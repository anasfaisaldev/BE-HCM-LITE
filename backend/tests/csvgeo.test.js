import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvRecords } from '../src/utils/csvParse.js';
import { haversineMeters } from '../src/utils/geo.js';

test('Haversine: known distances', () => {
  assert.equal(haversineMeters(24.8607, 67.0011, 24.8607, 67.0011), 0);
  assert.ok(Math.abs(haversineMeters(0, 0, 0.001, 0) - 111.19) < 0.5);       // 0.001 deg latitude ~ 111.2 m
  assert.ok(Math.abs(haversineMeters(24.8607, 67.0011, 31.5204, 74.3587) - 1_020_000) < 15_000); // Karachi -> Lahore ~ 1,020 km
});
test('CSV parser: quotes, escaped quotes, embedded commas/newlines, CRLF, BOM, blank lines', () => {
  const r = parseCsvRecords('\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n3,"line1\nline2",\n');
  assert.deepEqual(r.map((x) => x.cells), [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['3', 'line1\nline2', '']]);
  assert.deepEqual(r.map((x) => x.line), [1, 2, 4]); // blank record 3 still counts for row numbering
  assert.throws(() => parseCsvRecords('a,b\n"open,1'));
  assert.deepEqual(parseCsvRecords(''), []);
});
