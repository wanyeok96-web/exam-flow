/** Exam Flow — js/app.js (classic script, file:// 호환. ES module 아님) */

/* ========== Storage ========== */

let autoSaveTimer = null;
let autoSavePaused = false;

function syncStateToWindow() {
  window.examFlowState = appState;
  window.examFlowUI?.refreshStepProgress();
  scheduleAutoSave();
}

function scheduleAutoSave() {
  if (autoSavePaused) return;
  setSaveStatus('💾 저장 중…');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveToLocalSilent(), 700);
}

function setSaveStatus(text) {
  const el = document.getElementById('save-status');
  if (el) el.textContent = text;
}

function collectAllSettings() {
  collectMetaFromDOM();
  collectGradeParticipationFromDOM();
  collectTimetableFromDOM();
  collectMovementRulesFromDOM();
  collectSeatDefaultsFromDOM();
  sanitizeMovementRulesForParticipation();
  $$('.room-capacity-input').forEach(input => {
    const idx = parseInt(input.dataset.idx, 10);
    if (appState.rooms[idx]) appState.rooms[idx].capacity = parseInt(input.value, 10);
  });
}

function tryLoadLocalOnInit() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    Object.assign(appState, data);
    migrateLoadedState();
    restoreUI();
    return true;
  } catch (_) {
    return false;
  }
}

function saveToLocal() {
  try {
    persistAllSettings();
    setSaveStatus('💾 저장됨');
    alert('작업이 저장되었습니다. (localStorage)');
  } catch (e) {
    setSaveStatus('⚠️ 저장 실패');
    alert('저장 실패: ' + e.message);
  }
}

function migrateToFixedRoomSeats() {
  if (!appState.fixedRoomSeats) appState.fixedRoomSeats = {};
  if (Object.keys(appState.fixedRoomSeats).length) return;

  const fixed = {};
  Object.entries(appState.seatAssignments || {}).forEach(([studentId, seats]) => {
    if (!seats.length) return;
    const s = seats[0];
    fixed[studentId] = {
      roomName: s.roomName,
      seatNo: s.seatNo,
      row: s.row,
      col: s.col,
      isMoveStudent: s.isMoveStudent
    };
  });

  if (Object.keys(fixed).length) {
    appState.fixedRoomSeats = fixed;
    rebuildSeatAssignmentsFromFixed();
    if (appState.examGroups.length) syncDerivedRoomAssignments();
  }
}

function migrateLoadedState() {
  ensureGradeParticipationState();
  normalizeMoveRulesInState();
  sanitizeMovementRulesForParticipation();
  pruneNonExamOperationalData();
  if (appState.examRules.seatDefaults) {
    const sd = appState.examRules.seatDefaults;
    const legacyMap = { 'odd-columns': 'odd', 'even-columns': 'even', none: 'even' };
    if (!sd.moveStudentColumnMode || sd.moveStudentColumnMode === 'none') {
      sd.moveStudentColumnMode = legacyMap[sd.moverPlacement] || 'even';
    }
    sd.moveStudentColumnMode = normalizeMoveColumnMode(sd.moveStudentColumnMode);
    delete sd.moverPlacement;
    if (!sd.doorSide) sd.doorSide = 'left';
  }
  if (!appState.placementOverrides) appState.placementOverrides = {};
  if (!appState.placementChangeHistory) appState.placementChangeHistory = [];
  if (appState.operationLocked === undefined) appState.operationLocked = false;
  if (!appState.examMeta.schoolName) appState.examMeta.schoolName = '';
  purgeNonEnrolledStudentsFromState();
  migrateToFixedRoomSeats();
  if (hasFixedRoomSeats()) {
    rebuildSeatAssignmentsFromFixed();
    if (appState.examGroups.length) syncDerivedRoomAssignments();
  }
  sortRoomsInState();
}

function loadFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { alert('저장된 작업이 없습니다.'); return; }
  try {
    const data = JSON.parse(raw);
    Object.assign(appState, data);
    migrateLoadedState();
    restoreUI();
    syncStateToWindow();
    setSaveStatus('💾 불러옴');
    alert('작업을 불러왔습니다.');
  } catch (e) {
    alert('불러오기 실패: ' + e.message);
  }
}

