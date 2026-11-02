import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRows, writeLive } from '../lib/read.mjs';

function mk() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'obu-'));
  const p = path.join(d, 'o.sqlite');
  const db = new DatabaseSync(p);
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT);
    CREATE TABLE messages(uuid TEXT PRIMARY KEY, timestamp TEXT);
    CREATE TABLE tool_calls(id TEXT PRIMARY KEY, message_uuid TEXT, session_id TEXT, name TEXT, input_json TEXT);
    INSERT INTO sessions VALUES('s1','codex');
    INSERT INTO messages VALUES('m1','2026-10-30T10:00:00Z');
    INSERT INTO tool_calls VALUES('t1','m1','s1','exec','{"cmd":["obelisk","--query","a.mjs"]}');
    INSERT INTO tool_calls VALUES('t2','m1','s1','bash','{"command":"obelisk  --attune   x.mjs"}');
    INSERT INTO tool_calls VALUES('t3','zz','nope','bash','obelisk --query raw');
    INSERT INTO tool_calls VALUES('t4','m1','s1','bash','{"command":"ls"}');`);
  db.close();
  return { d, p };
}

test('readRows', () => {
  const { p } = mk();
  const r = readRows(p).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { id: 't1', ts: '2026-10-30T10:00:00Z', source: 'codex', name: 'exec', kind: 'query', cmd: 'obelisk --query a.mjs' });
  assert.equal(r[1].kind, 'attune');
  assert.equal(r[1].cmd, 'obelisk --attune x.mjs');
  assert.equal(r[2].ts, null);
  assert.equal(r[2].source, null);
  assert.equal(r[2].cmd, 'obelisk --query raw');
});

test('readRows leaves db untouched', () => {
  const { p } = mk();
  const before = fs.readFileSync(p).toString('hex');
  readRows(p);
  assert.equal(fs.readFileSync(p).toString('hex'), before);
});

test('writeLive', () => {
  const { d, p } = mk();
  const o = path.join(d, 'live.js');
  writeLive(p, o, '2026-11-01T00:00:00Z');
  const s = fs.readFileSync(o, 'utf8');
  assert.ok(s.startsWith('window.OBELISK_USAGE = '));
  const j = JSON.parse(s.replace(/^window\.OBELISK_USAGE = /, '').replace(/;\s*$/, ''));
  assert.equal(j.total, 3);
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.includes('.tmp')), []);
});
