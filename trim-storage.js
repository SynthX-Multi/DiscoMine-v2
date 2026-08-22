#!/usr/bin/env node
/**
 * Post-install storage trimmer.
 *
 * DiscoMine depends on `minecraft-data`, which ships gameplay data for
 * BOTH Minecraft Bedrock Edition and Java Edition. This bot only ever
 * speaks the Java Edition protocol (via mineflayer / minecraft-protocol),
 * so the `data/bedrock` dataset inside `minecraft-data` is never read by
 * any code path in this project — it's dead weight, and by far the
 * largest thing in node_modules.
 *
 * Rather than deleting all of it (which would drop total project size
 * well below the desired floor), this script deletes just enough of the
 * unused Bedrock version folders — largest first, then topped up with
 * smaller ones — to bring total on-disk project size into a target
 * window (460-512 MiB). Java/"pc" data and every other dependency are
 * never touched.
 *
 * Safe to re-run any time (e.g. after every `npm install`) — it's
 * idempotent and only ever removes files under data/bedrock.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname);
const BEDROCK_DIR = path.join(
  PROJECT_ROOT,
  'node_modules', 'minecraft-data', 'minecraft-data', 'data', 'bedrock'
);

const MIB = 1024 * 1024;
const TARGET_MIN = 460 * MIB;
const TARGET_MAX = 512 * MIB;

function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      try {
        const st = fs.statSync(full);
        // Use on-disk block usage (matches `du`/hosting dashboards),
        // not apparent byte size, since small-file overhead is
        // significant here (minecraft-data ships ~1,000+ tiny files).
        total += st.blocks * 512;
      } catch {
        // File vanished mid-walk, ignore.
      }
    }
  }
  return total;
}

function fmt(bytes) {
  return (bytes / MIB).toFixed(1) + ' MiB';
}

function main() {
  if (!fs.existsSync(BEDROCK_DIR)) {
    console.log('[trim-storage] No Bedrock data folder found (already trimmed, or dependency changed) - skipping.');
    return;
  }

  const projectSize = dirSize(PROJECT_ROOT);
  console.log(`[trim-storage] Current project size: ${fmt(projectSize)}`);

  if (projectSize >= TARGET_MIN && projectSize <= TARGET_MAX) {
    console.log('[trim-storage] Already within target window (460-512 MiB) - nothing to do.');
    return;
  }
  if (projectSize < TARGET_MIN) {
    console.log('[trim-storage] Already below 460 MiB - leaving remaining Bedrock data alone.');
    return;
  }

  const neededMin = projectSize - TARGET_MAX; // must remove at least this much
  const neededMax = projectSize - TARGET_MIN; // must not remove more than this

  const versions = fs.readdirSync(BEDROCK_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'common')
    .map((e) => {
      const full = path.join(BEDROCK_DIR, e.name);
      return { name: e.name, path: full, size: dirSize(full) };
    });

  const totalBedrock = versions.reduce((sum, v) => sum + v.size, 0);
  console.log(`[trim-storage] Unused Bedrock data available to trim: ${fmt(totalBedrock)} across ${versions.length} version folders.`);

  if (totalBedrock < neededMin) {
    console.warn('[trim-storage] Even all unused Bedrock data isn\'t enough to reach 512 MiB. Removing all of it; project will still be above target.');
  }

  // Pass 1: largest-first, skip anything that would blow past the max removal allowed.
  versions.sort((a, b) => b.size - a.size);
  const toRemove = [];
  let removed = 0;
  const remaining = [];

  for (const v of versions) {
    if (removed + v.size <= neededMax) {
      toRemove.push(v);
      removed += v.size;
    } else {
      remaining.push(v);
    }
  }

  // Pass 2: if still short of the minimum required removal, top up with the
  // smallest remaining folders without exceeding the max.
  remaining.sort((a, b) => a.size - b.size);
  for (const v of remaining) {
    if (removed >= neededMin) break;
    if (removed + v.size <= neededMax) {
      toRemove.push(v);
      removed += v.size;
    }
  }

  // Fallback: if we still can't reach the minimum with exact combinations,
  // just remove everything found (best effort, reported honestly).
  if (removed < neededMin) {
    for (const v of versions) {
      if (!toRemove.includes(v)) {
        toRemove.push(v);
        removed += v.size;
      }
    }
  }

  for (const v of toRemove) {
    fs.rmSync(v.path, { recursive: true, force: true });
  }

  const finalSize = projectSize - removed;
  console.log(`[trim-storage] Removed ${toRemove.length} unused Bedrock version folder(s), freeing ${fmt(removed)}.`);
  console.log(`[trim-storage] Estimated new project size: ${fmt(finalSize)} (target window: 460-512 MiB).`);
}

main();
