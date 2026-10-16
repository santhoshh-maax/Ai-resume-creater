const express = require('express');
const config = require('../config');
const usage = require('../services/usage.service');
const admin = require('../services/anthropicAdmin.service');
const { usageAccess } = require('../middleware/usageAccess');

const router = express.Router();
router.use(usageAccess);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => res.json(r)).catch(next);

router.get('/status', wrap(async () => ({
  applicationTracked: { available: true, description: 'Requests recorded by this application using its configured AI_API_KEY (metadata only).' },
  anthropicReported: admin.adminStatus(),
  localhostOnly: config.usage.localhostOnly,
  notice: 'Localhost restriction is not sufficient for public deployment. Add authentication and authorization first.',
})));

router.get('/summary', wrap(async (req) => {
  const q = req.query;
  const result = { applicationTracked: usage.summary(q) };
  if (q.includeProvider !== 'false') {
    result.anthropicReported = await admin.anthropicReported(q);
    result.creditEstimate = await admin.creditEstimate();
  }
  return result;
}));

router.get('/details', wrap(async (req) => usage.details(req.query)));

module.exports = router;
