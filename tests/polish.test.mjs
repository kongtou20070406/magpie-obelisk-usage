import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Node {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.style = { setProperty() {} }; this.attributes = {}; this.events = {}; this.className = ''; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.events[type] = fn; }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const cls = (node, name) => walk(node).filter(item => item.className.split(' ').includes(name));

test('default chart is stacked bars; heat sizing, months, source and metric notes', () => {
  const document = { createElement(tag) { return new Node(this, tag); }, createElementNS(_ns, tag) { return new Node(this, tag); }, getElementById() { return null; }, documentElement: { style: {} } };
  const window = { setInterval() {} };
  vm.runInNewContext(fs.readFileSync('page/app.js', 'utf8'), { window, document });
  const { heatCell, monthMarks } = window.obeliskChart;
  assert.equal(heatCell(900, 28, 53, 11, 22), 13);
  assert.equal(heatCell(100, 28, 53, 11, 22), 11);
  assert.equal(heatCell(4000, 28, 24, 12, 26), 26);
  const kept = monthMarks(['10月', '10月', '1月', '1月', '1月', '2月']);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].week, 2);
  assert.equal(kept[1].week, 5);
  const dropped = monthMarks(['10月', '1月', '1月', '1月', '2月']);
  assert.equal(dropped.map(mark => mark.label).join(','), '1月,2月');
  const root = new Node(document, 'main');
  window.renderObeliskUsage({ tz: 'Asia/Singapore', generatedAt: '2026-11-01T00:00:00Z', total: 4, bySource: [{ source: 'codex', count: 4 }], daily: [], hourly: [], monthly: [], recent: [] }, root);
  assert.equal(cls(root, 'control-chart')[0].children[0].attributes['aria-pressed'], 'true');
  assert.equal(cls(root, 'mode-bar').length, 1);
  const source = cls(root, 'panel').find(panel => panel.firstChild.firstChild.firstChild.textContent === '调用来源');
  assert.equal(source.firstChild.firstChild.children[1].textContent, '近 30 天 · UTC');
  const notes = cls(root, 'metric-note').map(note => note.textContent);
  assert.equal(notes.length, 6);
  assert.ok(notes.every(note => !note.includes('\n') && note.length <= 16));
});
