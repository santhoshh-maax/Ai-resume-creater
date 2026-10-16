const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { AppError } = require('../utils/errors');

const router = express.Router();
const CSS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'css');

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

router.post('/pdf', async (req, res, next) => {
  let browser;
  try {
    const { html, template, filename } = req.body || {};
    if (typeof html !== 'string' || !html.trim()) throw new AppError(400, 'VALIDATION_ERROR', '"html" is required.');
    if (html.length > 1_500_000) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Resume is too large to export.');
    const exe = findBrowser();
    if (!exe) throw new AppError(503, 'PDF_NO_BROWSER', 'No Chrome/Edge installation found for PDF generation. Install Chrome or Edge, or set CHROME_PATH in backend/.env.');

    const css = fs.readFileSync(path.join(CSS_DIR, 'resume-preview.css'), 'utf8');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
      <style>@page{size:A4;margin:14mm 16mm}html,body{margin:0;background:#fff}</style></head>
      <body class="pdf-mode">${html}</body></html>`;

    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false); // exported markup is data only
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') || r.url().startsWith('about:') ? r.continue() : r.abort()));
    await page.setContent(doc, { waitUntil: 'load', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    const safe = String(filename || 'Resume.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'Resume.pdf';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safe.endsWith('.pdf') ? safe : safe + '.pdf'}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(pdf));
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(500, 'PDF_FAILED', 'PDF generation failed. Please retry.'));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = router;

