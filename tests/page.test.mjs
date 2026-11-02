import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('index.html: no inline script, correct order', () => {
  const h = rd('../page/index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(h));
  const i = ['_magpie/bridge.js', 'live.js', 'app.js'].map((s) => h.indexOf(s));
  assert.ok(i.every((x) => x >= 0) && i[0] < i[1] && i[1] < i[2]);
});

test('app.js: no network / innerHTML / eval, exposes renderer', () => {
  const a = rd('../page/app.js');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML|eval\(/.test(a));
  assert.ok(/renderObeliskUsage/.test(a));
});

test('manifest intact and icon present', () => {
  const p = JSON.parse(rd('../package.json'));
  assert.equal(p.magpie.page.file, 'page/index.html');
  assert.deepEqual(p.magpie.permissions, []);
  assert.ok(fs.existsSync(new URL('../page/icon.svg', import.meta.url)));
});
