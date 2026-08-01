'use strict';

/**
 * DiscoMine Lite — minecraft-data pruner
 * ---------------------------------------
 * `mineflayer` depends on the `minecraft-data` package, which ships JSON/proto
 * data for EVERY Minecraft version ever released, for BOTH Java ("pc") and
 * Bedrock editions. On disk that is 400+ MB, even though this bot:
 *   - only ever speaks Java Edition (mineflayer/minecraft-protocol never
 *     touch the "bedrock" data at runtime — see below), and
 *   - only ever connects using the single version set in MC_SERVER_VERSION.
 *
 * This script deletes the data this bot cannot use, without touching any
 * application logic:
 *   1. Deletes ALL Bedrock per-version data (bot is Java-only). It keeps
 *      `bedrock/common` because minecraft-data's index.js unconditionally
 *      `require()`s a couple of small files from it at load time.
 *   2. For the Java ("pc") side, it inspects minecraft-data's own data.js to
 *      find every version-folder that the configured MC_SERVER_VERSION
 *      actually references (a version's entry sometimes borrows a field,
 *      e.g. `biomes`, from a neighbouring version's folder — this reads
 *      those references directly out of the library instead of guessing),
 *      and keeps exactly that set (plus `common`/`latest`).
 *
 * This runs automatically via `npm install` (postinstall), so it re-applies
 * itself on every fresh install/deploy using whatever MC_SERVER_VERSION is
 * configured at that time. If it can't confidently resolve the pc version
 * set (e.g. MC_SERVER_VERSION is blank, or the library's internal layout
 * changes in a future update), it safely skips the pc pruning step rather
 * than risk deleting something the bot needs — the guaranteed-safe bedrock
 * cleanup still runs either way.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MC_DATA_PKG = path.join(ROOT, 'node_modules', 'minecraft-data');
const DATA_JS = path.join(MC_DATA_PKG, 'data.js');
const DATA_DIR = path.join(MC_DATA_PKG, 'minecraft-data', 'data');

const ALWAYS_KEEP_PC = new Set(['common', 'latest']);
const ALWAYS_KEEP_BEDROCK = new Set(['common']);

function readEnvVar(name) {
  const envPath = path.join(ROOT, '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const match = raw.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (!match) return null;
    return match[1].trim().replace(/^['"]|['"]$/g, '') || null;
  } catch {
    return null;
  }
}

function dirSizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else {
      try { total += fs.statSync(full).size; } catch { /* ignore */ }
    }
  }
  return total;
}

function humanMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function pruneEdition(editionDir, keepSet, label) {
  let names;
  try {
    names = fs.readdirSync(editionDir);
  } catch {
    console.log(`[prune-minecraft-data] no ${label} data directory found, skipping`);
    return { before: 0, after: 0 };
  }

  const before = dirSizeBytes(editionDir);
  let removed = 0;

  for (const name of names) {
    if (keepSet.has(name)) continue;
    const full = path.join(editionDir, name);
    let isDir = false;
    try { isDir = fs.statSync(full).isDirectory(); } catch { /* ignore */ }
    if (!isDir) continue;
    removeDir(full);
    removed += 1;
  }

  const after = dirSizeBytes(editionDir);
  console.log(`[prune-minecraft-data] ${label}: removed ${removed} version folder(s), ${humanMB(before)} -> ${humanMB(after)}`);
  return { before, after };
}

/**
 * Reads minecraft-data's data.js and returns the set of pc/<version> folder
 * names that the given minecraft version's entry actually requires (its own
 * folder plus any folder it borrows fields from).
 */
function resolvePcDependencies(mcVersion) {
  let source;
  try {
    source = fs.readFileSync(DATA_JS, 'utf8');
  } catch {
    return null;
  }

  const escaped = mcVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startMatch = source.match(new RegExp(`['"]${escaped}['"]:\\s*\\{`));
  if (!startMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = source.indexOf('\n    },', startIdx);
  if (endIdx === -1) return null;

  const block = source.slice(startIdx, endIdx);
  const folderRefs = new Set([mcVersion]);
  const re = /data\/pc\/([^/]+)\//g;
  let m;
  while ((m = re.exec(block)) !== null) {
    folderRefs.add(m[1]);
  }

  return folderRefs;
}

function main() {
  if (!fs.existsSync(MC_DATA_PKG)) {
    console.log('[prune-minecraft-data] minecraft-data not installed, nothing to prune');
    return;
  }

  const totalBefore = dirSizeBytes(DATA_DIR);

  // 1. Bedrock is never used by this bot (Java-only via mineflayer /
  //    minecraft-protocol) — always safe to strip every version folder.
  pruneEdition(path.join(DATA_DIR, 'bedrock'), ALWAYS_KEEP_BEDROCK, 'bedrock');

  // 2. Java ("pc") — only prune if we can confidently resolve exactly which
  //    folders the configured version needs.
  const mcVersion = readEnvVar('MC_SERVER_VERSION');
  if (!mcVersion) {
    console.log('[prune-minecraft-data] MC_SERVER_VERSION not set in .env, skipping pc data pruning (bedrock cleanup still applied)');
  } else {
    const deps = resolvePcDependencies(mcVersion);
    if (!deps) {
      console.log(`[prune-minecraft-data] could not resolve data dependencies for version "${mcVersion}", skipping pc data pruning to be safe`);
    } else {
      const keep = new Set([...ALWAYS_KEEP_PC, ...deps]);
      pruneEdition(path.join(DATA_DIR, 'pc'), keep, 'pc');
    }
  }

  const totalAfter = dirSizeBytes(DATA_DIR);
  console.log(`[prune-minecraft-data] total minecraft-data size: ${humanMB(totalBefore)} -> ${humanMB(totalAfter)}`);
}

main();
