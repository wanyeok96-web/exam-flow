/** Exam Flow — js/students.js (classic script, file:// 호환. ES module 아님) */

/* ========== Column mapping for NICE Excel ========== */

const COLUMN_ALIASES = {
  year: ['학년도'],
  semester: ['학기'],
  grade: ['학년'],
  curriculum: ['편제명'],
  subject: ['개설과목', '개설과목(학점)', '개설과목(단위수)'],
  courseRoom: ['개설강의실'],
  studentGrade: ['계열/학년/학과', '학생학년', '학생 학년'],
  classNo: ['반'],
  number: ['번호'],
  name: ['성명', '이름']
};

function findColumnIndex(headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    for (const alias of aliases) {
      if (h === alias || h.includes(alias)) return i;
    }
  }
  return -1;
}

function mapColumns(headers) {
  const map = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    map[key] = findColumnIndex(headers, aliases);
  }
  return map;
}

/* ========== Step 1: Exam Rules UI ========== */

function renderExamDates() {
  const container = $('#exam-dates-container');
  if (!container) return;
  const days = parseInt($('#meta-days')?.value, 10) || appState.examMeta.days || 4;
  let html = '<div class="exam-dates-grid">';
  for (let d = 1; d <= days; d++) {
    const val = appState.examMeta.dates[d] || '';
    html += `<label class="exam-date-cell">
      <span class="exam-date-label">${d}일차</span>
      <input type="date" data-day="${d}" class="exam-date-input" value="${val}">
    </label>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

function formatTimetableDayHeader(day) {
  const d = appState.examMeta.dates[day];
  if (!d) return `${day}일차`;
  const dt = new Date(d + 'T00:00:00');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dt.getMonth() + 1}/${dt.getDate()}(${weekdays[dt.getDay()]})`;
}

function renderUnifiedTimetable() {
  const container = $('#timetable-container');
  if (!container) return;
  const days = appState.examMeta.days;
  const periods = appState.examMeta.periodsPerDay;

  let html = '<div class="timetable-scroll"><table class="timetable-table timetable-unified"><thead><tr>';
  html += '<th class="tt-col-grade">학년</th><th class="tt-col-period">교시</th>';
  for (let d = 1; d <= days; d++) {
    html += `<th class="tt-col-day">${formatTimetableDayHeader(d)}</th>`;
  }
  html += '</tr></thead><tbody>';

  [1, 2, 3].forEach(grade => {
    if (!appState.timetable[grade]) appState.timetable[grade] = {};
    for (let p = 1; p <= periods; p++) {
      const gradeSep = p === periods ? ' class="tt-grade-separator"' : '';
      html += `<tr${gradeSep}>`;
      if (p === 1) {
        html += `<th rowspan="${periods}" class="tt-grade-cell">${grade}학년</th>`;
      }
      html += `<th class="tt-period-cell">${p}교시</th>`;
      for (let d = 1; d <= days; d++) {
        if (!appState.timetable[grade][d]) appState.timetable[grade][d] = {};
        const subjects = appState.timetable[grade][d][p] || [];
        const val = subjects.join(' / ');
        html += `<td><input type="text" data-grade="${grade}" data-day="${d}" data-period="${p}" class="timetable-input" value="${val}" placeholder="-"></td>`;
      }
      html += '</tr>';
    }
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

const MOVE_MODE_OPTIONS = [
  { id: 'from-front', label: '앞번호부터' },
  { id: 'from-back', label: '뒷번호부터' },
  { id: 'from-number', label: '번호부터 N명' },
  { id: 'range', label: '번호 범위' }
];

function syncMovementModePanels(root = document) {
  root.querySelectorAll('.movement-grade-block').forEach(block => {
    const enabled = block.querySelector('.movement-enabled')?.checked;
    block.classList.toggle('is-enabled', !!enabled);
    const mode = block.querySelector('.movement-mode:checked')?.value || 'from-front';
    block.querySelectorAll('.movement-mode-panel').forEach(panel => {
      panel.hidden = panel.dataset.panel !== mode;
    });
  });
}

function renderMovementRules() {
  const container = $('#movement-rules-container');
  container.innerHTML = [1, 2, 3].map(g => {
    const rule = getMoveRules(g);
    const mode = rule.mode || 'from-front';
    const count = rule.count || 14;
    const modeTabs = MOVE_MODE_OPTIONS.map(m => `
      <label class="move-mode-tab">
        <input type="radio" class="movement-mode" name="movement-mode-${g}" data-grade="${g}" value="${m.id}" ${mode === m.id ? 'checked' : ''}>
        ${m.label}
      </label>`).join('');
    return `
      <div class="movement-grade-block${rule.enabled ? ' is-enabled' : ''}" data-grade="${g}">
        <div class="movement-grade-head">
          <h3>${g}학년 이동 설정</h3>
          <label class="movement-enable-inline">
            <input type="checkbox" class="movement-enabled" data-grade="${g}" ${rule.enabled ? 'checked' : ''}>
            다른 학년 교실로 이동
          </label>
        </div>
        <div class="movement-grade-body">
          <div class="form-inline-row movement-fields-row">
            <label>이동할 교실
              <select class="movement-target" data-grade="${g}">
                <option value="">없음</option>
                ${[1, 2, 3].filter(t => t !== g).map(t => `<option value="${t}" ${rule.targetGrade === t ? 'selected' : ''}>${t}학년 교실</option>`).join('')}
              </select>
            </label>
          </div>
          <p class="move-mode-label">이동 대상</p>
          <div class="move-mode-tabs" role="radiogroup" aria-label="${g}학년 이동 방식">${modeTabs}</div>
          <div class="movement-mode-panel" data-grade="${g}" data-panel="from-front" ${mode !== 'from-front' ? 'hidden' : ''}>
            <p class="move-phrase">앞번호부터 <input type="number" class="movement-count" min="1" value="${count}"> 명이 이동합니다.</p>
            <p class="hint">번호가 작은 학생부터 결번을 건너뛰고 선택합니다.</p>
          </div>
          <div class="movement-mode-panel" data-grade="${g}" data-panel="from-back" ${mode !== 'from-back' ? 'hidden' : ''}>
            <p class="move-phrase">뒷번호부터 <input type="number" class="movement-count" min="1" value="${count}"> 명이 이동합니다.</p>
            <p class="hint">번호가 큰 학생부터 결번을 건너뛰고 선택합니다.</p>
          </div>
          <div class="movement-mode-panel" data-grade="${g}" data-panel="from-number" ${mode !== 'from-number' ? 'hidden' : ''}>
            <p class="move-phrase">
              <input type="number" class="movement-start" min="1" value="${rule.fromNumber}">번부터
              <input type="number" class="movement-count" min="1" value="${count}"> 명이 이동합니다.
            </p>
            <p class="hint">지정 번호 이상인 학생을 번호순으로 목표 인원만큼 선택합니다.</p>
          </div>
          <div class="movement-mode-panel" data-grade="${g}" data-panel="range" ${mode !== 'range' ? 'hidden' : ''}>
            <p class="move-phrase">
              번호
              <input type="number" class="movement-start" min="1" value="${rule.fromNumber}">
              ~
              <input type="number" class="movement-end" min="1" value="${rule.toNumber}">
            </p>
            <p class="hint">시작 번호 이상 학생을 (끝−시작+1)명만큼 선택합니다. 결번이 있으면 다음 번호로 채웁니다.</p>
          </div>
        </div>
      </div>`;
  }).join('');
  syncMovementModePanels();
  renderMovementPreviewSelect();
}

function renderMovementPreviewSelect() {
  const sel = $('#movement-preview-select');
  if (!sel) return;
  const prev = sel.value;
  const options = ['<option value="">학년·반 선택</option>'];

  [1, 2, 3].forEach(g => {
    const rule = getMoveRules(g);
    if (!rule.enabled) return;
    const classNos = sortClassNos(
      Object.values(appState.students).filter(s => s.grade === g).map(s => s.classNo)
    );
    if (!classNos.length) {
      const roomClasses = appState.rooms
        .filter(r => r.type === 'class' && r.grade === g)
        .map(r => parseClassRoomName(r.name)?.classNo)
        .filter(n => Number.isFinite(n));
      classNos.push(...sortClassNos(roomClasses));
    }
    classNos.forEach(classNo => {
      options.push(`<option value="${g}-${classNo}">${g}학년 ${classNo}반</option>`);
    });
  });

  sel.innerHTML = options.join('');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderRoomsGradeSetup() {
  const container = $('#rooms-setup-grid');
  if (!container) return;

  const gradeCols = [1, 2, 3].map(g => `
    <div class="room-setup-col">
      <h4 class="room-setup-col-title">${g}학년</h4>
      <label class="room-setup-field"><span>학급 수</span><input type="number" id="class-count-${g}" value="${getClassCountForGrade(g)}" min="0" max="30"></label>
      <label class="room-setup-field"><span>학급당 좌석 수</span><input type="number" id="class-capacity-${g}" value="30" min="1"></label>
      <button type="button" class="btn btn-secondary room-setup-btn btn-generate-classes" data-grade="${g}">교실 생성</button>
    </div>
  `).join('');

  container.innerHTML = `
    ${gradeCols}
    <div class="room-setup-col">
      <h4 class="room-setup-col-title">특별실</h4>
      <label class="room-setup-field"><span>이름</span><input type="text" id="special-room-name" placeholder="예: 과학실"></label>
      <label class="room-setup-field"><span>좌석 수</span><input type="number" id="special-room-capacity" min="1" value="30"></label>
      <button type="button" id="btn-add-special-room" class="btn btn-secondary room-setup-btn">특별실 추가</button>
    </div>
    <div class="room-setup-col">
      <h4 class="room-setup-col-title">대기실</h4>
      <label class="room-setup-field"><span>이름</span><input type="text" id="waiting-room-name" placeholder="예: 대기실A"></label>
      <label class="room-setup-field"><span>좌석 수</span><input type="number" id="waiting-room-capacity" min="1" value="50"></label>
      <button type="button" id="btn-add-waiting-room" class="btn btn-secondary room-setup-btn">대기실 추가</button>
    </div>`;
}

function getClassCountForGrade(grade) {
  const prefix = `${grade}-`;
  const classes = appState.rooms.filter(r => r.type === 'class' && r.grade === grade);
  return classes.length || (grade === 1 ? 10 : grade === 2 ? 11 : 12);
}

function renderRoomsList() {
  const container = $('#rooms-list-container');
  if (!appState.rooms.length) {
    container.innerHTML = '<p class="hint">고사실이 없습니다. 학년별 교실을 생성하세요.</p>';
    return;
  }
  let html = `<table class="data-table"><thead><tr>
    <th>고사실명</th><th>유형</th><th>학년</th><th>좌석 수</th><th>삭제</th>
  </tr></thead><tbody>`;
  appState.rooms.forEach((room, idx) => {
    html += `<tr>
      <td>${room.name}</td>
      <td>${roomTypeLabel(room.type)}</td>
      <td>${room.grade || '-'}</td>
      <td><input type="number" class="room-capacity-input" data-idx="${idx}" value="${room.capacity}" min="1" style="width:70px"></td>
      <td><button type="button" class="btn btn-sm btn-danger btn-remove-room" data-idx="${idx}">삭제</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function roomTypeLabel(type) {
  return { class: '학급교실', special: '특별실', waiting: '대기실' }[type] || type;
}

function flushDOMBeforeTimetableRender() {
  collectMetaFromDOM();
  collectTimetableFromDOM();
}

function persistAllSettings() {
  collectAllSettings();
  saveToLocalSilent();
}

function applyExamMeta() {
  if (guardIfLocked('시험 규칙 수정')) return;
  flushDOMBeforeTimetableRender();
  renderExamDates();
  renderUnifiedTimetable();
  refreshOutputFilters();
  syncStateToWindow();
  persistAllSettings();
}

function collectMetaFromDOM() {
  if (!$('#meta-year')) return;
  appState.examMeta.schoolName = ($('#meta-school-name')?.value || '').trim();
  appState.examMeta.year = parseInt($('#meta-year').value, 10) || appState.examMeta.year;
  appState.examMeta.semester = parseInt($('#meta-semester').value, 10) || appState.examMeta.semester;
  appState.examMeta.round = parseInt($('#meta-round').value, 10) || appState.examMeta.round;
  appState.examMeta.examName = ($('#meta-exam-name')?.value || '').trim() || appState.examMeta.examName;
  appState.examMeta.days = parseInt($('#meta-days').value, 10) || appState.examMeta.days;
  appState.examMeta.periodsPerDay = parseInt($('#meta-periods').value, 10) || appState.examMeta.periodsPerDay;
  appState.examMeta.dates = {};
  $$('.exam-date-input').forEach(input => {
    appState.examMeta.dates[parseInt(input.dataset.day, 10)] = input.value;
  });
}

function collectTimetableFromDOM() {
  $$('.timetable-input').forEach(input => {
    const g = parseInt(input.dataset.grade, 10);
    const d = parseInt(input.dataset.day, 10);
    const p = parseInt(input.dataset.period, 10);
    if (!appState.timetable[g]) appState.timetable[g] = {};
    if (!appState.timetable[g][d]) appState.timetable[g][d] = {};
    const raw = input.value.trim();
    appState.timetable[g][d][p] = raw
      ? raw.split('/').map(s => normalizeSubject(s)).filter(Boolean)
      : [];
  });
}

function collectMovementRulesFromDOM() {
  if (!document.querySelector('.movement-enabled')) return;
  [1, 2, 3].forEach(g => {
    const block = document.querySelector(`.movement-grade-block[data-grade="${g}"]`);
    if (!block) return;
    const enabled = block.querySelector('.movement-enabled')?.checked;
    const target = block.querySelector('.movement-target')?.value;
    const mode = normalizeMoveMode(block.querySelector('.movement-mode:checked')?.value || 'from-front');
    const panel = block.querySelector(`.movement-mode-panel[data-panel="${mode}"]`);
    const start = parseInt(panel?.querySelector('.movement-start')?.value, 10);
    const end = parseInt(panel?.querySelector('.movement-end')?.value, 10);
    const countRaw = parseInt(panel?.querySelector('.movement-count')?.value, 10);
    let fromNumber = start || 1;
    let toNumber = end || 14;
    let count = countRaw || 14;
    if (mode === 'from-front') {
      fromNumber = 1;
      toNumber = count;
    } else if (mode === 'from-back') {
      fromNumber = 1;
      toNumber = count;
    } else if (mode === 'from-number') {
      fromNumber = start || 1;
      count = countRaw || 14;
      toNumber = fromNumber + count - 1;
    } else {
      fromNumber = start || 1;
      toNumber = end || fromNumber;
      count = Math.max(1, toNumber - fromNumber + 1);
    }
    appState.examRules.movementRules[g] = {
      enabled: !!enabled,
      targetGrade: target ? parseInt(target, 10) : null,
      mode,
      count,
      fromNumber,
      toNumber,
      rangeStart: fromNumber,
      rangeEnd: toNumber
    };
  });
  rebuildMoveTargetCache();
}

function collectSeatDefaultsFromDOM() {
  if (!$('#seat-rows')) return;
  appState.examRules.seatDefaults = {
    rows: parseInt($('#seat-rows').value, 10) || 6,
    cols: parseInt($('#seat-cols').value, 10) || 4,
    fillDirection: $('#seat-fill-direction').value,
    moveStudentColumnMode: normalizeMoveColumnMode($('#seat-move-column')?.value),
    doorSide: $('#seat-door-side')?.value || 'left'
  };
}

function saveTimetable() {
  if (guardIfLocked('시간표 수정')) return;
  collectTimetableFromDOM();
  alert('시간표가 저장되었습니다.');
  syncStateToWindow();
  persistAllSettings();
}

function saveMovementRules() {
  if (guardIfLocked('이동반 규칙 수정')) return;
  collectMovementRulesFromDOM();
  renderMovementPreview();
  syncStateToWindow();
  persistAllSettings();
}

function saveSeatDefaults() {
  if (guardIfLocked('좌석 규칙 수정')) return;
  collectSeatDefaultsFromDOM();
  renderSeatConfigPreview();
  syncStateToWindow();
  persistAllSettings();
}

function generateClassRooms(grade) {
  const count = parseInt($(`#class-count-${grade}`).value, 10);
  const capacity = parseInt($(`#class-capacity-${grade}`).value, 10) || 30;
  appState.rooms = appState.rooms.filter(r => !(r.type === 'class' && r.grade === grade));
  for (let c = 1; c <= count; c++) {
    appState.rooms.push({
      id: `${grade}-${c}`,
      name: `${grade}-${c}`,
      grade,
      type: 'class',
      capacity
    });
  }
  sortRoomsInState();
  renderRoomsList();
  renderRoomOccupancyPanel();
  syncStateToWindow();
}

function addSpecialRoom(type) {
  const isWaiting = type === 'waiting';
  const nameInput = isWaiting ? $('#waiting-room-name') : $('#special-room-name');
  const capInput = isWaiting ? $('#waiting-room-capacity') : $('#special-room-capacity');
  const name = nameInput.value.trim();
  const capacity = parseInt(capInput.value, 10) || 30;
  if (!name) { alert('고사실 이름을 입력하세요.'); return; }
  appState.rooms.push({
    id: `special-${Date.now()}`,
    name,
    grade: null,
    type: isWaiting ? 'waiting' : 'special',
    capacity
  });
  nameInput.value = '';
  sortRoomsInState();
  renderRoomsList();
  syncStateToWindow();
}

/* ========== Step 2: Excel Upload ========== */

/** 이름 앞 (미재학) — 현재 재학하지 않는 학생 (나이스 편성현황 잔존 데이터) */
function isNonEnrolledStudentName(name) {
  const n = String(name || '').trim();
  return /^\(미재학\)|^（미재학）/.test(n);
}

function removeStudentsFromState(studentIds) {
  const toRemove = new Set(studentIds);
  if (!toRemove.size) return 0;

  toRemove.forEach(id => {
    delete appState.students[id];
    delete appState.fixedRoomSeats?.[id];
    delete appState.seatAssignments?.[id];
    delete appState.studentExamSchedules?.[id];
    Object.keys(appState.placementOverrides || {}).forEach(k => {
      if (k.startsWith(`${id}-`)) delete appState.placementOverrides[k];
    });
    Object.keys(appState.attendanceNotes || {}).forEach(k => {
      if (k.startsWith(`${id}-`)) delete appState.attendanceNotes[k];
    });
  });

  appState.examGroups.forEach(g => {
    g.students = g.students.filter(sid => !toRemove.has(sid));
  });
  appState.examGroups = appState.examGroups.filter(g => g.students.length > 0);

  if (hasFixedRoomSeats()) {
    rebuildSeatAssignmentsFromFixed();
    if (appState.examGroups.length) syncDerivedRoomAssignments();
  }

  buildSubjectGroups();
  rebuildMoveTargetCache();
  return toRemove.size;
}

function purgeNonEnrolledStudentsFromState() {
  const toRemove = Object.entries(appState.students)
    .filter(([, st]) => isNonEnrolledStudentName(st?.name))
    .map(([id]) => id);
  return removeStudentsFromState(toRemove);
}

function deleteStudent(studentId) {
  if (guardIfLocked('학생 삭제')) return;
  const st = appState.students[studentId];
  if (!st) return;
  if (!confirm(`${st.name} (${studentId}) 학생을 삭제할까요?`)) return;

  removeStudentsFromState([studentId]);
  touchStepUI('2', renderStep2UI);
  if (isStepActive('1')) renderMovementPreview();
  else invalidateSteps('1');
  touchStepUI('3', renderStep3UI);
  invalidateSteps('4', '5');
  invalidateDiagnosis();
  syncStateToWindow();
}

function parseNiceExcel(arrayBuffer, expectedGrade) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const joined = row.map(c => String(c)).join('|');
    if (joined.includes('성명') && (joined.includes('반') || joined.includes('개설과목'))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) throw new Error('헤더 행을 찾을 수 없습니다. 나이스 학생편성현황 파일인지 확인하세요.');

  const headers = rows[headerRowIdx].map(h => String(h).trim());
  const colMap = mapColumns(headers);

  if (colMap.name < 0 || colMap.classNo < 0) {
    throw new Error('필수 열(반, 성명)을 찾을 수 없습니다.');
  }

  const parsed = [];
  let excludedCount = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some(c => c !== '' && c != null)) continue;

    const name = String(row[colMap.name] || '').trim();
    if (!name) continue;
    if (isNonEnrolledStudentName(name)) {
      excludedCount++;
      continue;
    }

    const classNo = parseClassNo(row[colMap.classNo]);
    const number = parseInt(row[colMap.number], 10);
    if (!classNo || isNaN(number)) continue;

    let grade = expectedGrade;
    if (colMap.studentGrade >= 0) {
      const g = parseGradeFromText(row[colMap.studentGrade]);
      if (g) grade = g;
    } else if (colMap.grade >= 0) {
      const g = parseInt(row[colMap.grade], 10);
      if (!isNaN(g)) grade = g;
    }

    const subject = normalizeSubject(row[colMap.subject >= 0 ? colMap.subject : -1] || '');
    const courseRoom = colMap.courseRoom >= 0 ? String(row[colMap.courseRoom] || '').trim() : '';

    parsed.push({ grade, classNo, number, name, subject, courseRoom });
  }

  return { rows: parsed, excludedCount };
}

function mergeStudentsFromRows(rows, expectedGrade) {
  const newStudents = { ...appState.students };

  Object.keys(newStudents).forEach(id => {
    const s = newStudents[id];
    if (s.grade === expectedGrade || isNonEnrolledStudentName(s?.name)) delete newStudents[id];
  });

  rows.filter(row => !isNonEnrolledStudentName(row.name)).forEach(row => {
    if (!row.subject) return;
    const studentId = makeStudentId(row.grade, row.classNo, row.number);
    if (!newStudents[studentId]) {
      newStudents[studentId] = {
        studentId,
        grade: row.grade,
        classNo: row.classNo,
        number: row.number,
        name: row.name,
        subjects: [],
        courseRooms: {}
      };
    }
    const st = newStudents[studentId];
    if (!st.subjects.includes(row.subject)) st.subjects.push(row.subject);
    if (row.courseRoom) st.courseRooms[row.subject] = row.courseRoom;
  });

  appState.students = newStudents;
  buildSubjectGroups();
}

function buildSubjectGroups() {
  const groups = {};
  Object.values(appState.students).forEach(st => {
    st.subjects.forEach(sub => {
      if (!groups[sub]) groups[sub] = { subject: sub, students: [], rooms: new Set() };
      groups[sub].students.push(st.studentId);
      if (st.courseRooms[sub]) groups[sub].rooms.add(st.courseRooms[sub]);
    });
  });
  Object.values(groups).forEach(g => {
    g.rooms = [...g.rooms];
    g.count = g.students.length;
  });
  appState.subjectGroups = groups;
}

async function handleGradeUpload(grade, file) {
  if (guardIfLocked('학생편성현황 업로드')) return;
  const statusEl = $(`#status-grade-${grade}`);
  const errorEl = $('#upload-errors');
  try {
    const buffer = await file.arrayBuffer();
    const { rows, excludedCount } = parseNiceExcel(buffer, grade);
    if (!rows.length) throw new Error(`${grade}학년: 유효한 학생 데이터가 없습니다.`);
    mergeStudentsFromRows(rows, grade);
    const count = Object.values(appState.students).filter(s => s.grade === grade).length;
    const excludeNote = excludedCount ? ` · (미재학) ${excludedCount}명 제외` : '';
    statusEl.textContent = `완료 (${count}명${excludeNote})`;
    statusEl.classList.add('done');
    statusEl.closest('.upload-box')?.classList.add('is-done');
    showEl(errorEl, false);
    rebuildMoveTargetCache();
    touchStepUI('2', renderStep2UI);
    if (isStepActive('1')) renderMovementPreview();
    invalidateSteps('3', '4', '5');
    invalidateDiagnosis();
    syncStateToWindow();
    if (appState.examGroups.length) tryAutoAssignFixedSeats();
  } catch (err) {
    statusEl.textContent = '오류';
    statusEl.classList.remove('done');
    statusEl.closest('.upload-box')?.classList.remove('is-done');
    errorEl.textContent = `${grade}학년 업로드 오류: ${err.message}`;
    showEl(errorEl, true);
  }
}

function renderStudentSummary() {
  const students = Object.values(appState.students);
  const byGrade = { 1: 0, 2: 0, 3: 0 };
  const byClass = {};
  students.forEach(s => {
    byGrade[s.grade] = (byGrade[s.grade] || 0) + 1;
    const key = `${s.grade}-${s.classNo}`;
    byClass[key] = (byClass[key] || 0) + 1;
  });

  const container = $('#student-summary');
  container.innerHTML = `
    <div class="summary-item"><div class="value">${students.length}</div><div class="label">전체 학생</div></div>
    <div class="summary-item"><div class="value">${byGrade[1] || 0}</div><div class="label">1학년</div></div>
    <div class="summary-item"><div class="value">${byGrade[2] || 0}</div><div class="label">2학년</div></div>
    <div class="summary-item"><div class="value">${byGrade[3] || 0}</div><div class="label">3학년</div></div>
    <div class="summary-item"><div class="value">${Object.keys(byClass).length}</div><div class="label">학급 수</div></div>
  `;
}

function getSubjectGroupsForGrade(grade) {
  const subjectMap = {};
  Object.values(appState.students)
    .filter(s => s.grade === grade)
    .forEach(st => {
      st.subjects.forEach(sub => {
        if (!subjectMap[sub]) subjectMap[sub] = { subject: sub, students: [], rooms: new Set() };
        subjectMap[sub].students.push(st.studentId);
        if (st.courseRooms[sub]) subjectMap[sub].rooms.add(st.courseRooms[sub]);
      });
    });
  return Object.values(subjectMap)
    .map(g => ({ ...g, rooms: [...g.rooms], count: g.students.length }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'ko'));
}

function renderSubjectStats() {
  const container = $('#subject-stats-table');
  if (!container) return;

  const gradeVal = $('#subject-stats-grade-filter')?.value;
  if (!gradeVal) {
    container.innerHTML = '<p class="hint">학년을 선택하면 해당 학년의 과목 목록이 표시됩니다.</p>';
    return;
  }

  const grade = parseInt(gradeVal, 10);
  const groups = getSubjectGroupsForGrade(grade);
  if (!groups.length) {
    container.innerHTML = '<p class="hint">해당 학년 수강 과목 데이터가 없습니다.</p>';
    return;
  }

  let html = `<table class="data-table"><thead><tr>
    <th>과목</th><th>수강 인원</th><th>개설강의실 수</th><th>개설강의실</th>
  </tr></thead><tbody>`;
  groups.forEach(g => {
    html += `<tr><td>${g.subject}</td><td>${g.count}</td><td>${g.rooms.length}</td><td>${g.rooms.join(', ')}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderStudentList() {
  const container = $('#student-list-table');
  if (!container) return;

  const filter = $('#student-list-grade-filter')?.value;
  const students = Object.values(appState.students)
    .filter(s => !filter || s.grade === parseInt(filter, 10))
    .sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.classNo !== b.classNo) return a.classNo - b.classNo;
      return a.number - b.number;
    });

  if (!students.length) {
    container.innerHTML = '<p class="hint">학생 데이터 없음</p>';
    return;
  }

  let html = `<table class="data-table student-roster-table"><colgroup>
    <col class="col-id"><col class="col-name"><col class="col-subjects"><col class="col-delete">
  </colgroup><thead><tr>
    <th class="col-id">학번</th><th class="col-name">성명</th><th class="col-subjects">수강 과목</th><th class="col-delete"></th>
  </tr></thead><tbody>`;
  students.slice(0, 500).forEach(s => {
    html += `<tr>
      <td class="col-id">${s.studentId}</td>
      <td class="col-name">${s.name}</td>
      <td class="col-subjects student-subjects-cell">${s.subjects.join(', ')}</td>
      <td class="col-delete">
        <button type="button" class="btn-icon-delete btn-delete-student" data-sid="${s.studentId}" title="학생 삭제" aria-label="${s.name} 삭제">
          <svg class="btn-icon-delete__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15.5V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 9v4M12 9v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </td>
    </tr>`;
  });
  if (students.length > 500) {
    html += `<tr><td colspan="4" class="hint">... 외 ${students.length - 500}명 (학년 필터로 범위를 줄이세요)</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

