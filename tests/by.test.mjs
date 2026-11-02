import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { aggregate } from '../lib/aggregate.mjs';

class Node {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.events = {}; this.className = ''; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.events[type] = fn; }
  get firstChild() { return this.children[0]; }
}
const walk = n => [n, ...n.children.flatMap(walk)];
const cls = (n, c) => walk(n).filter(n => n.className.split(' ').includes(c));
function harness(data) {
  const document = { createElement(t) { return new Node(this, t); }, createElementNS(ns,t) { return new Node(this,t); }, getElementById() { return null; }, documentElement: { style: {} } };
  const window = { setInterval() {} };
  vm.runInNewContext(fs.readFileSync('page/app.js','utf8'), { window, document });
  const root = new Node(document,'main');
  const render = () => window.renderObeliskUsage(data,root);
  render();
  return { root, window, render, select(label) { const b = walk(root).find(n => n.tagName === 'button' && (n.textContent === label || n.attributes['aria-label'] === label)); assert.ok(b,label); b.events.click(); } };
}
function fixture(file) { const window = {}; vm.runInNewContext(fs.readFileSync(file,'utf8'),{window}); return window.OBELISK_USAGE; }

test('by partitions all buckets and kinds, null and prototype-like names', () => {
  const rows = [null,'__proto__','constructor','codex'].flatMap(source => ['query','attune'].map(kind => ({source,kind,ts:'2026-11-01T12:00:00Z'})));
  rows.push({source:'ignored',kind:'query',ts:null});
  const data = aggregate(rows,'2026-11-01T12:30:00Z',{tz:'UTC'});
  for (const bucket of [...data.daily,...data.recentHours,...data.monthly]) {
    assert.equal(Object.values(bucket.by).reduce((a,b)=>a+b,0),bucket.total);
    for (const k of ['query','attune']) assert.equal(Object.values(bucket.byKind[k]).reduce((a,b)=>a+b,0),bucket[k]);
  }
  assert.equal(data.daily.at(-1).by.unknown,2);
  assert.equal(data.monthly[0].by.__proto__,2);
  assert.equal(JSON.parse(JSON.stringify(data)).recentHours.at(-1).by.unknown,2);
});
test('niceScale covers data with monotonic readable ticks', () => {
  const {niceScale}=harness({}).window.obeliskChart;
  for (const max of [0,1,2,9,10,19,79,1234,999999]) {
    const scale=niceScale(max,5);
    assert.ok(scale.max>=max);
    assert.equal(scale.ticks[0],0);
    assert.equal(scale.ticks.at(-1),scale.max);
    scale.ticks.slice(1).forEach((v,i)=>assert.ok(v>scale.ticks[i]));
  }
  assert.deepEqual(Array.from(niceScale(79,5).ticks),[0,20,40,60,80]);
});
test('source colors are stable across ordering and missing-source normalization', () => {
  const {sourceColor}=harness({}).window.obeliskChart;
  const names=['codex','claude','omp','agent','terminal','cli','editor'];
  const colors=new Map(names.map(n=>[n,sourceColor(n)]));
  for(const n of names.reverse()) assert.equal(sourceColor(n),colors.get(n));
  assert.equal(sourceColor(null),sourceColor('unknown'));
  assert.ok(new Set(colors.values()).size>=4);
});
for (const [name,data] of [['sample',fixture('page/live.sample.js')],['empty',{}]]) {
  test(`all 60 chart combinations, geometry and refresh persistence: ${name}`,()=>{
    const ui=harness(data);
    for(const range of ['今天','7 天','30 天','90 天','全部']) for(const kind of ['总计','query','attune']) for(const split of ['来源','类型']) for(const chart of ['柱状','折线']) {
      for(const value of [range,kind,split,chart]) ui.select(value);
      const trend=cls(ui.root,'trend-panel')[0];
      assert.equal(cls(trend,'panel-head')[0].children[0].children.filter(n=>n.tagName==='p').length,1);
      const subtitle=cls(trend,'panel-head')[0].children[0].children[1].textContent;
      assert.equal(walk(trend).filter(n=>n.textContent===subtitle).length,1);
      const ticks=cls(trend,'y-tick').map(n=>Number(n.textContent.replaceAll(',','')));
      assert.ok(ticks.length>=2);
      ticks.slice(1).forEach((v,i)=>assert.ok(v>ticks[i]));
      for(const column of cls(trend,'stack-column')) {
        const sum=column.children.reduce((s,n)=>s+Number(n.attributes['data-height']),0);
        assert.ok(Math.abs(sum-Number(column.attributes['data-height']))<1e-8);
      }
      const slot=cls(trend,'column-slot')[0];
      if(slot) slot.events.mouseenter();
      const pressed=walk(ui.root).filter(n=>n.attributes['aria-pressed']==='true').map(n=>n.attributes['aria-label']||n.textContent);
      ui.render();
      assert.deepEqual(walk(ui.root).filter(n=>n.attributes['aria-pressed']==='true').map(n=>n.attributes['aria-label']||n.textContent),pressed);
      if(slot) assert.equal(cls(cls(ui.root,'trend-panel')[0],'chart-tooltip')[0].hidden,false);
    }
  });
}
