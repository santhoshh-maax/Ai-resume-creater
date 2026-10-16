const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');

let mode = 'ok';
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const reply = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-api-key'] !== 'test-key') return reply(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (mode === 'rate') return reply(429, { error: { type: 'rate_limit_error', message: 'slow down' } });
    if (mode === 'truncated') return reply(200, { model: 'm', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"resume":' }], usage: { input_tokens: 10, output_tokens: 5 } });
    if (mode === 'malformed') return reply(200, { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, no JSON here' }], usage: { input_tokens: 10, output_tokens: 5 } });
    const sys = JSON.parse(body).system;
    let out;
    if (sys.includes('interviewer')) out = { reply: 'What is your email?', resume: { personalInfo: { fullName: 'Asha Rao' }, targetRole: 'Data Engineer' }, readyToGenerate: false, missingInformation: ['email'] };
    else if (sys.includes('expert resume writer')) out = { resume: { personalInfo: { fullName: 'Asha Rao' }, professionalSummary: 'Summary', skills: [{ category: 'Cloud', items: ['AWS S3'] }] }, missingInformation: ['metrics'], jobMatch: null };
    else out = { content: 'Better summary', explanation: 'Tighter.' };
    reply(200, { model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + JSON.stringify(out) + '\n```' }], usage: { input_tokens: 100, output_tokens: 50 } });
  });
});

let server, base;
test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;
  process.env.USAGE_LOG_FILE = path.join(os.tmpdir(), `usage-test-${Date.now()}.jsonl`);
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); mock.close(); });

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const emptyResume = {};

test('health and config status never reveal the key', async () => {
  assert.strictEqual((await (await fetch(base + '/api/health')).json()).status, 'ok');
  const txt = await (await fetch(base + '/api/config/status')).text();
  assert.ok(txt.includes('"configured":true'));
  assert.ok(!txt.includes('test-key'));
});

test('validation errors', async () => {
  const r = await post('/api/ai/interview', { messages: [], resume: {} });
  assert.strictEqual(r.status, 400);
  const r2 = await post('/api/ai/analyze-job', { resume: {} });
  assert.strictEqual(r2.status, 400);
});

test('interview returns normalized structured data', async () => {
  const r = await post('/api/ai/interview', { messages: [{ role: 'user', content: 'I want a data engineer job' }], resume: emptyResume });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.resume.personalInfo.fullName, 'Asha Rao');
  assert.deepStrictEqual(j.resume.skills, []);
});

test('generate-resume validates and returns resume', async () => {
  const r = await post('/api/ai/generate-resume', { resume: emptyResume });
  const j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.resume.skills[0].items[0], 'AWS S3');
});

test('improve-section', async () => {
  const r = await post('/api/ai/improve-section', { section: 'professionalSummary', action: 'improve', content: 'old' });
  assert.strictEqual((await r.json()).content, 'Better summary');
  const bad = await post('/api/ai/improve-section', { section: 'nope', action: 'improve', content: 'x' });
  assert.strictEqual(bad.status, 400);
});

test('provider errors map to clear codes and nothing is fabricated', async () => {
  mode = 'rate';
  let r = await post('/api/ai/generate-resume', { resume: emptyResume });
  assert.strictEqual(r.status, 429);
  mode = 'truncated';
  r = await post('/api/ai/generate-resume', { resume: emptyResume });
  assert.strictEqual((await r.json()).error.code, 'AI_TRUNCATED');
  mode = 'malformed';
  r = await post('/api/ai/generate-resume', { resume: emptyResume });
  assert.strictEqual((await r.json()).error.code, 'AI_MALFORMED');
  mode = 'ok';
});

test('usage summary matches recorded requests', async () => {
  const s = (await (await fetch(base + '/api/usage/summary')).json()).applicationTracked;
  // successes: interview, generate, improve + malformed (provider call succeeded) = 4 ; errors: rate, truncated = 2; validation failures never reach provider
  assert.strictEqual(s.totals.successful, 4);
  assert.strictEqual(s.totals.failed, 2);
  assert.strictEqual(s.totals.inputTokens, 100 * 3 + 10 + 10) // malformed (success) + truncated (error) both report tokens;
  assert.strictEqual(s.totals.outputTokens, 50 * 3 + 5 + 5);
  assert.strictEqual((await (await fetch(base + '/api/usage/summary')).json()).anthropicReported.available, false);
  const d = await (await fetch(base + '/api/usage/details?pageSize=2')).json();
  assert.strictEqual(d.rows.length, 2);
  assert.ok(!JSON.stringify(d).includes('test-key'));
});
