import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogManager } from '../src/catalogManager.js';

test('sanitizeCSVField neutralizes formula injection characters', () => {
  const formulaPayloads = [
    '=1+1',
    '+SUM(A1:A10)',
    '-10+20',
    '@SUM(A1:A10)',
    '\tCMD|',
    '\rCMD|'
  ];

  for (const payload of formulaPayloads) {
    const result = catalogManager.sanitizeCSVField(payload);
    assert.ok(
      result.startsWith('("\'') || result.startsWith('"\''),
      `Expected field starting with formula character '${payload[0]}' to be escaped with a single quote. Got: ${result}`
    );
  }
});

test('sanitizeCSVField escapes internal double quotes', () => {
  const input = 'video "id" test';
  const result = catalogManager.sanitizeCSVField(input);
  assert.equal(result, '"video ""id"" test"');
});

test('sanitizeCSVField handles standard benign strings', () => {
  const input = 'dQw4w9WgXcQ';
  const result = catalogManager.sanitizeCSVField(input);
  assert.equal(result, '"dQw4w9WgXcQ"');
});

test('sanitizeCSVField handles null and undefined', () => {
  assert.equal(catalogManager.sanitizeCSVField(null), '""');
  assert.equal(catalogManager.sanitizeCSVField(undefined), '""');
});
