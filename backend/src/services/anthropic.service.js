const config = require('../config');
const { AppError } = require('../utils/errors');
const usage = require('./usage.service');

const API_VERSION = '2023-06-01';

function categorize(status, type) {
  if (status === 401) return 'invalid_api_key';
  if (status === 402) return 'billing';
  if (status === 403) return 'permission';
  if (status === 404) return 'unsupported_model';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status >= 500) return 'provider_unavailable';
  if (status === 400 && type === 'invalid_request_error') return 'invalid_request';
  return 'provider_error';
}

function providerError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  const type = body && body.error && body.error.type;
  const category = categorize(status, type);
  const lower = msg.toLowerCase();
  if (status === 400 && /credit balance|billing/.test(lower)) {
    return { err: new AppError(402, 'AI_BILLING', 'The Anthropic account has insufficient credits or a billing restriction. Add credits in the Anthropic Console and retry.'), category: 'billing' };
  }
  const map = {
    invalid_api_key: [401, 'AI_INVALID_KEY', 'The Anthropic API key (AI_API_KEY) was rejected. Check that it is correct and active.'],
    billing: [402, 'AI_BILLING', 'Insufficient credits or billing restriction on the Anthropic account.'],
    permission: [403, 'AI_PERMISSION', 'The API key does not have permission to use this model or endpoint.'],
    unsupported_model: [400, 'AI_MODEL_UNSUPPORTED', `The model "${config.ai.model}" was not found. Check AI_MODEL.`],
    rate_limit: [429, 'AI_RATE_LIMIT', 'Anthropic rate limit reached. Wait a moment, then retry.'],
    provider_unavailable: [503, 'AI_UNAVAILABLE', 'The Anthropic service is temporarily unavailable or overloaded. Retry shortly.'],
    invalid_request: [400, 'AI_INVALID_REQUEST', 'Anthropic rejected the request as invalid. ' + msg.slice(0, 200)],
    provider_error: [502, 'AI_PROVIDER_ERROR', `Anthropic returned HTTP ${status}.`],
  };
  const [s, code, m] = map[category];
  return { err: new AppError(s, code, m), category };
}

/**
 * Single Messages API call. No automatic retries (to avoid runaway cost).
 * Returns { text, stopReason, usage }.
 */
async function complete({ feature, system, messages, maxTokensFloor = 0 }) {
  const ai = config.ai;
  if (ai.provider !== 'anthropic') throw new AppError(500, 'AI_CONFIG', `Unsupported AI_PROVIDER "${ai.provider}". This app supports "anthropic".`);
  if (!ai.apiKey) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI_API_KEY is not set. Add your Anthropic API key to backend/.env and restart the server.');

  const body = {
    model: ai.model,
    max_tokens: Math.max(ai.maxTokens, maxTokensFloor),
    system,
    messages,
  };
  if (ai.temperature !== null) body.temperature = ai.temperature;

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ai.timeoutMs);
  const fail = (err, category, tokens) => {
    usage.record({ model: ai.model, feature, inputTokens: tokens && tokens.input, outputTokens: tokens && tokens.output,
      status: 'error', durationMs: Date.now() - started, errorCategory: category });
    throw err;
  };

  let res;
  try {
    res = await fetch(`${ai.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return fail(new AppError(504, 'AI_TIMEOUT', `The AI request timed out after ${ai.timeoutMs / 1000}s. Retry, or raise AI_TIMEOUT_MS.`), 'timeout');
    return fail(new AppError(502, 'AI_NETWORK', 'Could not reach the Anthropic API. Check your network and AI_BASE_URL.'), 'network');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { data = null; } finally { clearTimeout(timer); }

  if (!res.ok) {
    const { err, category } = providerError(res.status, data);
    return fail(err, category);
  }
  if (!data || !Array.isArray(data.content)) {
    return fail(new AppError(502, 'AI_BAD_RESPONSE', 'Anthropic returned an unreadable response.'), 'bad_response');
  }
  const tokens = { input: data.usage && data.usage.input_tokens, output: data.usage && data.usage.output_tokens };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) return fail(new AppError(502, 'AI_EMPTY', 'The AI returned an empty response. Please retry.'), 'empty_response', tokens);
  if (data.stop_reason === 'max_tokens') {
    return fail(new AppError(502, 'AI_TRUNCATED', 'The AI response was cut off (token limit reached). Increase AI_MAX_TOKENS in backend/.env and retry.'), 'truncated', tokens);
  }

  const rec = usage.record({ model: data.model || ai.model, feature, inputTokens: tokens.input, outputTokens: tokens.output,
    status: 'success', durationMs: Date.now() - started });
  return { text, stopReason: data.stop_reason, usage: { inputTokens: rec.inputTokens, outputTokens: rec.outputTokens } };
}

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** Complete and parse JSON. Malformed output is an error, never silently replaced. */
async function completeJson(opts) {
  const out = await complete(opts);
  const json = extractJson(out.text);
  if (!json || typeof json !== 'object') {
    throw new AppError(502, 'AI_MALFORMED', 'The AI response was not valid structured JSON. Please retry.');
  }
  return { json, usage: out.usage };
}

function configStatus() {
  return {
    provider: config.ai.provider,
    configured: Boolean(config.ai.apiKey) && config.ai.provider === 'anthropic',
    model: config.ai.model,
    timeoutMs: config.ai.timeoutMs,
    maxTokens: config.ai.maxTokens,
  };
}

module.exports = { complete, completeJson, extractJson, configStatus };

