import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { aggregate } from '../lib/aggregate.mjs';
const core = ({ by, byKind, ...rest }) => rest

const HOUR = 3600000;
const now = '2026-11-01T12:30:00Z';
const row = (ts, kind = 'query') => ({ ts, kind, source: 'codex', cmd: 'obelisk --query example' });

test('recentHours: 192 ascending UTC hours, zero fill and inclusive/exclusive boundaries', () => {
  const start = Date.parse('2026-10-24T13:00:00Z');
  const data = aggregate([
    row(new Date(start - 1).toISOString()), row(new Date(start).toISOString()),
    row('2026-11-01T11:59:59.999Z'), row('2026-11-01T12:00:00Z', 'attune'),
    row('2026-11-01T12:59:59.999Z'), row('2026-11-01T13:00:00Z'), row(null), row('invalid')
  ], now, { tz: 'UTC' });
  assert.equal(data.recentHours.length, 192);
  data.recentHours.forEach((bucket, i) => assert.equal(bucket.t, new Date(start + i * HOUR).toISOString()));
  assert.deepEqual(core(data.recentHours[0]), { t: '2026-10-24T13:00:00.000Z', query: 1, attune: 0, total: 1 });
  assert.deepEqual(core(data.recentHours[1]), { t: '2026-10-24T14:00:00.000Z', query: 0, attune: 0, total: 0 });
  assert.deepEqual(core(data.recentHours.at(-1)), { t: '2026-11-01T12:00:00.000Z', query: 1, attune: 1, total: 2 });
  assert.equal(data.recentHours.at(-2).total, 1);
  assert.equal(data.recentHours.reduce((sum, b) => sum + b.total, 0), 4);
  assert.ok(aggregate([], now).recentHours.every(b => b.query === 0 && b.attune === 0 && b.total === 0));
});

// Minimal DOM with actual event dispatch, used to exercise the public renderer offline.
class Node {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.events = {}; this.className = ''; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.events[type] = fn; }
  get firstChild() { return this.children[0]; }
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
const byClass = (node, name) => descendants(node).filter(n => n.className.split(' ').includes(name));
function harness(data) {
  const document = { createElement(tag) { return new Node(this, tag); }, createElementNS(ns, tag) { return new Node(this, tag); }, getElementById() { return null; }, documentElement: { style: {} } };
  const window = { setInterval(fn, interval) { assert.equal(interval, 5000); } };
  vm.runInNewContext(fs.readFileSync(new URL('../page/app.js', import.meta.url), 'utf8'), { window, document });
  const root = new Node(document, 'main');
  window.renderObeliskUsage(data, root);
  return { root, select(label) { const button = descendants(root).find(n => n.tagName === 'button' && n.textContent === label); assert.ok(button); button.events.click(); } };
}
function fixture(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { window });
  return window.OBELISK_USAGE;
}
for (const tz of ['UTC', 'Asia/Singapore']) {
  test(`today local midnight, hourly columns and range metrics: ${tz}`, () => {
    const data = aggregate([
      row('2026-10-31T15:59:59Z'), row('2026-10-31T16:00:00Z', 'attune'),
      row('2026-10-31T23:59:59Z'), row('2026-11-01T00:00:00Z')
    ], now, { tz });
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = data.recentHours.filter(b => fmt.format(new Date(b.t)) === fmt.format(new Date(now)));
    assert.equal(today.reduce((sum, b) => sum + b.total, 0), tz === 'UTC' ? 1 : 3);
    const ui = harness(data);
    ui.select('今天');
    const plot = byClass(ui.root, 'columns')[0];
    assert.equal(plot.children.length, 24);
    assert.equal(byClass(plot, 'current').length, 1);
    assert.equal(byClass(plot, 'future').length, tz === 'UTC' ? 11 : 3);
    assert.match(plot.children[tz === 'UTC' ? 0 : 8].title, /query 1 · attune 0 · 总计 1/);
    assert.match(plot.children[0].title, tz === 'UTC' ? /attune 0/ : /attune 1/);
    const metrics = byClass(ui.root, 'metric');
    assert.equal(metrics[0].children[0].textContent, tz === 'UTC' ? '1' : '3');
    assert.equal(metrics[3].children[1].textContent, '每小时均值');
    assert.equal(metrics[5].children[1].textContent, '活跃小时数');
    assert.equal(metrics[5].children[0].textContent, tz === 'UTC' ? '1' : '3');
    assert.equal(byClass(ui.root, 'recent-row').length, tz === 'UTC' ? 1 : 3);
    assert.equal(byClass(ui.root, 'source-count')[0].textContent, tz === 'UTC' ? '1' : '3');
    assert.deepEqual(byClass(ui.root, 'ticks')[0].children.map(n => n.textContent), ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']);
    ui.select('7 天');
    assert.equal(byClass(ui.root, 'columns')[0].children.length, 28);
    assert.equal(byClass(ui.root, 'day-start').length, 7);
  });
}
for (const [name, data] of [['sample', fixture('../page/live.sample.js')], ['empty', {}]]) {
  test(`DOM render five ranges and all series: ${name}`, () => {
    const ui = harness(data);
    for (const [range, expected] of [['今天', 24], ['7 天', 28], ['30 天', 30], ['90 天', 90], ['全部', null]]) {
      ui.select(range);
      for (const kind of ['总计', 'query', 'attune']) {
        ui.select(kind);
        if (expected !== null) assert.equal(byClass(ui.root, 'columns')[0].children.length, expected);
      }
    }
  });
}
