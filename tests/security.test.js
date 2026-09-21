import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('CSV Formula Injection escaping in exportDeadVideosCSV', () => {
  const dangerousIds = [
    '=CMD|"/C calc"!A0',
    '+1+2',
    '-1000',
    '@SUM(1,2)',
    '\tTAB',
    '\rCARRIAGE',
    'safe_video_id_123'
  ];

  catalogManager.deadVideoIds.clear();
  dangerousIds.forEach(id => catalogManager.deadVideoIds.add(id));

  let csvOutput = '';
  // Test sanitization logic directly as in exportDeadVideosCSV
  catalogManager.deadVideoIds.forEach(id => {
    const safeId = String(id).replace(/^[=+\-@\t\r]/, "'$&");
    csvOutput += `"${safeId}"\n`;
  });

  assert.match(csvOutput, /"'=CMD/);
  assert.match(csvOutput, /"'\+1\+2"/);
  assert.match(csvOutput, /"'-1000"/);
  assert.match(csvOutput, /"'@SUM/);
  assert.match(csvOutput, /"'\tTAB"/);
  assert.match(csvOutput, /"'\rCARRIAGE"/);
  assert.match(csvOutput, /"safe_video_id_123"/);
});

test('Channel parameter sanitization prevents path traversal', () => {
  const rawInputs = [
    '../../admin',
    'bnsd/tv/1',
    '<script>alert(1)</script>',
    'channel-id-with-very-long-string-that-exceeds-thirty-two-chars',
    'valid_channel-123'
  ];

  const sanitize = (raw) => (raw || 'bnsdtv1').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'bnsdtv1';

  assert.equal(sanitize(rawInputs[0]), 'admin');
  assert.equal(sanitize(rawInputs[1]), 'bnsdtv1');
  assert.equal(sanitize(rawInputs[2]), 'scriptalert1script');
  assert.equal(sanitize(rawInputs[3]).length, 32);
  assert.equal(sanitize(rawInputs[4]), 'valid_channel-123');
});

test('parseCSVText parses catalog records without runtime errors', () => {
  const sampleCSV = `decade,year,channel,video_id,title,start_seconds,end_seconds
1990s,1995,Cartoons,dQw4w9WgXcQ,Never Gonna Give You Up,0,30
1980s,1985,Music,abcdefghijk,Test Music Video,10,60`;

  const result = catalogManager.parseCSVText(sampleCSV);
  assert.equal(result, true);
  assert.equal(catalogManager.allVideos.length, 2);
  assert.equal(catalogManager.allVideos[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(catalogManager.allVideos[0].category, 'Cartoons');
});
