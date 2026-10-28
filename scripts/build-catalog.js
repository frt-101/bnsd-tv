#!/usr/bin/env node
// Multi-Decade Catalog Builder for BNSD TV (1980s, 1990s, 2000s)
//
// Ingests, unscrambles, and curates retro video stream archives:
// - Decodes 11-character permutation-ciphered YouTube video IDs
// - Extracts and maps high-energy nostalgic cultural categories across 1980–2009
// - Filters out News, Soaps, Drama, Talkshows, and generic Other
// - Filters out known dead/embed-restricted video IDs
// - Generates canonical CSV files and bundled runtime catalog
//
// Run via: npm run build-catalog

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawCachePath = path.join(root, 'scripts', 'raw_decades.json');
const deadCachePath = path.join(root, 'scripts', 'dead_streams.json');
const csvPath = path.join(root, 'bnsd_tv_playlist.csv');
const publicCsvPath = path.join(root, 'public', 'bnsd_tv_playlist.csv');
const catalogOutPath = path.join(root, 'src', 'catalogData.js');

// Per-decade 32-row permutation matrices for unscrambling YouTube video IDs
const CYPHER_MATRICES = {
  '1980s': [
    [8, 9, 10, 4, 5, 6, 7, 0, 3, 1, 2],
    [2, 0, 1, 9, 3, 4, 5, 10, 8, 6, 7],
    [7, 3, 5, 10, 4, 0, 8, 2, 9, 6, 1],
    [5, 10, 6, 9, 7, 0, 1, 2, 3, 8, 4],
    [9, 2, 6, 10, 0, 3, 8, 1, 4, 7, 5],
    [6, 4, 8, 2, 9, 5, 10, 7, 3, 1, 0],
    [8, 0, 9, 3, 1, 7, 4, 6, 5, 2, 10],
    [7, 2, 9, 0, 8, 5, 4, 10, 1, 3, 6],
    [4, 6, 1, 3, 9, 7, 2, 8, 0, 5, 10],
    [7, 10, 3, 4, 8, 0, 6, 2, 1, 9, 5],
    [6, 8, 7, 1, 2, 5, 3, 10, 4, 9, 0],
    [7, 6, 4, 10, 8, 9, 5, 2, 3, 1, 0],
    [9, 2, 1, 3, 10, 4, 7, 6, 0, 5, 8],
    [1, 9, 7, 2, 3, 0, 10, 8, 6, 5, 4],
    [2, 4, 9, 0, 3, 5, 7, 8, 10, 6, 1],
    [9, 10, 8, 6, 7, 0, 5, 4, 2, 1, 3],
    [9, 6, 5, 10, 3, 8, 0, 2, 1, 7, 4],
    [2, 8, 1, 6, 3, 5, 0, 10, 4, 9, 7],
    [5, 10, 4, 9, 2, 3, 1, 7, 8, 0, 6],
    [2, 6, 4, 9, 1, 8, 3, 10, 0, 7, 5],
    [8, 4, 1, 3, 2, 9, 5, 7, 6, 10, 0],
    [4, 0, 7, 3, 6, 1, 2, 9, 5, 8, 10],
    [3, 10, 1, 8, 6, 9, 2, 5, 7, 0, 4],
    [10, 8, 0, 1, 4, 3, 5, 6, 9, 2, 7],
    [7, 9, 3, 0, 1, 2, 5, 4, 8, 6, 10],
    [2, 3, 7, 6, 4, 9, 1, 0, 5, 10, 8],
    [7, 8, 5, 6, 10, 4, 3, 9, 0, 1, 2],
    [9, 6, 5, 0, 1, 4, 10, 2, 8, 7, 3],
    [6, 0, 3, 4, 7, 1, 10, 9, 2, 8, 5],
    [0, 2, 6, 8, 7, 5, 3, 10, 9, 4, 1],
    [8, 10, 6, 1, 2, 0, 4, 9, 5, 7, 3],
    [8, 3, 1, 6, 4, 5, 0, 9, 7, 2, 10]
  ],
  '1990s': [
    [2, 7, 6, 3, 0, 8, 10, 4, 5, 1, 9],
    [2, 8, 3, 1, 10, 9, 6, 7, 5, 0, 4],
    [0, 5, 7, 10, 4, 9, 3, 6, 8, 1, 2],
    [6, 10, 3, 1, 2, 9, 4, 0, 5, 8, 7],
    [2, 5, 6, 4, 1, 10, 7, 0, 3, 8, 9],
    [1, 4, 2, 5, 8, 6, 0, 7, 3, 10, 9],
    [6, 4, 7, 9, 8, 1, 3, 10, 5, 2, 0],
    [2, 6, 10, 7, 5, 8, 0, 9, 1, 3, 4],
    [8, 4, 10, 9, 6, 5, 1, 3, 7, 2, 0],
    [4, 1, 7, 3, 9, 6, 0, 5, 10, 2, 8],
    [6, 8, 2, 4, 9, 10, 3, 7, 0, 1, 5],
    [1, 7, 5, 0, 10, 3, 9, 6, 8, 2, 4],
    [9, 5, 4, 6, 2, 10, 3, 0, 1, 7, 8],
    [10, 0, 6, 3, 8, 7, 4, 2, 9, 5, 1],
    [10, 0, 2, 8, 1, 7, 4, 6, 5, 3, 9],
    [5, 3, 2, 10, 6, 7, 4, 9, 0, 8, 1],
    [10, 7, 3, 4, 9, 5, 0, 1, 6, 2, 8],
    [2, 1, 8, 3, 0, 10, 7, 9, 6, 4, 5],
    [5, 8, 2, 10, 7, 1, 4, 9, 6, 0, 3],
    [4, 3, 10, 9, 2, 0, 7, 1, 8, 6, 5],
    [2, 5, 4, 1, 8, 0, 3, 9, 7, 10, 6],
    [9, 2, 4, 5, 3, 8, 10, 0, 6, 7, 1],
    [1, 6, 3, 10, 7, 9, 5, 0, 2, 8, 4],
    [8, 10, 7, 0, 6, 9, 4, 5, 2, 3, 1],
    [5, 3, 9, 8, 0, 1, 4, 10, 2, 6, 7],
    [1, 8, 5, 10, 9, 0, 3, 6, 2, 4, 7],
    [10, 4, 7, 9, 8, 0, 6, 3, 5, 1, 2],
    [6, 4, 3, 2, 9, 8, 0, 1, 5, 7, 10],
    [7, 0, 4, 3, 8, 1, 5, 9, 2, 10, 6],
    [5, 0, 6, 10, 1, 4, 2, 9, 8, 7, 3],
    [10, 8, 2, 1, 6, 5, 9, 0, 4, 3, 7],
    [1, 0, 3, 8, 2, 6, 5, 7, 4, 9, 10]
  ],
  '2000s': [
    [8, 2, 4, 7, 3, 10, 5, 0, 6, 1, 9],
    [3, 8, 10, 4, 5, 2, 9, 0, 1, 6, 7],
    [9, 6, 7, 3, 5, 1, 0, 2, 4, 10, 8],
    [10, 4, 5, 0, 3, 2, 7, 9, 8, 6, 1],
    [4, 1, 0, 7, 8, 10, 3, 2, 5, 9, 6],
    [0, 9, 4, 8, 7, 5, 6, 3, 10, 1, 2],
    [10, 0, 7, 9, 8, 5, 1, 6, 2, 4, 3],
    [0, 8, 3, 6, 7, 10, 2, 9, 5, 1, 4],
    [5, 10, 0, 4, 6, 7, 2, 3, 9, 1, 8],
    [7, 6, 10, 3, 2, 1, 4, 8, 0, 9, 5],
    [10, 4, 2, 0, 7, 9, 1, 3, 5, 8, 6],
    [9, 1, 2, 6, 7, 10, 5, 0, 8, 4, 3],
    [10, 6, 3, 9, 4, 2, 7, 5, 0, 8, 1],
    [9, 7, 0, 1, 5, 6, 10, 3, 8, 2, 4],
    [10, 9, 0, 3, 4, 2, 1, 7, 6, 8, 5],
    [5, 2, 8, 6, 0, 1, 4, 10, 7, 9, 3],
    [7, 1, 10, 3, 6, 0, 8, 9, 2, 4, 5],
    [4, 1, 3, 5, 8, 9, 6, 2, 7, 0, 10],
    [10, 8, 7, 6, 5, 1, 4, 3, 0, 9, 2],
    [2, 3, 6, 4, 1, 8, 0, 9, 10, 7, 5],
    [7, 9, 4, 2, 8, 0, 6, 5, 3, 10, 1],
    [4, 7, 0, 10, 1, 2, 9, 6, 3, 5, 8],
    [10, 4, 3, 5, 9, 6, 8, 1, 7, 0, 2],
    [3, 1, 5, 9, 0, 2, 4, 10, 8, 6, 7],
    [3, 5, 9, 6, 10, 4, 0, 8, 2, 7, 1],
    [0, 6, 10, 1, 7, 3, 8, 5, 4, 9, 2],
    [10, 7, 6, 2, 5, 3, 1, 0, 4, 9, 8],
    [7, 10, 0, 9, 3, 6, 1, 5, 4, 2, 8],
    [7, 4, 2, 8, 6, 9, 3, 0, 1, 10, 5],
    [4, 1, 9, 6, 7, 2, 3, 8, 0, 10, 5],
    [3, 8, 7, 4, 2, 5, 1, 0, 9, 6, 10],
    [2, 9, 1, 6, 0, 8, 10, 4, 3, 5, 7]
  ]
};

