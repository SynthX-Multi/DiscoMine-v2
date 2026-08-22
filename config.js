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

// ─────────────────────────────────────────────────────────────────────────────
// config.js — Centralised config loader from .env variables
// ─────────────────────────────────────────────────────────────────────────────

const config = {
  discord: {
    token:           process.env.DISCORD_TOKEN      || '',
    clientId:        process.env.CLIENT_ID          || '',
    guildId:         process.env.GUILD_ID           || '',
    statusChannelId: process.env.STATUS_CHANNEL_ID  || '',
  },
  server: {
    ip:      process.env.MC_SERVER_IP                    || 'yourserver.aternos.me',
    port:    parseInt(process.env.MC_SERVER_PORT || '25565', 10),
    version: process.env.MC_SERVER_VERSION               || null, // null = auto-detect
  },
  bot: {
    username: process.env.MC_USERNAME || 'DiscoMineAFK',
    password: process.env.MC_PASSWORD || '',
    auth:     process.env.MC_AUTH     || 'offline',
  },
};

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;

  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;

  console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} is invalid; using ${fallback}.`);
  return fallback;
}

function parsePositiveNumberEnv(name, fallback, minimum = Number.EPSILON) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (Number.isFinite(value) && value >= minimum) return value;

  console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} is invalid; using ${fallback}.`);
  return fallback;
}

function parseTimeEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;

  const match = /^(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) {
    console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} must use HH:mm; using ${fallback}.`);
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} is outside 00:00-23:59; using ${fallback}.`);
    return fallback;
  }

  return `${match[1]}:${match[2]}`;
}

// Parses a fixed UTC offset like "+8", "-5", "+05:30", "-3:00", "UTC+8".
// Returns the offset in minutes east of UTC, or null to mean "use the
// server/system's local timezone" (the previous, timezone-naive behaviour).
function parseUtcOffsetEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;

  const normalized = raw.trim().toUpperCase();
  if (normalized === 'LOCAL' || normalized === 'SYSTEM') return null;
  if (normalized === 'UTC' || normalized === 'Z') return 0;

  const match = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized);
  if (!match) {
    console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} must look like "+8", "-05:30", or "UTC"; using ${fallback === null ? 'local time' : fallback}.`);
    return fallback;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');

  if (hours > 14 || minutes > 59) {
    console.warn(`[Config] ⚠️  ${name}=${JSON.stringify(raw)} is outside a valid UTC offset range; using ${fallback === null ? 'local time' : fallback}.`);
    return fallback;
  }

  return sign * (hours * 60 + minutes);
}

const runtimeDefaults = {
  autoShutdownEnabled: false,
  autoShutdownTime: '04:00',
  autoShutdownUtcOffsetMinutes: null,
  interleavingEnabled: false,
  interleavingIntervalHours: 3,
};

config.features = {
  autoShutdown: {
    enabled: parseBooleanEnv('AUTO_SHUTDOWN_ENABLED', runtimeDefaults.autoShutdownEnabled),
    time: parseTimeEnv('AUTO_SHUTDOWN_TIME', runtimeDefaults.autoShutdownTime),
    // null = interpret AUTO_SHUTDOWN_TIME in whatever timezone the host process runs in
    utcOffsetMinutes: parseUtcOffsetEnv('AUTO_SHUTDOWN_UTC_OFFSET', runtimeDefaults.autoShutdownUtcOffsetMinutes),
  },
  interleaving: {
    enabled: parseBooleanEnv('INTERLEAVING_ENABLED', runtimeDefaults.interleavingEnabled),
    intervalHours: parsePositiveNumberEnv(
      'INTERLEAVING_INTERVAL_HOURS',
      runtimeDefaults.interleavingIntervalHours,
    ),
  },
};

// Validate required fields
const missing = [];
if (!config.discord.token)    missing.push('DISCORD_TOKEN');
if (!config.discord.clientId) missing.push('CLIENT_ID');
if (!config.discord.guildId)  missing.push('GUILD_ID');
if (!config.server.ip || config.server.ip === 'yourserver.aternos.me') missing.push('MC_SERVER_IP');

if (missing.length > 0) {
  console.error(`[Config] ❌  Missing required env vars: ${missing.join(', ')}`);
  console.error('[Config]    Fill in your .env file and restart.');
  process.exit(1);
}

module.exports = config;
