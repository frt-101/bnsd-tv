import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('parseCSVText - parses valid video items and filters out invalid YouTube video IDs', () => {
  const csvContent = `decade,year,channel,video_id,title,start_seconds,end_seconds
1990s,1995,Cartoons,dQw4w9WgXcQ,Good Video,10,30
1980s,1984,Music,<script>alert('xss')</script>,Malicious Video,0,0
2000s,2002,Commercials,too_long_video_id_here,Invalid Length,0,0
1990s,1999,Comedy,abc123_-XYZ,Valid Short ID,0,0
`;

  const success = catalogManager.parseCSVText(csvContent);
  assert.equal(success, true);
  assert.equal(catalogManager.allVideos.length, 2);

  const video1 = catalogManager.allVideos[0];
  assert.equal(video1.videoId, 'dQw4w9WgXcQ');
  assert.equal(video1.category, 'Cartoons');
  assert.equal(video1.decade, '1990s');
  assert.equal(video1.year, '1995');
  assert.equal(video1.title, 'Good Video');
  assert.equal(video1.startSec, 10);
  assert.equal(video1.endSec, 30);

  const video2 = catalogManager.allVideos[1];
  assert.equal(video2.videoId, 'abc123_-XYZ');
  assert.equal(video2.category, 'Comedy');
  assert.equal(video2.decade, '1990s');
});

test('ingestArrayData - compact tuple payload validates video IDs and maps fields correctly', () => {
  const compactPayload = {
    decades: ['1980s', '1990s', '2000s'],
    categories: ['Cartoons', 'Commercials', 'Music'],
    streams: [
      [1, 1994, 0, 'dQw4w9WgXcQ'], // Valid
      [0, 1985, 2, 'invalid_id!'], // Invalid characters
      [2, 2001, 1, '12345678901']  // Valid 11-char ID
    ]
  };

  catalogManager.ingestArrayData(compactPayload);
  assert.equal(catalogManager.allVideos.length, 2);
  assert.equal(catalogManager.allVideos[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(catalogManager.allVideos[0].decade, '1990s');
  assert.equal(catalogManager.allVideos[0].category, 'Cartoons');
  assert.equal(catalogManager.allVideos[1].videoId, '12345678901');
});

test('ingestArrayData - object array fallback validates video IDs', () => {
  const arrayPayload = [
    { decade: '1990s', year: '1992', channel: 'Sports', video_id: 'dQw4w9WgXcQ', title: 'Sample' },
    { decade: '1980s', year: '1988', channel: 'Music', video_id: 'bad_id', title: 'Bad' }
  ];

  catalogManager.ingestArrayData(arrayPayload);
  assert.equal(catalogManager.allVideos.length, 1);
  assert.equal(catalogManager.allVideos[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(catalogManager.allVideos[0].category, 'Sports');
});
