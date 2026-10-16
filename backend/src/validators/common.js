const { AppError } = require('../utils/errors');

const LIMITS = {
  message: 4000,
  messages: 40,
  jobDescription: 12000,
  resumeJson: 60000,
  field: 3000,
};

const str = (v, max = LIMITS.field) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max));
const arr = (v) => (Array.isArray(v) ? v : []);
const strList = (v, maxItems = 50) => arr(v).map((x) => str(x)).filter(Boolean).slice(0, maxItems);

/** Coerce any object (AI output or client state) into the canonical resume shape. */
function normalizeResume(input) {
  const r = input && typeof input === 'object' ? input : {};
  const p = r.personalInfo && typeof r.personalInfo === 'object' ? r.personalInfo : {};
  return {
    personalInfo: {
      fullName: str(p.fullName), email: str(p.email), phone: str(p.phone), location: str(p.location),
      linkedin: str(p.linkedin), github: str(p.github), portfolio: str(p.portfolio),
    },
    targetRole: str(r.targetRole),
    professionalSummary: str(r.professionalSummary, 2000),
    skills: arr(r.skills).slice(0, 20).map((s) => ({ category: str(s && s.category), items: strList(s && s.items, 60) }))
      .filter((s) => s.category || s.items.length),
    experience: arr(r.experience).slice(0, 20).map((e) => ({
      type: ['internship', 'volunteer'].includes(e && e.type) ? e.type : 'job',
      title: str(e && e.title), company: str(e && e.company), location: str(e && e.location),
      startDate: str(e && e.startDate), endDate: str(e && e.endDate), bullets: strList(e && e.bullets, 12),
    })).filter((e) => e.title || e.company || e.bullets.length),
    education: arr(r.education).slice(0, 10).map((e) => ({
      institution: str(e && e.institution), degree: str(e && e.degree), field: str(e && e.field), location: str(e && e.location),
      startDate: str(e && e.startDate), endDate: str(e && e.endDate), grade: str(e && e.grade), details: strList(e && e.details, 8),
    })).filter((e) => e.institution || e.degree),
    projects: arr(r.projects).slice(0, 20).map((x) => ({
      name: str(x && x.name), link: str(x && x.link), date: str(x && x.date), technologies: strList(x && x.technologies, 30), bullets: strList(x && x.bullets, 10),
    })).filter((x) => x.name || x.bullets.length),
    certifications: arr(r.certifications).slice(0, 30).map((c) => ({
      name: str(c && c.name), issuer: str(c && c.issuer), date: str(c && c.date), link: str(c && c.link),
    })).filter((c) => c.name),
    achievements: strList(r.achievements, 20),
    additionalSections: arr(r.additionalSections).slice(0, 10).map((s) => ({
      title: str(s && s.title, 100), items: strList(s && s.items, 30),
    })).filter((s) => s.title || s.items.length),
  };
}

function requireResume(body, field = 'resume') {
  const v = body[field];
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError(400, 'VALIDATION_ERROR', `"${field}" must be an object.`);
  if (JSON.stringify(v).length > LIMITS.resumeJson) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Resume content is too large.');
  return normalizeResume(v);
}

function optionalText(body, field, max) {
  const v = body[field];
  if (v == null || v === '') return '';
  if (typeof v !== 'string') throw new AppError(400, 'VALIDATION_ERROR', `"${field}" must be a string.`);
  if (v.length > max) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `"${field}" exceeds the ${max} character limit.`);
  return v.trim();
}

function requireText(body, field, max) {
  const v = optionalText(body, field, max);
  if (!v) throw new AppError(400, 'VALIDATION_ERROR', `"${field}" is required.`);
  return v;
}

function requireMessages(body) {
  const m = body.messages;
  if (!Array.isArray(m) || !m.length) throw new AppError(400, 'VALIDATION_ERROR', '"messages" must be a non-empty array.');
  const recent = m.slice(-LIMITS.messages).map((x) => {
    if (!x || !['user', 'assistant'].includes(x.role) || typeof x.content !== 'string' || !x.content.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Each message needs a role (user|assistant) and non-empty content.');
    }
    if (x.content.length > LIMITS.message) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Messages are limited to ${LIMITS.message} characters.`);
    return { role: x.role, content: x.content.trim() };
  });
  if (recent[recent.length - 1].role !== 'user') throw new AppError(400, 'VALIDATION_ERROR', 'The last message must be from the user.');
  // Anthropic requires first message to be user
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

module.exports = { LIMITS, normalizeResume, requireResume, optionalText, requireText, requireMessages, str, strList, arr };
