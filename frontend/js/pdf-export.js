/* PDF export: the server renders the exact preview markup + CSS in headless Chrome/Edge -> text-based PDF. */
(function () {
  let lastFailed = false;

  function fileName(state) {
    const name = (state.resume.personalInfo.fullName || '').trim();
    const parts = name.split(/\s+/).filter(Boolean).map((p) => p.replace(/[^\p{L}\p{N}]+/gu, ''));
    const base = parts.length ? parts.join('_') : 'My';
    return `${base}_Resume.pdf`;
  }

  async function download(btn) {
    const state = App.state;
    if (!App.hasContent()) { App.toast('Add some resume content before downloading.', true); return; }
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing PDF…'; }
    try {
      const html = Preview.buildHtml(state);
      const blob = await AI.blob('/api/resume/pdf', { html, template: state.template, filename: fileName(state) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName(state);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      lastFailed = false;
      App.toast('Download started: ' + fileName(state));
    } catch (e) {
      lastFailed = true;
      App.toast('PDF failed: ' + e.message + ' Click Download PDF to retry.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function fullPreview() {
    const html = Preview.buildHtml(App.state);
    App.openModal('Final preview (A4)', `<div class="full-preview">${html}</div><p class="small muted">Dashed guides approximate page breaks; the PDF is paginated automatically and keeps text selectable.</p>`, [
      { label: 'Close', cls: '' },
      { label: 'Download PDF', cls: 'primary', onClick: () => { download(null); return true; } },
    ], true);
  }

  window.PdfExport = { download, fullPreview, fileName };
})();
