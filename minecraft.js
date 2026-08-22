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

const mineflayer = require('mineflayer');
const minecraftProtocol = require('minecraft-protocol');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const EventEmitter = require('events');
const config = require('./config');

const state = {
  bot: null,
  connected: false,
  connecting: false,
  startTime: null,
  reconnectAttempts: 0,
  isReconnecting: false,
  manualStop: false,
  leftForPlayers: false,
  waitingForEmpty: false,
  playerCount: 0,
  intervals: [],
  statusPollTimer: null,
  reconnectTimer: null,
  connectionTimer: null,
  interleaveTimer: null,
  interleaving: false,
  nextInterleaveAt: null,
};

const emitter = new EventEmitter();

function signalStateChange() {
  emitter.emit('stateChanged', getStatus());
}

function clearIntervals() {
  state.intervals.forEach((id) => clearInterval(id));
  state.intervals = [];
}

function addInterval(fn, ms) {
  const id = setInterval(fn, ms);
  state.intervals.push(id);
  return id;
}

function clearTimers() {
  if (state.statusPollTimer) {
    clearTimeout(state.statusPollTimer);
    state.statusPollTimer = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.connectionTimer) {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
  }
  if (state.interleaveTimer) {
    clearTimeout(state.interleaveTimer);
    state.interleaveTimer = null;
    state.nextInterleaveAt = null;
  }
}

