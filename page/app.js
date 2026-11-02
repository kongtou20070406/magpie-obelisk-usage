(() => {
  'use strict';
  const DAY = 86400000;
  const states = new WeakMap();
  const count = value => Number.isFinite(value) && value > 0 ? value : 0;
  const number = value => count(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const array = value => Array.isArray(value) ? value : [];
  const HOUR = 3600000;
  const stamp = time => new Date(time).toISOString().slice(0, 16).replace('T', ' ');
  function localClock(tz) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    return time => {
      const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    };
  }
  function bucketRows(data, days, now, wall) {
    const local = days === 1 || days === 7;
    const end = Math.floor((local ? wall(now) : now) / DAY) * DAY;
    const start = end - (days - 1) * DAY;
    const size = days === 1 ? HOUR : days === 7 ? 6 * HOUR : DAY;
    const rows = Array.from({ length: days * DAY / size }, (_, i) => ({
      start: start + i * size, end: start + (i + 1) * size,
      query: 0, attune: 0, total: 0, by: Object.create(null), byKind: { query: Object.create(null), attune: Object.create(null) }
    }));
    for (const row of array(local ? data.recentHours : data.daily)) {
      const time = Date.parse(local ? row.t : `${row.date}T00:00:00Z`);
      if (!Number.isFinite(time)) continue;
      const index = Math.floor(((local ? wall(time) : time) - start) / size);
      if (index >= 0 && index < rows.length) {
        for (const key of ['query', 'attune', 'total']) rows[index][key] += count(row[key]);
        mergeCounts(rows[index].by, row.by);
        for (const kind of ['query', 'attune']) mergeCounts(rows[index].byKind[kind], row.byKind && row.byKind[kind]);
      }
    }
    for (const row of rows) {
      row.label = stamp(row.start).slice(5, 10);
      const clock = local ? wall(now) : now;
      row.future = row.start > clock;
      row.current = row.start <= clock && row.end > clock;
      if (days === 1) row.tick = new Date(row.start).getUTCHours() % 2 === 0 ? stamp(row.start).slice(11) : null;
      if (days === 7) {
        row.separator = new Date(row.start).getUTCHours() === 0;
        row.tick = row.separator ? row.label : null;
      }
    }
    return { rows, start, end: end + DAY, local };
  }
  function monthRows(data) {
    const daily = array(data.daily);
    const byMonth = new Map();
    for (const row of daily) {
      const month = row.date.slice(0, 7);
      const sum = byMonth.get(month) || { query: 0, attune: 0, total: 0 };
      for (const key of ['query', 'attune', 'total']) sum[key] += count(row[key]);
      byMonth.set(month, sum);
    }
    return array(data.monthly).filter(row => count(row.total)).map(row => {
      const start = Date.parse(`${row.month}-01T00:00:00Z`);
      const date = new Date(start);
      const sum = byMonth.get(row.month);
      const complete = sum && sum.total === row.total;
      return { ...row, label: row.month, start, end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
        query: row.query ?? (complete ? sum.query : null), attune: row.attune ?? (complete ? sum.attune : null) };
    });
  }
  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function svgNode(doc, tag, attrs, text) {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function panel(doc, root, title, subtitle, meta) {
    const node = element(doc, 'section', 'panel');
    const head = element(doc, 'div', 'panel-head');
    const heading = element(doc, 'div');
    heading.append(element(doc, 'h2', '', title), element(doc, 'p', 'muted', subtitle));
    head.append(heading);
    if (meta) head.append(element(doc, 'span', 'muted panel-meta', meta));
    node.append(head);
    root.append(node);
    return node;
  }
  function empty(doc, root) { root.append(element(doc, 'p', 'empty', '暂无数据')); }
  function bars(doc, root, rows, key, tz) {
    if (!rows.length) { empty(doc, root); return; }
    const max = Math.max(0, ...rows.map(row => count(row[key])));
    const chart = element(doc, 'div', 'column-chart');
    chart.append(element(doc, 'div', 'chart-max', `最大 ${number(max)}`));
    const plot = element(doc, 'div', 'columns');
    plot.style.gap = rows.length > 30 ? '1px' : '3px';
    rows.forEach(row => {
      const slot = element(doc, 'div', `column-slot${row.separator ? ' day-start' : ''}`);
      const value = key => row[key] == null ? '无分项数据' : number(row[key]);
      slot.title = `${stamp(row.start)} 至 ${stamp(row.end)}（结束不含） · ${tz}\nquery ${value('query')} · attune ${value('attune')} · 总计 ${value('total')}${row.future ? ' · 未发生' : ''}`;
      slot.setAttribute('aria-label', slot.title);
      const bar = element(doc, 'span', `column${row.current ? ' current' : ''}${row.future ? ' future' : ''}`);
      bar.style.height = `${max ? count(row[key]) / max * 100 : 0}%`;
      slot.append(bar);
      plot.append(slot);
    });
    const ticks = element(doc, 'div', rows.some(row => row.separator) ? 'ticks daily-ticks' : 'ticks');
    const custom = rows.some(row => row.tick !== undefined);
    const indices = custom ? rows.flatMap((row, i) => row.tick != null ? [i] : [])
      : [...new Set(Array.from({ length: Math.min(6, rows.length) }, (_, i) => Math.round(i * (rows.length - 1) / Math.max(1, Math.min(6, rows.length) - 1))))];
    for (const index of indices) {
      const tick = element(doc, 'span', '', custom ? rows[index].tick : rows[index].label);
      tick.style.left = `${(index + .5) / rows.length * 100}%`;
      ticks.append(tick);
    }
    chart.append(plot, ticks);
    root.append(chart);
  }
  function relative(ts, now) {
    const delta = now - Date.parse(ts);
    if (!Number.isFinite(delta)) return '—';
    if (delta < 0) return '稍后';
    if (delta < 60000) return '刚刚';
    if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
    if (delta < DAY) return `${Math.floor(delta / 3600000)} 小时前`;
    return `${Math.floor(delta / DAY)} 天前`;
  }
  function mergeCounts(target, source) {
    for (const [name, value] of Object.entries(source || {})) target[name] = (target[name] || 0) + count(value);
  }
  function niceScale(max, ticks = 5) {
    const ceiling = Math.max(1, count(max));
    const raw = ceiling / Math.max(1, Math.floor(ticks) - 1);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, [1, 2, 5, 10].find(n => n * magnitude >= raw) * magnitude);
    const top = Math.ceil(ceiling / step) * step;
    return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
  }
  function seriesColor(source) {
    const name = String(source ?? 'unknown');
    const fixed = { codex: 0, query: 0, claude: 1, omp: 2, attune: 3, deepseek: 6, 'codexhost-antigravity': 7 };
    if (name === 'unknown') return 'var(--series-unknown)';
    if (Object.hasOwn(fixed, name)) return `var(--series-${fixed[name]})`;
    let hash = 2166136261;
    for (const char of name) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
    return `var(--series-${[3, 4, 5][hash % 3]})`;
  }
  const sourceColor = seriesColor;
  function heatCell(containerWidth, labelWidth, cols, min, max) {
    const width = Number(containerWidth);
    const labels = Number(labelWidth);
    const columns = Math.max(1, Math.floor(Number(cols)) || 1);
    const lo = Math.min(Number(min), Number(max));
    const hi = Math.max(Number(min), Number(max));
    if (!Number.isFinite(width) || !Number.isFinite(labels) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
    const raw = Math.floor((width - labels) / columns) - 3;
    return Math.min(hi, Math.max(lo, Number.isFinite(raw) ? raw : lo));
  }
  function monthMarks(weeks) {
    const marks = [];
    let previous = '';
    for (let week = 0; week < weeks.length; week++) {
      if (weeks[week] === previous) continue;
      marks.push({ week, label: weeks[week] });
      previous = weeks[week];
    }
    const shown = [];
    for (let index = 0; index < marks.length; index++) {
      const last = shown.at(-1);
      if (last && marks[index].week - last.week < 3) shown.pop();
      shown.push(marks[index]);
    }
    if (shown.length > 1 && shown[1].week - shown[0].week < 3) shown.shift();
    return shown;
  }
  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
    let path = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[Math.max(0, i - 1)];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const [x3, y3] = points[Math.min(points.length - 1, i + 2)];
      path += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
    }
    return path;
  }
  function chartIcon(doc, kind) {
    const svg = svgNode(doc, 'svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true', class: 'chart-icon' });
    if (kind === 'bar') {
      [[1, 7, 3, 6], [5.5, 3, 3, 10], [10, 5, 3, 8]].forEach(([x, y, width, height]) => {
        svg.append(svgNode(doc, 'rect', { x, y, width, height, rx: .6, fill: 'currentColor' }));
      });
    } else {
      svg.append(svgNode(doc, 'path', { d: 'M1.5 10.5 L5 5.5 L9 8.5 L12.5 3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      [[5, 5.5], [12.5, 3]].forEach(([cx, cy]) => svg.append(svgNode(doc, 'circle', { cx, cy, r: 1.2, fill: 'currentColor' })));
    }
    return svg;
  }
  window.obeliskChart = { niceScale, sourceColor, seriesColor, heatCell, monthMarks };
  function choices(doc, state, key, options, rerender) {
    const tabs = element(doc, 'div', `tabs control-${key}`);
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', key);
    for (const [value, label] of options) {
      const button = element(doc, 'button');
      if (key === 'chart') button.append(chartIcon(doc, value));
      else button.textContent = label;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(state[key] === value));
      button.addEventListener('click', () => { state[key] = value; rerender(); });
      tabs.append(button);
    }
    return tabs;
  }
  function series(row, kind, split) {
    if (split === 'type') return Object.fromEntries(['query', 'attune'].filter(k => kind === 'total' || kind === k).map(k => [k, count(row[k])]));
    return kind === 'total' ? row.by || {} : (row.byKind && row.byKind[kind]) || {};
  }
  function tipContent(doc, tip, label, values, total, future) {
    tip.replaceChildren(element(doc, 'strong', '', label));
    if (future) tip.append(element(doc, 'p', 'muted', '未发生'));
    for (const [name, value] of Object.entries(values)) {
      const line = element(doc, 'div', 'tip-row');
      const dot = element(doc, 'i', 'source-dot');
      dot.style.background = sourceColor(name);
      line.append(dot, element(doc, 'span', 'tip-name', name), element(doc, 'b', '', number(value)));
      tip.append(line);
    }
    const sum = element(doc, 'div', 'tip-total');
    sum.append(element(doc, 'span', '', '合计'), element(doc, 'b', '', number(total)));
    tip.append(sum);
  }
  function placeTip(tip, fraction) {
    tip.style.left = fraction > .5 ? 'auto' : '8px';
    tip.style.right = fraction > .5 ? '8px' : 'auto';
    tip.hidden = false;
  }
  function drawTrend(doc, panel, rows, state, zone) {
    const layout = element(doc, 'div', 'trend-layout');
    const chart = element(doc, 'div', 'trend-chart');
    const plot = element(doc, 'div', `columns trend-columns mode-${state.chart}`);
    plot.style.gap = '1px';
    const scale = niceScale(Math.max(0, ...rows.map(r => count(r[state.kind]))));
    const grid = element(doc, 'div', 'y-grid');
    for (const value of scale.ticks) {
      const line = element(doc, 'div', 'y-line');
      line.style.bottom = `${value / scale.max * 100}%`;
      line.append(element(doc, 'span', 'y-tick', number(value)));
      grid.append(line);
    }
    chart.append(grid);
    const tip = element(doc, 'div', 'chart-tooltip');
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    const slots = [];
    const linePaths = [];
    const linePoints = [];
    const clearHover = () => {
      state.hover = null;
      tip.hidden = true;
      slots.forEach(s => { s.style.opacity = '1'; });
      linePaths.forEach(p => { p.style.opacity = '1'; });
      linePoints.forEach(({ point }) => { point.style.opacity = '0'; });
    };
    const values = rows.map(row => series(row, state.kind, state.split));
    const names = [...new Set(values.flatMap(v => Object.keys(v)))].sort((a, b) => values.reduce((sum, v) => sum + count(v[b]) - count(v[a]), 0) || a.localeCompare(b));
    const show = index => {
      const row = rows[index];
      state.hover = String(row.start);
      tipContent(doc, tip, `${stamp(row.start).replaceAll('-', '/')} · ${zone}`, values[index], row[state.kind], row.future);
      placeTip(tip, (index + .5) / rows.length);
      slots.forEach((slot, i) => { slot.style.opacity = i === index ? '1' : '.45'; });
      linePaths.forEach(p => { p.style.opacity = '.45'; });
      linePoints.forEach(({ point, bucket }) => { point.style.opacity = bucket === index ? '1' : '0'; });
    };
    rows.forEach((row, index) => {
      const slot = element(doc, 'div', `column-slot${row.separator ? ' day-start' : ''}`);
      slot.title = `${stamp(row.start)} 至 ${stamp(row.end)} · ${zone}\nquery ${number(row.query)} · attune ${number(row.attune)} · 总计 ${number(row.total)}${row.future ? ' · 未发生' : ''}`;
      slot.setAttribute('tabindex', '0');
      slot.setAttribute('aria-label', slot.title);
      const column = element(doc, 'div', `stack-column${row.current ? ' current' : ''}${row.future ? ' future' : ''}${!row[state.kind] ? ' zero' : ''}`);
      const total = count(row[state.kind]);
      column.style.height = `${total / scale.max * 100}%`;
      column.setAttribute('data-height', String(total / scale.max * 180));
      for (const name of names) {
        const value = count(values[index][name]);
        if (!value) continue;
        const segment = element(doc, 'span', 'stack-segment');
        segment.style.height = `${total ? value / total * 100 : 0}%`;
        segment.style.background = sourceColor(name);
        segment.setAttribute('data-height', String(value / scale.max * 180));
        column.append(segment);
      }
      slot.append(column);
      slot.addEventListener('mouseenter', () => show(index));
      slot.addEventListener('focus', () => show(index));
      slot.addEventListener('mouseleave', clearHover);
      slot.addEventListener('blur', clearHover);
      slots.push(slot);
      plot.append(slot);
    });
    chart.append(plot);
    if (state.chart === 'line' && rows.length) {
      const svg = svgNode(doc, 'svg', { viewBox: '0 0 1000 180', preserveAspectRatio: 'none', class: 'line-chart' });
      for (const name of names) {
        const points = rows.flatMap((r, i) => r.future ? [] : [[(i + .5) / rows.length * 1000, 180 - count(values[i][name]) / scale.max * 180]]);
        if (!points.length) continue;
        const path = smoothPath(points);
        const area = svgNode(doc, 'path', { d: `${path} L${points.at(-1)[0]},180 L${points[0][0]},180 Z`, fill: sourceColor(name), 'fill-opacity': .08, stroke: 'none' });
        svg.append(area);
        const line = svgNode(doc, 'path', { d: path, fill: 'none', stroke: sourceColor(name), 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' });
        linePaths.push(line);
        svg.append(line);
        rows.forEach((row, bucket) => {
          if (row.future) return;
          const point = svgNode(doc, 'circle', { cx: (bucket + .5) / rows.length * 1000, cy: 180 - count(values[bucket][name]) / scale.max * 180, r: 3, fill: sourceColor(name), stroke: 'var(--card)', 'stroke-width': 1 });
          point.style.opacity = '0';
          linePoints.push({ point, bucket });
          svg.append(point);
        });
      }
      chart.append(svg);
    }
    const ticks = element(doc, 'div', 'ticks trend-ticks');
    const custom = rows.some(row => row.tick !== undefined);
    rows.forEach((row, i) => {
      if (custom ? row.tick == null : i % Math.max(1, Math.ceil(rows.length / 6)) !== 0) return;
      const tick = element(doc, 'span', '', custom ? row.tick : row.label);
      tick.style.left = `${(i + .5) / rows.length * 100}%`;
      ticks.append(tick);
    });
    chart.append(ticks, tip);
    const aside = element(doc, 'aside', 'trend-details');
    const totals = names.map(name => ({ name, total: values.reduce((s, v) => s + count(v[name]), 0),
      query: rows.reduce((s, r) => s + count(series(r, 'query', state.split)[name]), 0),
      attune: rows.reduce((s, r) => s + count(series(r, 'attune', state.split)[name]), 0) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const sum = totals.reduce((s, r) => s + r.total, 0);
    const displayed = totals.slice(0, 8);
    if (totals.length > 8) displayed.push(totals.slice(8).reduce((s, r) => ({ name: '其他', total: s.total + r.total, query: s.query + r.query, attune: s.attune + r.attune }), { total: 0, query: 0, attune: 0 }));
    for (const row of displayed) {
      const item = element(doc, 'div', 'detail-row');
      const head = element(doc, 'div', 'tip-row');
      const dot = element(doc, 'i', 'source-dot');
      dot.style.background = sourceColor(row.name);
      head.append(dot, element(doc, 'span', 'tip-name', row.name), element(doc, 'b', '', number(row.total)));
      const track = element(doc, 'div', 'track');
      track.style.background = `color-mix(in oklab, ${sourceColor(row.name)} 16%, var(--card))`;
      const fill = element(doc, 'span', 'fill');
      const percent = sum ? row.total / sum * 100 : 0;
      fill.style.width = `${percent}%`;
      fill.style.background = sourceColor(row.name);
      track.append(fill);
      item.append(head, track, element(doc, 'p', 'muted', `query ${row.query} · attune ${row.attune} · 占比 ${percent.toFixed(1)}%`));
      aside.append(item);
    }
    if (!totals.length) empty(doc, aside);
    layout.append(chart, aside);
    panel.append(layout);
    const active = rows.findIndex(r => String(r.start) === state.hover);
    if (active >= 0) show(active);
  }
  function drawHeat(doc, parent, spec, replacing) {
    const scroll = element(doc, 'div', 'heat-scroll');
    scroll.style.width = '100%';
    const width = spec.labelWidth + spec.cols * (spec.cell + spec.gap);
    const height = spec.top + spec.rows * (spec.cell + spec.gap);
    const svg = svgNode(doc, 'svg', {
      viewBox: `0 0 ${width} ${height}`, class: spec.className, role: 'img', 'aria-label': spec.label,
      'data-cols': spec.cols, 'data-min': spec.min, 'data-max': spec.max, 'data-label-width': spec.labelWidth
    });
    spec.paint(svg, spec.cell, spec.gap, spec.labelWidth, spec.top);
    scroll.append(svg);
    let observer = null;
    let listening = false;
    const stop = () => {
      if (observer) observer.disconnect();
      if (listening) window.removeEventListener('resize', fit);
      observer = null;
      listening = false;
    };
    function fit() {
      // A replaced or removed heat map must never rebuild itself: a detached node still
      // receives a final resize notification, and rebuilding from it appended a duplicate.
      if (scroll.isConnected === false || (replacing && replacing.stale)) { stop(); return; }
      const container = scroll.clientWidth || scroll.getBoundingClientRect().width || width;
      const cell = heatCell(container, spec.labelWidth, spec.cols, spec.min, spec.max);
      if (cell === spec.cell) return;
      spec.cell = cell;
      stop();
      scroll.stale = true;
      drawHeat(doc, parent, spec, scroll);
    }
    if (replacing && typeof replacing.replaceWith === 'function') replacing.replaceWith(scroll);
    else parent.append(scroll);
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(fit); observer.observe(scroll); }
    else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') { window.addEventListener('resize', fit); listening = true; }
    return scroll;
  }
  function drawDailyHeat(doc, root, data, now, state, rerender) {
    const card = panel(doc, root, '用量热力图', '最近 53 周 · 每日 · UTC');
    card.className += ' daily-heat';
    const hint = element(doc, 'button', 'hint', '?');
    hint.type = 'button';
    hint.title = '每日汇总按 UTC 日历日计算';
    hint.setAttribute('aria-label', '每日汇总按 UTC 日历日计算');
    card.firstChild.firstChild.children[1].append(hint);
    card.firstChild.append(choices(doc, state, 'heatKind', [['total', '总计'], ['query', 'query'], ['attune', 'attune']], rerender));
    const end = Math.floor(now / DAY) * DAY;
    const start = end - ((new Date(end).getUTCDay() + 6) % 7 + 52 * 7) * DAY;
    const weeks = Array.from({ length: 53 }, (_, w) => `${new Date(start + w * 7 * DAY).getUTCMonth() + 1}月`);
    const marks = monthMarks(weeks);
    const lookup = new Map(array(data.daily).map(row => [row.date, row]));
    const max = Math.max(1, ...array(data.daily).map(r => count(r[state.heatKind])));
    const tip = element(doc, 'div', 'chart-tooltip');
    tip.hidden = true;
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    drawHeat(doc, card, {
      className: 'daily-map', label: '最近 53 周每日调用热力图', cols: 53, rows: 7, cell: 12, gap: 3, min: 11, max: 22, labelWidth: 28, top: 18,
      paint(svg, cell, gap, labelWidth, top) {
        weekdays.forEach((name, d) => svg.append(svgNode(doc, 'text', { x: 0, y: top + d * (cell + gap) + cell * .78, class: 'axis-label' }, name)));
        for (const mark of marks) svg.append(svgNode(doc, 'text', { x: labelWidth + mark.week * (cell + gap), y: 11, class: 'axis-label' }, weeks[mark.week]));
        for (let w = 0; w < 53; w++) for (let d = 0; d < 7; d++) {
          const time = start + (w * 7 + d) * DAY;
          if (time > end) continue;
          const key = new Date(time).toISOString().slice(0, 10);
          const row = lookup.get(key);
          const value = count(row && row[state.heatKind]);
          const box = svgNode(doc, 'rect', { x: labelWidth + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 2, tabindex: 0, class: `heat-cell level-${value ? Math.ceil(value / max * 4) : 0}` });
          const label = `${key} · ${row ? number(value) + ' 次' : '无历史数据'}`;
          box.append(svgNode(doc, 'title', {}, label));
          const show = () => { state.heatHover = key; tipContent(doc, tip, label, row ? series(row, state.heatKind, 'source') : {}, value, false); placeTip(tip, w / 53); };
          box.addEventListener('mouseenter', show);
          box.addEventListener('focus', show);
          box.addEventListener('mouseleave', () => { tip.hidden = true; state.heatHover = null; });
          box.addEventListener('blur', () => { tip.hidden = true; state.heatHover = null; });
          if (state.heatHover === key) show();
          svg.append(box);
        }
      }
    });
    const legend = element(doc, 'div', 'legend daily-legend');
    legend.append(element(doc, 'span', '', '少'));
    for (let level = 0; level < 5; level++) legend.append(element(doc, 'span', `swatch level-${level}`));
    legend.append(element(doc, 'span', '', '多'));
    card.append(legend, tip);
  }
  function renderObeliskUsage(data, root) {
    if (!root) return;
    data = data || {};
    const doc = root.ownerDocument;
    const state = states.get(root) || { days: 30, kind: 'total', split: 'source', chart: 'bar', heatKind: 'total', hover: null };
    states.set(root, state);
    root.replaceChildren();
    const rerender = () => renderObeliskUsage(data, root);
    const toolbar = element(doc, 'header', 'toolbar');
    const controls = element(doc, 'div', 'seg');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '统计时间范围');
    for (const [days, label] of [[1, '今天'], [7, '7 天'], [30, '30 天'], [90, '90 天'], [0, '全部']]) {
      const button = element(doc, 'button', '', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(days === state.days));
      button.addEventListener('click', () => { state.days = days; rerender(); });
      controls.append(button);
    }
    const status = element(doc, 'span', 'refresh', '每 5 秒更新');
    status.title = data.generatedAt ? `数据更新于 ${data.generatedAt}` : '等待首次数据同步';
    toolbar.append(controls, status);
    root.append(toolbar);
    const parsed = Date.parse(data.generatedAt);
    const now = Number.isFinite(parsed) ? parsed : Date.now();
    const tz = data.tz || 'UTC';
    const wall = localClock(tz);
    const all = state.days === 0;
    const today = state.days === 1;
    const selected = all ? null : bucketRows(data, state.days, now, wall);
    const daily = all ? [] : selected.rows;
    const recent = array(data.recent).filter(row => {
      const ts = Date.parse(row.ts);
      if (!Number.isFinite(ts)) return false;
      const time = selected && selected.local ? wall(ts) : ts;
      return all || (time >= selected.start && time < selected.end);
    });
    const total = all ? count(data.total) : daily.reduce((sum, row) => sum + count(row.total), 0);
    const query = all ? count(data.queryCount) : daily.reduce((sum, row) => sum + count(row.query), 0);
    const attune = all ? count(data.attuneCount) : daily.reduce((sum, row) => sum + count(row.attune), 0);
    const active = all ? count(data.activeDays) : today ? daily.filter(row => count(row.total)).length
      : new Set(daily.filter(row => count(row.total)).map(row => Math.floor(row.start / DAY))).size;
    const dated = all ? array(data.monthly).reduce((sum, row) => sum + count(row.total), 0) : total;
    const zone = today || state.days === 7 ? tz : 'UTC';
    const range = `${all ? '全部时间' : today ? '今天' : `近 ${state.days} 天`} · ${zone}`;
    const grain = `${all ? '全部时间 · 每月' : today ? '今天 · 每小时' : state.days === 7 ? '近 7 天 · 每 6 小时' : `近 ${state.days} 天 · 每天`} · ${zone}`;
    const elapsedHours = today ? Math.max((wall(now) - selected.start) / HOUR, 0) : 0;
    const stats = element(doc, 'section', 'metrics');
    stats.setAttribute('aria-label', '调用指标');
    for (const [value, label, note] of [
      [number(total), '总调用', all ? `含 ${number(data.undated)} 条无日期` : today ? '今天' : `近 ${state.days} 天`],
      [number(query), 'query', '检索与查询'], [number(attune), 'attune', '上下文调谐'],
      [number(today ? elapsedHours ? total / elapsedHours : 0 : active ? dated / active : 0), today ? '每小时均值' : '日均调用', today ? '按已过去小时' : '按活跃天'],
      [number(data.peak && data.peak.total), '最忙一天', data.peak ? data.peak.date : '全部时间'],
      [number(active), today ? '活跃小时数' : '活跃天数', today ? '范围内有调用的小时' : '范围内有调用的日期']
    ]) {
      const metric = element(doc, 'div', 'metric');
      metric.append(element(doc, 'p', 'metric-value', value), element(doc, 'h2', 'metric-label', label), element(doc, 'p', 'metric-note', note));
      stats.append(metric);
    }
    root.append(stats);
    const trend = panel(doc, root, '调用趋势', grain);
    trend.className += ' trend-panel';
    const tools = element(doc, 'div', 'trend-tools');
    tools.append(choices(doc, state, 'kind', [['total', '总计'], ['query', 'query'], ['attune', 'attune']], rerender),
      choices(doc, state, 'chart', [['bar', '柱状'], ['line', '折线']], rerender),
      choices(doc, state, 'split', [['source', '来源'], ['type', '类型']], rerender));
    trend.append(tools);
    const trendRows = all ? monthRows(data) : daily;
    if (all) for (const row of trendRows) { row.current = row.start <= now && row.end > now; row.future = row.start > now; }
    drawTrend(doc, trend, trendRows, state, zone);
    drawDailyHeat(doc, root, data, now, state, rerender);
    const grid = element(doc, 'div', 'card-grid');
    root.append(grid);
    const heat = panel(doc, grid, '按时段', `全部时间 · 每小时 · ${tz}`);
    const hourly = array(data.hourly);
    const maxHour = Math.max(0, ...hourly.flat().map(count));
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    let busiest = '暂无调用';
    drawHeat(doc, heat, {
      className: 'heatmap', label: '周一至周日，0 至 23 时调用热力图', cols: 24, rows: 7, cell: 12, gap: 3, min: 12, max: 26, labelWidth: 28, top: 18,
      paint(svg, cell, gap, labelWidth, top) {
        for (let hour = 0; hour < 24; hour += 3) svg.append(svgNode(doc, 'text', { x: labelWidth + hour * (cell + gap), y: 11, class: 'axis-label' }, String(hour).padStart(2, '0')));
        for (let day = 0; day < 7; day++) {
          svg.append(svgNode(doc, 'text', { x: 0, y: top + day * (cell + gap) + cell * .78, class: 'axis-label' }, weekdays[day]));
          for (let hour = 0; hour < 24; hour++) {
            const value = count(hourly[day] && hourly[day][hour]);
            if (value && value === maxHour && busiest === '暂无调用') busiest = `${weekdays[day]} ${String(hour).padStart(2, '0')}:00 · ${number(value)} 次`;
            const level = value ? Math.ceil(value / maxHour * 4) : 0;
            const box = svgNode(doc, 'rect', { x: labelWidth + hour * (cell + gap), y: top + day * (cell + gap), width: cell, height: cell, rx: 2, class: `heat-cell level-${level}` });
            box.append(svgNode(doc, 'title', {}, `${weekdays[day]} ${String(hour).padStart(2, '0')}:00 · ${number(value)} 次`));
            svg.append(box);
          }
        }
      }
    });
    const footer = element(doc, 'div', 'heat-footer');
    footer.append(element(doc, 'span', '', `最忙：${busiest}`));
    const legend = element(doc, 'div', 'legend');
    legend.append(element(doc, 'span', '', '少'));
    for (let level = 0; level < 5; level++) legend.append(element(doc, 'span', `swatch level-${level}`));
    legend.append(element(doc, 'span', '', '多'));
    footer.append(legend);
    heat.append(footer);
    const bucketSources = new Map();
    for (const row of (all ? monthRows(data) : trendRows)) for (const [name, value] of Object.entries(row.by || {})) bucketSources.set(name, (bucketSources.get(name) || 0) + count(value));
    const sources = (all || !bucketSources.size ? array(data.bySource) : [...bucketSources].map(([source, n]) => ({ source, count: n })).sort((a, b) => b.count - a.count || String(a.source).localeCompare(String(b.source))));
    const sourcePanel = panel(doc, grid, '调用来源', range);
    const sourceTotal = sources.reduce((sum, row) => sum + count(row.count), 0);
    const sourceMax = Math.max(1, ...sources.map(row => count(row.count)));
    const sourceList = element(doc, 'ol', 'source-list');
    for (const row of sources) {
      const item = element(doc, 'li', 'source-row');
      const name = element(doc, 'span', 'source-name', row.source);
      name.title = row.source;
      const track = element(doc, 'div', 'track');
      const fill = element(doc, 'span', 'fill');
      fill.style.width = `${count(row.count) / sourceMax * 100}%`;
      track.style.background = `color-mix(in oklab, ${sourceColor(row.source)} 16%, var(--card))`;
      fill.style.background = sourceColor(row.source);
      track.append(fill);
      item.append(name, track, element(doc, 'span', 'source-count', number(row.count)), element(doc, 'span', 'muted percent', `${sourceTotal ? (count(row.count) / sourceTotal * 100).toFixed(1) : 0}%`));
      sourceList.append(item);
    }
    sourcePanel.append(sourceList);
    if (!sources.length) empty(doc, sourcePanel);
    const recentPanel = panel(doc, grid, '最近调用', `${range} · 最多 30 条`, `${recent.length} 条`);
    const list = element(doc, 'ol', 'recent-list');
    for (const row of recent.slice(0, 30)) {
      const item = element(doc, 'li', 'recent-row');
      const source = element(doc, 'span', 'recent-source');
      const dot = element(doc, 'i', 'source-dot');
      dot.style.background = sourceColor(row.source);
      source.append(dot, element(doc, 'span', 'source-name', row.source || 'unknown'));
      const command = element(doc, 'code', 'command', row.cmd || '—');
      command.title = row.cmd || '—';
      const time = element(doc, 'time', 'relative', relative(row.ts, now));
      time.title = row.ts;
      const kind = element(doc, 'span', row.kind === 'attune' ? 'kind attune' : 'kind', row.kind || 'query');
      item.append(source, command, time, kind);
      list.append(item);
    }
    recentPanel.append(list);
    if (!recent.length) empty(doc, recentPanel);
    const monthly = panel(doc, grid, '月度调用', '全部时间 · 每月 · UTC');
    bars(doc, monthly, monthRows(data), 'total', 'UTC');
  }
  window.renderObeliskUsage = renderObeliskUsage;
  const root = document.getElementById('app');
  const render = () => renderObeliskUsage(window.OBELISK_USAGE, root);
  function applyTheme(theme) {
    const mode = typeof theme === 'string' ? theme : theme && (theme.mode || theme.colorScheme);
    if (mode === 'light' || mode === 'dark') document.documentElement.style.colorScheme = mode;
  }
  const bridge = window.magpie;
  if (bridge) {
    applyTheme(bridge.theme);
    if (typeof bridge.onTheme === 'function') bridge.onTheme(applyTheme);
    if (typeof bridge.ready === 'function') bridge.ready();
  }
  render();
  let loading = false;
  window.setInterval(() => {
    if (loading) return;
    loading = true;
    const previous = document.getElementById('obelisk-live');
    const script = document.createElement('script');
    script.id = 'obelisk-live';
    script.src = `live.js?t=${Date.now()}`;
    script.onload = () => { loading = false; render(); };
    script.onerror = () => { loading = false; render(); };
    if (previous) previous.replaceWith(script);
    else document.head.append(script);
  }, 5000);
})();
