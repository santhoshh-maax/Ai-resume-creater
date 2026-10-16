/* Renders the structured resume into HTML (used for the live preview AND the PDF export). */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function safeUrl(u, kind) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(javascript|data|vbscript):/i.test(u)) return '';
    if (kind === 'email') return 'mailto:' + u;
    if (kind === 'phone') return 'tel:' + u.replace(/[^\d+]/g, '');
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w-]+:/.test(u) && !/^[\w.-]+\.[a-z]{2,}(:\d+)?\//i.test(u)) return ''; // unknown scheme
    return 'https://' + u.replace(/^\/+/, '');
  }
  const display = (u) => String(u).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const link = (text, href) => (href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text));
  const dates = (a, b) => [a, b].filter(Boolean).join(' – ');
  const bullets = (list) => (list && list.length ? `<ul class="r-bullets">${list.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '');

  const renderers = {
    summary: (r) => (r.professionalSummary ? `<p class="r-text">${esc(r.professionalSummary)}</p>` : ''),
    experience: (r) => r.experience.map((e) => `
      <div class="r-entry">
        <div class="r-line"><span class="l">${esc(e.title)}${e.type && e.type !== 'job' ? ` (${esc(e.type[0].toUpperCase() + e.type.slice(1))})` : ''}</span><span class="d">${esc(dates(e.startDate, e.endDate))}</span></div>
        ${e.company || e.location ? `<div class="r-sub">${esc([e.company, e.location].filter(Boolean).join(', '))}</div>` : ''}
        ${bullets(e.bullets)}
      </div>`).join(''),
    education: (r) => r.education.map((e) => `
      <div class="r-entry">
        <div class="r-line"><span class="l">${esc(e.institution)}</span><span class="d">${esc(dates(e.startDate, e.endDate))}</span></div>
        ${e.degree || e.field || e.grade || e.location ? `<div class="r-sub">${esc([[e.degree, e.field].filter(Boolean).join(' in '), e.grade, e.location].filter(Boolean).join(' | '))}</div>` : ''}
        ${bullets(e.details)}
      </div>`).join(''),
    projects: (r) => r.projects.map((p) => {
      const href = safeUrl(p.link);
      return `
      <div class="r-entry">
        <div class="r-line"><span class="l">${esc(p.name)}</span>${p.date ? `<span class="d">${esc(p.date)}</span>` : ''}</div>
        ${p.link ? `<div class="r-tech">${link(display(p.link), href)}</div>` : ''}
        ${p.technologies.length ? `<div class="r-tech">Technologies: ${esc(p.technologies.join(', '))}</div>` : ''}
        ${bullets(p.bullets)}
      </div>`;
    }).join(''),
    skills: (r) => r.skills.map((s) => `<div class="r-skill"><b>${esc(s.category)}${s.category ? ':' : ''}</b> <span class="r-tech-inline">${esc(s.items.join(', '))}</span></div>`).join(''),
    certifications: (r) => r.certifications.map((c) => `
      <div class="r-entry"><div class="r-line"><span><span class="l">${c.link ? link(c.name, safeUrl(c.link)) : esc(c.name)}</span>${c.issuer ? ` — ${esc(c.issuer)}` : ''}</span><span class="d">${esc(c.date)}</span></div></div>`).join(''),
    achievements: (r) => bullets(r.achievements),
  };

  function hasContent(key, r, extra) {
    if (key.startsWith('extra:')) return !!(extra && extra.items.length);
    const f = Templates.SECTIONS[key].field;
    const v = r[f];
    return Array.isArray(v) ? v.length > 0 : !!v;
  }

  const ICONS = {
    summary: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3 0-8 1.5-8 4.5V20h16v-1.5c0-3-5-4.5-8-4.5z"/>',
    work: '<path d="M10 4h4a2 2 0 0 1 2 2v1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4V6a2 2 0 0 1 2-2zm0 2v1h4V6h-4z"/>',
    education: '<path d="M12 4 1 9l11 5 9-4.1V15h2V9L12 4zm-6 9.2V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.8l-6 2.8-6-2.8z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    phone: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.5.55 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.55 3.5a1 1 0 0 1-.25 1z"/>',
    mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7 8-5H4l8 5zm0 2L4 9v9h16V9l-8 5z"/>',
    pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.500a2.5 2.5 0 0 1 0 5z"/>',
    linkedin: '<path d="M4 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2.5 9h3v12h-3zM9 9h2.900v1.700c.5-.9 1.700-2 3.600-2 3.700 0 4.500 2.400 4.500 5.600V21h-3v-5.900c0-1.500 0-3.200-2-3.200s-2.100 1.500-2.100 3.100V21H9z"/>',
    github: '<path d="M12 2a10 10 0 0 0-3.200 19.500c.5.1.7-.2.7-.5v-1.800c-2.800.6-3.400-1.200-3.400-1.200-.5-1.200-1.100-1.500-1.100-1.500-.9-.6.100-.6.100-.6 1 .1 1.500 1 1.500 1 .9 1.500 2.400 1.100 3 .8.1-.7.4-1.100.6-1.400-2.200-.3-4.600-1.100-4.600-5 0-1.100.4-2 1-2.700-.1-.3-.4-1.300.1-2.700 0 0 .8-.3 2.800 1a9.600 9.600 0 0 1 5 0c2-1.300 2.800-1 2.800-1 .5 1.400.2 2.400.1 2.700.6.700 1 1.600 1 2.700 0 3.900-2.300 4.700-4.600 5 .4.300.7.900.7 1.800v2.700c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/>',
    globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.900 9h-3a15 15 0 0 0-1.200-5.200A8 8 0 0 1 18.900 11zM12 4c.8 1 1.600 3 1.900 7h-3.800C10.400 7 11.200 5 12 4zM4.600 13h3a15 15 0 0 0 1.200 5.200A8 8 0 0 1 4.600 13zm3-2h-3a8 8 0 0 1 4.200-5.200A15 15 0 0 0 7.600 11zM12 20c-.8-1-1.600-3-1.900-7h3.800c-.3 4-1.100 6-1.900 7zm2.200-1.800A15 15 0 0 0 15.400 13h3a8 8 0 0 1-4.200 5.200z"/>',
  };
  const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const SIDEBAR_LEFT = ['skills', 'certifications'];
  const SECTION_ICON = { summary: 'summary', projects: 'work', experience: 'work', education: 'education', achievements: 'star' };

  function contactItems(p, withIcons) {
    const items = [];
    const add = (ic, html) => items.push(withIcons ? `<span>${icon(ic)}${html}</span>` : `<span>${html}</span>`);
    if (p.phone) add('phone', link(p.phone, safeUrl(p.phone, 'phone')));
    if (p.email) add('mail', link(p.email, safeUrl(p.email, 'email')));
    if (p.location) add('pin', esc(p.location));
    if (p.linkedin) add('linkedin', link(display(p.linkedin), safeUrl(p.linkedin)));
    if (p.github) add('github', link(display(p.github), safeUrl(p.github)));
    if (p.portfolio) add('globe', link(display(p.portfolio), safeUrl(p.portfolio)));
    return items;
  }
  const contactHtml = (p) => contactItems(p, false).join('');

  function sectionInfo(state, key) {
    const r = state.resume;
    let extra = null;
    if (key.startsWith('extra:')) {
      extra = (r.additionalSections || []).find((s) => 'extra:' + s.id === key);
      if (!extra) return null;
    } else if (!Templates.SECTIONS[key]) return null;
    if ((state.hiddenSections || []).includes(key)) return null;
    if (!hasContent(key, r, extra)) return null;
    const tpl = Templates.get(state.template);
    const title = (state.headings && state.headings[key]) || (extra ? extra.title : (tpl.titles && tpl.titles[key]) || Templates.SECTIONS[key].title);
    return { key, extra, title };
  }

  function sectionHtml(state, info, withIcon) {
    const body = info.extra ? bullets(info.extra.items) : renderers[info.key](state.resume);
    const ic = withIcon ? `<span class="r-ico">${icon(SECTION_ICON[info.key] || 'star')}</span>` : '';
    return `<section class="r-sec" data-sec="${esc(info.key)}"><h2 class="r-title">${ic}${esc(info.title)}</h2><div class="r-body">${body}</div></section>`;
  }

  // Left column of the sidebar layout: contact, soft skills, technical skills, certifications, languages/interests.
  function sidebarLeft(state) {
    const r = state.resume;
    const out = [];
    const p = r.personalInfo;
    const contact = contactItems(p, true);
    if (contact.length) out.push(`<section class="r-sec"><h2 class="r-title">Contact</h2><div class="r-contact-list">${contact.join('')}</div></section>`);
    const skillInfo = sectionInfo(state, 'skills');
    if (skillInfo) {
      const soft = r.skills.filter((s) => /soft/i.test(s.category));
      const tech = r.skills.filter((s) => !/soft/i.test(s.category));
      if (soft.length) out.push(`<section class="r-sec"><h2 class="r-title">Soft Skills</h2>${bullets(soft.flatMap((s) => s.items))}</section>`);
      if (tech.length) out.push(`<section class="r-sec"><h2 class="r-title">${esc(skillInfo.title)}</h2><div class="r-body">${renderers.skills({ skills: tech })}</div></section>`);
    }
    const cert = sectionInfo(state, 'certifications');
    if (cert) out.push(sectionHtml(state, cert, false));
    const mainExtras = [];
    (state.sectionOrder || []).forEach((k) => {
      if (!k.startsWith('extra:')) return;
      const info = sectionInfo(state, k);
      if (!info) return;
      if (/language|interest|hobb/i.test(info.title)) out.push(sectionHtml(state, info, false)); else mainExtras.push(k);
    });
    return { html: out.join(''), mainExtras };
  }

  function buildHtml(state) {
    const r = state.resume;
    const p = r.personalInfo;
    const tpl = Templates.get(state.template);
    const accent = /^#[0-9a-f]{6}$/i.test(state.accent || '') ? state.accent : Templates.accentFor(state.template);
    const cls = `resume tpl-${esc(state.template)} fs-${esc(state.fontSize || 'medium')}`;
    const wrap = (inner) => `<div class="${cls}" style="--accent:${accent}">${inner}</div>`;
    const empty = !p.fullName && !r.targetRole && !App.hasContent();

    if (tpl.layout === 'sidebar') {
      if (empty) return wrap('<p class="r-empty-note">Your resume will appear here as you answer the interview questions.</p>');
      const left = sidebarLeft(state);
      const mainKeys = state.sectionOrder.filter((k) => !SIDEBAR_LEFT.includes(k) && (!k.startsWith('extra:') || left.mainExtras.includes(k)));
      const main = mainKeys.map((k) => sectionInfo(state, k)).filter(Boolean).map((i) => sectionHtml(state, i, true)).join('');
      return wrap(`<header class="r-head">${p.fullName ? `<h1 class="r-name">${esc(p.fullName)}</h1>` : ''}${r.targetRole ? `<div class="r-role">${esc(r.targetRole)}</div>` : ''}</header>
        <div class="r-cols"><aside class="r-side">${left.html}</aside><div class="r-main">${main}</div></div>`);
    }

    const secs = state.sectionOrder.map((k) => sectionInfo(state, k)).filter(Boolean).map((i) => sectionHtml(state, i, false)).join('');
    const head = `<header class="r-head">
      ${p.fullName ? `<h1 class="r-name">${esc(p.fullName)}</h1>` : ''}
      ${r.targetRole ? `<div class="r-role">${esc(r.targetRole)}</div>` : ''}
      <div class="r-contact">${contactHtml(p)}</div></header>`;
    return wrap(empty && !secs ? '<p class="r-empty-note">Your resume will appear here as you answer the interview questions.</p>' : head + secs);
  }
  function render(state, host) {
    (host || document.getElementById('previewHost')).innerHTML = buildHtml(state);
  }

  window.Preview = { buildHtml, render, esc, safeUrl };
})();