const getIndex = (arr) => arr.reduce((acc, char) => acc + char.charCodeAt(0), 0) % 32;

function decodeVideoId(scrambled, decade = '1990s') {
  const chars = scrambled.split('');
  const matrix = CYPHER_MATRICES[decade] || CYPHER_MATRICES['1990s'];
  const row = matrix[getIndex(chars)];
  return row.map(idx => chars[idx]).join('');
}

// Curated Category Map: Includes high-visual, nostalgic categories
// Explicitly excludes news, soaps, drama, talkshows, and generic filler
const CATEGORY_MAP = {
  c: 'Cartoons',
  s: 'Comedy',
  a: 'Commercials',
  g: 'Gameshows',
  k: 'Kids',
  e: 'Movies',
  m: 'Music',
  p: 'Specials',
  r: 'Sports',
  f: 'Trailers'
  // Excluded:
  // n: 'News' (politics/tragedy)
  // z: 'Soaps' (slow talking heads)
  // d: 'Drama' (dialogue-heavy)
  // t: 'Talkshows' (controversial/talking heads)
  // o: 'Other' (generic filler)
};

const EXCLUDED_CATEGORIES = {
  n: 'News',
  z: 'Soaps',
  d: 'Drama',
  t: 'Talkshows',
  o: 'Other'
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

function loadDeadSet() {
  if (fs.existsSync(deadCachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(deadCachePath, 'utf8'));
      return new Set(Object.keys(data));
    } catch (e) {}
  }
  return new Set();
}

