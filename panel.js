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

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, EmbedBuilder } = require('discord.js');

const PANEL_TITLE = 'DiscoMine Panel';

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}

function getModeMeta(mode, status = {}) {
  switch (mode) {
    case 'online':
      return {
        label: 'Online',
        emoji: '🟢',
        color: Colors.Green,
        blurb: 'Bot is in the server and holding the slot.',
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        emoji: '🟡',
        color: Colors.Yellow,
        blurb: status.waitingForEmpty
          ? 'Bot is waiting for players to leave before rejoining.'
          : 'Bot is trying to connect again right now.',
      };
    case 'offline':
    default:
      return {
        label: 'Offline',
        emoji: '🔴',
        color: Colors.DarkGrey,
        blurb: 'Bot is stopped and not connected.',
      };
  }
}

function buildPanelEmbed(status, config) {
  const mode = status.mode || 'offline';
  const meta = getModeMeta(mode, status);
  const uptime = mode === 'online' ? formatUptime(status.uptime) : '—';

  return new EmbedBuilder()
    .setTitle(`${meta.emoji} ${PANEL_TITLE}`)
    .setColor(meta.color)
    .setDescription(
      meta.blurb
    )
    .addFields(
      {
        name: 'Server',
        value: `\`${status.server}\``,
        inline: true,
      },
      {
        name: 'Players Online',
        value: `${status.playerCount}`,
        inline: true,
      },
      {
        name: 'Uptime',
        value: uptime,
        inline: true,
      },
      {
        name: 'Reconnect Attempts',
        value: `${status.reconnectAttempts}`,
        inline: true,
      },
      {
        name: 'Bot Username',
        value: `\`${config.bot.username}\``,
        inline: true,
      },
      {
        name: 'Mode',
        value: `${meta.emoji} **${meta.label}**`,
        inline: true,
      },
      ...(status.waitingForEmpty ? [{
        name: 'Waiting For',
        value: 'Players to leave',
        inline: true,
      }] : []),
    )
    .setFooter({ text: 'made by akahn • DiscoMine control panel' })
    .setTimestamp();
}

function buildPanelRow(status) {
  const mode = status.mode || 'offline';
  const startDisabled = mode !== 'offline';
  const stopDisabled = mode === 'offline';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel_start')
      .setLabel('Start Bot')
      .setStyle(ButtonStyle.Success)
      .setDisabled(startDisabled),
    new ButtonBuilder()
      .setCustomId('panel_stop')
      .setLabel('Stop Bot')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(stopDisabled),
  );
}

module.exports = {
  PANEL_TITLE,
  buildPanelEmbed,
  buildPanelRow,
  formatUptime,
};
