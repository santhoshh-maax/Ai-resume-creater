const ai = require('./anthropic.service');
const { normalizeResume, str, strList, arr } = require('../validators/common');
const { AppError } = require('../utils/errors');

const SCHEMA = `Resume JSON schema (all strings; use "" or [] when unknown):
{
  "personalInfo": {"fullName","email","phone","location","linkedin","github","portfolio"},
  "targetRole": "",
  "professionalSummary": "",
  "skills": [{"category": "", "items": [""]}],
  "experience": [{"type": "job|internship|volunteer", "title","company","location","startDate","endDate","bullets": [""]}],
  "education": [{"institution","degree","field","location","startDate","endDate","grade","details": [""]}],
  "projects": [{"name","date","link","technologies": [""],"bullets": [""]}],
  "certifications": [{"name","issuer","date","link"}],
  "achievements": [""],
  "additionalSections": [{"title": "e.g. Languages, Publications, Volunteer Experience", "items": [""]}]
}`;

const RULES = `Non-negotiable rules:
- NEVER invent or assume personal details, employers, job titles, dates, education, grades, certifications, skills, links, or numbers/metrics. Use only facts the user has stated.
- A job's location, employer or target country is NOT the candidate's location or history. Leave personalInfo.location empty unless the user states where they live.
- A job description describes the employer's wants; it is NOT evidence about the user. Never add JD skills or keywords to the resume unless the user stated them.
- Writing quality may be improved (action verbs, concision, grammar, clarity) without adding new facts.
- Do not claim the resume is guaranteed to pass any ATS.
- Put soft skills in a skills category named exactly "Soft Skills" (only ones the user stated). Spoken languages go in additionalSections with title "Languages". Project date/duration goes in projects[].date as the user wrote it.
- Respond with ONE valid JSON object only. No markdown, no commentary outside the JSON.`;

const compact = (o) => JSON.stringify(o);

async function interview({ messages, resume, jobDescription }) {
  const system = `You are the interviewer of an AI resume builder. Through friendly conversation you collect the facts needed for a professional resume.

Behaviour:
- First, find out: target role, candidate type (fresher/student/experienced/career changer), whether they have an existing resume to paste, and whether there is a target job description. Accept all of this in one natural message; do not re-ask what is already known.
- Ask only relevant MISSING questions, one manageable group (max 3-4 questions) at a time.
- Fresher/student: focus on education, projects, internships, certifications, skills. Experienced: responsibilities, technologies, measurable outcomes (ask, never invent). Career changer: transferable skills and relevant projects.
- If the user pastes an existing resume or details, extract them into the structured data.
- Optional sections (publications, volunteer, languages, etc.) may be skipped; respect "no"/"skip".
- Set readyToGenerate=true once you have at minimum: name, contact email or phone, target role, and at least one of education/experience/projects. Tell the user they can generate the resume now (they may still add more).
- Keep replies short and warm.

${RULES}

${SCHEMA}

Return JSON: {"reply": "message shown to the user (includes the next question group)", "resume": <the FULL updated resume object containing ONLY facts the user has stated so far; keep all existing data unless the user corrected it>, "readyToGenerate": boolean, "missingInformation": ["short items still worth asking about"]}`;

  const ctx = `Current structured resume data (verified from user):\n${compact(resume)}${jobDescription ? `\n\nTarget job description supplied by user:\n${jobDescription}` : ''}`;
  const msgs = messages.slice();
  const last = msgs.pop();
  msgs.push({ role: 'user', content: `${ctx}\n\nUser's latest message:\n${last.content}` });

  const { json, usage } = await ai.completeJson({ feature: 'interview', system, messages: msgs, maxTokensFloor: 3000 });
  return {
    reply: str(json.reply, 3000) || 'Could you tell me a bit more?',
    resume: normalizeResume(json.resume),
    readyToGenerate: json.readyToGenerate === true,
    missingInformation: strList(json.missingInformation, 12),
    usage,
  };
}

