#!/usr/bin/env node
// Multi-Decade Catalog Builder for BNSD TV (1980s, 1990s, 2000s)
//
// Ingests, unscrambles, and curates retro video stream archives:
// - Decodes 11-character permutation-ciphered YouTube video IDs
// - Extracts and maps categories across 1980–2009
// - Filters out News and Politics to keep only nostalgic cultural moments
// - Generates canonical CSV files and bundled runtime catalog
//
// Run via: npm run build-catalog

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawCachePath = path.join(root, 'scripts', 'raw_decades.json');
const csvPath = path.join(root, 'bnsd_tv_playlist.csv');
const publicCsvPath = path.join(root, 'public', 'bnsd_tv_playlist.csv');
const catalogOutPath = path.join(root, 'src', 'catalogData.js');

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

const CATEGORY_MAP = {
  c: 'Cartoons',
  s: 'Comedy',
  a: 'Commercials',
  d: 'Drama',
  g: 'Gameshows',
  k: 'Kids',
  e: 'Movies',
  m: 'Music',
  n: 'News', // Filtered out
  o: 'Other',
  z: 'Soaps',
  p: 'Specials',
  r: 'Sports',
  t: 'Talkshows',
  f: 'Trailers'
};

const DECADE_CONFIGS = [
  { name: '1980s', baseYear: 1980 },
  { name: '1990s', baseYear: 1990 },
  { name: '2000s', baseYear: 2000 }
];

async function loadRawDecades() {
  if (fs.existsSync(rawCachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(rawCachePath, 'utf8'));
      console.log('Loaded raw database archives from local snapshot (scripts/raw_decades.json).');
      return cache;
    } catch (e) {
      console.error('Error reading scripts/raw_decades.json:', e.message);
    }
  }
  throw new Error('scripts/raw_decades.json not found. Please provide the raw database snapshot.');
}

async function buildDatabase() {
  console.log('=== BNSD TV Multi-Decade Database Builder ===');
  const rawData = await loadRawDecades();

  const seenIds = new Set();
  const rows = [];
  const decadeCounts = {};
  const categoryCounts = {};
  let excludedNewsCount = 0;

  for (const cfg of DECADE_CONFIGS) {
    decadeCounts[cfg.name] = 0;
    const decadeData = rawData[cfg.name];
    if (!decadeData || !Array.isArray(decadeData.x)) {
      console.warn(`Warning: Missing data for decade ${cfg.name}`);
      continue;
    }

    for (let yearOffset = 0; yearOffset < decadeData.x.length; yearOffset++) {
      const yearStr = (cfg.baseYear + yearOffset).toString();
      const yearStringBlock = decadeData.x[yearOffset] || '';
      const numClips = Math.floor(yearStringBlock.length / 12);

      for (let i = 0; i < numClips; i++) {
        const chunk = yearStringBlock.substring(i * 12, (i + 1) * 12);
        if (chunk.length < 12) continue;

        const scrambledId = chunk.substring(0, 11);
        const code = chunk.slice(-1).toLowerCase();
        const categoryName = CATEGORY_MAP[code];

        // Filter out news, politics, or unknown category tags
        if (!categoryName || categoryName === 'News') {
          if (categoryName === 'News') excludedNewsCount++;
          continue;
        }

        const realVideoId = decodeVideoId(scrambledId);
        if (!realVideoId || realVideoId.length !== 11) continue;

        // Deduplicate across all years and decades
        if (seenIds.has(realVideoId)) continue;
        seenIds.add(realVideoId);

        decadeCounts[cfg.name]++;
        categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;

        rows.push({
          decade: cfg.name,
          year: yearStr,
          channel: categoryName,
          video_id: realVideoId,
          title: `${categoryName} (${yearStr})`,
          start_seconds: '0',
          end_seconds: '0'
        });
      }
    }
  }

  console.log(`\nExtracted ${rows.length} unique video streams across ${DECADE_CONFIGS.length} decades.`);
  console.log(`Filtered out ${excludedNewsCount} news/political broadcasts.`);
  console.log('\nDecade Breakdown:');
  console.table(decadeCounts);
  console.log('\nCategory Breakdown:');
  console.table(categoryCounts);

  // 1. Write CSV to root and public/
  const csvContent = Papa.unparse(rows, { header: true });
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  fs.writeFileSync(publicCsvPath, csvContent, 'utf8');
  console.log(`\nWrote ${rows.length} rows to ${csvPath} and ${publicCsvPath}`);

  // 2. Write Optimized Bundled JS module src/catalogData.js
  const uniqueDecades = ['1980s', '1990s', '2000s'];
  const uniqueCategories = Object.values(CATEGORY_MAP).filter(c => c !== 'News').sort();

  const compactStreams = rows.map(r => [
    uniqueDecades.indexOf(r.decade),
    parseInt(r.year, 10),
    uniqueCategories.indexOf(r.channel),
    r.video_id
  ]);

  const compactPayload = {
    decades: uniqueDecades,
    categories: uniqueCategories,
    streams: compactStreams
  };

  const banner =
    '// AUTO-GENERATED by `npm run build-catalog`.\n' +
    '// BNSD TV Master Playlist Catalog (1980s, 1990s, 2000s)\n' +
    '// Do not hand-edit — regenerate with `npm run build-catalog`.\n' +
    'export const BNSD_TV_CATALOG = ' + JSON.stringify(compactPayload) + ';\n' +
    'export const DEFAULT_90S_CATALOG = BNSD_TV_CATALOG;\n';

  fs.writeFileSync(catalogOutPath, banner, 'utf8');
  console.log(`Generated bundled runtime module: ${catalogOutPath}`);
  console.log('=== Database Build Complete! ===\n');
}

buildDatabase().catch(err => {
  console.error('Build catalog fatal error:', err);
  process.exit(1);
});
