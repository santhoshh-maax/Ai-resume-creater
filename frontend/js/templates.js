/* Template and section definitions shared by preview, editor and export. */
(function () {
  const TEMPLATES = [
    { id: 'sidebar', name: 'Sidebar Timeline', desc: 'Two columns with a timeline, like the sample resume.', layout: 'sidebar', accent: '#1f3a5f',
      titles: { summary: 'Profile', skills: 'Technical Skills' },
      order: ['summary', 'projects', 'experience', 'education', 'skills', 'certifications', 'achievements'] },
    { id: 'classic', name: 'Classic Professional', desc: 'Traditional, clean serif layout.',
      order: ['summary', 'experience', 'education', 'projects', 'skills', 'certifications', 'achievements'] },
    { id: 'modern', name: 'Modern Minimal', desc: 'Contemporary typography and spacing.',
      order: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements'] },
    { id: 'ats', name: 'ATS-Friendly', desc: 'Single column, plain headings, no decoration.',
      order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'] },
    { id: 'technical', name: 'Technical Resume', desc: 'Leads with skills, projects and certifications.',
      order: ['summary', 'skills', 'projects', 'experience', 'certifications', 'education', 'achievements'] },
  ];

  // Built-in section keys -> default heading and the resume field that backs each.
  const SECTIONS = {
    summary: { title: 'Professional Summary', field: 'professionalSummary' },
    experience: { title: 'Experience', field: 'experience' },
    education: { title: 'Education', field: 'education' },
    projects: { title: 'Projects', field: 'projects' },
    skills: { title: 'Technical Skills', field: 'skills' },
    certifications: { title: 'Certifications', field: 'certifications' },
    achievements: { title: 'Achievements', field: 'achievements' },
  };

  const DEFAULT_ACCENT = '#1d4ed8';
  function accentFor(id) { return get(id).accent || DEFAULT_ACCENT; }
  function get(id) { return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]; }

  /** Default ordered list of section keys for a template (built-ins + extra sections appended). */
  function defaultOrder(id, resume) {
    const order = get(id).order.slice();
    (resume.additionalSections || []).forEach((_, i) => order.push('extra:' + i));
    return order;
  }

  window.Templates = { TEMPLATES, SECTIONS, get, accentFor, defaultOrder };
})();
