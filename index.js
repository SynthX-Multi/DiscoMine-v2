'use strict';

const { Client, GatewayIntentBits, ActivityType, Events, Options, MessageFlags } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');

const config = require('./config');
const mc = require('./minecraft');
const { PANEL_TITLE, buildPanelEmbed, buildPanelRow } = require('./panel');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  // This bot never reads message content and only ever needs the specific
  // messages it explicitly fetches (the panel message, or the handful of
  // candidates scanned once while resolving it). Capping these caches keeps
  // long-running memory usage flat instead of growing with every channel
  // the bot can see, which matters on small (512 MiB-class) hosts.
  makeCache: Options.cacheWithLimits({
    MessageManager: 25,
    GuildMemberManager: 25,
    UserManager: 25,
    PresenceManager: 0,
    ReactionManager: 0,
    GuildStickerManager: 0,
    GuildEmojiManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    VoiceStateManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 900,
      lifetime: 900,
    },
  },
});

let panelMessage = null;
let panelRefreshQueue = Promise.resolve();
const PANEL_STATE_FILE = path.join(__dirname, '.panel-state.json');

function buildStatusEmbed(status) {
  return buildPanelEmbed(status, config);
}

function buildStatusCard(status) {
  return {
    embeds: [buildStatusEmbed(status)],
    components: [buildPanelRow(status)],
  };
}

async function fetchStatusChannel() {
  if (!config.discord.statusChannelId) return null;
  const channel = await client.channels.fetch(config.discord.statusChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function loadPanelState() {
  try {
    const raw = await fs.readFile(PANEL_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      channelId: typeof parsed.channelId === 'string' ? parsed.channelId : null,
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : null,
    };
  } catch {
    return { channelId: null, messageId: null };
  }
}

async function savePanelState(channelId, messageId) {
  try {
    await fs.writeFile(
      PANEL_STATE_FILE,
      JSON.stringify({ channelId, messageId }, null, 2),
      'utf8',
    );
  } catch (err) {
    console.error('[Panel] failed to save panel state:', err.message);
  }
}

async function fetchPanelCandidates(channel) {
  const candidates = [];
  let before = null;

  for (let page = 0; page < 10; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const message of batch.values()) {
      if (message.author?.id !== client.user?.id) continue;
      const embed = message.embeds?.[0];
      if (!embed?.title) continue;
      if (embed.title === PANEL_TITLE || embed.title.endsWith(PANEL_TITLE)) {
        candidates.push(message);
      }
    }

    const last = batch.last();
    if (!last) break;
    before = last.id;

    if (batch.size < 100) break;
  }

  candidates.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  return candidates;
}

async function resolvePanelMessage(channel) {
  const state = await loadPanelState();

  if (state.channelId === channel.id && state.messageId) {
    const remembered = await channel.messages.fetch(state.messageId).catch(() => null);
    if (remembered?.author?.id === client.user?.id) {
      const embed = remembered.embeds?.[0];
      if (embed?.title === PANEL_TITLE || embed?.title?.endsWith(PANEL_TITLE)) {
        return remembered;
      }
    }
  }

  const candidates = await fetchPanelCandidates(channel);
  if (candidates.length > 0) {
    const [latest, ...duplicates] = candidates;
    for (const dup of duplicates) {
      await dup.delete().catch(() => null);
    }
    await savePanelState(channel.id, latest.id);
    return latest;
  }

  return null;
}

async function refreshStatusPanel() {
  const channel = await fetchStatusChannel();
  if (!channel || !client.user) return null;

  const status = mc.getStatus();
  const payload = buildStatusCard(status);

  if (!panelMessage) {
    panelMessage = await resolvePanelMessage(channel);
  }

  try {
    if (panelMessage) {
      await panelMessage.edit(payload);
      await savePanelState(channel.id, panelMessage.id);
      return panelMessage;
    }
  } catch (_) {
    panelMessage = null;
  }

  try {
    panelMessage = await channel.send(payload);
    await savePanelState(channel.id, panelMessage.id);
    return panelMessage;
  } catch (err) {
    console.error('[Panel] failed to render status panel:', err.message);
    return null;
  }
}

function schedulePanelRefresh() {
  panelRefreshQueue = panelRefreshQueue
    .then(() => refreshStatusPanel())
    .catch((err) => {
      console.error('[Panel] refresh failed:', err.message);
    });
  return panelRefreshQueue;
}

function updatePresence() {
  if (!client.user) return;
  const status = mc.getStatus();

  if (status.mode === 'online') {
    client.user.setPresence({
      status: 'online',
      activities: [{
        name: `holding slot on ${config.server.ip}`,
        type: ActivityType.Watching,
      }],
    });
  } else if (status.mode === 'reconnecting') {
    client.user.setPresence({
      status: 'idle',
      activities: [{
        name: status.waitingForEmpty
          ? `waiting for players to leave on ${config.server.ip}`
          : `reconnecting to ${config.server.ip}`,
        type: ActivityType.Watching,
      }],
    });
  } else {
    client.user.setPresence({
      status: 'dnd',
      activities: [{
        name: 'offline — press Start Bot',
        type: ActivityType.Custom,
      }],
    });
  }
}

mc.emitter.on('stateChanged', () => {
  updatePresence();
  schedulePanelRefresh();
});

mc.emitter.on('leftForPlayers', (count) => {
  console.log(`[Bot] left because ${count} player(s) were online`);
});

mc.emitter.on('kicked', (reason) => {
  console.log(`[Bot] kicked: ${reason}`);
});

mc.emitter.on('kicked_reconnect', () => {
  console.log('[Bot] reconnecting after disconnect');
});

mc.emitter.on('stopped', () => {
  console.log('[Bot] stopped');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const status = mc.getStatus();

    if (interaction.customId === 'panel_start') {
      await interaction.reply({
        content: status.mode !== 'offline'
          ? `The bot is already ${status.waitingForEmpty ? 'waiting for players to leave' : status.mode}.`
          : 'Start requested. The panel will update as soon as the bot state changes.',
        flags: MessageFlags.Ephemeral,
      });

      if (status.mode === 'offline') {
        mc.start();
        await schedulePanelRefresh();
      }
      return;
    }

    if (interaction.customId === 'panel_stop') {
      await interaction.reply({
        content: status.mode === 'offline'
          ? 'The bot is already offline.'
          : 'Stop requested. The panel will update as soon as the bot stops.',
        flags: MessageFlags.Ephemeral,
      });

      if (status.mode !== 'offline') {
        mc.stop();
        await schedulePanelRefresh();
      }
      return;
    }

    await interaction.reply({
      content: 'Unknown button action.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error('[Discord] button interaction failed:', err.message);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: 'Something went wrong while processing that action.',
        });
      } else {
        await interaction.reply({
          content: 'Something went wrong while processing that action.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (_) {
      // Ignore secondary message failures
    }
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[Discord] logged in as ${c.user.tag}`);

  const channel = await fetchStatusChannel();
  if (channel) {
    panelMessage = await resolvePanelMessage(channel);
  }

  updatePresence();
  mc.start();
  await schedulePanelRefresh();

  console.log('[Bot] starting live status panel...');
  setInterval(updatePresence, 120_000);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandled Rejection:', reason);
});

console.log('[Bot] starting discord bot...');
client.login(config.discord.token);
