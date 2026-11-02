import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../lib/aggregate.mjs';
const core = ({ by, byKind, ...rest }) => rest; // v4 adds per-source breakdowns; the original contract keys are compared here

const now = '2026-11-01T12:00:00Z';
const rows = [
  { id: '1', ts: '2026-11-01T01:00:00Z', source: 'codex', name: 'exec', kind: 'query', cmd: 'obelisk --query a.mjs' },
  { id: '2', ts: '2026-11-01T02:00:00Z', source: 'codex', name: 'exec', kind: 'attune', cmd: 'obelisk --attune b.mjs' },
  { id: '3', ts: '2026-10-31T23:59:59Z', source: null, name: 'bash', kind: 'query', cmd: 'x' },
  { id: '4', ts: null, source: 'claude', name: 'bash', kind: 'query', cmd: 'y' },
  { id: '5', ts: '2025-01-01T00:00:00Z', source: 'omp', name: 'bash', kind: 'query', cmd: 'old' },
];

test('totals', () => {
  const a = aggregate(rows, now);
  assert.equal(a.total, 5);
  assert.equal(a.queryCount, 4);
  assert.equal(a.attuneCount, 1);
  assert.equal(a.undated, 1);
  assert.equal(a.generatedAt, now);
});

test('daily window', () => {
  const a = aggregate(rows, now);
  assert.equal(a.daily.length, 365);
  assert.equal(a.daily.at(-1).date, '2026-11-01');
  assert.equal(a.daily[0].date, '2025-11-02');
  assert.deepEqual(core(a.daily.at(-1)), { date: '2026-11-01', query: 1, attune: 1, total: 2 });
  assert.deepEqual(core(a.daily.at(-2)), { date: '2026-10-31', query: 1, attune: 0, total: 1 });
});

test('monthly includes out-of-window dated rows', () => {
  const a = aggregate(rows, now);
  assert.deepEqual(a.monthly.map(({ month, total }) => ({ month, total })), [
    { month: '2025-01', total: 1 },
    { month: '2026-10', total: 1 },
    { month: '2026-11', total: 2 },
  ]);
});

test('bySource', () => {
  const a = aggregate(rows, now);
  assert.deepEqual(a.bySource, [
    { source: 'codex', count: 2 },
    { source: 'claude', count: 1 },
    { source: 'omp', count: 1 },
    { source: 'unknown', count: 1 },
  ]);
});

test('recent newest first, dated only', () => {
  const a = aggregate(rows, now);
  assert.deepEqual(a.recent.map((r) => r.ts), [
    '2026-11-01T02:00:00Z', '2026-11-01T01:00:00Z', '2026-10-31T23:59:59Z', '2025-01-01T00:00:00Z',
  ]);
});

test('recent capped at 30 and empty input', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    id: String(i), ts: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`,
    source: 'a', name: 'n', kind: 'query', cmd: 'c',
  }));
  assert.equal(aggregate(many, now).recent.length, 30);
  const e = aggregate([], now);
  assert.equal(e.total, 0);
  assert.equal(e.daily.length, 365);
  assert.deepEqual(e.recent, []);
});