async function generateResume({ resume, conversation, jobDescription }) {
  const system = `You are an expert resume writer. Turn the user's confirmed facts into a polished, job-targeted resume.

Tasks: write a concise 2-4 sentence professional summary from verified facts; organize skills into sensible categories (only skills the user stated); rewrite experience/project bullets to be concise and action-oriented; keep a fresher-oriented structure (education, projects, internships, skills) when there is no work experience; emphasize relevant verified achievements; use relevant terminology and consistent tense/formatting; order entries most-relevant-first.
Use measurable results ONLY if the user provided them. Do not add placeholders like "[X]%".

${RULES}

${SCHEMA}

Return JSON: {"resume": <full resume>, "missingInformation": ["specific information the user could add to strengthen the resume"], "jobMatch": ${jobDescription ? '{"matchingSkills": [""], "missingOrUnverified": [""]}' : 'null'}}`;
  const content = `Confirmed facts:\n${compact(resume)}\n${conversation ? `\nConversation transcript (user statements only):\n${conversation}\n` : ''}${jobDescription ? `\nTarget job description:\n${jobDescription}\n` : ''}\nGenerate the resume JSON.`;
  const { json, usage } = await ai.completeJson({ feature: 'generate-resume', system, messages: [{ role: 'user', content }], maxTokensFloor: 4096 });
  if (!json.resume || typeof json.resume !== 'object') throw new AppError(502, 'AI_MALFORMED', 'The AI response did not include a resume. Please retry.');
  const out = normalizeResume(json.resume);
  if (!out.personalInfo.fullName && !out.professionalSummary && !out.experience.length && !out.education.length && !out.projects.length) {
    throw new AppError(502, 'AI_MALFORMED', 'The AI returned an empty resume. Please retry.');
  }
  // Safety net: never lose user-provided contact info the model may have dropped.
  for (const k of Object.keys(out.personalInfo)) if (!out.personalInfo[k] && resume.personalInfo[k]) out.personalInfo[k] = resume.personalInfo[k];
  if (!out.targetRole) out.targetRole = resume.targetRole;
  return {
    resume: out,
    missingInformation: strList(json.missingInformation, 15),
    jobMatch: json.jobMatch && typeof json.jobMatch === 'object'
      ? { matchingSkills: strList(json.jobMatch.matchingSkills, 40), missingOrUnverified: strList(json.jobMatch.missingOrUnverified, 40) } : null,
    usage,
  };
}

async function quickResume({ text, targetRole, jobDescription }) {
  const system = `You are an expert resume writer. The user pasted everything about themselves in free text (any order, any format). In ONE step: extract every fact into the structured resume AND polish the writing.

Tasks: extract name, contact, links, education, projects, experience/internships, skills, certifications, achievements, languages; write a concise 2-4 sentence professional summary from stated facts only; rewrite project/experience bullets as 2-3 concise, action-oriented bullets each (no invented metrics); group technical skills into sensible categories; list soft skills only if stated. If the user has no work experience, build a fresher-style resume (education, projects, skills). List anything important that is missing in missingInformation (e.g. email, phone, graduation date) instead of guessing.

${RULES}

${SCHEMA}

Return JSON: {"resume": <full resume>, "missingInformation": ["..."], "jobMatch": ${jobDescription ? '{"matchingSkills": [""], "missingOrUnverified": [""]}' : 'null'}}`;
  const content = `${targetRole ? `Target role: ${targetRole}\n\n` : ''}User's description of themselves:\n${text}${jobDescription ? `\n\nTarget job description:\n${jobDescription}` : ''}`;
  const { json, usage } = await ai.completeJson({ feature: 'quick-resume', system, messages: [{ role: 'user', content }], maxTokensFloor: 4096 });
  if (!json.resume || typeof json.resume !== 'object') throw new AppError(502, 'AI_MALFORMED', 'The AI response did not include a resume. Please retry.');
  const out = normalizeResume(json.resume);
  if (targetRole && !out.targetRole) out.targetRole = targetRole;
  if (!out.personalInfo.fullName && !out.professionalSummary && !out.experience.length && !out.education.length && !out.projects.length) {
    throw new AppError(502, 'AI_MALFORMED', 'The AI could not find resume details in your text. Add a few more details and retry.');
  }
  return {
    resume: out,
    missingInformation: strList(json.missingInformation, 15),
    jobMatch: json.jobMatch && typeof json.jobMatch === 'object'
      ? { matchingSkills: strList(json.jobMatch.matchingSkills, 40), missingOrUnverified: strList(json.jobMatch.missingOrUnverified, 40) } : null,
    usage,
  };
}
const ACTIONS = {
  improve: 'Improve this section: clearer, stronger wording, better structure.',
  professional: 'Rewrite this section in a more professional tone.',
  concise: 'Make this section more concise without losing facts.',
  highlight: 'Reorder/reword to highlight the skills and details most relevant to the target role (only facts already present).',
  bullets: 'Improve the bullet points: action verbs, clarity, concision. Do not add metrics.',
  tailor: 'Tailor wording and ordering to the target job. Do not add skills or facts the user has not stated.',
  grammar: 'Fix grammar, spelling and punctuation only. Keep wording otherwise.',
  explain: 'Do NOT change the content. Explain why this section may need improvement and what specific information the user could add.',
};
const SECTIONS = ['professionalSummary', 'skills', 'experience', 'education', 'projects', 'certifications', 'achievements', 'additionalSections'];

