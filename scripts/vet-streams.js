#!/usr/bin/env node
// Automated YouTube Stream Vetting & Availability Validator
// Uses YouTube's lightweight oEmbed endpoint to detect 404s, deleted/private videos,
// and embed-disabled videos (Error 101/150).
//
// Usage:
//   node scripts/vet-streams.js --sample 100
//   node scripts/vet-streams.js --decade 1990s --concurrency 30
//   node scripts/vet-streams.js --all --concurrency 40

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifiedPath = path.join(root, 'scripts', 'verified_streams.json');
const deadPath = path.join(root, 'scripts', 'dead_streams.json');
const rawPath = path.join(root, 'scripts', 'raw_decades.json');

// Parse CLI flags
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return defaultValue;
}
const hasFlag = (name) => args.includes(`--${name}`);

const sampleLimit = parseInt(getArg('sample', '0'), 10);
const targetDecade = getArg('decade', null);
const concurrency = parseInt(getArg('concurrency', '25'), 10);
const isFullRun = hasFlag('all') || hasFlag('full');

// 32-row permutation matrix for unscrambling YouTube video IDs
const CYPHER_MATRIX = [
  [5, 6, 9, 3, 0, 7, 10, 1, 4, 2, 8],
  [9, 4, 6, 5, 8, 1, 10, 2, 0, 3, 7],
  [6, 2, 4, 8, 5, 7, 0, 1, 9, 3, 10],
  [3, 7, 4, 10, 1, 2, 0, 5, 6, 9, 8],
  [4, 8, 2, 1, 9, 10, 6, 7, 0, 3, 5],
  [0, 3, 1, 5, 2, 4, 10, 7, 6, 8, 9],
  [10, 4, 1, 0, 6, 7, 2, 8, 5, 9, 3],
  [6, 2, 10, 7, 0, 9, 5, 3, 1, 4, 8],
  [7, 9, 10, 6, 5, 1, 8, 4, 2, 0, 3],
  [6, 7, 9, 8, 0, 3, 10, 1, 4, 2, 5],
  [10, 0, 1, 6, 7, 2, 5, 8, 4, 3, 9],
  [4, 2, 8, 5, 10, 1, 9, 7, 6, 0, 3],
  [6, 7, 10, 4, 9, 3, 5, 2, 0, 8, 1],
  [9, 2, 5, 8, 4, 6, 1, 10, 3, 0, 7],
  [10, 2, 4, 5, 3, 6, 0, 7, 8, 9, 1],
  [7, 4, 2, 10, 3, 0, 9, 8, 1, 6, 5],
  [8, 7, 9, 10, 5, 0, 3, 6, 4, 1, 2],
  [7, 5, 8, 2, 9, 3, 4, 1, 0, 6, 10],
  [2, 3, 10, 9, 0, 1, 7, 8, 5, 4, 6],
  [10, 1, 0, 3, 9, 5, 6, 7, 4, 8, 2],
  [5, 4, 10, 9, 6, 2, 1, 8, 0, 3, 7],
  [5, 8, 10, 9, 7, 2, 3, 4, 1, 6, 0],
  [10, 6, 7, 3, 0, 2, 1, 4, 5, 8, 9],
  [2, 5, 10, 3, 9, 1, 6, 0, 4, 7, 8],
  [0, 5, 3, 7, 10, 4, 8, 2, 1, 6, 9],
  [2, 0, 8, 9, 4, 1, 6, 10, 5, 3, 7],
  [9, 8, 2, 0, 3, 4, 7, 6, 1, 10, 5],
  [3, 5, 2, 4, 7, 6, 10, 1, 8, 0, 9],
  [0, 3, 6, 2, 1, 10, 8, 9, 7, 5, 4],
  [4, 5, 3, 6, 2, 1, 8, 10, 7, 0, 9],
  [5, 10, 4, 8, 0, 2, 1, 6, 3, 7, 9],
  [1, 6, 10, 9, 2, 8, 5, 7, 4, 3, 0]
];
const t = CYPHER_MATRIX.length;
const getIndex = (arr) => arr.reduce((acc, char) => acc + char.charCodeAt(0), 0) % t;

function decodeVideoId(scrambled) {
  const chars = scrambled.split('');
  const row = CYPHER_MATRIX[getIndex(chars)];
  return row.map(idx => chars[idx]).join('');
}

// Caching load / save
function loadJson(filePath, defaultValue) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {}
  }
  return defaultValue;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Check single video ID via YouTube oEmbed
