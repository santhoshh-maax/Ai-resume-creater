const config = require('../config');
const { AppError } = require('../utils/errors');

const VERSION = '2023-06-01';

function adminStatus() {
  const u = config.usage;
  return {
    enabled: u.adminEnabled,
    keyConfigured: Boolean(u.adminKey),
    scope: u.scope,
    baseUrl: u.adminBaseUrl,
  };
}

async function adminFetch(pathname, params) {
  const u = config.usage;
  if (!u.adminEnabled) throw new AppError(409, 'ADMIN_USAGE_DISABLED', 'Anthropic usage reporting is disabled (AI_USAGE_API_ENABLED=false).');
  if (!u.adminKey) throw new AppError(409, 'ADMIN_KEY_MISSING', 'AI_USAGE_API_KEY (Admin API credential) is not configured.');
  const results = [];
  let page = null;
  for (let i = 0; i < 10; i++) { // bounded pagination
    const url = new URL(u.adminBaseUrl + pathname);
    for (const [k, v] of params) url.searchParams.append(k, v);
    if (page) url.searchParams.set('page', page);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        headers: { 'x-api-key': u.adminKey, 'anthropic-version': VERSION, 'user-agent': 'AIResumeCreator/1.0' },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new AppError(504, 'ADMIN_USAGE_UNREACHABLE', e.name === 'AbortError' ? 'Usage API request timed out.' : 'Could not reach the Anthropic usage API.');
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const map = {
        401: 'The Admin API credential was rejected.',
        403: 'The credential lacks permission for the Usage & Cost API (an Admin API key is required).',
        404: 'The usage endpoint was not found at AI_USAGE_BASE_URL.',
        429: 'Rate limited by the usage API. Try again later.',
      };
      throw new AppError(res.status === 401 || res.status === 403 ? 403 : 502, 'ADMIN_USAGE_ERROR',
        map[res.status] || `Anthropic usage API returned HTTP ${res.status}.`);
    }
    const body = await res.json();
    results.push(...(body.data || []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return results;
}

function range(q) {
  const end = q.to ? new Date(q.to) : new Date();
  if (q.to) end.setHours(23, 59, 59, 999);
  let start;
  if (q.range === 'today') { start = new Date(); start.setUTCHours(0, 0, 0, 0); }
  else if (q.range === '7d') start = new Date(Date.now() - 7 * 864e5);
  else if (q.range === 'custom' && q.from) start = new Date(q.from);
  else start = new Date(Date.now() - 30 * 864e5);
  start.setUTCHours(0, 0, 0, 0);
  if (end - start > 31 * 864e5) start = new Date(end.getTime() - 31 * 864e5);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function usageReport(q) {
  const { start, end } = range(q);
  const buckets = await adminFetch('/organizations/usage_report/messages', [
    ['starting_at', start], ['ending_at', end], ['bucket_width', '1d'], ['group_by[]', 'model'], ['limit', '31'],
  ]);
  let input = 0, output = 0;
  const byModel = {};
  const daily = buckets.map((b) => {
    let di = 0, dout = 0;
    for (const r of b.results || []) {
      const i = (r.uncached_input_tokens || 0) + (r.cache_read_input_tokens || 0) +
        ((r.cache_creation && (r.cache_creation.ephemeral_1h_input_tokens || 0) + (r.cache_creation.ephemeral_5m_input_tokens || 0)) || 0);
      const o = r.output_tokens || 0;
      di += i; dout += o;
      const m = r.model || 'unknown';
      byModel[m] = byModel[m] || { name: m, inputTokens: 0, outputTokens: 0 };
      byModel[m].inputTokens += i; byModel[m].outputTokens += o;
    }
    input += di; output += dout;
    return { date: (b.starting_at || '').slice(0, 10), inputTokens: di, outputTokens: dout };
  });
  return { start, end, totals: { inputTokens: input, outputTokens: output, totalTokens: input + output }, byModel: Object.values(byModel), daily };
}

async function costReport(startIso, endIso) {
  const buckets = await adminFetch('/organizations/cost_report', [
    ['starting_at', startIso], ['ending_at', endIso], ['bucket_width', '1d'], ['limit', '31'],
  ]);
  let cents = 0;
  const currencies = new Set();
  const daily = buckets.map((b) => {
    let d = 0;
    for (const r of b.results || []) { d += parseFloat(r.amount) || 0; if (r.currency) currencies.add(r.currency); }
    cents += d;
    return { date: (b.starting_at || '').slice(0, 10), usd: d / 100 };
  });
  return { totalUsd: cents / 100, currencies: [...currencies], daily };
}

async function anthropicReported(q) {
  const status = adminStatus();
  const base = {
    source: 'anthropic-reported',
    scope: `Organization-level (AI_USAGE_SCOPE=${config.usage.scope}). This is NOT limited to this application or to AI_API_KEY and may include other apps, workspaces and keys.`,
    status,
  };
  if (!status.enabled || !status.keyConfigured) {
    return { ...base, available: false, reason: !status.enabled
      ? 'Disabled. Set AI_USAGE_API_ENABLED=true to enable.'
      : 'AI_USAGE_API_KEY (Admin API key) is not configured.' };
  }
  try {
    const usage = await usageReport(q);
    let cost = null, costError = null;
    try {
      const c = await costReport(usage.start, usage.end);
      cost = { totalUsd: c.totalUsd, daily: c.daily, label: 'Provider-reported cost (USD) for the organization over this period' };
    } catch (e) { costError = e.message; }
    return { ...base, available: true, usage, cost, costError, lastUpdated: new Date().toISOString() };
  } catch (e) {
    if (e instanceof AppError) return { ...base, available: false, reason: e.message, code: e.code };
    throw e;
  }
}

/** Estimated remaining credit: only when AI_CREDIT_TOTAL, AI_CREDIT_START and provider cost data exist. */
async function creditEstimate() {
  const u = config.usage;
  if (u.creditTotal === null || !u.creditStart) {
    return { available: false, reason: 'AI_CREDIT_TOTAL and AI_CREDIT_START are not both configured.' };
  }
  const start = new Date(u.creditStart);
  if (isNaN(start)) return { available: false, reason: 'AI_CREDIT_START is not a valid date.' };
  if (!u.adminEnabled || !u.adminKey) {
    return { available: false, reason: 'A reliable cost basis requires the Anthropic Admin API (AI_USAGE_API_ENABLED=true and AI_USAGE_API_KEY).' };
  }
  try {
    const end = new Date();
    const chunks = [];
    for (let s = new Date(start); s < end; s = new Date(s.getTime() + 31 * 864e5)) {
      const e = new Date(Math.min(s.getTime() + 31 * 864e5, end.getTime()));
      chunks.push(await costReport(s.toISOString(), e.toISOString()));
      if (chunks.length >= 12) break;
    }
    const spent = chunks.reduce((a, c) => a + c.totalUsd, 0);
    return {
      available: true,
      label: 'ESTIMATE - not a live Anthropic account balance. Based on organization-wide provider-reported cost since AI_CREDIT_START.',
      creditTotalUsd: u.creditTotal,
      spentUsd: spent,
      estimatedRemainingUsd: u.creditTotal - spent,
      since: start.toISOString(),
      warning: spent / u.creditTotal >= 0.8 ? `Estimated spend has reached ${(spent / u.creditTotal * 100).toFixed(0)}% of the configured credit total.` : null,
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

module.exports = { adminStatus, anthropicReported, creditEstimate };
