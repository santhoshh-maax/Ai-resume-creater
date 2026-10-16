/* App shell: state, drafts (localStorage), undo, routing, dashboard and workspace wiring. */
(function () {
  const esc = (s) => Preview.esc(s);
  const $ = (id) => document.getElementById(id);
  const DRAFTS_KEY = 'arc.drafts.v1';
  const CURRENT_KEY = 'arc.current.v1';

  const blankResume = () => ({
    personalInfo: { fullName: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '' },
    targetRole: '', professionalSummary: '', skills: [], experience: [], education: [], projects: [],
    certifications: [], achievements: [], additionalSections: [],
  });

  function newState(mode) {
    const s = {
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(), updatedAt: Date.now(),
      mode: mode || 'scratch', template: 'sidebar', fontSize: 'medium', accent: Templates.accentFor('sidebar'),
      resume: blankResume(), sectionOrder: [], hiddenSections: [], headings: {}, orderCustom: false,
      messages: [Interview.greeting(mode)], jobDescription: '',
      generated: false, generatedOnce: false, readyToGenerate: false, missingInformation: [], jobMatch: null,
    };
    s.sectionOrder = Templates.defaultOrder(s.template, s.resume);
    return s;
  }

  const App = {
    state: null,
    undoStack: [],
    lastEdit: 0,
    saveTimer: null,
    renderTimer: null,
  };

  // ---------- helpers ----------
  App.hasContent = function () {
    const r = App.state.resume, p = r.personalInfo;
    return !!(p.fullName || p.email || p.phone || r.targetRole || r.professionalSummary || r.skills.length || r.experience.length ||
      r.education.length || r.projects.length || r.certifications.length || r.achievements.length || r.additionalSections.length);
  };

  function ensureIds(r) {
    r.additionalSections.forEach((s, i) => { if (!s.id) s.id = 'x' + Date.now().toString(36) + i; });
  }

  function reconcileOrder() {
    const s = App.state;
    const valid = new Set(Templates.defaultOrder(s.template, s.resume).filter((k) => !k.startsWith('extra:')));
    s.resume.additionalSections.forEach((x) => valid.add('extra:' + x.id));
    s.sectionOrder = s.sectionOrder.filter((k) => valid.has(k));
    valid.forEach((k) => { if (!s.sectionOrder.includes(k)) s.sectionOrder.push(k); });
  }

  App.afterResumeReplaced = function () {
    ensureIds(App.state.resume);
    if (!App.state.orderCustom) {
      const base = Templates.get(App.state.template).order.slice();
      App.state.resume.additionalSections.forEach((x) => base.push('extra:' + x.id));
      App.state.sectionOrder = base;
    } else reconcileOrder();
  };

  // ---------- undo ----------
  const snap = () => JSON.stringify({ r: App.state.resume, o: App.state.sectionOrder, h: App.state.hiddenSections, hd: App.state.headings, c: App.state.orderCustom });
  App.snapshot = function () {
    App.undoStack.push(snap());
    if (App.undoStack.length > 60) App.undoStack.shift();
    $('btnUndo').disabled = false;
  };
  App.beforeEdit = function () {
    const now = Date.now();
    if (now - App.lastEdit > 1500) App.snapshot();
    App.lastEdit = now;
  };
  App.canUndo = () => App.undoStack.length > 0;
  function undo() {
    const last = App.undoStack.pop();
    if (!last) return;
    const d = JSON.parse(last);
    Object.assign(App.state, { resume: d.r, sectionOrder: d.o, hiddenSections: d.h, headings: d.hd, orderCustom: d.c });
    Editor.clearPending();
    App.changed({ noSnapshot: true });
    Editor.render();
    Interview.render();
    $('btnUndo').disabled = !App.canUndo();
  }

  // ---------- change / persistence ----------
  App.changed = function () {
    App.state.updatedAt = Date.now();
    cancelAnimationFrame(App.renderTimer);
    App.renderTimer = requestAnimationFrame(renderPreview);
    $('btnUndo').disabled = !App.canUndo();
    App.persist();
  };

  function renderPreview() {
    const s = App.state;
    Preview.render(s);
    fitPreview();
    const badge = $('previewBadge');
    if (!s.generated && App.hasContent()) {
      badge.hidden = false;
      badge.textContent = 'Draft built from your interview answers so far. Click "Generate Resume" for the AI-written version.';
    } else badge.hidden = true;
  }

  function fitPreview() {
    const scroll = document.querySelector('.preview-scroll');
    const host = document.getElementById('previewHost');
    const avail = scroll.clientWidth - 36;
    const natural = 793.7; // 210mm in CSS px
    host.style.zoom = avail > 0 && avail < natural ? Math.max(0.35, avail / natural).toFixed(3) : 1;
  }
  window.addEventListener('resize', () => { if (document.getElementById('previewHost')) fitPreview(); });

  function setSave(text, cls) { const e = $('saveStatus'); e.textContent = text; e.className = 'save-status ' + (cls || ''); }

  App.persist = function () {
    setSave('Saving…');
    clearTimeout(App.saveTimer);
    App.saveTimer = setTimeout(() => {
      try {
        const drafts = loadDrafts();
        if (!App.hasContent() && App.state.messages.filter((m) => m.role === 'user').length === 0) { setSave('Not saved yet'); return; }
        drafts[App.state.id] = App.state;
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
        localStorage.setItem(CURRENT_KEY, App.state.id);
        setSave('Saved locally ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
      } catch (e) {
        setSave('Unable to save (browser storage unavailable or full)', 'err');
      }
    }, 600);
  };

  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {}; } catch { return {}; }
  }
  function saveDrafts(d) { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); return true; } catch { return false; } }

  function hydrate(saved) {
    const base = newState(saved.mode);
    const s = Object.assign(base, saved);
    s.resume = Object.assign(blankResume(), saved.resume || {});
    s.resume.personalInfo = Object.assign(blankResume().personalInfo, (saved.resume || {}).personalInfo);
    ['skills', 'experience', 'education', 'projects', 'certifications', 'achievements', 'additionalSections'].forEach((k) => { if (!Array.isArray(s.resume[k])) s.resume[k] = []; });
    if (!Templates.TEMPLATES.some((t) => t.id === s.template)) s.template = 'sidebar';
    s.hiddenSections = s.hiddenSections || []; s.headings = s.headings || {};
    return s;
  }

  // ---------- UI: toast / modal ----------
  App.toast = function (msg, isError) {
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), isError ? 7000 : 3500);
  };

  let modalButtons = [];
  App.openModal = function (title, bodyHtml, buttons, wide) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    modalButtons = buttons || [];
    const foot = $('modalFoot');
    foot.innerHTML = '';
    modalButtons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.onclick = () => { const r = b.onClick ? b.onClick() : true; if (r !== false) closeModal(b); };
      foot.appendChild(btn);
    });
    document.querySelector('.modal-box').classList.toggle('wide', !!wide);
    $('modal').hidden = false;
    const first = $('modalBody').querySelector('input,textarea,select');
    if (first) first.focus();
  };
  let modalResolve = null;
  function closeModal() { $('modal').hidden = true; if (modalResolve) { modalResolve(false); modalResolve = null; } }
  App.confirm = function (title, text) {
    return new Promise((resolve) => {
      App.openModal(title, `<p>${esc(text)}</p>`, [
        { label: 'Cancel', cls: '', onClick: () => { resolve(false); return true; } },
        { label: 'Continue', cls: 'primary', onClick: () => { resolve(true); return true; } },
      ]);
      modalResolve = resolve;
    });
  };

  // ---------- workspace ----------
  App.showTab = function (name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (name === 'edit') Editor.render();
    if (name === 'interview') Interview.render();
    if (name === 'job') fillJobTab();
  };

  App.showPane = function (pane) {
    document.querySelectorAll('#mobileSwitch button').forEach((x) => x.classList.toggle('active', x.dataset.pane === pane));
    $('workspace').dataset.pane = pane;
  };

  App.startManual = function () {
    App.state.generated = true;
    App.afterResumeReplaced();
    Editor.openSection('personal');
    App.changed();
    Editor.render(); Interview.render();
  };

  function fillJobTab() {
    $('targetRole').value = App.state.resume.targetRole || '';
    $('jobDescription').value = App.state.jobDescription || '';
  }

  function list(items, cls) {
    return items && items.length ? `<div class="tagrow ${cls || ''}">${items.map((i) => `<span>${esc(i)}</span>`).join('')}</div>` : '<p class="empty">None identified.</p>';
  }
  const ul = (items) => (items && items.length ? `<ul class="res-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="empty">None identified.</p>');

  App.showJobMatch = function (jm) {
    $('jobResult').innerHTML = `<div class="card"><h3>Job match (based on your confirmed facts)</h3>
      <b class="small">Matching skills</b>${list(jm.matchingSkills, 'good')}
      <b class="small">Missing or unverified requirements</b>${list(jm.missingOrUnverified, 'bad')}
      <p class="small muted">Your qualifications were not changed to match the job description. Add skills only if you truly have them.</p></div>`;
  };

  function busyBtn(btn, text, fn) {
    return async () => {
      const label = btn.textContent; btn.disabled = true; btn.textContent = text;
      try { await fn(); } finally { btn.disabled = false; btn.textContent = label; }
    };
  }

  function resumeForAi() {
    const r = JSON.parse(JSON.stringify(App.state.resume));
    r.additionalSections = r.additionalSections.map(({ title, items }) => ({ title, items }));
    return r;
  }

  function initJobTab() {
    $('targetRole').addEventListener('input', (e) => { App.beforeEdit(); App.state.resume.targetRole = e.target.value; App.changed(); });
    $('jobDescription').addEventListener('input', (e) => { App.state.jobDescription = e.target.value; App.persist(); });
    const ab = $('btnAnalyze');
    ab.addEventListener('click', busyBtn(ab, 'Analyzing…', async () => {
      const jd = App.state.jobDescription.trim();
      if (!jd) { App.toast('Paste a job description first.', true); return; }
      $('jobResult').innerHTML = '';
      try {
        const { analysis: a } = await AI.analyzeJob({ jobDescription: jd, resume: resumeForAi() });
        $('jobResult').innerHTML = `<div class="card"><h3>Job description analysis</h3>
          ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
          <b class="small">Matching skills in your resume</b>${list(a.matchingSkills, 'good')}
          <b class="small">Missing or unverified requirements</b>${list(a.missingOrUnverified, 'bad')}
          <b class="small">Required skills</b>${list(a.requiredSkills)}
          <b class="small">Preferred skills</b>${list(a.preferredSkills)}
          <b class="small">Main responsibilities</b>${ul(a.responsibilities)}
          <b class="small">Experience requirements</b>${ul(a.experienceRequirements)}
          <b class="small">Education requirements</b>${ul(a.educationRequirements)}
          <b class="small">Keywords</b>${list(a.keywords)}
          <p class="small muted">Only add a keyword to your resume if it truthfully describes you.</p></div>`;
      } catch (e) { $('jobResult').innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
    }));
    const sb = $('btnSuggest');
    sb.addEventListener('click', busyBtn(sb, 'Reviewing…', async () => {
      if (!App.hasContent()) { App.toast('Add some resume content first.', true); return; }
      $('jobResult').innerHTML = '';
      try {
        const r = await AI.suggest({ resume: resumeForAi(), targetRole: App.state.resume.targetRole });
        $('jobResult').innerHTML = `<div class="card"><h3>Suggested improvements</h3>
          ${r.suggestions.length ? `<ul class="res-list">${r.suggestions.map((s) => `<li><b>${esc(s.section)}</b> (${esc(s.priority)}): ${esc(s.suggestion)}</li>`).join('')}</ul>` : '<p class="empty">No suggestions returned.</p>'}
          ${r.missingInformation.length ? `<b class="small">Information you could add</b>${ul(r.missingInformation)}` : ''}</div>`;
      } catch (e) { $('jobResult').innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
    }));
  }

  function fillTemplateControls() {
    const sel = $('templateSelect');
    sel.innerHTML = Templates.TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    sel.value = App.state.template;
    $('fontSize').value = App.state.fontSize;
    $('accentColor').value = App.state.accent;
  }

  function setTemplate(id) {
    const s = App.state;
    if (s.accent === Templates.accentFor(s.template)) { s.accent = Templates.accentFor(id); $('accentColor').value = s.accent; }
    s.template = id;
    if (!s.orderCustom) App.afterResumeReplaced(); else reconcileOrder();
    $('templateSelect').value = id;
    App.changed();
    if (!$('tab-edit').hidden) Editor.render();
  }

  function renderAllWorkspace() {
    fillTemplateControls();
    fillJobTab();
    $('jobResult').innerHTML = '';
    Interview.clearError();
    Editor.clearPending();
    Interview.render();
    Editor.render();
    renderPreview();
    $('btnUndo').disabled = !App.canUndo();
    App.showTab(App.pendingTab || (App.state.generated ? 'edit' : 'interview'));
    App.pendingTab = null;
    setSave(loadDrafts()[App.state.id] ? 'Saved locally' : 'Not saved yet', loadDrafts()[App.state.id] ? 'ok' : '');
    if (App.state.generated && App.state.jobMatch) App.showJobMatch(App.state.jobMatch);
  }

  // ---------- dashboard / drafts ----------
  function draftTitle(d) {
    const p = d.resume.personalInfo;
    return [p.fullName, d.resume.targetRole].filter(Boolean).join(' – ') || 'Untitled draft';
  }
  function draftListHtml(limit) {
    const all = Object.values(loadDrafts()).sort((a, b) => b.updatedAt - a.updatedAt);
    const items = limit ? all.slice(0, limit) : all;
    if (!items.length) return '<p class="empty">No saved drafts yet. Drafts you create will appear here (stored only in this browser).</p>';
    return items.map((d) => `<div class="draft-item"><div class="info"><div class="name">${esc(draftTitle(d))}</div>
      <div class="small muted">Edited ${esc(new Date(d.updatedAt).toLocaleString())} · ${esc((Templates.get(d.template)).name)}</div></div>
      <button class="btn small" data-open="${esc(d.id)}">Open</button>
      <button class="btn small danger" data-del="${esc(d.id)}">Delete</button></div>`).join('');
  }
  function renderDashboard() {
    $('dashDrafts').innerHTML = draftListHtml(4);
    $('dashTemplates').innerHTML = Templates.TEMPLATES.map((t) => `
      <button class="card tpl-card ${App.state && App.state.template === t.id ? 'selected' : ''}" data-tpl="${t.id}">
        <div class="tpl-thumb ${t.id}">${t.id === 'technical' ? '<div class="col side"><i class="h"></i><i></i><i></i></div><div class="col"><i class="h"></i><i></i><i></i><i></i></div>' : '<i class="h"></i><i></i><i></i><i class="h"></i><i></i><i></i>'}</div>
        <h4>${esc(t.name)}</h4><p>${esc(t.desc)}</p></button>`).join('');
  }
  function renderDrafts() { $('draftsList').innerHTML = draftListHtml(0); }

  function openDraft(id) {
    const saved = loadDrafts()[id];
    if (!saved) return;
    App.state = hydrate(saved);
    ensureIds(App.state.resume); reconcileOrder();
    App.undoStack = [];
    localStorage.setItem(CURRENT_KEY, id);
    location.hash = '#/create';
    if (currentView === 'create') renderAllWorkspace();
  }

  function deleteDraft(id) {
    App.confirm('Delete this draft?', 'It will be removed from this browser permanently.').then((ok) => {
      if (!ok) return;
      const d = loadDrafts(); delete d[id]; saveDrafts(d);
      if (App.state && App.state.id === id) { App.state = newState('scratch'); App.undoStack = []; }
      renderDashboard(); renderDrafts();
    });
  }

  function startNew(mode) {
    App.state = newState(mode);
    App.undoStack = [];
    location.hash = '#/create';
    App.pendingTab = mode === 'job' ? 'job' : null;
    if (currentView === 'create') renderAllWorkspace();
  }

  // ---------- routing ----------
  let currentView = null;
  const VIEWS = ['dashboard', 'create', 'drafts', 'usage', 'settings'];

  function route() {
    const name = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
    const view = VIEWS.includes(name) ? name : 'dashboard';
    VIEWS.forEach((v) => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
    $('mainNav').classList.remove('open');
    currentView = view;
    if (view === 'dashboard') renderDashboard();
    if (view === 'drafts') renderDrafts();
    if (view === 'create') {
      if (!App.state) App.state = newState('scratch');
      renderAllWorkspace();
    }
    if (view === 'usage') UsageDashboard.load();
    if (view === 'settings') loadSettings();
    window.scrollTo(0, 0);
  }

  async function loadSettings() {
    const host = $('configStatus');
    try {
      const c = await AI.configStatus();
      host.innerHTML = `<p>Provider: <b>${esc(c.provider)}</b> · Model: <b>${esc(c.model)}</b></p>
        <p>API key: ${c.configured ? '<b style="color:#15803d">configured</b> (value hidden)' : '<b style="color:#b91c1c">not configured</b>. Set <code>AI_API_KEY</code> in <code>backend/.env</code> and restart the server.'}</p>
        <p class="small">Timeout ${c.timeoutMs} ms · Max tokens (base) ${c.maxTokens}</p>`;
    } catch (e) { host.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  }

  async function checkConfig() {
    const b = $('aiBanner');
    try {
      const c = await AI.configStatus();
      if (!c.configured) {
        b.hidden = false;
        b.textContent = 'AI is not configured: set AI_API_KEY in backend/.env and restart the server. Resume generation and AI editing are unavailable until then (manual editing, preview and PDF still work).';
      } else b.hidden = true;
    } catch (e) {
      b.hidden = false;
      b.textContent = 'Cannot reach the backend server. Start it with "npm start" in the backend folder.';
    }
  }

  // ---------- init ----------
  function init() {
    Editor.init(); Interview.init(); UsageDashboard.init(); initJobTab();

    // restore current draft
    const cur = localStorage.getItem(CURRENT_KEY);
    const saved = cur && loadDrafts()[cur];
    App.state = saved ? hydrate(saved) : newState('scratch');
    ensureIds(App.state.resume); reconcileOrder();

    $('btnNew').addEventListener('click', () => { $('mainNav').classList.remove('open'); $('navToggle').setAttribute('aria-expanded', 'false'); startNew('scratch'); });
    $('navToggle').addEventListener('click', () => { const o = $('mainNav').classList.toggle('open'); $('navToggle').setAttribute('aria-expanded', o); });
    document.querySelectorAll('#mainNav a').forEach((a) => {
      a.addEventListener('click', () => {
        $('mainNav').classList.remove('open');
        $('navToggle').setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', (e) => {
      const st = e.target.closest('[data-start]');
      if (st) { startNew(st.dataset.start); return; }
      const op = e.target.closest('[data-open]'); if (op) { openDraft(op.dataset.open); return; }
      const dl = e.target.closest('[data-del]'); if (dl) { deleteDraft(dl.dataset.del); return; }
      const tp = e.target.closest('[data-tpl]');
      if (tp) { App.state.template = tp.dataset.tpl; App.afterResumeReplaced(); App.persist(); renderDashboard(); App.toast('Template selected: ' + Templates.get(tp.dataset.tpl).name); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('option')) { e.preventDefault(); startNew(e.target.dataset.start); }
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
    });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => App.showTab(t.dataset.tab)));
    document.querySelectorAll('#mobileSwitch button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#mobileSwitch button').forEach((x) => x.classList.toggle('active', x === b));
      $('workspace').dataset.pane = b.dataset.pane;
    }));

    $('templateSelect').addEventListener('change', (e) => setTemplate(e.target.value));
    $('fontSize').addEventListener('change', (e) => { App.state.fontSize = e.target.value; App.changed(); });
    $('accentColor').addEventListener('input', (e) => { App.state.accent = e.target.value; App.changed(); });
    $('btnUndo').addEventListener('click', undo);
    $('btnBackInterview').addEventListener('click', () => { App.state.generated = false; App.persist(); Interview.render(); App.showTab('interview'); });
    $('btnPdf').addEventListener('click', (e) => PdfExport.download(e.currentTarget));
    $('btnFullPreview').addEventListener('click', PdfExport.fullPreview);

    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
    $('btnClearDrafts').addEventListener('click', async () => {
      if (!(await App.confirm('Clear all saved drafts?', 'This permanently deletes every resume draft stored in this browser.'))) return;
      localStorage.removeItem(DRAFTS_KEY); localStorage.removeItem(CURRENT_KEY);
      App.state = newState('scratch'); App.undoStack = [];
      App.toast('All local drafts cleared.');
    });

    window.addEventListener('hashchange', route);
    checkConfig();
    route();
  }

  // closeModal wrapper used by openModal buttons
  window.App = App;
  document.addEventListener('DOMContentLoaded', init);
})();

