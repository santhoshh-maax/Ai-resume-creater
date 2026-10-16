const fs = require('fs');
const path = require('path');
const config = require('../config');

const LOG_FILE = process.env.USAGE_LOG_FILE || path.join(__dirname, '..', '..', 'data', 'usage.jsonl');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let records = null;

function load() {
  if (records) return records;
  records = [];
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  } catch { /* no log yet */ }
  return records;
}

/**
 * Record metadata only. Never store keys, headers, prompts, or resume content.
 * Token fields are null when the provider did not return them.
 */
function record({ model, feature, inputTokens, outputTokens, status, durationMs, errorCategory }) {
  const hasIn = Number.isFinite(inputTokens);
  const hasOut = Number.isFinite(outputTokens);
  const rec = {
    ts: new Date().toISOString(),
    model: model || null,
    feature: feature || 'unknown',
    inputTokens: hasIn ? inputTokens : null,
    outputTokens: hasOut ? outputTokens : null,
    totalTokens: hasIn && hasOut ? inputTokens + outputTokens : null,
    status,
    durationMs: Math.round(durationMs || 0),
    errorCategory: errorCategory || null,
  };
  load().push(rec);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.error('[usage] could not persist usage log:', e.message);
  }
  return rec;
}

function parseRange(q) {
  const now = new Date();
  let from = null;
  let to = null;
  const range = q.range || 'all';
  if (range === 'today') {
    from = new Date(now); from.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    from = new Date(now.getTime() - 7 * 864e5);
  } else if (range === '30d') {
    from = new Date(now.getTime() - 30 * 864e5);
  } else if (range === 'custom') {
    if (q.from) from = new Date(q.from);
    if (q.to) { to = new Date(q.to); to.setHours(23, 59, 59, 999); }
  }
  if (from && isNaN(from)) from = null;
  if (to && isNaN(to)) to = null;
  return { from, to };
}

function filtered(q) {
  const { from, to } = parseRange(q);
  return load().filter((r) => {
    const t = new Date(r.ts);
    if (from && t < from) return false;
    if (to && t > to) return false;
    if (q.model && r.model !== q.model) return false;
    if (q.feature && r.feature !== q.feature) return false;
    return true;
  });
}

const sum = (arr, k) => arr.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0);

function summary(q) {
  const rows = filtered(q);
  const group = (key) => {
    const m = {};
    for (const r of rows) {
      const k = r[key] || 'unknown';
      m[k] = m[k] || { name: k, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      m[k].requests += 1;
      m[k].inputTokens += r.inputTokens || 0;
      m[k].outputTokens += r.outputTokens || 0;
      m[k].totalTokens += r.totalTokens || 0;
    }
    return Object.values(m).sort((a, b) => b.requests - a.requests);
  };
  const daily = {};
  for (const r of rows) {
    const d = r.ts.slice(0, 10);
    daily[d] = daily[d] || { date: d, requests: 0, inputTokens: 0, outputTokens: 0 };
    daily[d].requests += 1;
    daily[d].inputTokens += r.inputTokens || 0;
    daily[d].outputTokens += r.outputTokens || 0;
  }
  const all = load();
  return {
    source: 'application-tracked',
    description: 'Requests recorded by this application using its configured AI_API_KEY.',
    totals: {
      requests: rows.length,
      successful: rows.filter((r) => r.status === 'success').length,
      failed: rows.filter((r) => r.status !== 'success').length,
      inputTokens: sum(rows, 'inputTokens'),
      outputTokens: sum(rows, 'outputTokens'),
      totalTokens: sum(rows, 'totalTokens'),
      requestsWithoutTokenCounts: rows.filter((r) => r.totalTokens === null).length,
    },
    byModel: group('model'),
    byFeature: group('feature'),
    daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
    availableModels: [...new Set(all.map((r) => r.model).filter(Boolean))],
    availableFeatures: [...new Set(all.map((r) => r.feature))],
    period: {
      requested: q.range || 'all',
      firstRecord: rows.length ? rows[0].ts : null,
      lastRecord: rows.length ? rows[rows.length - 1].ts : null,
    },
    cost: {
      available: false,
      note: 'Per-request cost is not returned by the Messages API. This app does not hardcode prices. See Anthropic-reported cost below when the Admin API is enabled.',
    },
    lastUpdated: new Date().toISOString(),
  };
}

function details(q) {
  const rows = filtered(q).slice().reverse();
  const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 25, 1), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return {
    source: 'application-tracked',
    total: rows.length,
    page,
    pageSize,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}

module.exports = { record, summary, details, config };
