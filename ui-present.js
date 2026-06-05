/**
 * Exam Flow — UI presentation layer only (v0.9)
 * Step progress, diagnosis pills, output card actions
 * Does not modify appState or business logic.
 */

(function () {
  function refreshStepProgress() {
    const st = window.examFlowState;
    if (!st) return;
    const hasMeta = !!(st.examMeta?.year && st.rooms?.length);
    const hasStudents = Object.keys(st.students || {}).length > 0;
    const hasAssignment = Object.keys(st.roomAssignments || {}).length > 0;
    const hasSeats = Object.keys(st.seatAssignments || {}).length > 0;
    const hasPlacement = Object.keys(st.placementOverrides || {}).length > 0 || hasSeats;

    const doneMap = {
      '1': hasMeta,
      '2': hasStudents,
      '3': hasAssignment && hasSeats,
      '4': hasPlacement,
      '5': hasSeats
    };

    document.querySelectorAll('.step-tab').forEach(tab => {
      const step = tab.dataset.step;
      tab.classList.toggle('done', !!doneMap[step]);
    });
  }

  function refreshDiagnosisPills() {
    const d = window.examFlowState?._lastDiagnosis;
    const wrap = document.getElementById('diagnosis-summary-cards');
    if (!wrap) return;
    if (!d) {
      wrap.querySelectorAll('.pill-value').forEach(el => { el.textContent = '—'; });
      return;
    }
    const err = document.getElementById('diag-pill-error');
    const warn = document.getElementById('diag-pill-warning');
    const ok = document.getElementById('diag-pill-ok');
    if (err) err.textContent = d.summary.errors;
    if (warn) warn.textContent = d.summary.warnings;
    if (ok) ok.textContent = d.summary.ok;
  }

  function bindOutputCardActions() {
    document.querySelectorAll('.output-btn-print').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const type = btn.dataset.output;
        const tab = document.querySelector(`.output-index-tab[data-output="${type}"]`);
        if (tab) tab.click();
        setTimeout(() => document.getElementById('btn-print-output')?.click(), 120);
      });
    });
  }

  function refreshAll() {
    refreshStepProgress();
    refreshDiagnosisPills();
  }

  function observeDiagnosis() {
    const tableEl = document.getElementById('diagnosis-results-table');
    if (!tableEl) return;
    const obs = new MutationObserver(refreshDiagnosisPills);
    obs.observe(tableEl, { childList: true, subtree: true });
    document.getElementById('btn-run-diagnosis')?.addEventListener('click', () => {
      setTimeout(refreshDiagnosisPills, 80);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindOutputCardActions();
    observeDiagnosis();
    refreshAll();
    setInterval(refreshAll, 2500);
  });
})();
