const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const num = (v, d) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

const config = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  ai: {
    provider: process.env.AI_PROVIDER || 'anthropic',
    apiKey: (process.env.AI_API_KEY || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
    model: process.env.AI_MODEL || 'claude-sonnet-4-5',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 30000),
    maxTokens: num(process.env.AI_MAX_TOKENS, 1024),
    temperature: process.env.AI_TEMPERATURE === undefined || process.env.AI_TEMPERATURE === ''
      ? null : num(process.env.AI_TEMPERATURE, null),
  },
  usage: {
    adminEnabled: bool(process.env.AI_USAGE_API_ENABLED, false),
    adminKey: (process.env.AI_USAGE_API_KEY || '').trim(),
    adminBaseUrl: (process.env.AI_USAGE_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
    scope: process.env.AI_USAGE_SCOPE || 'account',
    localhostOnly: bool(process.env.USAGE_LOCALHOST_ONLY, true),
    creditTotal: process.env.AI_CREDIT_TOTAL ? num(process.env.AI_CREDIT_TOTAL, null) : null,
    creditStart: process.env.AI_CREDIT_START || null,
  },
};

module.exports = config;