function log(tag, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function getMode() {
  if (state.connected) return 'online';
  if (state.connecting || state.isReconnecting) return 'reconnecting';
  return 'offline';
}

function pingServerStatus() {
  return new Promise((resolve, reject) => {
    minecraftProtocol.ping(
      {
        host: config.server.ip,
        port: config.server.port,
      },
      (err, data) => {
        if (err) return reject(err);
        const playerCount = Number(data?.players?.online ?? data?.playerCount ?? 0) || 0;
        const maxPlayers = Number(data?.players?.max ?? data?.maxPlayers ?? 0) || 0;
        resolve({
          online: !!data,
          playerCount,
          maxPlayers,
          raw: data,
        });
      },
    );
  });
}

async function startWaitingForEmptyServer() {
  if (state.manualStop || state.connected) return;

  clearTimers();
  state.connecting = false;
  state.isReconnecting = true;
  state.waitingForEmpty = true;
  signalStateChange();

  // Seed with whatever the caller already knows/logged (e.g. "someone is in
  // the server (N players)...") so the first poll doesn't immediately repeat
  // the same news. null means "we don't know yet / it was empty before".
  let lastLoggedCount = state.playerCount > 0 ? state.playerCount : null;

  const poll = async () => {
    if (state.manualStop || state.connected) return;

    try {
      const status = await pingServerStatus();
      state.playerCount = status.playerCount;
      signalStateChange();

      if (status.online && status.playerCount <= 0) {
        log('Bot', lastLoggedCount !== null ? 'everyone left, rejoining' : 'server is empty, rejoining');
        state.waitingForEmpty = false;
        state.isReconnecting = false;
        signalStateChange();
        createBot();
        return;
      }

      // Only log when someone new joins (count goes up from what we last
      // announced) — not on every poll while we're just sitting here waiting.
      if (status.online && (lastLoggedCount === null || status.playerCount > lastLoggedCount)) {
        log('Bot', `someone joined (${status.playerCount} online), waiting for them to leave`);
        lastLoggedCount = status.playerCount;
      } else if (status.online) {
        lastLoggedCount = status.playerCount;
      }
    } catch (err) {
      log('Bot', `status ping failed while waiting: ${err.message}`);
    }

    if (!state.manualStop && !state.connected) {
      state.statusPollTimer = setTimeout(poll, 8_000);
    }
  };

  await poll();
}


async function start() {
  if (state.connected || state.connecting || state.isReconnecting || state.waitingForEmpty) {
    log('Bot', 'already running or waiting');
    return;
  }

  state.manualStop = false;
  state.leftForPlayers = false;
  state.waitingForEmpty = false;
  state.interleaving = false;
  state.reconnectAttempts = 0;
  state.connecting = true;
  signalStateChange();

  try {
    const status = await pingServerStatus();
    state.playerCount = status.playerCount;
    signalStateChange();

    if (status.online && status.playerCount > 0) {
      log('Bot', `players are already online (${status.playerCount}), waiting for them to leave`);
      await startWaitingForEmptyServer();
      return;
    }

    if (status.online && status.playerCount <= 0) {
      log('Bot', 'server is empty, joining now');
    } else {
      log('Bot', 'status ping unavailable, trying to join directly');
    }
  } catch (err) {
    log('Bot', `initial status ping failed: ${err.message}`);
    log('Bot', 'trying to join directly');
  }

  createBot();
}

function stop() {
  state.manualStop = true;
  state.leftForPlayers = false;
  state.waitingForEmpty = false;
  state.connecting = false;
  state.interleaving = false;
  clearTimers();
  clearIntervals();

  if (state.bot) {
    try {
      state.bot.removeAllListeners();
      state.bot.end();
    } catch (e) {
      log('Bot', `error stopping: ${e.message}`);
    }
    state.bot = null;
  }

  state.connected = false;
  state.isReconnecting = false;
  state.playerCount = 0;
  log('Bot', 'stopped');
  signalStateChange();
  emitter.emit('stopped');
}

function getStatus() {
  return {
    mode: getMode(),
    connected: state.connected,
    connecting: state.connecting,
    leftForPlayers: state.leftForPlayers,
    waitingForEmpty: state.waitingForEmpty,
    playerCount: state.playerCount,
    uptime: state.connected && state.startTime
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : 0,
    reconnectAttempts: state.reconnectAttempts,
    interleaving: state.interleaving,
    nextInterleaveAt: state.nextInterleaveAt,
    server: `${config.server.ip}:${config.server.port}`,
  };
}

function createBot() {
  if (state.bot) {
    clearIntervals();
    try {
      state.bot.removeAllListeners();
      state.bot.end();
    } catch (_) { }
    state.bot = null;
  }

  state.connecting = true;
  state.waitingForEmpty = false;
  signalStateChange();

  log('Bot', `connecting to ${config.server.ip}:${config.server.port}...`);
  emitter.emit('connecting', getStatus());

  let bot;
  try {
    const mcVersion = config.server.version || false;
    if (mcVersion) {
      log('Bot', `using version ${mcVersion}`);
    } else {
      log('Bot', 'no version pinned, auto detecting');
    }

    bot = mineflayer.createBot({
      username: config.bot.username,
      password: config.bot.password || undefined,
      auth: config.bot.auth,
      host: config.server.ip,
      port: config.server.port,
      version: mcVersion,
      hideErrors: false,
      checkTimeoutInterval: 600000,
    });
    bot.loadPlugin(pathfinder);
  } catch (err) {
    state.connecting = false;
    log('Bot', `failed to start: ${err.message}`);
    signalStateChange();
    if (!state.manualStop) rejoinASAP();
    return;
  }

  state.bot = bot;

  clearTimers();
  state.connectionTimer = setTimeout(() => {
    if (!state.connected) {
      log('Bot', 'timed out, no spawn in 150s');
      try {
        bot.removeAllListeners();
        bot.end();
      } catch (_) { }
      state.bot = null;
      state.connecting = false;
      signalStateChange();
      if (!state.manualStop) rejoinASAP();
    }
  }, 150_000);

  let spawnHandled = false;

  bot.once('spawn', () => {
    if (spawnHandled) return;
    spawnHandled = true;

    clearTimers();
    state.connected = true;
    state.connecting = false;
    state.startTime = Date.now();
    state.reconnectAttempts = 0;
    state.isReconnecting = false;
    state.waitingForEmpty = false;
    state.leftForPlayers = false;
    state.interleaving = false;

    log('Bot', `joined! version ${bot.version}, watching players`);
    signalStateChange();
    emitter.emit('connected', { version: bot.version });

    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.allowFreeMotion = false;
    movements.canDig = false;
    movements.liquidCost = 9999;
    movements.fallDamageCost = 9999;

    setTimeout(() => checkAndActOnPlayers(bot, movements), 2_000);
    scheduleInterleaving();
  });

  bot.on('kicked', (reason) => {
    const r = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    log('Bot', `kicked: ${r}`);
    state.connected = false;
    state.connecting = false;
    clearIntervals();
    signalStateChange();
    emitter.emit('kicked', r);
  });

  bot.on('end', (reason) => {
    log('Bot', `disconnected: ${reason || 'unknown'}`);
    state.connected = false;
    state.connecting = false;
    state.playerCount = 0;
    clearIntervals();
    signalStateChange();
    emitter.emit('disconnected', reason);

    if (state.manualStop) return;

    if (state.leftForPlayers) {
      log('Bot', 'left because players were on, waiting for empty server');
      startWaitingForEmptyServer();
    } else if (state.interleaving) {
      log('Bot', 'interleaving disconnect complete, checking server before rejoining');
      // NOTE: state.interleaving stays true here on purpose. The interleave
      // cycle isn't done until the bot has actually rejoined (cleared on
      // spawn) — clearing it here made the flag go false for the entire
      // wait-for-empty/rejoin window, which is most of the cycle. That's
      // also why the panel could never show an "interleaving" state.
      startWaitingForEmptyServer();
    } else {
      log('Bot', 'unexpected disconnection, attempting rejoin...');
      emitter.emit('kicked_reconnect');
      rejoinASAP();
    }
  });

  bot.on('error', (err) => {
    log('Bot', `error: ${err.message}`);
  });
}

function scheduleInterleaving() {
  if (!config.features.interleaving.enabled) return;

  const delayMs = config.features.interleaving.intervalHours * 60 * 60 * 1000;
  state.nextInterleaveAt = Date.now() + delayMs;
  state.interleaveTimer = setTimeout(() => {
    state.interleaveTimer = null;
    state.nextInterleaveAt = null;

    if (!state.connected || !state.bot || state.manualStop) return;

    state.interleaving = true;
    state.connecting = false;
    state.waitingForEmpty = true;
    clearIntervals();
    signalStateChange();

    log(
      'Bot',
      `interleaving after ${config.features.interleaving.intervalHours} hour(s); disconnecting and checking server before rejoining`,
    );

    try {
      state.bot.end('scheduled interleaving');
    } catch (err) {
      log('Bot', `error during scheduled interleaving: ${err.message}`);
      state.interleaving = false;
      state.waitingForEmpty = false;
      if (!state.manualStop) rejoinASAP();
    }
  }, delayMs);
}

function startAntiAFK(bot, movements) {
  addInterval(() => {
    if (!state.connected || !bot) return;
    try {
      bot.swingArm();
    } catch (_) { }
  }, 15_000 + Math.random() * 45_000);

  addInterval(() => {
    if (!state.connected || !bot) return;
    try {
      bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * Math.PI / 2, true);
    } catch (_) { }
  }, 8_000 + Math.random() * 12_000);

  addInterval(() => {
    if (!state.connected || !bot) return;
    try {
      bot.setQuickBarSlot(Math.floor(Math.random() * 9));
    } catch (_) { }
  }, 30_000 + Math.random() * 60_000);

  addInterval(() => {
    if (!state.connected || !bot || typeof bot.setControlState !== 'function') return;
    try {
      bot.look(Math.random() * Math.PI * 2, 0, true);
      bot.setControlState('forward', true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === 'function') {
          bot.setControlState('forward', false);
        }
      }, 500 + Math.random() * 1_500);
    } catch (_) { }
  }, 120_000 + Math.random() * 240_000);

  addInterval(() => {
    if (!state.connected || !bot || typeof bot.setControlState !== 'function') return;
    if (Math.random() > 0.6) {
      try {
        bot.setControlState('sneak', true);
        setTimeout(() => {
          if (bot && typeof bot.setControlState === 'function') {
            bot.setControlState('sneak', false);
          }
        }, 300 + Math.random() * 800);
      } catch (_) { }
    }
  }, 60_000 + Math.random() * 90_000);

  addInterval(() => {
    if (!state.connected || !bot || typeof bot.setControlState !== 'function') return;
    try {
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === 'function') {
          bot.setControlState('jump', false);
        }
      }, 100);
    } catch (_) { }
  }, 90_000 + Math.random() * 180_000);

  log('AntiAFK', 'anti AFK started');
}