function exportJson() {
  collectAllSettings();
  const blob = new Blob([JSON.stringify(getPersistableState(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `exam-flow-backup-${Date.now()}.json`;
  a.click();
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      Object.assign(appState, data);
      migrateLoadedState();
      restoreUI();
      syncStateToWindow();
      alert('JSON 백업을 불러왔습니다.');
    } catch (e) {
      alert('JSON 파싱 실패: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('모든 데이터를 초기화합니다. 계속하시겠습니까?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function restoreUI() {
  if ($('#meta-school-name')) $('#meta-school-name').value = appState.examMeta.schoolName || '';
  $('#meta-year').value = appState.examMeta.year;
  $('#meta-semester').value = appState.examMeta.semester;
  $('#meta-round').value = appState.examMeta.round;
  $('#meta-exam-name').value = appState.examMeta.examName;
  $('#meta-days').value = appState.examMeta.days;
  $('#meta-periods').value = appState.examMeta.periodsPerDay;
  renderExamDates();
  Object.entries(appState.examMeta.dates).forEach(([d, v]) => {
    const input = document.querySelector(`.exam-date-input[data-day="${d}"]`);
    if (input) input.value = v;
  });

  const sd = appState.examRules.seatDefaults;
  $('#seat-rows').value = sd.rows;
  $('#seat-cols').value = sd.cols;
  $('#seat-fill-direction').value = sd.fillDirection;
  if ($('#seat-move-column')) {
    $('#seat-move-column').value = normalizeMoveColumnMode(sd.moveStudentColumnMode);
  }
  if ($('#seat-door-side')) $('#seat-door-side').value = sd.doorSide || 'left';

  rebuildMoveTargetCache();
  renderStep1UI();

  [1, 2, 3].forEach(g => {
    const count = Object.values(appState.students).filter(s => s.grade === g).length;
    const statusEl = $(`#status-grade-${g}`);
    if (count) {
      statusEl.textContent = `완료 (${count}명)`;
      statusEl.classList.add('done');
      statusEl.closest('.upload-box')?.classList.add('is-done');
    }
  });

  invalidateSteps('2', '3', '4', '5');
  step5OutputInitialized = false;

  applyLockStateToUI();
  tryAutoAssignFixedSeats();
  syncStateToWindow();
}

/* ========== Step UI (lazy render) ========== */

function isStepActive(step) {
  return $(`#step-${step}`)?.classList.contains('active');
}

function invalidateSteps(...steps) {
  steps.forEach(s => {
    stepUIReady[s] = false;
    if (s === '4') placementEditorDirty = true;
    if (s === '5') step5PreviewStale = true;
  });
}

function renderStep1UI() {
  renderExamDates();
  renderGradeParticipation();
  renderUnifiedTimetable();
  renderMovementRules();
  renderMovementOverviewSummary();
  renderMovementPreviewSelect();
  renderSeatConfigPreview();
  renderRoomsGradeSetup();
  renderRoomsList();
  renderOpsSetupOverview();
  stepUIReady['1'] = true;
}

function renderStep2UI() {
  renderStudentSummary();
  renderSubjectStats();
  renderStudentList();
  stepUIReady['2'] = true;
}

function renderStep3UI() {
  populateExamGroupFilters();
  renderExamGroupsTable();
  renderRoomOccupancyPanel();
  stepUIReady['3'] = true;
}

function touchStepUI(step, renderFn) {
  if (isStepActive(step)) {
    renderFn();
    stepUIReady[step] = true;
  } else {
    invalidateSteps(step);
  }
}

function ensureStepUI(step) {
  const s = String(step);
  if (stepUIReady[s]) {
    if (s === '5' && step5PreviewStale) {
      refreshOutputFilters();
      refreshOutputPreview({ refreshChrome: true });
      step5PreviewStale = false;
    }
    return;
  }
  switch (s) {
    case '1':
      renderStep1UI();
      break;
    case '2':
      renderStep2UI();
      break;
    case '3':
      renderStep3UI();
      break;
    case '4':
      initPlacementEditor();
      stepUIReady['4'] = true;
      break;
    case '5':
      initStep5Output();
      stepUIReady['5'] = true;
      step5PreviewStale = false;
      break;
    default:
      break;
  }
}

/* ========== Navigation ========== */

const STEP_LABELS = {
  guide: '가이드',
  '1': '운영설정',
  '2': '학생업로드',
  '3': '시험실배정',
  '4': '자료검증',
  '5': '출력',
  office: '관리실'
};

function stepTabs() {
  return document.querySelectorAll('.step-tab');
}

function stepPanels() {
  return document.querySelectorAll('.step-panel');
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  const btn = $('#btn-sidebar-toggle');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) backdrop.hidden = true;
}

function openSidebar() {
  document.body.classList.add('sidebar-open');
  const btn = $('#btn-sidebar-toggle');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) backdrop.hidden = false;
}

function activateStep(step) {
  const next = String(step);
  if (typeof isPageTourActive === 'function' && isPageTourActive() && typeof stopPageTour === 'function') {
    stopPageTour();
  }
  stepTabs().forEach(t => {
    const on = t.dataset.step === next;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  stepPanels().forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('step-' + next);
  if (panel) panel.classList.add('active');
  const mobile = document.getElementById('mobile-current-step');
  if (mobile) mobile.textContent = STEP_LABELS[next] || '';
  closeSidebar();
  if (typeof closeAllBulkClassBubbles === 'function') closeAllBulkClassBubbles();
  ensureStepUI(next);
}

function initStepNav() {
  stepTabs().forEach(tab => {
    tab.addEventListener('click', () => activateStep(tab.dataset.step));
  });
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) closeSidebar();
    else openSidebar();
  });
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);
}

/* ========== Event Bindings ========== */

function initEvents() {
  $('#btn-apply-meta').addEventListener('click', applyExamMeta);
  $('#meta-days').addEventListener('change', () => {
    flushDOMBeforeTimetableRender();
    renderExamDates();
    renderUnifiedTimetable();
    persistAllSettings();
  });
  $('#meta-periods')?.addEventListener('change', () => {
    flushDOMBeforeTimetableRender();
    renderUnifiedTimetable();
    persistAllSettings();
  });
  $('#exam-dates-container')?.addEventListener('change', e => {
    if (e.target.classList.contains('exam-date-input')) {
      flushDOMBeforeTimetableRender();
      renderUnifiedTimetable();
      persistAllSettings();
    }
  });
  $('#btn-save-timetable').addEventListener('click', saveTimetable);

  $('#grade-participation-container')?.addEventListener('change', e => {
    if (e.target.classList.contains('grade-participation-mode')) {
      applyGradeParticipationChange();
    }
  });

  $('#movement-rules-container').addEventListener('change', e => {
    if (e.target.classList.contains('movement-mode') || e.target.classList.contains('movement-enabled')) {
      syncMovementModePanels(e.target.closest('.movement-grade-block') || document);
    }
    saveMovementRules();
    renderMovementOverviewSummary();
    renderMovementPreview();
  });
  $('#movement-rules-container').addEventListener('input', () => {
    collectMovementRulesFromDOM();
    clearTimeout(movementPreviewDebounce);
    movementPreviewDebounce = setTimeout(() => {
      renderMovementOverviewSummary();
      renderMovementPreview();
    }, 120);
  });
  $('#movement-preview-select')?.addEventListener('change', renderMovementPreview);
  ['#seat-rows', '#seat-cols', '#seat-fill-direction', '#seat-move-column', '#seat-door-side'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => {
      renderSeatConfigPreview();
      saveSeatDefaults();
    });
    el.addEventListener('input', () => {
      clearTimeout(seatPreviewDebounce);
      seatPreviewDebounce = setTimeout(renderSeatConfigPreview, 120);
    });
  });

  $('#rooms-setup-grid')?.addEventListener('click', e => {
    if (e.target.classList.contains('btn-generate-classes')) {
      generateClassRooms(parseInt(e.target.dataset.grade, 10));
    } else if (e.target.id === 'btn-add-special-room') {
      addSpecialRoom('special');
    } else if (e.target.id === 'btn-add-waiting-room') {
      addSpecialRoom('waiting');
    }
  });
  $('#rooms-list-container').addEventListener('click', e => {
    if (e.target.classList.contains('btn-remove-room')) {
      const idx = parseInt(e.target.dataset.idx, 10);
      appState.rooms.splice(idx, 1);
      renderRoomsList();
      syncStateToWindow();
    }
  });
  $('#rooms-list-container').addEventListener('change', e => {
    if (e.target.classList.contains('room-capacity-input')) {
      const idx = parseInt(e.target.dataset.idx, 10);
      appState.rooms[idx].capacity = parseInt(e.target.value, 10);
      syncStateToWindow();
    }
  });

  [1, 2, 3].forEach(g => {
    $(`#upload-grade-${g}`)?.addEventListener('change', e => {
      if (e.target.files[0]) handleGradeUpload(g, e.target.files[0]);
    });
  });
  $('#student-list-grade-filter')?.addEventListener('change', renderStudentList);
  $('#subject-stats-grade-filter')?.addEventListener('change', renderSubjectStats);
  $('#student-list-table')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete-student');
    if (!btn) return;
    deleteStudent(btn.dataset.sid);
  });

  $('#btn-generate-schedules').addEventListener('click', generateSchedulesAndGroups);
  $('#exam-group-grade-filter')?.addEventListener('change', renderExamGroupsTable);
  $('#exam-group-day-filter')?.addEventListener('change', renderExamGroupsTable);

  $('#btn-assign-seats').addEventListener('click', assignSeats);

  $('#btn-run-diagnosis')?.addEventListener('click', runAndShowOperationDiagnosis);
  $('#btn-lock-operation')?.addEventListener('click', confirmOperationLock);
  $('#btn-unlock-operation')?.addEventListener('click', unlockOperation);
  $('#btn-export-template')?.addEventListener('click', exportSettingsTemplate);
  $('#btn-import-template')?.addEventListener('change', e => {
    if (e.target.files[0]) {
      importSettingsTemplate(e.target.files[0]);
      e.target.value = '';
    }
  });
  $('#btn-export-operation-backup')?.addEventListener('click', exportOperationBackup);

  $('#btn-print-output')?.addEventListener('click', printOutput);

  $('#output-preview').addEventListener('change', e => {
    if (e.target.classList.contains('attendance-note')) {
      appState.attendanceNotes[e.target.dataset.key] = e.target.value;
      const printSpan = e.target.parentElement?.querySelector('.print-only-note');
      if (printSpan) printSpan.textContent = e.target.value;
      syncStateToWindow();
    }
  });

  $('#btn-save-local').addEventListener('click', saveToLocal);
  $('#btn-save-local-mobile')?.addEventListener('click', saveToLocal);
  $('#btn-load-local').addEventListener('click', loadFromLocal);
  $('#btn-export-json').addEventListener('click', exportJson);
  $('#input-import-json').addEventListener('change', e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
  });
  $('#btn-reset-all').addEventListener('click', resetAll);

  initAutoSave();
}

function initAutoSave() {
  const metaIds = [
    'meta-school-name', 'meta-year', 'meta-semester', 'meta-round',
    'meta-exam-name', 'meta-days', 'meta-periods'
  ];
  metaIds.forEach(id => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener('input', scheduleAutoSave);
    el.addEventListener('change', scheduleAutoSave);
  });

  document.addEventListener('input', e => {
    if (e.target.matches('.exam-date-input, .timetable-input')) scheduleAutoSave();
  });

  window.addEventListener('beforeunload', () => {
    if (!autoSavePaused) persistAllSettings();
  });
}

/* ========== Init ========== */

function init() {
  autoSavePaused = true;
  normalizeMoveRulesInState();

  const loaded = tryLoadLocalOnInit();
  if (!loaded) {
    renderStep1UI();
  } else {
    stepUIReady['1'] = true;
  }

  initStepNav();
  initPageTour();
  initEvents();
  initPlacementEditorEvents();
  applyLockStateToUI();
  autoSavePaused = false;
  window.examFlowState = appState;
}

document.addEventListener('DOMContentLoaded', init);
