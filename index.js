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

async function findExistingPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;

  const found = messages.find((message) => {
    if (message.author?.id !== client.user?.id) return false;
    const embed = message.embeds?.[0];
    return typeof embed?.title === 'string' && embed.title.endsWith(PANEL_TITLE);
  });

  return found || null;
}

async function refreshStatusPanel() {
  const channel = await fetchStatusChannel();
  if (!channel || !client.user) return null;

  const status = mc.getStatus();
  const payload = buildStatusCard(status);

  if (!panelMessage) {
    panelMessage = await findExistingPanel(channel);
  }

  try {
    if (panelMessage) {
      await panelMessage.edit(payload);
      return panelMessage;
    }
  } catch (_) {
    panelMessage = null;
  }

  try {
    panelMessage = await channel.send(payload);
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

  const status = mc.getStatus();

  if (interaction.customId === 'panel_start') {
    if (status.mode !== 'offline') {
      return interaction.reply({
        content: `The bot is already ${status.waitingForEmpty ? 'waiting for players to leave' : status.mode}.`,
        ephemeral: true,
      });
    }

    mc.start();
    await schedulePanelRefresh();

    return interaction.reply({
      content: 'Start requested. The bot will now check whether the server is empty and wait if needed.',
      ephemeral: true,
    });
  }

  if (interaction.customId === 'panel_stop') {
    if (status.mode === 'offline') {
      return interaction.reply({
        content: 'The bot is already offline.',
        ephemeral: true,
      });
    }

    mc.stop();
    await schedulePanelRefresh();

    return interaction.reply({
      content: 'Stop requested. The status panel has been updated.',
      ephemeral: true,
    });
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[Discord] logged in as ${c.user.tag}`);

  await clearSlashCommands();

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