async function checkVideoStatus(videoId, retries = 2) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 200) {
        const data = await res.json();
        return { valid: true, videoId, title: data.title, author: data.author_name };
      } else if (res.status === 401 || res.status === 403) {
        return { valid: false, videoId, reason: 'embedding_disabled' };
      } else if (res.status === 404) {
        return { valid: false, videoId, reason: 'not_found' };
      } else if (res.status === 429) {
        // Rate limited - backoff and retry
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      } else {
        return { valid: false, videoId, reason: `http_${res.status}` };
      }
    } catch (err) {
      if (attempt === retries) {
        return { valid: null, videoId, reason: err.name === 'AbortError' ? 'timeout' : 'network_error' };
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { valid: null, videoId, reason: 'retry_exhausted' };
}

async function main() {
  console.log('=== BNSD TV Stream Availability & Embed Validator ===');
  if (!fs.existsSync(rawPath)) {
    console.error('raw_decades.json not found at:', rawPath);
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const verifiedMap = loadJson(verifiedPath, {});
  const deadMap = loadJson(deadPath, {});

  console.log(`Loaded cache: ${Object.keys(verifiedMap).length} verified live, ${Object.keys(deadMap).length} dead.`);

  // Collect all unique video IDs from curated categories
  const EXCLUDED_CODES = new Set(['n', 'z', 'd', 't', 'o']); // Exclude News, Soaps, Drama, Talkshows, Other
  const queue = [];
  const seen = new Set();

  for (const dec of ['1980s', '1990s', '2000s']) {
    if (targetDecade && dec !== targetDecade) continue;
    const decObj = rawData[dec];
    if (!decObj || !decObj.x) continue;

    for (let yr = 0; yr < decObj.x.length; yr++) {
      const block = decObj.x[yr] || '';
      for (let i = 0; i < block.length; i += 12) {
        const chunk = block.substring(i, i + 12);
        if (chunk.length < 12) continue;
        const code = chunk.slice(-1).toLowerCase();
        if (EXCLUDED_CODES.has(code)) continue;

        const scrambled = chunk.substring(0, 11);
        const realId = decodeVideoId(scrambled);
        if (!realId || realId.length !== 11 || seen.has(realId)) continue;
        seen.add(realId);

        // Skip if already in verified or dead cache
        if (verifiedMap[realId] || deadMap[realId]) continue;

        queue.push(realId);
      }
    }
  }

  console.log(`Discovered ${seen.size} total target videos. ${queue.length} videos need validation.`);

  const toCheck = sampleLimit > 0 ? queue.slice(0, sampleLimit) : (isFullRun ? queue : queue.slice(0, 100));
  console.log(`Checking ${toCheck.length} videos (Concurrency: ${concurrency})...\n`);

  let processed = 0;
  let liveCount = 0;
  let deadCount = 0;
  let indeterminateCount = 0;

  let activeIndex = 0;
  async function worker() {
    while (activeIndex < toCheck.length) {
      const idx = activeIndex++;
      const videoId = toCheck[idx];
      const result = await checkVideoStatus(videoId);

      processed++;
      if (result.valid === true) {
        liveCount++;
        verifiedMap[videoId] = { title: result.title, author: result.author, verifiedAt: new Date().toISOString() };
      } else if (result.valid === false) {
        deadCount++;
        deadMap[videoId] = { reason: result.reason, flaggedAt: new Date().toISOString() };
      } else {
        indeterminateCount++;
      }

      if (processed % 25 === 0 || processed === toCheck.length) {
        process.stdout.write(`\rProgress: ${processed}/${toCheck.length} | Live: ${liveCount} | Dead: ${deadCount} | Skipped/Timeout: ${indeterminateCount}`);
        saveJson(verifiedPath, verifiedMap);
        saveJson(deadPath, deadMap);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, toCheck.length) }, () => worker());
  await Promise.all(workers);

  saveJson(verifiedPath, verifiedMap);
  saveJson(deadPath, deadMap);

  console.log(`\n\n=== Validation Completed ===`);
  console.log(`Total Verified Live: ${Object.keys(verifiedMap).length}`);
  console.log(`Total Flagged Dead: ${Object.keys(deadMap).length}`);
  console.log(`Saved caches to ${verifiedPath} and ${deadPath}\n`);
}

main().catch(err => {
  console.error('Fatal validation error:', err);
  process.exit(1);
});
