#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLive } from '../lib/read.mjs';

try {
  let dbPath = join(homedir(), '.obelisk', 'obelisk.sqlite');
  let outFile = fileURLToPath(new URL('../page/live.js', import.meta.url));
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if ((option !== '--db' && option !== '--out') || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: obelisk-usage [--db PATH] [--out PATH]');
    }
    if (option === '--db') dbPath = args[++i];
    else outFile = args[++i];
  }
  const data = writeLive(dbPath, outFile);
  console.log(`Obelisk usage: total=${data.total} query=${data.queryCount} attune=${data.attuneCount} undated=${data.undated}; out=${outFile}`);
} catch (error) {
  console.error(`Obelisk usage: ${error.message}`);
  process.exitCode = 1;
}
