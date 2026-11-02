import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../lib/aggregate.mjs';

const now = '2026-11-01T12:00:00Z';
const rows = ['2024-01-07T23:30:00Z', '2024-01-07T23:45:00Z', '2026-10-31T16:00:00Z', null, 'invalid']
  .map(ts => ({ ts, source: 'codex', kind: 'query', cmd: 'obelisk --query x' }));
for (const tz of ['UTC', 'Asia/Singapore']) {
  test(`hourly timezone boundaries and all-time metadata: ${tz}`, () => {
    const data = aggregate(rows, now, { tz });
    const expected = Array.from({ length: 7 }, () => Array(24).fill(0));
    if (tz === 'UTC') { expected[6][23] = 2; expected[5][16] = 1; }
    else { expected[0][7] = 2; expected[6][0] = 1; }
    assert.equal(data.tz, tz);
    assert.deepEqual(data.hourly, expected);
    assert.deepEqual(data.peak, { date: '2024-01-07', total: 2 });
    assert.equal(data.activeDays, 2);
    assert.equal(data.firstTs, '2024-01-07T23:30:00.000Z');
    assert.equal(data.lastTs, '2026-10-31T16:00:00.000Z');
    const empty = aggregate([], now, { tz });
    assert.deepEqual(empty.hourly, Array.from({ length: 7 }, () => Array(24).fill(0)));
    assert.equal(empty.peak, null);
    assert.equal(empty.activeDays, 0);
    assert.equal(empty.firstTs, null);
    assert.equal(empty.lastTs, null);
  });
}
