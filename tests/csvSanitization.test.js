import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('CSV Formula Injection Sanitization', (t) => {
  // Test sanitization regex and quote escaping logic on malicious inputs
  const testIds = [
    '=1+1',
    '+cmd|"/C calc"!A0',
    '-100',
    '@SUM(A1:A10)',
    '\tTAB_INJECT',
    '\rCARRIAGE_RETURN',
    'normal_video_id_123',
    '12345_numeric_start',
    '007_test',
    'video_"with"_quotes'
  ];

  catalogManager.deadVideoIds.clear();
  testIds.forEach(id => catalogManager.deadVideoIds.add(id));

  // Directly call catalogManager.exportDeadVideosCSV() to get the generated CSV string
  const csv = catalogManager.exportDeadVideosCSV();

  // Verify formula triggers are neutralized with leading single quote
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'\+cmd|""/C calc""!A0"'));
  assert.ok(csv.includes('"\'-100"'));
  assert.ok(csv.includes('"\'@SUM(A1:A10)"'));
  assert.ok(csv.includes('"\'\tTAB_INJECT"'));
  assert.ok(csv.includes('"\'\rCARRIAGE_RETURN"'));

  // Verify normal and numeric IDs are not prepended with single quote
  assert.ok(csv.includes('"normal_video_id_123"'));
  assert.ok(csv.includes('"12345_numeric_start"'));
  assert.ok(csv.includes('"007_test"'));
  assert.ok(!csv.includes('"\'12345_numeric_start"'));
  assert.ok(!csv.includes('"\'007_test"'));

  // Verify double quotes are properly escaped as ""
  assert.ok(csv.includes('"video_""with""_quotes"'));
});
