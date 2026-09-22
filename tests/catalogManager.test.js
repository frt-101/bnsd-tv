import { test, describe } from 'node:test';
import assert from 'node:assert';
import { catalogManager } from '../src/catalogManager.js';

describe('CatalogManager', () => {
  test('loads bundled tuple catalog without error', async () => {
    const success = await catalogManager.loadCSV();
    assert.strictEqual(success, true);
    assert.ok(catalogManager.allVideos.length > 100000, 'Expected > 100,000 streams in catalog');
  });

  test('correctly tallies decades and categories', () => {
    const decades = catalogManager.getDecades();
    assert.strictEqual(decades.length, 3);
    const totalDecadesCount = decades.reduce((sum, d) => sum + d.count, 0);
    assert.strictEqual(totalDecadesCount, catalogManager.allVideos.length);

    const categories = catalogManager.getCategories();
    assert.ok(categories.length > 0);
    const totalCatCount = categories.reduce((sum, c) => sum + c.count, 0);
    assert.strictEqual(totalCatCount, catalogManager.allVideos.length);
  });

  test('generates anti-clustered channel queue', () => {
    const queue = catalogManager.generateChannelQueue('test-channel');
    assert.ok(queue.length > 0);
    assert.strictEqual(queue.length, catalogManager.allVideos.length);
  });

  test('quarantines dead videos correctly', () => {
    const firstVideo = catalogManager.allVideos[0];
    const initialCount = catalogManager.allVideos.length;

    catalogManager.markVideoDead(firstVideo.videoId, firstVideo.title);
    assert.strictEqual(catalogManager.deadVideoIds.has(firstVideo.videoId), true);
    assert.strictEqual(catalogManager.allVideos.length, initialCount - 1);

    catalogManager.clearDeadVideoFlags();
    assert.strictEqual(catalogManager.deadVideoIds.size, 0);
  });
});
