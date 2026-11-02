import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Regression: a heat map that resized (or was replaced) used to append a duplicate copy of itself,
// because the replaced node's resize observer kept firing from a detached node.
class Node {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.parent = null; this.style = { setProperty() {} }; this.attributes = {}; this.events = {}; this.className = ''; this.textContent = ''; this.clientWidth = 0; }
  append(...nodes) { for (const n of nodes) { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n); n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { for (const c of this.children) c.parent = null; this.children = []; this.append(...nodes); }
  replaceWith(next) {
    const p = this.parent; if (!p) return; // detached: no-op, exactly like the DOM
    if (next.parent) next.parent.children = next.parent.children.filter(c => c !== next);
    p.children = p.children.map(c => (c === this ? next : c)); next.parent = p; this.parent = null;
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === n.ownerDocument.root; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(t, fn) { this.events[t] = fn; }
  getBoundingClientRect() { return { width: this.clientWidth }; }
  get firstChild() { return this.children[0]; }
}
const walk = n => [n, ...n.children.flatMap(walk)];
const count = (root, name) => walk(root).filter(n => n.className.split(' ').includes(name)).length;

test('resizing the daily heat map never duplicates it', () => {
  const observers = [];
  const document = { root: null, createElement(tag) { return new Node(this, tag); }, createElementNS(_n, tag) { return new Node(this, tag); }, getElementById() { return null; }, documentElement: { style: {} } };
  class ResizeObserver { constructor(fn) { this.fn = fn; this.on = new Set(); observers.push(this); } observe(n) { this.on.add(n); } disconnect() { this.on.clear(); } }
  const window = { setInterval() {}, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync('page/app.js', 'utf8'), { window, document, ResizeObserver });
  const root = new Node(document, 'main'); document.root = root;
  window.renderObeliskUsage({ tz: 'Asia/Singapore', generatedAt: '2026-11-01T00:00:00Z', total: 4, bySource: [{ source: 'codex', count: 4 }], daily: [], hourly: [], monthly: [], recent: [] }, root);
  const before = count(root, 'heat-scroll');
  assert.ok(before >= 2);
  const widths = [600, 900, 1300, 700, 1500, 1500, 800];
  for (const w of widths) {
    for (const o of [...observers]) for (const n of [...o.on]) { n.clientWidth = w; o.fn([{ target: n }]); }
    // Also fire every observer on its stale node: the former duplicate source.
    for (const o of observers) o.fn([]);
    assert.equal(count(root, 'heat-scroll'), before, `heat maps after resize to ${w}`);
  }
});