async function improveSection({ section, action, content, targetRole, jobDescription, context }) {
  if (!SECTIONS.includes(section)) throw new AppError(400, 'VALIDATION_ERROR', `"section" must be one of: ${SECTIONS.join(', ')}.`);
  if (!ACTIONS[action]) throw new AppError(400, 'VALIDATION_ERROR', `"action" must be one of: ${Object.keys(ACTIONS).join(', ')}.`);
  const system = `You edit ONE section of a resume.
Task: ${ACTIONS[action]}
Edit ONLY the "${section}" section; keep the exact same JSON structure/field names as the input content. Preserve all facts (names, dates, numbers). Do not add facts, skills, metrics or technologies not in the input or context.

${RULES}

Return JSON: {"content": <the revised section, same structure as the input>, "explanation": "1-2 sentences on what changed or what the user should consider"}`;
  const user = `Target role: ${targetRole || 'not specified'}\n${jobDescription ? `Job description:\n${jobDescription}\n` : ''}${context ? `Minimal context (do not edit): ${compact(context)}\n` : ''}\nSection "${section}" current content:\n${compact(content)}`;
  const { json, usage } = await ai.completeJson({ feature: 'improve-section', system, messages: [{ role: 'user', content: user }], maxTokensFloor: 2048 });
  if (json.content === undefined) throw new AppError(502, 'AI_MALFORMED', 'The AI response did not include revised content. Please retry.');
  const wrapper = { [section]: json.content };
  const normalized = normalizeResume(wrapper);
  let revised = normalized[section];
  if (section === 'professionalSummary' && typeof json.content !== 'string') throw new AppError(502, 'AI_MALFORMED', 'The AI returned an invalid summary. Please retry.');
  if (action === 'explain') revised = null;
  return { section, action, content: revised, explanation: str(json.explanation, 1500), usage };
}

async function analyzeJob({ jobDescription, resume }) {
  const system = `You analyze a job description against a candidate's confirmed resume data.
Extract from the job description: required skills, preferred skills, main responsibilities, experience requirements, education requirements, relevant keywords.
Then compare with the candidate's confirmed resume ONLY: matchingSkills (skills/keywords present in the resume), missingOrUnverified (job requirements NOT evidenced in the resume).
Never treat job requirements as the candidate's skills.

${RULES}

Return JSON: {"requiredSkills":[""],"preferredSkills":[""],"responsibilities":[""],"experienceRequirements":[""],"educationRequirements":[""],"keywords":[""],"matchingSkills":[""],"missingOrUnverified":[""],"summary":"2-3 sentence plain summary"}`;
  const user = `Job description:\n${jobDescription}\n\nCandidate resume data:\n${compact(resume)}`;
  const { json, usage } = await ai.completeJson({ feature: 'analyze-job', system, messages: [{ role: 'user', content: user }], maxTokensFloor: 2048 });
  const keys = ['requiredSkills', 'preferredSkills', 'responsibilities', 'experienceRequirements', 'educationRequirements', 'keywords', 'matchingSkills', 'missingOrUnverified'];
  const out = {};
  for (const k of keys) out[k] = strList(json[k], 40);
  out.summary = str(json.summary, 1500);
  return { analysis: out, usage };
}

async function suggestImprovements({ resume, targetRole }) {
  const system = `You review a resume and recommend improvements for the target role.
Give specific, actionable suggestions. When a suggestion needs facts from the user (metrics, tools, dates), phrase it as a question or request; never supply invented facts.
Do not promise ATS success.

${RULES}

Return JSON: {"suggestions":[{"section":"summary|skills|experience|education|projects|certifications|achievements|general","priority":"high|medium|low","suggestion":""}],"missingInformation":[""]}`;
  const user = `Target role: ${targetRole || resume.targetRole || 'not specified'}\n\nResume:\n${compact(resume)}`;
  const { json, usage } = await ai.completeJson({ feature: 'suggest-improvements', system, messages: [{ role: 'user', content: user }], maxTokensFloor: 2048 });
  return {
    suggestions: arr(json.suggestions).slice(0, 20).map((s) => ({
      section: str(s && s.section, 40) || 'general',
      priority: ['high', 'medium', 'low'].includes(s && s.priority) ? s.priority : 'medium',
      suggestion: str(s && s.suggestion, 800),
    })).filter((s) => s.suggestion),
    missingInformation: strList(json.missingInformation, 15),
    usage,
  };
}

module.exports = { quickResume, interview, generateResume, improveSection, analyzeJob, suggestImprovements, SECTIONS, ACTIONS };
