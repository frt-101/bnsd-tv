import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('catalogManager - ingestArrayData compact format correctly ingests valid streams', () => {
  const sampleData = {
    decades: ['1980s', '1990s', '2000s'],
    categories: ['Cartoons', 'Commercials', 'Music'],
    streams: [
      [1, 1995, 0, 'dQw4w9WgXcQ'], // valid 11-char ID
      [0, 1985, 1, 'abcdefghijk'], // valid 11-char ID
      [2, 2005, 2, 'invalid_short'], // invalid length (13)
      [1, 1992, 0, '<script>x</script>'], // invalid characters/length
      [1, 1999, 1, '12345678901']  // valid 11-char ID
    ]
  };

  catalogManager.ingestArrayData(sampleData);

  // Should ingest only the 3 valid streams
  assert.equal(catalogManager.allVideos.length, 3);
  assert.equal(catalogManager.allVideos[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(catalogManager.allVideos[0].decade, '1990s');
  assert.equal(catalogManager.allVideos[0].category, 'Cartoons');
  assert.equal(catalogManager.allVideos[1].videoId, 'abcdefghijk');
  assert.equal(catalogManager.allVideos[2].videoId, '12345678901');
});

test('catalogManager - parseCSVText parses valid CSV and sanitizes invalid video IDs', () => {
  const csvContent = `decade,year,channel,video_id,title,start_seconds,end_seconds
1990s,1994,Cartoons,XyZ12345678,Good Cartoon,0,0
1980s,1988,Music,malicious_id_too_long,Bad Track,0,0
2000s,2002,Commercials,valid_id_12,Good Commercial,10,30
1990s,1991,Commercials,javascript:alert(1),Hack,0,0`;

  const result = catalogManager.parseCSVText(csvContent);

  assert.equal(result, true);
  // Should ingest only the 2 valid 11-char video IDs
  assert.equal(catalogManager.allVideos.length, 2);
  assert.equal(catalogManager.allVideos[0].videoId, 'XyZ12345678');
  assert.equal(catalogManager.allVideos[0].category, 'Cartoons');
  assert.equal(catalogManager.allVideos[1].videoId, 'valid_id_12');
  assert.equal(catalogManager.allVideos[1].category, 'Commercials');
  assert.equal(catalogManager.allVideos[1].startSec, 10);
  assert.equal(catalogManager.allVideos[1].endSec, 30);
});

test('catalogManager - generateChannelQueue filters out quarantined dead videos', () => {
  const sampleData = {
    decades: ['1990s'],
    categories: ['Cartoons', 'Music'],
    streams: [
      [0, 1995, 0, 'vid11111111'],
      [0, 1996, 1, 'vid22222222']
    ]
  };

  catalogManager.ingestArrayData(sampleData);
  assert.equal(catalogManager.allVideos.length, 2);

  // Flag one video as dead
  catalogManager.markVideoDead('vid11111111', 'Dead Video');

  const queue = catalogManager.generateChannelQueue('channel1');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].videoId, 'vid22222222');

  // Cleanup dead flags
  catalogManager.clearDeadVideoFlags();
});
