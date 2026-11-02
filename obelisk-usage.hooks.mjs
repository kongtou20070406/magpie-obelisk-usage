import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const cli = fileURLToPath(new URL('./bin/obelisk-usage.mjs', import.meta.url));
const output = fileURLToPath(new URL('./page/live.js', import.meta.url));
const database = join(homedir(), '.obelisk', 'obelisk.sqlite');
const intervalMs = 30_000;
let lastStarted = -Infinity;
let running = false;

function refresh() {
  try {
    const now = performance.now();
    if (running || now - lastStarted < intervalMs) return;
    lastStarted = now;
    running = true;
    // A separate process keeps synchronous SQLite and file I/O off the request loop.
    const child = spawn(process.execPath, [cli, '--db', database, '--out', output], {
      stdio: 'ignore', windowsHide: true,
    });
    child.once('error', () => { running = false; });
    child.once('close', () => { running = false; });
    child.unref();
  } catch {
    running = false;
  }
}

export async function onRequest() {
  refresh();
}

refresh();
const timer = setInterval(refresh, intervalMs);
timer.unref();
