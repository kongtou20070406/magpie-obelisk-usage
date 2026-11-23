const DAY_MS = 86_400_000;
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const kindOf = (row) => (row.kind === 'attune' ? 'attune' : row.kind === 'search' ? 'search' : 'query');
const breakdown = () => ({ by: Object.create(null), byKind: { query: Object.create(null), attune: Object.create(null), search: Object.create(null) } });
function increment(bucket, source, kind) {
  bucket.by[source] = (bucket.by[source] || 0) + 1;
  bucket.byKind[kind][source] = (bucket.byKind[kind][source] || 0) + 1;
}

export function aggregate(rows, nowIso, opts = {}) {
  const tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hourly = Array.from({ length: 7 }, () => Array(24).fill(0));
  const days = new Map();
  let first = Infinity;
  let last = -Infinity;
  const now = new Date(nowIso);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - 364 * DAY_MS;
  const hourStart = Math.floor(now.getTime() / 3600000) * 3600000 - 191 * 3600000;
  const recentHours = Array.from({ length: 192 }, (_, i) => ({
    t: new Date(hourStart + i * 3600000).toISOString(),
    query: 0, attune: 0, search: 0, total: 0, ...breakdown(),
  }));
  const daily = Array.from({ length: 365 }, (_, i) => ({
    date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    query: 0, attune: 0, search: 0, total: 0, ...breakdown(),
  }));
  const months = new Map();
  const sources = new Map();
  const newest = [];
  let queryCount = 0;
  let attuneCount = 0;
  let searchCount = 0;
  let undated = 0;

  for (const row of rows) {
    const kind = kindOf(row);
    if (kind === 'attune') attuneCount++;
    else if (kind === 'search') searchCount++;
    else queryCount++;
    const source = row.source ?? 'unknown';
    sources.set(source, (sources.get(source) ?? 0) + 1);
    const time = row.ts == null ? NaN : Date.parse(row.ts);
    if (!Number.isFinite(time)) {
      undated++;
      continue;
    }
    const iso = new Date(time).toISOString();
    const hourIndex = Math.floor((time - hourStart) / 3600000);
    if (hourIndex >= 0 && hourIndex < recentHours.length) {
      recentHours[hourIndex][kind]++;
      recentHours[hourIndex].total++;
      increment(recentHours[hourIndex], source, kind);
    }
    const date = iso.slice(0, 10);
    days.set(date, (days.get(date) || 0) + 1);
    first = Math.min(first, time);
    last = Math.max(last, time);
    const parts = clock.formatToParts(time);
    const weekday = weekdays.indexOf(parts.find(part => part.type === 'weekday').value);
    const hour = Number(parts.find(part => part.type === 'hour').value);
    hourly[weekday][hour]++;
    const month = iso.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, total: 0, query: 0, attune: 0, search: 0, ...breakdown() });
    const bucket = months.get(month);
    bucket.total++;
    bucket[kind]++;
    increment(bucket, source, kind);
    const index = Math.floor((time - start) / DAY_MS);
    if (index >= 0 && index < daily.length) {
      daily[index][kind]++;
      daily[index].total++;
      increment(daily[index], source, kind);
    }
    // Retain only the newest 30; equal timestamps keep input order.
    const position = newest.findIndex((entry) => entry.time < time);
    if (position !== -1) newest.splice(position, 0, { time, row });
    else if (newest.length < 30) newest.push({ time, row });
    if (newest.length > 30) newest.pop();
  }
  let peak = null;
  for (const [date, total] of days) {
    if (!peak || total > peak.total || (total === peak.total && date < peak.date)) peak = { date, total };
  }

  return {
    generatedAt: nowIso,
    tz, hourly, peak, activeDays: days.size,
    recentHours,
    firstTs: Number.isFinite(first) ? new Date(first).toISOString() : null,
    lastTs: Number.isFinite(last) ? new Date(last).toISOString() : null,
    total: rows.length, queryCount, attuneCount, searchCount, undated,
    daily,
    monthly: [...months.values()].sort((a, b) => compareText(a.month, b.month)),
    bySource: [...sources].map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || compareText(a.source, b.source)),
    recent: newest.map(({ row }) => ({
      ts: row.ts, source: row.source ?? 'unknown', kind: row.kind, cmd: row.cmd,
    })),
  };
}