function checkAndActOnPlayers(bot, movements) {
  if (!state.connected || !bot) return;

  const count = Object.values(bot.players || {})
    .filter((p) => p.username !== config.bot.username)
    .length;
  state.playerCount = count;
  signalStateChange();

  if (count > 0) {
    log('Bot', `someone is in the server (${count} players), leaving to save energy`);
    emitter.emit('leftForPlayers', count);
    leaveForPlayers();
  } else {
    log('Bot', 'server is empty, holding slot');
    startAntiAFK(bot, movements);
    addInterval(() => {
      if (!state.connected || !bot) return;
      const c = Object.values(bot.players || {})
        .filter((p) => p.username !== config.bot.username)
        .length;
      state.playerCount = c;
      signalStateChange();
      if (c > 0) {
        log('Bot', `someone joined (${c} players), leaving`);
        emitter.emit('leftForPlayers', c);
        leaveForPlayers();
      }
    }, 5_000);
  }
}

function leaveForPlayers() {
  if (!state.connected || state.leftForPlayers) return;
  state.leftForPlayers = true;
  state.waitingForEmpty = true;
  state.connecting = false;
  clearIntervals();
  clearTimers();
  signalStateChange();

  try {
    if (state.bot) state.bot.end('leaving — players online');
  } catch (e) {
    log('Bot', `error leaving: ${e.message}`);
  }
}

function rejoinASAP() {
  if (state.manualStop) return;
  if (state.isReconnecting) return;

  state.isReconnecting = true;
  state.connecting = false;
  state.reconnectAttempts++;

  const delay = 8_000;
  log('Bot', `checking again in 8s (attempt #${state.reconnectAttempts})`);
  signalStateChange();
  emitter.emit('reconnecting', { attempt: state.reconnectAttempts, delayMs: delay });

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.isReconnecting = false;
    state.connecting = true;
    signalStateChange();
    createBot();
  }, delay);
}

module.exports = { start, stop, getStatus, emitter };
