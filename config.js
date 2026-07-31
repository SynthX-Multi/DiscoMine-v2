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

require('dotenv').config();

function clean(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
}

const config = {
  discord: {
    token: clean(process.env.DISCORD_TOKEN),
    clientId: clean(process.env.CLIENT_ID),
    guildId: clean(process.env.GUILD_ID),
    statusChannelId: clean(process.env.STATUS_CHANNEL_ID),
  },
  server: {
    ip: clean(process.env.MC_SERVER_IP) || 'yourserver.aternos.me',
    port: parseInt(clean(process.env.MC_SERVER_PORT) || '25565', 10),
    version: clean(process.env.MC_SERVER_VERSION) || null,
  },
  bot: {
    username: clean(process.env.MC_USERNAME) || 'DiscoMineAFK',
    password: clean(process.env.MC_PASSWORD),
    auth: clean(process.env.MC_AUTH) || 'offline',
  },
};

const missing = [];
if (!config.discord.token) missing.push('DISCORD_TOKEN');
if (!config.discord.clientId) missing.push('CLIENT_ID');
if (!config.discord.guildId) missing.push('GUILD_ID');
if (!config.server.ip || config.server.ip === 'yourserver.aternos.me') missing.push('MC_SERVER_IP');

if (missing.length > 0) {
  console.error(`[Config] Missing required env vars: ${missing.join(', ')}`);
  console.error('[Config] Fill in your .env file and restart.');
  process.exit(1);
}

module.exports = config;
