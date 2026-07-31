'use strict';

// Copyright (C) 2026 DiscoMine Contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
  REST,
  Routes,
} = require('discord.js');
const fs = require('fs/promises');
const path = require('path');

const config = require('./config');
const mc = require('./minecraft');
const {
  PANEL_TITLE,
  buildPanelEmbed,
  buildPanelRow,
} = require('./panel');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

let panelMessage = null;
let panelRefreshQueue = Promise.resolve();
const PANEL_STATE_FILE = path.join(__dirname, '.panel-state.json');


async function clearSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  try {
    console.log('[Discord] removing slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: [] },
    );
    console.log('[Discord] slash commands removed.');
  } catch (err) {
    console.error('[Discord] failed to remove slash commands:', err.message);
  }
}

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

mc.emitter.on('connected', ({ version }) => {
  console.log(`[Bot] connected using version ${version}`);
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

mc.emitter.on('disconnected', (reason) => {
  console.log(`[Bot] disconnected: ${reason || 'unknown'}`);
});

mc.emitter.on('reconnecting', ({ attempt, delayMs }) => {
  console.log(`[Bot] rejoin attempt #${attempt} in ${(delayMs / 1000).toFixed(1)}s`);
});

mc.emitter.on('stopped', () => {
  console.log('[Bot] stopped');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const status = mc.getStatus();

    // Panel interaction reply
    if (interaction.customId === 'panel_start') {
      await interaction.reply({
        content: status.mode !== 'offline'
          ? `The bot is already ${status.waitingForEmpty ? 'waiting for players to leave' : status.mode}.`
          : 'Start requested. The panel will update as soon as the bot state changes.',
        ephemeral: true,
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
        ephemeral: true,
      });

      if (status.mode !== 'offline') {
        mc.stop();
        await schedulePanelRefresh();
      }
      return;
    }

    await interaction.reply({
      content: 'Unknown button action.',
      ephemeral: true,
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
          ephemeral: true,
        });
      }
    } catch (_) {
      // Ignore secondary message failures
    }
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[Discord] logged in as ${c.user.tag}`);

  await clearSlashCommands();

  const channel = await fetchStatusChannel();
  if (channel) {
    panelMessage = await resolvePanelMessage(channel);
  }

  updatePresence();
  mc.start();
  await schedulePanelRefresh();

  console.log('[Bot] starting live status panel...');
  setInterval(updatePresence, 60_000);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandled Rejection:', reason);
});

console.log('[Bot] starting discord bot...');
client.login(config.discord.token);
