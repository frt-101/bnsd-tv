import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('loadCSV ingests bundled BNSD_TV_CATALOG without errors and builds catalog', async () => {
  const start = performance.now();
  const success = await catalogManager.loadCSV();
  const elapsed = performance.now() - start;

  assert.equal(success, true, 'loadCSV should return true');
  assert.equal(catalogManager.isLoaded, true, 'isLoaded should be true');
  assert.ok(catalogManager.allVideos.length > 100000, 'allVideos should contain over 100,000 items');
  console.log(`Ingested ${catalogManager.allVideos.length} items in ${elapsed.toFixed(2)}ms`);
});

test('generateChannelQueue builds filtered queue correctly', () => {
  const start = performance.now();
  const queue = catalogManager.generateChannelQueue('bnsdtv1', ['Cartoons', 'Commercials'], ['1990s']);
  const elapsed = performance.now() - start;

  assert.ok(queue.length > 0, 'Queue should not be empty');
  assert.ok(queue.every(item => item.decadeUpper === '1990S'), 'All items should match decade 1990s');
  console.log(`Generated queue of ${queue.length} items in ${elapsed.toFixed(2)}ms`);
});

test('getCategories counts active items properly', () => {
  const categories = catalogManager.getCategories(['1990s']);
  assert.ok(categories.length > 0, 'Categories list should not be empty');
  const totalCount = categories.reduce((sum, c) => sum + c.count, 0);
  assert.ok(totalCount > 0, 'Total categories count should be > 0');
});
