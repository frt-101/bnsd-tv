import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

describe('CatalogManager - Security & CSV Export (CWE-1236)', () => {
  let createdBlobContent = null;

  beforeEach(() => {
    catalogManager.clearDeadVideoFlags();
    createdBlobContent = null;

    // Mock DOM elements and URL methods if missing in Node environment
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {
        createElement: () => ({
          href: '',
          download: '',
          click: () => {}
        })
      };
    }

    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = (blob) => {
        createdBlobContent = blob;
        return 'blob:mock-url';
      };
    } else {
      const origCreate = globalThis.URL.createObjectURL;
      globalThis.URL.createObjectURL = (blob) => {
        createdBlobContent = blob;
        return origCreate ? origCreate(blob) : 'blob:mock-url';
      };
    }

    if (!globalThis.URL.revokeObjectURL) {
      globalThis.URL.revokeObjectURL = () => {};
    }
  });

  test('markVideoDead rejects non-string or empty video IDs', () => {
    catalogManager.markVideoDead(null);
    catalogManager.markVideoDead(12345);
    catalogManager.markVideoDead('   ');
    assert.equal(catalogManager.deadVideoIds.size, 0);
  });

  test('markVideoDead stores trimmed valid video IDs', () => {
    catalogManager.markVideoDead('  abc12345678  ', 'Test Video');
    assert.equal(catalogManager.deadVideoIds.has('abc12345678'), true);
  });

  test('exportDeadVideosCSV escapes formula triggers (=, +, -, @, \\t, \\r) and quotes', async () => {
    catalogManager.markVideoDead('=cmd|"/C calc"!A0', 'Exploit 1');
    catalogManager.markVideoDead('+12345', 'Exploit 2');
    catalogManager.markVideoDead('-12345', 'Exploit 3');
    catalogManager.markVideoDead('@SUM(A1:A10)', 'Exploit 4');
    catalogManager.markVideoDead('normal_video_id', 'Normal Video');

    catalogManager.exportDeadVideosCSV();

    assert.ok(createdBlobContent, 'Blob should be created');
    const text = await createdBlobContent.text();

    // Check that header exists
    assert.ok(text.startsWith('video_id,flagged_at\n'));

    // Check formula sanitization: formula characters must be prepended with a single quote '
    assert.ok(text.includes('"' + "'=cmd|\"\"/C calc\"\"!A0\""));
    assert.ok(text.includes('"' + "'+12345\""));
    assert.ok(text.includes('"' + "'-12345\""));
    assert.ok(text.includes('"' + "'@SUM(A1:A10)\""));

    // Check normal ID is NOT prepended with single quote
    assert.ok(text.includes('"normal_video_id"'));
  });
});
