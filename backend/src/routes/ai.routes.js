const express = require('express');
const rateLimit = require('express-rate-limit');
const svc = require('../services/resume.service');
const v = require('../validators/common');
const { LIMITS } = v;

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => res.json(r)).catch(next);

router.use(rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests. Please wait a minute and retry.' } },
}));

router.post('/interview', wrap(async (req) => {
  const b = req.body || {};
  return svc.interview({
    messages: v.requireMessages(b),
    resume: v.requireResume(b),
    jobDescription: v.optionalText(b, 'jobDescription', LIMITS.jobDescription),
  });
}));

router.post('/quick-resume', wrap(async (req) => {
  const b = req.body || {};
  return svc.quickResume({
    text: v.requireText(b, 'text', 8000),
    targetRole: v.optionalText(b, 'targetRole', 200),
    jobDescription: v.optionalText(b, 'jobDescription', LIMITS.jobDescription),
  });
}));

router.post('/generate-resume', wrap(async (req) => {
  const b = req.body || {};
  return svc.generateResume({
    resume: v.requireResume(b),
    conversation: v.optionalText(b, 'conversation', 20000),
    jobDescription: v.optionalText(b, 'jobDescription', LIMITS.jobDescription),
  });
}));

router.post('/improve-section', wrap(async (req) => {
  const b = req.body || {};
  if (b.content === undefined || b.content === null) throw new (require('../utils/errors').AppError)(400, 'VALIDATION_ERROR', '"content" is required.');
  if (JSON.stringify(b.content).length > 20000) throw new (require('../utils/errors').AppError)(413, 'PAYLOAD_TOO_LARGE', 'Section content is too large.');
  return svc.improveSection({
    section: String(b.section || ''),
    action: String(b.action || ''),
    content: b.content,
    targetRole: v.optionalText(b, 'targetRole', 200),
    jobDescription: v.optionalText(b, 'jobDescription', LIMITS.jobDescription),
    context: b.context && typeof b.context === 'object' && JSON.stringify(b.context).length < 3000 ? b.context : null,
  });
}));

router.post('/analyze-job', wrap(async (req) => {
  const b = req.body || {};
  return svc.analyzeJob({
    jobDescription: v.requireText(b, 'jobDescription', LIMITS.jobDescription),
    resume: v.requireResume(b),
  });
}));

router.post('/suggest-improvements', wrap(async (req) => {
  const b = req.body || {};
  return svc.suggestImprovements({ resume: v.requireResume(b), targetRole: v.optionalText(b, 'targetRole', 200) });
}));

module.exports = router;
