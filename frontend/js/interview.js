/* Conversational interview: chat UI + resume generation. */
(function () {
  const esc = (s) => Preview.esc(s);
  let busy = false;
  let lastError = null; // { kind: 'interview'|'generate', message }

  const EXAMPLES = [
    'Create a resume for an entry-level AWS Data Engineer job in Singapore.',
    'I am a final-year computer science student with internship experience and IoT projects.',
    'Make my resume ATS-friendly and highlight my technical skills.',
  ];

  function greeting(mode) {
    const base = mode === 'job'
      ? 'Great, let\'s tailor a resume to a specific job. Paste the job description in the "Job & Tips" tab (or in this chat), and tell me:\n\n1. What role are you targeting?\n2. Are you a fresher, student, experienced professional or career changer?\n3. Do you already have a resume you can paste here, or are we starting from scratch?'
      : 'Hi! I\'ll help you build your resume. Tell me in your own words:\n\n1. What job title or type of role are you targeting?\n2. Are you a fresher, student, experienced professional or career changer?\n3. Do you have an existing resume (you can paste it) or are we starting from scratch?\n4. Is there a particular job description you want to target?\n\nYou can answer all of this in a single message. I will only use facts you give me and will ask when something is missing.';
    return { role: 'assistant', content: base, local: true, examples: true };
  }

  function apiMessages() {
    return App.state.messages.filter((m) => !m.local && (m.role === 'user' || m.role === 'assistant')).map(({ role, content }) => ({ role, content }));
  }

  function render() {
    const s = App.state;
    const log = document.getElementById('chatLog');
    log.innerHTML = s.messages.map((m) => {
      const chips = m.examples && s.messages.filter((x) => x.role === 'user').length === 0
        ? `<div class="chips">${EXAMPLES.map((e) => `<button class="chip" type="button" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : '';
      return `<div class="msg ${m.role}">${esc(m.content)}${chips}</div>`;
    }).join('') + (busy ? `<div class="msg assistant typing">${busy === 'generate' ? 'Generating your resume…' : 'Thinking…'}</div>` : '');
    log.scrollTop = log.scrollHeight;

    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const gen = document.getElementById('btnGenerate');
    const locked = s.generated;
    input.disabled = !!busy || locked;
    send.disabled = !!busy || locked;
    input.placeholder = locked ? 'Resume generated — use "Back to interview" in the Edit tab to add more information.' : 'Type your answer in plain language...';
    gen.disabled = !!busy || !App.hasContent();
    gen.textContent = s.generatedOnce ? 'Regenerate full resume' : 'Generate Resume';
    document.getElementById('readyHint').textContent = s.generated
      ? 'Resume ready — switch to "Edit Resume".'
      : s.readyToGenerate ? 'I have enough to generate your resume. You can still add more.'
      : App.hasContent() ? 'You can generate now, or keep answering for a stronger result.' : 'Answer the questions to get started.';

    document.getElementById('quickBox').hidden = s.generated || s.messages.some((m) => m.role === 'user' && !m.local) && !lastError;
    document.getElementById('btnQuick').disabled = !!busy;

    const n = document.getElementById('chatNotice');
    if (lastError && !busy) {
      n.hidden = false; n.className = 'notice error';
      n.innerHTML = `${esc(lastError.message)} <button class="btn small" id="btnRetry">Retry</button>`;
    } else if (s.missingInformation && s.missingInformation.length && s.generated) {
      n.hidden = false; n.className = 'notice warn';
      n.innerHTML = '<b>Information that could strengthen your resume:</b><ul class="res-list">' + s.missingInformation.map((m) => `<li>${esc(m)}</li>`).join('') + '</ul>';
    } else n.hidden = true;
  }

  function keepIfBlank(oldR, newR) {
    for (const k of Object.keys(oldR.personalInfo)) if (!newR.personalInfo[k] && oldR.personalInfo[k]) newR.personalInfo[k] = oldR.personalInfo[k];
    if (!newR.targetRole && oldR.targetRole) newR.targetRole = oldR.targetRole;
    return newR;
  }

  async function callInterview() {
    const s = App.state;
    busy = 'interview'; lastError = null; render();
    try {
      const res = await AI.interview({ messages: apiMessages(), resume: stripIds(s.resume), jobDescription: s.jobDescription || undefined });
      App.snapshot();
      s.resume = keepIfBlank(s.resume, res.resume);
      s.resume.additionalSections = res.resume.additionalSections || [];
      App.afterResumeReplaced();
      s.messages.push({ role: 'assistant', content: res.reply });
      s.readyToGenerate = res.readyToGenerate;
      s.missingInformation = res.missingInformation;
    } catch (e) {
      lastError = { kind: 'interview', message: e.message };
    }
    busy = false;
    App.changed({ noSnapshot: true });
    render();
  }

  function stripIds(r) { return { ...r, additionalSections: (r.additionalSections || []).map(({ title, items }) => ({ title, items })) }; }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy || App.state.generated) return;
    App.state.messages.push({ role: 'user', content: text });
    document.getElementById('chatInput').value = '';
    App.persist();
    await callInterview();
  }

  async function quick() {
    const s = App.state;
    if (busy) return;
    const text = document.getElementById('quickText').value.trim();
    if (text.length < 30) { App.toast('Please write a little more about yourself (education, projects, skills, contact).', true); return; }
    const role = document.getElementById('quickRole').value.trim();
    busy = 'generate'; lastError = null;
    s.messages.push({ role: 'user', content: text });
    if (role && !s.resume.targetRole) s.resume.targetRole = role;
    render();
    try {
      const res = await AI.quick({ text, targetRole: role || s.resume.targetRole || undefined, jobDescription: s.jobDescription || undefined });
      App.snapshot();
      s.resume = res.resume;
      App.afterResumeReplaced();
      s.generated = true; s.generatedOnce = true;
      s.missingInformation = res.missingInformation;
      s.jobMatch = res.jobMatch;
      s.messages.push({ role: 'system', content: 'Your resume is ready. Check every detail, edit anything, then download the PDF.' });
      busy = false;
      App.changed({ noSnapshot: true });
      App.showTab('edit');
      App.showPane('right');
      if (res.jobMatch) App.showJobMatch(res.jobMatch);
      App.toast('Resume ready! Review it, then click Download PDF.');
    } catch (e) {
      busy = false;
      s.messages.pop(); // let the user retry with the same text
      lastError = { kind: 'quick', message: e.message };
    }
    render();
  }

  async function generate() {
    const s = App.state;
    if (busy) return;
    if (s.generatedOnce) {
      const ok = await App.confirm('Regenerate the whole resume?', 'This rewrites every section from your confirmed facts. Your manual edits may be replaced. You can undo afterwards.');
      if (!ok) return;
    }
    busy = 'generate'; lastError = null; render();
    const conversation = s.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n').slice(0, 20000);
    try {
      const res = await AI.generate({ resume: stripIds(s.resume), conversation, jobDescription: s.jobDescription || undefined });
      App.snapshot();
      s.resume = res.resume;
      App.afterResumeReplaced(true);
      s.generated = true; s.generatedOnce = true;
      s.missingInformation = res.missingInformation;
      s.jobMatch = res.jobMatch;
      s.messages.push({ role: 'system', content: 'Resume generated. Review and edit it in the "Edit Resume" tab. Check every statement for accuracy before sending it to employers.' });
      busy = false;
      App.changed({ noSnapshot: true });
      App.showTab('edit');
      if (res.jobMatch) App.showJobMatch(res.jobMatch);
      App.toast('Resume generated. Please review every section.');
    } catch (e) {
      busy = false;
      lastError = { kind: 'generate', message: e.message };
    }
    render();
  }

  function init() {
    document.getElementById('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send(document.getElementById('chatInput').value); });
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.target.value); }
    });
    document.getElementById('btnGenerate').addEventListener('click', generate);
    document.getElementById('btnQuick').addEventListener('click', quick);
    document.getElementById('tab-interview').addEventListener('click', (e) => {
      const ex = e.target.closest('[data-example]');
      if (ex) { const i = document.getElementById('chatInput'); i.value = ex.dataset.example; i.focus(); }
      if (e.target.closest('#btnRetry') && lastError) {
        const kind = lastError.kind; lastError = null;
        if (kind === 'generate') generate(); else if (kind === 'quick') quick(); else callInterview();
      }
    });
  }

  window.Interview = { init, render, greeting, clearError: () => { lastError = null; } };
})();

