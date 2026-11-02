import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { aggregate } from './aggregate.mjs';

const require = createRequire(import.meta.url);
const SQL = `SELECT t.id, m.timestamp AS ts, s.source AS source, t.name, t.input_json
FROM tool_calls t LEFT JOIN messages m ON m.uuid=t.message_uuid LEFT JOIN sessions s ON s.id=t.session_id
WHERE t.input_json LIKE '%obelisk%--query%' OR t.input_json LIKE '%obelisk%--attune%'`;

function openReadOnly(dbPath) {
  try {
    const { Database } = require('bun:sqlite');
    return new Database(dbPath, { readonly: true });
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly: true });
  }
}

function commandText(raw) {
  let value = raw;
  try {
    const input = JSON.parse(raw);
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      for (const key of ['command', 'cmd', 'input', 'script']) {
        if (Object.hasOwn(input, key)) {
          value = Array.isArray(input[key]) ? input[key].join(' ') : input[key];
          break;
        }
      }
    }
  } catch {
    // Legacy calls may store a raw command instead of JSON.
  }
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function readRows(dbPath) {
  const db = openReadOnly(dbPath);
  try {
    return db.prepare(SQL).all().map(({ id, ts, source, name, input_json }) => ({
      id, ts, source, name,
      kind: input_json.includes('--attune') ? 'attune' : 'query',
      cmd: commandText(input_json),
    }));
  } finally {
    db.close();
  }
}

export function writeLive(dbPath, outFile, nowIso = new Date().toISOString()) {
  const data = aggregate(readRows(dbPath), nowIso);
  mkdirSync(dirname(outFile), { recursive: true });
  const temporary = `${outFile}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `window.OBELISK_USAGE = ${JSON.stringify(data)};\n`, { flag: 'wx' });
  renameSync(temporary, outFile);
  return data;
}
