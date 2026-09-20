import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

describe('CatalogManager Performance and Interleaving Tests', () => {
  it('should successfully load the catalog data array without throwing ReferenceErrors', async () => {
    const loaded = await catalogManager.loadCSV();
    assert.strictEqual(loaded, true, 'Catalog should load successfully');
    assert.ok(catalogManager.allVideos.length > 0, 'Catalog should contain videos');
    assert.ok(catalogManager.categoriesMap.size > 0, 'Catalog should index categories');
    assert.ok(catalogManager.decadesMap.size > 0, 'Catalog should index decades');
  });

  it('should generate an anti-clustered channel queue with proper category interleaving', async () => {
    await catalogManager.loadCSV();
    const queue = catalogManager.generateChannelQueue('test-channel-1', ['Cartoons', 'Music', 'Sports', 'Trailers', 'Comedy']);
    assert.ok(queue.length > 0, 'Queue should not be empty');

    let consecutiveCollisions = 0;
    for (let i = 0; i < queue.length - 1; i++) {
      if (queue[i].catUpper === queue[i + 1].catUpper) {
        consecutiveCollisions++;
      }
    }

    const collisionRatio = consecutiveCollisions / queue.length;
    assert.ok(collisionRatio < 0.01, `Collision ratio across ${queue.length} items should be under 1%, got ${(collisionRatio * 100).toFixed(2)}%`);
  });

  it('should exclude quarantined dead videos from generated channel queues', async () => {
    await catalogManager.loadCSV();
    const initialQueue = catalogManager.generateChannelQueue('test-channel-2');
    const targetVideo = initialQueue[0];
    assert.ok(targetVideo && targetVideo.videoId, 'Target video must exist');

    catalogManager.markVideoDead(targetVideo.videoId, targetVideo.title);

    const newQueue = catalogManager.generateChannelQueue('test-channel-2');
    const exists = newQueue.some(item => item.videoId === targetVideo.videoId);
    assert.strictEqual(exists, false, 'Quarantined video must not appear in new queue');

    // Clean up
    catalogManager.clearDeadVideoFlags();
  });
});
