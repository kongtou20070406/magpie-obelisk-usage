# magpie-obelisk-usage

A [magpie](https://usemagpie.ai) page plugin that shows how often your agents call [obelisk](https://github.com/tommy0103/obelisk): a daily heatmap, per-agent breakdown, `--query` vs `--attune` share, and recent calls. Time granularity adapts to the range (today → hourly).

## Install

```bash
magpie plugin add github:kongtou20070406/magpie-obelisk-usage
```

## How it works

- Reads `~/.obelisk/obelisk.sqlite` **read-only** (`tool_calls` joined to `messages` and `sessions`); a call is a tool call whose input matches `obelisk … --query` or `--attune`.
- A host hook runs the bundled CLI every 30 s and writes `page/live.js`; the page reloads it every 5 s. Nothing leaves your machine and the page requests no magpie permissions.
- Requires Node 22+ or Bun (for `node:sqlite` / `bun:sqlite`).

## Develop

```bash
node --test tests/*.test.mjs
```

MIT licensed.
