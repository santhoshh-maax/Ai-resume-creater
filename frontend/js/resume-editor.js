/* Manual editor + AI-assisted section editing. Edits the shared structured resume in App.state. */
(function () {
  const esc = (s) => Preview.esc(s);
  const open = new Set(['personal']);
  const pending = {}; // sectionKey -> { result, original }

  const BLANK = {
    experience: () => ({ type: 'job', title: '', company: '', location: '', startDate: '', endDate: '', bullets: [''] }),
    education: () => ({ institution: '', degree: '', field: '', location: '', startDate: '', endDate: '', grade: '', details: [] }),
    projects: () => ({ name: '', date: '', link: '', technologies: [], bullets: [''] }),
    skills: () => ({ category: '', items: [] }),
    certifications: () => ({ name: '', issuer: '', date: '', link: '' }),
    achievements: () => '',
  };

  const AI_ACTIONS = [
    ['improve', 'Improve this section'], ['professional', 'Rewrite professionally'], ['concise', 'Make it more concise'],
    ['highlight', 'Highlight relevant skills'], ['bullets', 'Improve these bullet points'], ['tailor', 'Tailor to my target job'],
    ['grammar', 'Fix grammar'], ['explain', 'Explain why it needs improvement'],
  ];

  function getPath(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), App.state);
  }
  function setPath(path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const parent = parts.reduce((o, k) => o[k], App.state);
    parent[last] = value;
  }

  const field = (label, path, opts = {}) => `
    <label class="field ${opts.full ? 'full' : ''}"><span>${esc(label)}</span>
      <input type="text" data-path="${path}" ${opts.csv ? 'data-csv="1"' : ''} value="${esc(opts.csv ? (getPath(path) || []).join(', ') : getPath(path))}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}></label>`;

  function listEditor(label, path) {
    const list = getPath(path) || [];
    return `<div class="blist"><div class="lbl">${esc(label)}</div>
      ${list.map((v, i) => `<div class="brow">
        <textarea rows="1" data-path="${path}.${i}">${esc(v)}</textarea>
        <button class="icon-btn" data-act="up" data-list="${path}" data-i="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="icon-btn" data-act="down" data-list="${path}" data-i="${i}" title="Move down" ${i === list.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="icon-btn" data-act="del" data-list="${path}" data-i="${i}" title="Remove">&#10005;</button></div>`).join('')}
      <button class="btn small" data-act="add" data-list="${path}" data-kind="string">+ Add</button></div>`;
  }

  function entryHead(listPath, i, len, title) {
    return `<div class="entry-head"><span class="t">${esc(title)}</span>
      <button class="icon-btn" data-act="up" data-list="${listPath}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">&uarr;</button>
      <button class="icon-btn" data-act="down" data-list="${listPath}" data-i="${i}" ${i === len - 1 ? 'disabled' : ''} title="Move down">&darr;</button>
      <button class="icon-btn" data-act="del" data-list="${listPath}" data-i="${i}" title="Delete entry">&#10005;</button></div>`;
  }

  const addBtn = (list, label) => `<button class="btn small" data-act="add" data-list="${list}" data-kind="entry">+ ${esc(label)}</button>`;

  const bodies = {
    summary: () => `<label class="field"><span>Summary</span><textarea rows="5" data-path="resume.professionalSummary">${esc(App.state.resume.professionalSummary)}</textarea></label>`,
    experience: () => {
      const L = App.state.resume.experience;
      return L.map((e, i) => { const p = `resume.experience.${i}`; return `<div class="entry">${entryHead('resume.experience', i, L.length, e.title || e.company || 'New experience')}
        <div class="form-grid">
          ${field('Job title', p + '.title')}${field('Company / organization', p + '.company')}
          ${field('Location', p + '.location')}
          <label class="field"><span>Type</span><select data-path="${p}.type">${['job', 'internship', 'volunteer'].map((t) => `<option value="${t}" ${e.type === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
          ${field('Start date', p + '.startDate')}${field('End date', p + '.endDate', { placeholder: 'Present' })}
          <div class="full">${listEditor('Bullet points', p + '.bullets')}</div></div></div>`; }).join('') + addBtn('resume.experience', 'Add experience');
    },
    education: () => {
      const L = App.state.resume.education;
      return L.map((e, i) => { const p = `resume.education.${i}`; return `<div class="entry">${entryHead('resume.education', i, L.length, e.institution || 'New education')}
        <div class="form-grid">
          ${field('Institution', p + '.institution', { full: true })}${field('Degree', p + '.degree')}${field('Field of study', p + '.field')}
          ${field('Location', p + '.location')}${field('Grade / GPA', p + '.grade')}
          ${field('Start date', p + '.startDate')}${field('End date', p + '.endDate')}
          <div class="full">${listEditor('Details (optional)', p + '.details')}</div></div></div>`; }).join('') + addBtn('resume.education', 'Add education');
    },
    projects: () => {
      const L = App.state.resume.projects;
      return L.map((x, i) => { const p = `resume.projects.${i}`; return `<div class="entry">${entryHead('resume.projects', i, L.length, x.name || 'New project')}
        <div class="form-grid">
          ${field('Project name', p + '.name')}${field('Date / duration', p + '.date', { placeholder: '2025 Jan - 2025 Mar' })}${field('Link', p + '.link', { full: true })}
          ${field('Technologies (comma separated)', p + '.technologies', { csv: true, full: true })}
          <div class="full">${listEditor('Bullet points', p + '.bullets')}</div></div></div>`; }).join('') + addBtn('resume.projects', 'Add project');
    },
    skills: () => {
      const L = App.state.resume.skills;
      return L.map((s, i) => { const p = `resume.skills.${i}`; return `<div class="entry">${entryHead('resume.skills', i, L.length, s.category || 'New category')}
        <div class="form-grid">${field('Category', p + '.category', { full: true })}
        ${field('Skills (comma separated)', p + '.items', { csv: true, full: true })}</div></div>`; }).join('') + addBtn('resume.skills', 'Add skill category');
    },
    certifications: () => {
      const L = App.state.resume.certifications;
      return L.map((c, i) => { const p = `resume.certifications.${i}`; return `<div class="entry">${entryHead('resume.certifications', i, L.length, c.name || 'New certification')}
        <div class="form-grid">${field('Name', p + '.name', { full: true })}${field('Issuer', p + '.issuer')}${field('Date', p + '.date')}${field('Link', p + '.link', { full: true })}</div></div>`; }).join('') + addBtn('resume.certifications', 'Add certification');
    },
    achievements: () => listEditor('Achievements', 'resume.achievements'),
  };

  function sectionTitle(key) {
    const s = App.state;
    if (s.headings[key]) return s.headings[key];
    if (key.startsWith('extra:')) { const x = extraById(key); return x ? (x.title || 'Additional section') : 'Section'; }
    return Templates.SECTIONS[key].title;
  }
  const extraById = (key) => App.state.resume.additionalSections.find((e) => 'extra:' + e.id === key);

  function aiBar(key) {
    return `<div class="ai-bar"><span class="small"><b>AI</b></span>
      <select data-aisel="${esc(key)}">${AI_ACTIONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <button class="btn small primary" data-act="ai" data-key="${esc(key)}">Run</button></div>
      <div data-suggest="${esc(key)}">${suggestionHtml(key)}</div>`;
  }

  function sectionBlock(key, idx, total) {
    const s = App.state;
    const hidden = s.hiddenSections.includes(key);
    const isExtra = key.startsWith('extra:');
    let body;
    if (isExtra) {
      const i = s.resume.additionalSections.findIndex((e) => 'extra:' + e.id === key);
      body = i < 0 ? '' : `<div class="form-grid"><div class="full">${listEditor('Items', `resume.additionalSections.${i}.items`)}</div></div>`;
    } else body = bodies[key]();
    const heading = `<label class="field"><span>Section heading (shown on resume)</span>
      <input type="text" data-heading="${esc(key)}" value="${esc(sectionTitle(key))}"></label>`;
    return `<div class="sec ${open.has(key) ? 'open' : ''} ${hidden ? 'hidden-sec' : ''}" data-key="${esc(key)}">
      <div class="sec-head" data-toggle="${esc(key)}">
        <span class="title">${esc(sectionTitle(key))}</span>
        ${hidden ? '<span class="tag">hidden</span>' : ''}
        <button class="icon-btn" data-act="secup" data-key="${esc(key)}" ${idx === 0 ? 'disabled' : ''} title="Move section up">&uarr;</button>
        <button class="icon-btn" data-act="secdown" data-key="${esc(key)}" ${idx === total - 1 ? 'disabled' : ''} title="Move section down">&darr;</button>
        <button class="icon-btn" data-act="sechide" data-key="${esc(key)}" title="${hidden ? 'Show' : 'Hide'} on resume">${hidden ? 'Show' : 'Hide'}</button>
        ${isExtra ? `<button class="icon-btn" data-act="secdel" data-key="${esc(key)}" title="Delete section">&#10005;</button>` : ''}
      </div>
      <div class="sec-body">${heading}${aiBar(key)}${body}</div></div>`;
  }

  function personalBlock() {
    const p = 'resume.personalInfo';
    return `<div class="sec ${open.has('personal') ? 'open' : ''}" data-key="personal">
      <div class="sec-head" data-toggle="personal"><span class="title">Contact information &amp; target role</span></div>
      <div class="sec-body"><div class="form-grid">
        ${field('Full name', p + '.fullName')}${field('Target role / headline', 'resume.targetRole')}
        ${field('Email', p + '.email')}${field('Phone', p + '.phone')}${field('Location', p + '.location')}
        ${field('LinkedIn', p + '.linkedin')}${field('GitHub', p + '.github')}${field('Portfolio', p + '.portfolio')}
      </div></div></div>`;
  }

  function render() {
    const host = document.getElementById('editor');
    if (!host) return;
    const scroller = document.getElementById('tab-edit');
    const top = scroller.scrollTop;
    const s = App.state;
    if (!s.generated && !App.hasContent()) {
      host.innerHTML = '<p class="empty">Nothing to edit yet. Start the interview, or add details manually:</p><button class="btn" id="btnManualStart">Start with a blank resume</button>';
    } else {
      host.innerHTML = personalBlock() + s.sectionOrder.map((k, i) => sectionBlock(k, i, s.sectionOrder.length)).join('');
    }
    scroller.scrollTop = top;
    document.getElementById('btnUndo').disabled = !App.canUndo();
  }

  // ---------- suggestions ----------
  function toText(section, c) {
    if (c == null) return '';
    if (typeof c === 'string') return c;
    const list = (a) => (a || []).map((b) => '• ' + b).join('\n');
    switch (section) {
      case 'skills': return c.map((s) => `${s.category}: ${s.items.join(', ')}`).join('\n');
      case 'experience': return c.map((e) => `${e.title} — ${e.company} (${[e.startDate, e.endDate].filter(Boolean).join(' – ')})\n${list(e.bullets)}`).join('\n\n');
      case 'education': return c.map((e) => `${e.institution} — ${e.degree} ${e.field}\n${list(e.details)}`).join('\n\n');
      case 'projects': return c.map((p) => `${p.name}${p.technologies.length ? ' [' + p.technologies.join(', ') + ']' : ''}\n${list(p.bullets)}`).join('\n\n');
      case 'certifications': return c.map((x) => `${x.name} — ${x.issuer} ${x.date}`).join('\n');
      case 'achievements': return list(c);
      case 'additionalSections': return c.map((x) => `${x.title}\n${list(x.items)}`).join('\n\n');
      default: return JSON.stringify(c, null, 2);
    }
  }

  function suggestionHtml(key) {
    const p = pending[key];
    if (!p) return '';
    if (p.loading) return '<div class="suggest">Asking Claude…</div>';
    if (p.error) return `<div class="notice error">${esc(p.error)} <button class="btn small" data-act="ai" data-key="${esc(key)}">Retry</button></div>`;
    const r = p.result;
    return `<div class="suggest">
      ${r.explanation ? `<p class="small"><b>AI note:</b> ${esc(r.explanation)}</p>` : ''}
      ${r.content === null ? '<p class="small muted">No content changes were proposed for this action.</p><button class="btn small" data-act="reject" data-key="' + esc(key) + '">Dismiss</button>'
        : `<div class="cmp"><div><h4>Current</h4><pre>${esc(p.originalText)}</pre></div><div><h4>AI suggestion</h4><pre>${esc(toText(p.section, r.content))}</pre></div></div>
        <p class="small muted">Review carefully: AI wording is a suggestion, not a verified fact.</p>
        <div class="row gap"><button class="btn small primary" data-act="accept" data-key="${esc(key)}">Accept</button><button class="btn small" data-act="reject" data-key="${esc(key)}">Reject</button></div>`}
    </div>`;
  }

  function refreshSuggest(key) {
    const el = document.querySelector(`[data-suggest="${CSS.escape(key)}"]`);
    if (el) el.innerHTML = suggestionHtml(key);
  }

  function sectionContent(key) {
    const r = App.state.resume;
    if (key === 'summary') return { section: 'professionalSummary', content: r.professionalSummary };
    if (key.startsWith('extra:')) { const x = extraById(key); return { section: 'additionalSections', content: [{ title: x.title, items: x.items }] }; }
    const f = Templates.SECTIONS[key].field;
    return { section: f, content: r[f] };
  }

  async function runAi(key) {
    const sel = document.querySelector(`[data-aisel="${CSS.escape(key)}"]`);
    const action = sel ? sel.value : 'improve';
    const { section, content } = sectionContent(key);
    const isEmpty = Array.isArray(content) ? !content.length : !content;
    if (isEmpty) { App.toast('This section is empty. Add some content first.', true); return; }
    pending[key] = { loading: true };
    refreshSuggest(key);
    const s = App.state;
    const ctx = { name: s.resume.personalInfo.fullName ? 'provided' : 'missing', candidateType: s.mode };
    try {
      const result = await AI.improve({ section, action, content, targetRole: s.resume.targetRole, jobDescription: s.jobDescription, context: ctx });
      pending[key] = { result, section, originalText: toText(section, content) };
    } catch (e) {
      pending[key] = { error: e.message };
    }
    refreshSuggest(key);
  }

  function accept(key) {
    const p = pending[key];
    if (!p || !p.result || p.result.content === null) return;
    App.snapshot();
    const s = App.state;
    const c = p.result.content;
    if (key === 'summary') s.resume.professionalSummary = c;
    else if (key.startsWith('extra:')) {
      const i = s.resume.additionalSections.findIndex((e) => 'extra:' + e.id === key);
      if (i >= 0 && c[0]) s.resume.additionalSections[i] = { ...c[0], id: s.resume.additionalSections[i].id };
    } else s.resume[Templates.SECTIONS[key].field] = c;
    delete pending[key];
    App.changed(); render();
    App.toast('AI suggestion applied. You can keep editing or undo.');
  }

  // ---------- events ----------
  function onInput(e) {
    const t = e.target;
    if (t.dataset.heading) {
      App.beforeEdit();
      const v = t.value;
      if (v.trim()) App.state.headings[t.dataset.heading] = v; else delete App.state.headings[t.dataset.heading];
      const title = t.closest('.sec').querySelector('.sec-head .title');
      if (title) title.textContent = v || sectionTitle(t.dataset.heading);
      App.changed({ keepEditor: true });
      return;
    }
    if (!t.dataset.path) return;
    App.beforeEdit();
    if (t.dataset.csv) setPath(t.dataset.path, t.value.split(',').map((x) => x.trim()).filter(Boolean));
    else setPath(t.dataset.path, t.value);
    App.changed({ keepEditor: true });
  }

  function moveItem(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

  function onClick(e) {
    const manual = e.target.closest('#btnManualStart');
    if (manual) { App.startManual(); return; }
    const tog = e.target.closest('[data-toggle]');
    const btn = e.target.closest('[data-act]');
    if (btn) {
      e.stopPropagation();
      const act = btn.dataset.act;
      const s = App.state;
      if (act === 'ai') { runAi(btn.dataset.key); return; }
      if (act === 'accept') { accept(btn.dataset.key); return; }
      if (act === 'reject') { delete pending[btn.dataset.key]; refreshSuggest(btn.dataset.key); return; }
      App.snapshot();
      if (act === 'add') {
        const list = getPath(btn.dataset.list);
        const name = btn.dataset.list.split('.').pop();
        list.push(btn.dataset.kind === 'string' ? '' : BLANK[name]());
      } else if (act === 'del') {
        getPath(btn.dataset.list).splice(+btn.dataset.i, 1);
      } else if (act === 'up' || act === 'down') {
        moveItem(getPath(btn.dataset.list), +btn.dataset.i, act === 'up' ? -1 : 1);
      } else if (act === 'secup' || act === 'secdown') {
        const i = s.sectionOrder.indexOf(btn.dataset.key);
        moveItem(s.sectionOrder, i, act === 'secup' ? -1 : 1);
        s.orderCustom = true;
      } else if (act === 'sechide') {
        const k = btn.dataset.key; const i = s.hiddenSections.indexOf(k);
        if (i >= 0) s.hiddenSections.splice(i, 1); else s.hiddenSections.push(k);
      } else if (act === 'secdel') {
        const k = btn.dataset.key;
        s.resume.additionalSections = s.resume.additionalSections.filter((x) => 'extra:' + x.id !== k);
        s.sectionOrder = s.sectionOrder.filter((x) => x !== k);
      }
      App.changed(); render();
      return;
    }
    if (tog && !e.target.closest('input,textarea,select')) {
      const k = tog.dataset.toggle;
      if (open.has(k)) open.delete(k); else open.add(k);
      tog.parentElement.classList.toggle('open');
    }
  }

  function addSection() {
    const body = `<label class="field"><span>Section title</span><input type="text" id="newSecTitle" list="secSuggest" placeholder="e.g. Languages, Publications, Volunteer Experience">
      <datalist id="secSuggest"><option>Languages</option><option>Publications</option><option>Volunteer Experience</option><option>Interests</option><option>Awards</option></datalist></label>`;
    App.openModal('Add section', body, [
      { label: 'Cancel', cls: '' },
      { label: 'Add', cls: 'primary', onClick: () => {
        const title = document.getElementById('newSecTitle').value.trim();
        if (!title) return false;
        App.snapshot();
        const id = 'x' + Date.now().toString(36);
        App.state.resume.additionalSections.push({ id, title, items: [''] });
        App.state.sectionOrder.push('extra:' + id);
        open.add('extra:' + id);
        App.changed(); render();
        return true;
      } },
    ]);
  }

  function init() {
    const host = document.getElementById('editor');
    host.addEventListener('input', onInput);
    host.addEventListener('click', onClick);
    document.getElementById('btnAddSection').addEventListener('click', addSection);
  }

  window.Editor = { init, render, openSection: (k) => open.add(k), clearPending: () => Object.keys(pending).forEach((k) => delete pending[k]) };
})();

