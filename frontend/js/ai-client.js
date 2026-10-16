/* Thin client for the backend API. No credentials ever live in the browser. */
(function () {
  class ApiError extends Error {
    constructor(message, code, status) { super(message); this.code = code; this.status = status; }
  }

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError('Cannot reach the server. Make sure the backend is running.', 'NETWORK', 0);
    }
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      let msg = `Request failed (HTTP ${res.status}).`;
      let code = 'HTTP_' + res.status;
      if (ct.includes('application/json')) {
        const j = await res.json().catch(() => null);
        if (j && j.error) { msg = j.error.message || msg; code = j.error.code || code; }
      }
      throw new ApiError(msg, code, res.status);
    }
    return res;
  }

  const json = async (m, p, b) => (await request(m, p, b)).json();

  window.AI = {
    ApiError,
    get: (p) => json('GET', p),
    post: (p, b) => json('POST', p, b),
    blob: async (p, b) => { const r = await request('POST', p, b); return r.blob(); },
    configStatus: () => json('GET', '/api/config/status'),
    interview: (b) => json('POST', '/api/ai/interview', b),
    quick: (b) => json('POST', '/api/ai/quick-resume', b),
    generate: (b) => json('POST', '/api/ai/generate-resume', b),
    improve: (b) => json('POST', '/api/ai/improve-section', b),
    analyzeJob: (b) => json('POST', '/api/ai/analyze-job', b),
    suggest: (b) => json('POST', '/api/ai/suggest-improvements', b),
  };
})();
