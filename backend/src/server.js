const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const ai = require('./services/anthropic.service');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
}));

// Basic request timeout for API routes (AI routes enforce their own provider timeout).
app.use('/api', (req, res, next) => { res.setTimeout(config.ai.timeoutMs + 20000); next(); });

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/config/status', (req, res) => res.json(ai.configStatus()));
app.use('/api/ai', require('./routes/ai.routes'));
app.use('/api/resume', require('./routes/resume.routes'));
app.use('/api/usage', require('./routes/usage.routes'));

app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));
app.use('/api', notFound);
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'index.html')));
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`AI Resume Creator running at http://localhost:${config.port}`);
    if (!config.ai.apiKey) console.warn('WARNING: AI_API_KEY is not set. AI features will return a configuration error.');
  });
}
module.exports = app;
