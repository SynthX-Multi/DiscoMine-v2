'use strict';

const mineflayer = require('mineflayer');
const minecraftProtocol = require('minecraft-protocol');
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
  reconnectTimer: null,
  waitingTimer: null,
  connectionTimer: null,
  afkTimers: [],
};

const emitter = new EventEmitter();

function signalStateChange() {
  emitter.emit('stateChanged', getStatus());
}

function log(tag, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function getMode() {
  if (state.connected) return 'online';
  if (state.connecting || state.isReconnecting || state.waitingForEmpty) return 'reconnecting';
  return 'offline';
}

function clearTimer(name) {
  if (state[name]) {
    clearTimeout(state[name]);
    state[name] = null;
  }
}

function clearIntervals() {
  for (const id of state.afkTimers) clearInterval(id);
  state.afkTimers = [];
}

function clearAllTimers() {
  clearTimer('reconnectTimer');
  clearTimer('waitingTimer');
  clearTimer('connectionTimer');
}

function pingServerStatus() {
  return new Promise((resolve, reject) => {
    minecraftProtocol.ping(
      { host: config.server.ip, port: config.server.port, version: config.server.version || false },
      (err, data) => {
        if (err) return reject(err);
        resolve({
          online: !!data,
          playerCount: Number(data?.players?.online ?? data?.playerCount ?? 0) || 0,
          maxPlayers: Number(data?.players?.max ?? data?.maxPlayers ?? 0) || 0,
          raw: data,
        });
      },
    );
  });
}

async function startWaitingForEmptyServer() {
  if (state.manualStop || state.connected) return;

  clearAllTimers();
  state.connecting = false;
  state.isReconnecting = true;
  state.waitingForEmpty = true;
  signalStateChange();

  log('Bot', 'waiting for players to leave');

  const poll = async () => {
    if (state.manualStop || state.connected) return;

    try {
      const status = await pingServerStatus();
      state.playerCount = status.playerCount;
      signalStateChange();

      if (status.online && status.playerCount <= 0) {
        log('Bot', 'all players have left, reconnecting now');
        state.waitingForEmpty = false;
        state.isReconnecting = false;
        signalStateChange();
        createBot();
        return;
      }
    } catch (err) {
      log('Bot', `status ping failed while waiting: ${err.message}`);
    }

    if (!state.manualStop && !state.connected) {
      state.waitingTimer = setTimeout(poll, 20000);
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
  clearIntervals();
  clearAllTimers();

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
    server: `${config.server.ip}:${config.server.port}`,
  };
}

function startAFK(bot) {
  // lightweight anti-AFK: minimal resource usage, no pathfinder.
  clearIntervals();
  state.afkTimers.push(setInterval(() => {
    if (!state.connected || !bot) return;
    try { bot.swingArm(); } catch (_) {}
    try { bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4, true); } catch (_) {}
  }, 60000));
}

function checkAndActOnPlayers(bot) {
  if (!state.connected || !bot) return;

  const count = Object.values(bot.players || {}).filter((p) => p.username !== config.bot.username).length;
  state.playerCount = count;
  signalStateChange();

  if (count > 0) {
    log('Bot', `someone is in the server (${count} players), leaving to save energy`);
    emitter.emit('leftForPlayers', count);
    leaveForPlayers();
    return;
  }

  log('Bot', 'server is empty, holding slot');
  startAFK(bot);
  state.afkTimers.push(setInterval(() => {
    if (!state.connected || !bot) return;
    const c = Object.values(bot.players || {}).filter((p) => p.username !== config.bot.username).length;
    state.playerCount = c;
    signalStateChange();
    if (c > 0) {
      log('Bot', `someone joined (${c} players), leaving`);
      emitter.emit('leftForPlayers', c);
      leaveForPlayers();
    }
  }, 10000));
}

function leaveForPlayers() {
  if (!state.connected || state.leftForPlayers) return;
  state.leftForPlayers = true;
  state.waitingForEmpty = true;
  state.connecting = false;
  clearIntervals();
  clearAllTimers();
  signalStateChange();

  try {
    if (state.bot) state.bot.end('leaving — players online');
  } catch (e) {
    log('Bot', `error leaving: ${e.message}`);
  }
}

function rejoinASAP() {
  if (state.manualStop || state.isReconnecting) return;

  state.isReconnecting = true;
  state.connecting = false;
  state.reconnectAttempts += 1;

  const delay = 8000;
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

function createBot() {
  if (state.bot) {
    clearIntervals();
    try {
      state.bot.removeAllListeners();
      state.bot.end();
    } catch (_) {}
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
  } catch (err) {
    state.connecting = false;
    log('Bot', `failed to start: ${err.message}`);
    signalStateChange();
    if (!state.manualStop) rejoinASAP();
    return;
  }

  state.bot = bot;

  clearTimer('connectionTimer');
  state.connectionTimer = setTimeout(() => {
    if (!state.connected) {
      log('Bot', 'timed out, no spawn in 150s');
      try {
        bot.removeAllListeners();
        bot.end();
      } catch (_) {}
      state.bot = null;
      state.connecting = false;
      signalStateChange();
      if (!state.manualStop) rejoinASAP();
    }
  }, 150000);

  let spawnHandled = false;

  bot.once('spawn', () => {
    if (spawnHandled) return;
    spawnHandled = true;

    clearAllTimers();
    state.connected = true;
    state.connecting = false;
    state.startTime = Date.now();
    state.reconnectAttempts = 0;
    state.isReconnecting = false;
    state.waitingForEmpty = false;
    state.leftForPlayers = false;
    state.playerCount = 0;

    log('Bot', `joined! version ${bot.version}, watching players`);
    signalStateChange();
    emitter.emit('connected', { version: bot.version });

    setTimeout(() => checkAndActOnPlayers(bot), 2000);
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

module.exports = { start, stop, getStatus, emitter };