async function buildDatabase() {
  console.log('=== BNSD TV Multi-Decade Database Builder (Curated) ===');
  const rawData = await loadRawDecades();
  const deadSet = loadDeadSet();
  if (deadSet.size > 0) {
    console.log(`Loaded ${deadSet.size} known dead/embed-restricted video IDs to exclude.`);
  }

  const seenIds = new Set();
  const rows = [];
  const decadeCounts = {};
  const categoryCounts = {};
  const excludedCounts = {};

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

        // Track and filter excluded categories
        if (EXCLUDED_CATEGORIES[code]) {
          const exName = EXCLUDED_CATEGORIES[code];
          excludedCounts[exName] = (excludedCounts[exName] || 0) + 1;
          continue;
        }

        const categoryName = CATEGORY_MAP[code];
        if (!categoryName) continue;

        const realVideoId = decodeVideoId(scrambledId, cfg.name);
        if (!realVideoId || realVideoId.length !== 11) continue;

        // Skip known dead streams
        if (deadSet.has(realVideoId)) continue;

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

  console.log(`\nExtracted ${rows.length} curated unique video streams across ${DECADE_CONFIGS.length} decades.`);
  console.log('\nExcluded Low-Interest / Risky Categories:');
  console.table(excludedCounts);
  console.log('\nActive Decade Breakdown:');
  console.table(decadeCounts);
  console.log('\nActive Category Breakdown:');
  console.table(categoryCounts);

  // 1. Write CSV to root and public/
  const csvContent = Papa.unparse(rows, { header: true });
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  fs.writeFileSync(publicCsvPath, csvContent, 'utf8');
  console.log(`\nWrote ${rows.length} rows to ${csvPath} and ${publicCsvPath}`);

  // 2. Write Optimized Bundled JS module src/catalogData.js
  const uniqueDecades = ['1980s', '1990s', '2000s'];
  const uniqueCategories = Object.values(CATEGORY_MAP).sort();

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
    '// BNSD TV Master Curated Playlist Catalog (1980s, 1990s, 2000s)\n' +
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
