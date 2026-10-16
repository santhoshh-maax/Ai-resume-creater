/* AI API Usage dashboard. Application-tracked and Anthropic-reported data are shown separately. */
(function () {
  const esc = (s) => Preview.esc(s);
  const fmt = (n) => (n == null ? 'n/a' : Number(n).toLocaleString());
  const fmtCost = (n) => {
    if (n == null || !Number.isFinite(n)) return 'n/a';
    if (n === 0) return '$0.0000';
    return '$' + Number(n).toFixed(4);
  };
  let page = 1;
  const PAGE_SIZE = 20;

  function getCost(r) {
    if (r.costUsd != null && Number.isFinite(r.costUsd)) return r.costUsd;
    if (r.inputTokens == null && r.outputTokens == null) return null;
    const m = String(r.model || '').toLowerCase();
    let inRate = 3.0 / 1e6, outRate = 15.0 / 1e6;
    if (m.includes('opus')) { inRate = 15.0 / 1e6; outRate = 75.0 / 1e6; }
    else if (m.includes('3-5-haiku') || m.includes('3.5-haiku') || m.includes('haiku-4')) { inRate = 0.8 / 1e6; outRate = 4.0 / 1e6; }
    else if (m.includes('haiku')) { inRate = 0.25 / 1e6; outRate = 1.25 / 1e6; }
    return (r.inputTokens || 0) * inRate + (r.outputTokens || 0) * outRate;
  }

  const el = (id) => document.getElementById(id);

  function query() {
    const p = new URLSearchParams();
    const range = el('uRange').value;
    p.set('range', range);
    if (range === 'custom') { if (el('uFrom').value) p.set('from', el('uFrom').value); if (el('uTo').value) p.set('to', el('uTo').value); }
    if (el('uModel').value) p.set('model', el('uModel').value);
    if (el('uFeature').value) p.set('feature', el('uFeature').value);
    return p;
  }

  function fillSelect(sel, values) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">All</option>' + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = values.includes(cur) ? cur : '';
  }

  function stat(label, value, cls) { return `<div class="stat ${cls || ''}"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`; }

  function chart(daily, aKey, bKey, aLabel, bLabel) {
    if (!daily.length) return '<p class="empty">No data in this period.</p>';
    const W = 720, H = 220, pad = { l: 46, r: 10, t: 10, b: 28 };
    const max = Math.max(1, ...daily.map((d) => (d[aKey] || 0) + (d[bKey] || 0)));
    const bw = Math.min(46, (W - pad.l - pad.r) / daily.length - 6);
    const x = (i) => pad.l + (i + 0.5) * ((W - pad.l - pad.r) / daily.length);
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    const bars = daily.map((d, i) => {
      const a = d[aKey] || 0, b = d[bKey] || 0;
      return `<g><title>${esc(d.date)}: ${aLabel} ${fmt(a)}, ${bLabel} ${fmt(b)}</title>
        <rect x="${x(i) - bw / 2}" y="${y(a)}" width="${bw}" height="${H - pad.b - y(a)}" fill="#1d4ed8"/>
        <rect x="${x(i) - bw / 2}" y="${y(a + b)}" width="${bw}" height="${y(a) - y(a + b)}" fill="#93c5fd"/>
        <text x="${x(i)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#64748b">${esc(d.date.slice(5))}</text></g>`;
    }).join('');
    const ticks = [0, .5, 1].map((f) => `<g><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#e2e8f0"/><text x="${pad.l - 6}" y="${y(max * f) + 3}" font-size="10" text-anchor="end" fill="#64748b">${fmt(Math.round(max * f))}</text></g>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Token usage by day">${ticks}${bars}</svg>
      <div class="chart-legend"><span><i style="background:#1d4ed8"></i>${aLabel}</span><span><i style="background:#93c5fd"></i>${bLabel}</span></div>`;
  }

  function bars(rows, valueKey, label) {
    if (!rows.length) return '<p class="empty">No data.</p>';
    const max = Math.max(1, ...rows.map((r) => r[valueKey] || 0));
    return rows.map((r) => `<div class="bar-row"><span class="n" title="${esc(r.name)}">${esc(r.name)}</span><div class="b"><div style="width:${((r[valueKey] || 0) / max) * 100}%"></div></div><span class="c">${label(r)}</span></div>`).join('');
  }

  function appSection(a) {
    const t = a.totals;
    return `
      <div class="src-head"><span class="badge app">Application-tracked usage</span></div>
      <p class="muted small">${esc(a.description)} Counts come from token usage returned by Anthropic for each request; failed requests without token data are shown as n/a, not estimated.</p>
      <div class="cards">
        ${stat('Total API requests', fmt(t.requests))}
        ${stat('Successful', fmt(t.successful), 'ok')}
        ${stat('Failed', fmt(t.failed), t.failed ? 'bad' : '')}
        ${stat('Input tokens', fmt(t.inputTokens))}
        ${stat('Output tokens', fmt(t.outputTokens))}
        ${stat('Total tokens', fmt(t.totalTokens))}
        ${stat('Estimated cost (USD)', fmtCost(t.totalCostUsd), 'ok')}
      </div>
      <p class="small muted">Period: ${esc(a.period.requested)}${a.period.firstRecord ? ` · first record ${esc(new Date(a.period.firstRecord).toLocaleString())}` : ''} · last updated ${esc(new Date(a.lastUpdated).toLocaleTimeString())}${t.requestsWithoutTokenCounts ? ` · ${t.requestsWithoutTokenCounts} request(s) have no token counts` : ''}</p>
      <div class="card"><h3>Tokens per day</h3>${chart(a.daily, 'inputTokens', 'outputTokens', 'Input tokens', 'Output tokens')}</div>
      <div class="grid cols-2">
        <div class="card"><h3>By model</h3>${bars(a.byModel, 'totalTokens', (r) => `${fmt(r.requests)} req · ${fmt(r.totalTokens)} tok${r.costUsd != null ? ` · ${fmtCost(r.costUsd)}` : ''}`)}</div>
        <div class="card"><h3>By feature</h3>${bars(a.byFeature, 'totalTokens', (r) => `${fmt(r.requests)} req · ${fmt(r.totalTokens)} tok${r.costUsd != null ? ` · ${fmtCost(r.costUsd)}` : ''}`)}</div>
      </div>
      <div class="card"><h3>Request log</h3><div id="usageTable"><p class="muted">Loading…</p></div></div>
      <p class="small muted">Cost: ${esc(a.cost.note)}</p>`;
  }

  function providerSection(p, credit) {
    let html = `<div class="src-head"><span class="badge prov">Anthropic-reported usage</span></div>
      <p class="muted small">${esc(p.scope)}</p>`;
    if (!p.available) {
      html += `<div class="card"><p><b>Not available.</b> ${esc(p.reason || 'The usage API did not return data.')}</p>
        <p class="small muted">Enable with <code>AI_USAGE_API_ENABLED=true</code> and an Admin API key in <code>AI_USAGE_API_KEY</code> (organization accounts only). Application-tracked usage above is unaffected.</p></div>`;
    } else {
      const t = p.usage.totals;
      html += `<div class="cards">${stat('Input tokens (org)', fmt(t.inputTokens))}${stat('Output tokens (org)', fmt(t.outputTokens))}${stat('Total tokens (org)', fmt(t.totalTokens))}
        ${p.cost ? stat('Provider-reported cost (USD)', '$' + p.cost.totalUsd.toFixed(2)) : stat('Cost', 'n/a')}</div>
        <p class="small muted">Reporting window: ${esc(p.usage.start.slice(0, 10))} to ${esc(p.usage.end.slice(0, 10))}${p.costError ? ' · Cost unavailable: ' + esc(p.costError) : ''}</p>
        <div class="card"><h3>Organization tokens per day</h3>${chart(p.usage.daily, 'inputTokens', 'outputTokens', 'Input tokens', 'Output tokens')}</div>
        <div class="card"><h3>Organization usage by model</h3>${bars(p.usage.byModel.map((m) => ({ ...m, total: m.inputTokens + m.outputTokens })), 'total', (r) => `${fmt(r.inputTokens)} in · ${fmt(r.outputTokens)} out`)}</div>`;
    }
    html += '<div class="card"><h3>Estimated remaining credit</h3>';
    if (credit && credit.available) {
      html += `<p class="small"><b>${esc(credit.label)}</b></p>
        <div class="cards">${stat('Configured credit (USD)', '$' + credit.creditTotalUsd.toFixed(2))}${stat('Estimated spent (USD)', '$' + credit.spentUsd.toFixed(2))}${stat('Estimated remaining (USD)', '$' + credit.estimatedRemainingUsd.toFixed(2))}</div>
        ${credit.warning ? `<div class="notice warn">${esc(credit.warning)} (This is an estimate, separate from Anthropic's actual account limits.)</div>` : ''}`;
    } else {
      html += `<p class="muted">Not available. ${esc((credit && credit.reason) || 'No reliable basis for a balance.')} Remaining credit and quota are not provided by the configured API.</p>`;
    }
    return html + '</div>';
  }

  async function loadTable() {
    const host = el('usageTable');
    if (!host) return;
    const q = query(); q.set('page', page); q.set('pageSize', PAGE_SIZE);
    try {
      const d = await AI.get('/api/usage/details?' + q);
      if (!d.rows.length) { host.innerHTML = '<p class="empty">No requests recorded in this period yet.</p>'; return; }
      const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
      host.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Time</th><th>Model</th><th>Feature</th><th class="num">Input</th><th class="num">Output</th><th class="num">Total</th><th>Status</th><th class="num">Duration</th><th>Error</th><th class="num">Cost</th></tr></thead><tbody>
        ${d.rows.map((r) => {
          const cost = getCost(r);
          return `<tr><td>${esc(new Date(r.ts).toLocaleString())}</td><td>${esc(r.model || 'n/a')}</td><td>${esc(r.feature)}</td>
            <td class="num">${fmt(r.inputTokens)}</td><td class="num">${fmt(r.outputTokens)}</td><td class="num">${fmt(r.totalTokens)}</td>
            <td><span class="pill ${r.status === 'success' ? 'success' : 'error'}">${esc(r.status)}</span></td><td class="num">${(r.durationMs / 1000).toFixed(1)}s</td><td>${esc(r.errorCategory || '')}</td><td class="num" title="${cost != null ? '$' + Number(cost).toFixed(6) : ''}">${fmtCost(cost)}</td></tr>`;
        }).join('')}
        </tbody></table></div>
        <div class="pager"><span class="small muted">${fmt(d.total)} records</span><button class="btn small" id="uPrev" ${page <= 1 ? 'disabled' : ''}>Prev</button><span>Page ${page} / ${pages}</span><button class="btn small" id="uNext" ${page >= pages ? 'disabled' : ''}>Next</button></div>`;
      const prev = el('uPrev'), next = el('uNext');
      if (prev) prev.onclick = () => { page--; loadTable(); };
      if (next) next.onclick = () => { page++; loadTable(); };
    } catch (e) { host.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  }

  async function load() {
    const body = el('usageBody');
    body.innerHTML = '<p class="muted">Loading…</p>';
    page = 1;
    try {
      const d = await AI.get('/api/usage/summary?' + query());
      const a = d.applicationTracked;
      fillSelect(el('uModel'), a.availableModels);
      fillSelect(el('uFeature'), a.availableFeatures);
      body.innerHTML = appSection(a) + providerSection(d.anthropicReported, d.creditEstimate) +
        '<p class="small muted mt">Security: usage endpoints are limited to localhost while <code>USAGE_LOCALHOST_ONLY=true</code>. That is not enough for a public deployment; add authentication first. API keys are never sent to the browser.</p>';
      loadTable();
    } catch (e) {
      body.innerHTML = `<div class="notice error">${esc(e.message)} <button class="btn small" id="uRetry">Retry</button></div>`;
      const r = el('uRetry'); if (r) r.onclick = load;
    }
  }

  function init() {
    el('usageRefresh').addEventListener('click', load);
    ['uRange', 'uFrom', 'uTo', 'uModel', 'uFeature'].forEach((id) => el(id).addEventListener('change', () => {
      const custom = el('uRange').value === 'custom';
      el('uFromWrap').hidden = !custom; el('uToWrap').hidden = !custom;
      load();
    }));
  }

  window.UsageDashboard = { init, load };
})();
