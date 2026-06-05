/**
 * Exam Flow - 정기시험 운영 출력물 생성 도구
 * 클라이언트 전용, 서버 전송 없음
 */

/* ========== State ========== */

const STORAGE_KEY = 'examFlowState_v1';

const appState = {
  examMeta: {
    schoolName: '',
    year: 2026,
    semester: 1,
    round: 1,
    examName: '정기시험',
    days: 4,
    periodsPerDay: 3,
    dates: {}
  },
  examRules: {
    movementRules: {
      1: { enabled: false, targetGrade: null, rangeStart: 1, rangeEnd: 14 },
      2: { enabled: false, targetGrade: 1, rangeStart: 1, rangeEnd: 14 },
      3: { enabled: false, targetGrade: 2, rangeStart: 1, rangeEnd: 14 }
    },
    seatDefaults: {
      rows: 6,
      cols: 4,
      fillDirection: 'front-to-back',
      moveStudentColumnMode: 'even',
      doorSide: 'left'
    }
  },
  rooms: [],
  students: {},
  subjectGroups: {},
  timetable: { 1: {}, 2: {}, 3: {} },
  studentExamSchedules: {},
  examGroups: [],
  roomAssignments: {},
  fixedRoomSeats: {},
  seatAssignments: {},
  attendanceNotes: {},
  placementOverrides: {},
  placementChangeHistory: [],
  operationLocked: false
};

window.examFlowState = appState;

/** 학급별 이동 대상 캐시: `${grade}-${classNo}` → Set<studentId> */
let moveTargetCache = {};

/* ========== Utilities ========== */

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function makeStudentId(grade, classNo, number) {
  return `${grade}${String(classNo).padStart(2, '0')}${String(number).padStart(2, '0')}`;
}

function parseClassNo(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseGradeFromText(val) {
  if (val == null) return null;
  const m = String(val).match(/(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeSubject(name) {
  if (!name) return '';
  return String(name)
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function examGroupKey(grade, day, period, subject) {
  return `${grade}-${day}-${period}-${subject}`;
}

function sortStudentsByClass(studentIds) {
  return [...studentIds].sort((a, b) => {
    const sa = appState.students[a];
    const sb = appState.students[b];
    if (!sa || !sb) return 0;
    if (sa.grade !== sb.grade) return sa.grade - sb.grade;
    if (sa.classNo !== sb.classNo) return sa.classNo - sb.classNo;
    return sa.number - sb.number;
  });
}

function getRoomByName(name) {
  return appState.rooms.find(r => r.name === name);
}

function showEl(el, show) {
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

/* ========== Move Rules (이동반) ========== */

function getMoveRules(grade) {
  const rule = appState.examRules.movementRules[grade] || {};
  const fromNumber = rule.fromNumber ?? rule.rangeStart ?? 1;
  const toNumber = rule.toNumber ?? rule.rangeEnd ?? 14;
  return {
    enabled: !!rule.enabled,
    targetGrade: rule.targetGrade ?? null,
    fromNumber,
    toNumber
  };
}

function normalizeMoveRulesInState() {
  [1, 2, 3].forEach(g => {
    const rule = appState.examRules.movementRules[g];
    if (!rule) return;
    rule.fromNumber = rule.fromNumber ?? rule.rangeStart ?? 1;
    rule.toNumber = rule.toNumber ?? rule.rangeEnd ?? 14;
    rule.rangeStart = rule.fromNumber;
    rule.rangeEnd = rule.toNumber;
  });
}

function getMoveTargetStudentIdsByClass(grade, classNo) {
  const rule = getMoveRules(grade);
  if (!rule.enabled || !rule.targetGrade) return [];

  const students = Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo)
    .sort((a, b) => a.number - b.number);

  const targetCount = rule.toNumber - rule.fromNumber + 1;
  const candidates = students.filter(s => s.number >= rule.fromNumber);
  return candidates.slice(0, targetCount).map(s => s.studentId);
}

function rebuildMoveTargetCache() {
  moveTargetCache = {};
  const classKeys = new Set();
  Object.values(appState.students).forEach(s => classKeys.add(`${s.grade}-${s.classNo}`));
  classKeys.forEach(key => {
    const [grade, classNo] = key.split('-').map(Number);
    moveTargetCache[key] = new Set(getMoveTargetStudentIdsByClass(grade, classNo));
  });
}

function isMoveTargetStudent(student) {
  if (!student) return false;
  const key = `${student.grade}-${student.classNo}`;
  if (!moveTargetCache[key]) rebuildMoveTargetCache();
  return moveTargetCache[key].has(student.studentId);
}

function getDefaultExamRoomForStudent(student, subject, day, period) {
  if (!student) return '';
  if (isMoveTargetStudent(student)) {
    const rule = getMoveRules(student.grade);
    if (rule.targetGrade) return `${rule.targetGrade}-${student.classNo}`;
  }
  return `${student.grade}-${student.classNo}`;
}

function getStudentsInClass(grade, classNo) {
  return Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo)
    .sort((a, b) => a.number - b.number);
}

/* ========== Fixed Room Seats (반=교실, 5일 고정) ========== */

function parseClassRoomName(roomName) {
  const m = String(roomName).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { grade: parseInt(m[1], 10), classNo: parseInt(m[2], 10) };
}

function compareClassNos(a, b) {
  return a - b;
}

function compareGradeClass(gradeA, classA, gradeB, classB) {
  if (gradeA !== gradeB) return gradeA - classB;
  return classA - classB;
}

function compareClassRoomNames(a, b) {
  const pa = parseClassRoomName(a);
  const pb = parseClassRoomName(b);
  if (pa && pb) return compareGradeClass(pa.grade, pa.classNo, pb.grade, pb.classNo);
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return String(a).localeCompare(String(b), 'ko');
}

function sortClassRoomNames(names) {
  return [...names].sort(compareClassRoomNames);
}

function sortClassNos(classNos) {
  return [...new Set(classNos)].sort(compareClassNos);
}

function compareRooms(a, b) {
  const typeOrder = { class: 0, special: 1, waiting: 2 };
  const ta = typeOrder[a.type] ?? 9;
  const tb = typeOrder[b.type] ?? 9;
  if (ta !== tb) return ta - tb;
  return compareClassRoomNames(a.name, b.name);
}

function sortRoomsInState() {
  appState.rooms.sort(compareRooms);
}

function getSortedRoomNames() {
  return sortClassRoomNames(appState.rooms.map(r => r.name));
}

function getClassRooms() {
  return appState.rooms.filter(r => r.type === 'class').sort(compareRooms);
}

function getFixedRoomForStudent(studentId) {
  const st = appState.students[studentId];
  if (!st) return '';
  return getDefaultExamRoomForStudent(st, '', 0, 0);
}

function hasFixedRoomSeats() {
  return Object.keys(appState.fixedRoomSeats || {}).length > 0;
}

function getResidentsForRoom(roomName) {
  const parsed = parseClassRoomName(roomName);
  if (!parsed) return [];

  rebuildMoveTargetCache();
  const { grade: homeGrade, classNo: homeClassNo } = parsed;
  const residentIds = new Set();

  getStudentsInClass(homeGrade, homeClassNo).forEach(s => {
    if (!isMoveTargetStudent(s)) residentIds.add(s.studentId);
  });

  Object.values(appState.students).forEach(s => {
    if (isMoveTargetStudent(s) && getFixedRoomForStudent(s.studentId) === roomName) {
      residentIds.add(s.studentId);
    }
  });

  return sortStudentsByClass([...residentIds]);
}

function getFixedSeatDataForRoom(room) {
  const seatConfig = getSeatConfig();
  const positions = generateSeatPositions(seatConfig.rows, seatConfig.cols, seatConfig.fillDirection);
  const seatByCoord = {};

  Object.entries(appState.fixedRoomSeats || {}).forEach(([studentId, fixed]) => {
    if (fixed.roomName !== room) return;
    const st = appState.students[studentId];
    const coord = (fixed.row && fixed.col)
      ? { row: fixed.row, col: fixed.col }
      : positions.find(p => p.seatNo === fixed.seatNo);
    if (!coord) return;
    seatByCoord[`${coord.row}-${coord.col}`] = {
      ...fixed,
      row: coord.row,
      col: coord.col,
      seatGroup: fixed.seatGroup || (fixed.isMoveStudent ? 'move' : 'home'),
      studentId,
      name: st?.name || '',
      homeClass: st ? `${st.grade}-${st.classNo}` : '',
      subject: ''
    };
  });

  return { seatConfig, positions, seatByCoord, subject: '' };
}

function rebuildSeatAssignmentsFromFixed() {
  const seatAssignments = {};
  const { days, periodsPerDay } = appState.examMeta;
  const fixed = appState.fixedRoomSeats || {};

  Object.entries(fixed).forEach(([studentId, fs]) => {
    const st = appState.students[studentId];
    if (!st) return;
    const schedule = appState.studentExamSchedules[studentId] || [];
    const scheduleMap = {};
    schedule.forEach(e => { scheduleMap[`${e.day}-${e.period}`] = e; });

    seatAssignments[studentId] = [];
    for (let day = 1; day <= days; day++) {
      for (let period = 1; period <= periodsPerDay; period++) {
        const entry = scheduleMap[`${day}-${period}`];
        seatAssignments[studentId].push({
          grade: st.grade,
          day,
          period,
          subject: entry?.subject || '',
          roomName: fs.roomName,
          seatNo: fs.seatNo,
          row: fs.row,
          col: fs.col,
          isMoveStudent: fs.isMoveStudent,
          seatGroup: fs.seatGroup || (fs.isMoveStudent ? 'move' : 'home'),
          status: entry ? 'exam' : 'idle'
        });
      }
    }
  });

  appState.seatAssignments = seatAssignments;
}

function syncDerivedRoomAssignments() {
  if (!hasFixedRoomSeats() || !appState.examGroups.length) return;

  appState.roomAssignments = {};
  appState.examGroups.forEach(g => {
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const byRoom = {};
    g.students.forEach(id => {
      const fs = appState.fixedRoomSeats[id];
      const room = fs?.roomName || getFixedRoomForStudent(id);
      if (!byRoom[room]) byRoom[room] = [];
      byRoom[room].push(id);
    });
    appState.roomAssignments[key] = {
      grade: g.grade,
      day: g.day,
      period: g.period,
      subject: g.subject,
      autoAssigned: true,
      derivedFromFixedSeats: true,
      rooms: Object.entries(byRoom).map(([roomName, students]) => ({
        roomName,
        students: sortStudentsByClass(students)
      }))
    };
  });
}

function assignFixedSeats() {
  collectAllSettings();
  const seatConfig = getSeatConfig();
  const fixedRoomSeats = {};
  let overflowCount = 0;

  rebuildMoveTargetCache();

  getClassRooms().forEach(room => {
    const residents = getResidentsForRoom(room.name);
    if (!residents.length) return;

    const caps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
    const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
    const moveCount = residents.length - homeCount;
    if (homeCount > caps.home || moveCount > caps.move) overflowCount++;

    const results = assignSeatsForRoom(room.name, residents, {}, seatConfig);
    results.forEach(r => {
      fixedRoomSeats[r.studentId] = {
        roomName: room.name,
        seatNo: r.seatNo,
        row: r.row,
        col: r.col,
        isMoveStudent: r.isMoveStudent,
        seatGroup: r.seatGroup || (r.isMoveStudent ? 'move' : 'home')
      };
    });
  });

  appState.fixedRoomSeats = fixedRoomSeats;
  rebuildSeatAssignmentsFromFixed();
  syncDerivedRoomAssignments();
  return { count: Object.keys(fixedRoomSeats).length, overflowCount };
}

function findDuplicateFixedSeats() {
  const seen = {};
  const dupes = [];
  Object.entries(appState.fixedRoomSeats || {}).forEach(([studentId, fs]) => {
    const key = `${fs.roomName}-${fs.row}-${fs.col}`;
    if (seen[key]) {
      dupes.push({
        roomName: fs.roomName,
        seatNo: fs.seatNo,
        row: fs.row,
        col: fs.col,
        students: [seen[key], studentId]
      });
    } else {
      seen[key] = studentId;
    }
  });
  return dupes;
}

function renderRoomOccupancyPanel() {
  const panel = $('#room-occupancy-panel');
  if (!panel) return;

  if (!Object.keys(appState.students).length) {
    panel.innerHTML = '<p class="hint">학생 데이터 업로드 후 교실별 상주 현황이 표시됩니다.</p>';
    return;
  }

  rebuildMoveTargetCache();
  const seatConfig = getSeatConfig();
  const classRooms = getClassRooms();

  if (!classRooms.length) {
    panel.innerHTML = '<p class="hint">Step 1에서 학년별 교실(반)을 먼저 생성하세요.</p>';
    return;
  }

  let html = '<table class="data-table"><thead><tr>' +
    '<th>교실</th><th>상주 인원</th><th>정원</th><th>좌석 수</th><th>상태</th></tr></thead><tbody>';

  const caps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
  classRooms.forEach(room => {
    const residents = getResidentsForRoom(room.name);
    const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
    const moveCount = residents.length - homeCount;
    const overCap = residents.length > room.capacity;
    const overHome = homeCount > caps.home;
    const overMove = moveCount > caps.move;
    const status = overHome || overMove
      ? '<span class="validation-error">좌석 초과</span>'
      : overCap
        ? '<span class="validation-warn">정원 초과</span>'
        : '<span class="validation-ok">정상</span>';
    html += `<tr>
      <td>${room.name}</td>
      <td>${residents.length}명 (본반 ${homeCount} · 이동반 ${moveCount})</td>
      <td>${room.capacity}명</td>
      <td>본반 ${caps.home} · 이동반 ${caps.move}</td>
      <td>${status}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  html += '<p class="hint" style="margin-top:0.5rem">반=교실 원칙: 본반 학생(이동 제외) + 이동반 유입 학생이 각 교실에 상주합니다.</p>';
  panel.innerHTML = html;
}

function renderMovementPreview() {
  const container = $('#movement-preview-container');
  if (!container) return;

  rebuildMoveTargetCache();
  renderMovementPreviewSelect();

  const selected = $('#movement-preview-select')?.value || '';
  if (!selected) {
    container.innerHTML = '<p class="hint">학년·반을 선택하면 이동 대상 미리보기가 표시됩니다.</p>';
    return;
  }

  const hasStudents = Object.keys(appState.students).length > 0;
  if (!hasStudents) {
    container.innerHTML = '<p class="hint">학생 데이터 업로드 후 이동 대상 미리보기가 표시됩니다.</p>';
    return;
  }

  const [g, classNo] = selected.split('-').map(n => parseInt(n, 10));
  const rule = getMoveRules(g);
  if (!rule.enabled) {
    container.innerHTML = '<p class="hint">해당 학년의 이동 설정이 꺼져 있습니다.</p>';
    return;
  }

  const ids = getMoveTargetStudentIdsByClass(g, classNo);
  const numbers = ids.map(id => appState.students[id]?.number).filter(n => n != null);
  const targetRoom = rule.targetGrade ? `${rule.targetGrade}-${classNo}` : '-';
  const targetCount = rule.toNumber - rule.fromNumber + 1;

  container.innerHTML = `
    <div class="move-preview-panel">
      <h4>${g}학년 ${classNo}반 이동 대상: ${ids.length}명 (목표 ${targetCount}명)</h4>
      <div class="move-preview-meta">이동 번호: ${numbers.join(', ') || '없음'}</div>
      <div class="move-preview-meta">이동 고사실: ${targetRoom}</div>
      ${ids.length !== targetCount ? '<div class="validation-warn move-preview-warn">※ 목표 인원과 실제 인원이 다릅니다 (결번 보정 결과).</div>' : ''}
    </div>`;
}

function buildSeatPreviewTable(rows, cols, getCellMeta) {
  let html = `<table class="seat-layout-table seat-preview-table" style="--seat-cols:${cols}"><tbody>`;
  for (let r = 1; r <= rows; r++) {
    html += '<tr>';
    for (let c = 1; c <= cols; c++) {
      const { label, groupClass } = getCellMeta(r, c);
      html += `<td class="seat-preview-cell ${groupClass || ''}">${label || ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function renderSeatConfigPreview() {
  const container = $('#seat-config-preview');
  if (!container) return;

  const seatConfig = {
    rows: parseInt($('#seat-rows')?.value, 10) || 6,
    cols: parseInt($('#seat-cols')?.value, 10) || 4,
    fillDirection: $('#seat-fill-direction')?.value || 'front-to-back',
    moveStudentColumnMode: $('#seat-move-column')?.value || 'even'
  };
  const doorSide = $('#seat-door-side')?.value || 'left';
  const moveMode = seatConfig.moveStudentColumnMode;
  const { rows, cols } = seatConfig;
  const classRoom = '1-1';

  const classTable = buildSeatPreviewTable(rows, cols, (r, c) => ({
    label: getSplitSeatLabelAtCoord(classRoom, r, c, seatConfig),
    groupClass: isMoveColumn(c, moveMode) ? 'seat-preview-move' : 'seat-preview-home'
  }));
  const classCaps = getSplitSeatCapacities(rows, cols, moveMode);
  const moveColLabel = moveMode === 'odd' ? '홀수열' : '짝수열';

  container.innerHTML = `
    <p class="seat-preview-title">좌석 배치 미리보기 <span class="seat-preview-meta">${rows}행 × ${cols}열 · 본반 ${classCaps.home}석 · 이동반 ${classCaps.move}석</span></p>
    ${classTable}
    <div class="seat-map-footer seat-preview-footer"><div class="door-marker door-${doorSide}">🚪 출입문</div></div>
    <p class="hint seat-preview-legend">회색 음영: ${moveColLabel} · 이동반</p>`;
}

/* ========== Seat Config & Algorithm ========== */

function getSeatConfig() {
  const sd = appState.examRules.seatDefaults;
  return {
    rows: sd.rows || 6,
    cols: sd.cols || 4,
    fillDirection: sd.fillDirection || 'front-to-back',
    moveStudentColumnMode: normalizeMoveColumnMode(sd.moveStudentColumnMode)
  };
}

function normalizeMoveColumnMode(mode) {
  if (mode === 'odd' || mode === 'even') return mode;
  return 'even';
}

function getHomeColumnMode(moveMode) {
  return moveMode === 'odd' ? 'even' : 'odd';
}

function isMoveColumn(col, moveMode) {
  return moveMode === 'odd' ? col % 2 === 1 : col % 2 === 0;
}

/** 교실 좌석: 본반·이동반 열 분리 (열 단위 위→아래 채움, 번호 각각 1번부터) */
function usesSplitColumnLayout(roomName) {
  return !!parseClassRoomName(roomName);
}

/** 교실 좌석번호 표기: 본반1~N, 이동1~N */
function formatSeatNumberLabel(seatNo, options = {}) {
  if (seatNo == null || seatNo === '' || seatNo === '-') return '-';
  const n = parseInt(seatNo, 10);
  if (!Number.isFinite(n)) return String(seatNo);

  const { seatGroup, isMoveStudent, roomName } = options;
  if (!roomName || !usesSplitColumnLayout(roomName)) return String(n);

  const isMove = seatGroup === 'move' || (seatGroup !== 'home' && !!isMoveStudent);
  return isMove ? `이동${n}` : `본반${n}`;
}

function formatSeatLabelForStudent(studentId, seatNo, roomName) {
  const fs = appState.fixedRoomSeats?.[studentId];
  return formatSeatNumberLabel(seatNo, {
    seatGroup: fs?.seatGroup,
    isMoveStudent: fs?.isMoveStudent,
    roomName: roomName || fs?.roomName
  });
}

function getSplitSeatLabelAtCoord(roomName, row, col, seatConfig) {
  if (!usesSplitColumnLayout(roomName)) return null;
  const { rows, cols } = seatConfig;
  const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const groupParity = isMoveColumn(col, moveMode) ? moveMode : getHomeColumnMode(moveMode);
  const pos = generateGroupColumnPositions(rows, cols, groupParity)
    .find(p => p.row === row && p.col === col);
  if (!pos) return '';
  return formatSeatNumberLabel(pos.seatNo, {
    seatGroup: isMoveColumn(col, moveMode) ? 'move' : 'home',
    roomName
  });
}

function generateGroupColumnPositions(rows, cols, parity) {
  const colList = [];
  for (let c = 1; c <= cols; c++) {
    if (parity === 'odd' && c % 2 === 1) colList.push(c);
    if (parity === 'even' && c % 2 === 0) colList.push(c);
  }
  const positions = [];
  let seatNo = 1;
  colList.forEach(c => {
    for (let r = 1; r <= rows; r++) {
      positions.push({ seatNo, row: r, col: c });
      seatNo++;
    }
  });
  return positions;
}

function getSplitSeatCapacities(rows, cols, moveMode = 'even') {
  const move = normalizeMoveColumnMode(moveMode);
  const home = getHomeColumnMode(move);
  return {
    home: generateGroupColumnPositions(rows, cols, home).length,
    move: generateGroupColumnPositions(rows, cols, move).length,
    total: generateGroupColumnPositions(rows, cols, home).length
      + generateGroupColumnPositions(rows, cols, move).length
  };
}

function assignSeatsSplitByColumn(roomName, studentIds, seatConfig) {
  const { rows, cols } = seatConfig;
  const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const homeMode = getHomeColumnMode(moveMode);
  const homePositions = generateGroupColumnPositions(rows, cols, homeMode);
  const movePositions = generateGroupColumnPositions(rows, cols, moveMode);
  const sorted = sortStudentsByClass(studentIds);

  const homeStudents = sorted.filter(id => !isMoveTargetStudent(appState.students[id]));
  const moveStudents = sorted.filter(id => isMoveTargetStudent(appState.students[id]));
  const results = [];

  homeStudents.forEach((id, idx) => {
    const pos = homePositions[idx];
    if (!pos) return;
    results.push({
      studentId: id,
      seatNo: pos.seatNo,
      row: pos.row,
      col: pos.col,
      isMoveStudent: false,
      seatGroup: 'home'
    });
  });

  moveStudents.forEach((id, idx) => {
    const pos = movePositions[idx];
    if (!pos) return;
    results.push({
      studentId: id,
      seatNo: pos.seatNo,
      row: pos.row,
      col: pos.col,
      isMoveStudent: true,
      seatGroup: 'move'
    });
  });

  return results;
}

function generateSeatPositions(rows, cols, fillDirection) {
  const coords = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      coords.push({ row: r, col: c });
    }
  }

  let ordered;
  switch (fillDirection) {
    case 'back-to-front':
      ordered = [];
      for (let r = rows; r >= 1; r--) {
        for (let c = 1; c <= cols; c++) ordered.push({ row: r, col: c });
      }
      break;
    case 'left-to-right':
      ordered = [];
      for (let c = 1; c <= cols; c++) {
        for (let r = 1; r <= rows; r++) ordered.push({ row: r, col: c });
      }
      break;
    case 'right-to-left':
      ordered = [];
      for (let c = cols; c >= 1; c--) {
        for (let r = 1; r <= rows; r++) ordered.push({ row: r, col: c });
      }
      break;
    case 'front-to-back':
    default:
      ordered = coords;
      break;
  }

  return ordered.map((pos, idx) => ({
    seatNo: idx + 1,
    row: pos.row,
    col: pos.col
  }));
}

function isMoverPreferredColumn(col, mode) {
  if (mode === 'odd') return col % 2 === 1;
  if (mode === 'even') return col % 2 === 0;
  return true;
}

function assignSeatsForRoom(roomName, studentIds, context, seatConfig) {
  if (usesSplitColumnLayout(roomName)) {
    return assignSeatsSplitByColumn(roomName, studentIds, seatConfig);
  }

  const positions = generateSeatPositions(seatConfig.rows, seatConfig.cols, seatConfig.fillDirection);
  const sorted = sortStudentsByClass(studentIds);
  const results = [];
  const used = new Set();

  const takeFromPools = (pools) => {
    for (const pool of pools) {
      for (const p of pool) {
        const k = `${p.row}-${p.col}`;
        if (!used.has(k)) {
          used.add(k);
          return p;
        }
      }
    }
    return null;
  };

  const mode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const moverPositions = positions.filter(p => isMoverPreferredColumn(p.col, mode));
  const nonMoverPositions = positions.filter(p => !isMoverPreferredColumn(p.col, mode));

  const movers = sorted.filter(id => isMoveTargetStudent(appState.students[id]));
  const nonMovers = sorted.filter(id => !isMoveTargetStudent(appState.students[id]));

  movers.forEach(id => {
    const pos = takeFromPools([moverPositions, nonMoverPositions, positions]);
    if (!pos) return;
    results.push({
      studentId: id,
      seatNo: pos.seatNo,
      row: pos.row,
      col: pos.col,
      isMoveStudent: true
    });
  });

  nonMovers.forEach(id => {
    const pos = takeFromPools([nonMoverPositions, moverPositions, positions]);
    if (!pos) return;
    results.push({
      studentId: id,
      seatNo: pos.seatNo,
      row: pos.row,
      col: pos.col,
      isMoveStudent: false
    });
  });

  return results;
}

/* ========== Whole-grade exam detection & auto assign ========== */

function isWholeGradeExam(group) {
  const { grade, day, period, subject } = group;
  const timetableSubjects = appState.timetable[grade]?.[day]?.[period] || [];
  if (timetableSubjects.length !== 1) return false;

  const gradeStudents = Object.values(appState.students).filter(s => s.grade === grade);
  if (!gradeStudents.length) return false;

  const ratio = group.students.length / gradeStudents.length;
  return ratio >= 0.8;
}

function autoAssignWholeGradeExams() {
  appState.examGroups.forEach(group => {
    if (!isWholeGradeExam(group)) return;

    const key = examGroupKey(group.grade, group.day, group.period, group.subject);
    const roomMap = {};

    group.students.forEach(id => {
      const st = appState.students[id];
      if (!st) return;
      const room = getDefaultExamRoomForStudent(st, group.subject, group.day, group.period);
      if (!roomMap[room]) roomMap[room] = [];
      roomMap[room].push(id);
    });

    appState.roomAssignments[key] = {
      grade: group.grade,
      day: group.day,
      period: group.period,
      subject: group.subject,
      autoAssigned: true,
      rooms: Object.entries(roomMap).map(([roomName, students]) => ({
        roomName,
        students: sortStudentsByClass(students)
      }))
    };
  });
}

function getActualRoomForStudent(groupKey, studentId) {
  if (appState.fixedRoomSeats?.[studentId]) {
    return appState.fixedRoomSeats[studentId].roomName;
  }
  const assignment = appState.roomAssignments[groupKey];
  if (!assignment) return getFixedRoomForStudent(studentId);
  for (const r of assignment.rooms) {
    if (r.students.includes(studentId)) return r.roomName;
  }
  return '';
}

function getSeatInfoForStudent(studentId, day, period, subject) {
  const fs = appState.fixedRoomSeats?.[studentId];
  if (fs) {
    const seats = appState.seatAssignments[studentId] || [];
    const slot = seats.find(s => s.day === day && s.period === period);
    return {
      ...fs,
      day,
      period,
      subject: slot?.subject || subject || ''
    };
  }
  const seats = appState.seatAssignments[studentId] || [];
  return seats.find(s => s.day === day && s.period === period && (!subject || s.subject === subject)) || null;
}

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

function renderMovementRules() {
  const container = $('#movement-rules-container');
  container.innerHTML = [1, 2, 3].map(g => {
    const rule = appState.examRules.movementRules[g];
    return `
      <div class="movement-grade-block" data-grade="${g}">
        <div class="movement-grade-head">
          <h3>${g}학년 이동 설정</h3>
          <label class="movement-enable-inline">
            <input type="checkbox" class="movement-enabled" data-grade="${g}" ${rule.enabled ? 'checked' : ''}>
            다른 학년 교실로 이동
          </label>
        </div>
        <div class="form-inline-row movement-fields-row">
          <label>이동 대상 학년
            <select class="movement-target" data-grade="${g}">
              <option value="">없음</option>
              ${[1, 2, 3].filter(t => t !== g).map(t => `<option value="${t}" ${rule.targetGrade === t ? 'selected' : ''}>${t}학년 교실</option>`).join('')}
            </select>
          </label>
          <label>번호 범위 시작 <input type="number" class="movement-start" data-grade="${g}" value="${rule.rangeStart}" min="1"></label>
          <label>번호 범위 끝 <input type="number" class="movement-end" data-grade="${g}" value="${rule.rangeEnd}" min="1"></label>
        </div>
      </div>`;
  }).join('');
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

function applyExamMeta() {
  if (guardIfLocked('시험 규칙 수정')) return;
  collectMetaFromDOM();
  renderExamDates();
  renderUnifiedTimetable();
  refreshOutputFilters();
  syncStateToWindow();
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
    const enabled = document.querySelector(`.movement-enabled[data-grade="${g}"]`)?.checked;
    const target = document.querySelector(`.movement-target[data-grade="${g}"]`)?.value;
    const start = parseInt(document.querySelector(`.movement-start[data-grade="${g}"]`)?.value, 10);
    const end = parseInt(document.querySelector(`.movement-end[data-grade="${g}"]`)?.value, 10);
    const fromNumber = start || 1;
    const toNumber = end || 14;
    appState.examRules.movementRules[g] = {
      enabled: !!enabled,
      targetGrade: target ? parseInt(target, 10) : null,
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
}

function saveMovementRules() {
  if (guardIfLocked('이동반 규칙 수정')) return;
  collectMovementRulesFromDOM();
  renderMovementPreview();
  syncStateToWindow();
}

function saveSeatDefaults() {
  if (guardIfLocked('좌석 규칙 수정')) return;
  collectSeatDefaultsFromDOM();
  renderSeatConfigPreview();
  syncStateToWindow();
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

  Object.values(appState.roomAssignments || {}).forEach(a => {
    a.rooms.forEach(r => {
      r.students = r.students.filter(sid => !toRemove.has(sid));
    });
    a.rooms = a.rooms.filter(r => r.students.length > 0);
  });

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
  renderStudentSummary();
  renderSubjectStats();
  renderStudentList();
  renderMovementPreview();
  renderRoomOccupancyPanel();
  markPlacementDirty();
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
    showEl(errorEl, false);
    rebuildMoveTargetCache();
    renderStudentSummary();
    renderSubjectStats();
    renderStudentList();
    renderMovementPreview();
    renderRoomOccupancyPanel();
    syncStateToWindow();
  } catch (err) {
    statusEl.textContent = '오류';
    statusEl.classList.remove('done');
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

/* ========== Step 3: Schedules & Assignment ========== */

function subjectMatches(studentSubject, examSubject) {
  const a = normalizeSubject(studentSubject);
  const b = normalizeSubject(examSubject);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function generateSchedulesAndGroups() {
  if (guardIfLocked('시험 일정·응시자 생성')) return;
  const schedules = {};
  const groupsMap = {};

  Object.values(appState.students).forEach(st => {
    const gradeTimetable = appState.timetable[st.grade];
    if (!gradeTimetable) return;

    schedules[st.studentId] = [];

    for (const [dayStr, periods] of Object.entries(gradeTimetable)) {
      const day = parseInt(dayStr, 10);
      for (const [periodStr, subjects] of Object.entries(periods)) {
        const period = parseInt(periodStr, 10);
        if (!subjects || !subjects.length) continue;

        subjects.forEach(examSubject => {
          const matched = st.subjects.find(s => subjectMatches(s, examSubject));
          if (matched) {
            const entry = {
              grade: st.grade,
              day,
              period,
              subject: examSubject,
              courseRoom: st.courseRooms[matched] || '',
              status: 'exam'
            };
            schedules[st.studentId].push(entry);

            const gKey = examGroupKey(st.grade, day, period, examSubject);
            if (!groupsMap[gKey]) {
              groupsMap[gKey] = {
                grade: st.grade,
                day,
                period,
                subject: examSubject,
                students: []
              };
            }
            if (!groupsMap[gKey].students.includes(st.studentId)) {
              groupsMap[gKey].students.push(st.studentId);
            }
          }
        });
      }
    }
  });

  appState.studentExamSchedules = schedules;
  appState.examGroups = Object.values(groupsMap).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    if (a.day !== b.day) return a.day - b.day;
    return a.period - b.period;
  });

  rebuildMoveTargetCache();
  if (hasFixedRoomSeats()) {
    rebuildSeatAssignmentsFromFixed();
    syncDerivedRoomAssignments();
  }

  const wholeGradeCount = appState.examGroups.filter(isWholeGradeExam).length;
  const resultEl = $('#schedule-gen-result');
  resultEl.textContent = `생성 완료: 학생 ${Object.keys(schedules).length}명, 응시 그룹 ${appState.examGroups.length}개 (전체응시 ${wholeGradeCount}개)`;
  showEl(resultEl, true);

  populateExamGroupFilters();
  renderExamGroupsTable();
  renderRoomOccupancyPanel();
  refreshOutputFilters();
  syncStateToWindow();
}

function renderExamGroupsTable() {
  const gradeFilter = $('#exam-group-grade-filter').value;
  const dayFilter = $('#exam-group-day-filter').value;

  const groups = appState.examGroups.filter(g => {
    if (gradeFilter && g.grade !== parseInt(gradeFilter, 10)) return false;
    if (dayFilter && g.day !== parseInt(dayFilter, 10)) return false;
    return true;
  });

  let html = '';
  groups.forEach(g => {
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const wholeGrade = isWholeGradeExam(g);
    html += `<h4 style="margin:0.75rem 0 0.35rem">${g.grade}학년 ${g.day}일차 ${g.period}교시 — ${g.subject} (${g.students.length}명)${wholeGrade ? ' <span class="validation-ok" style="font-size:0.8rem">[전체응시·자동배정]</span>' : ''}</h4>`;
    html += `<table class="data-table"><thead><tr>
      <th>학번</th><th>이름</th><th>원반</th><th>번호</th><th>나이스 편성강의실</th>
      <th>이동대상</th><th>추천 고사실</th><th>실제 고사실</th><th>좌석번호</th>
    </tr></thead><tbody>`;

    sortStudentsByClass(g.students).forEach(id => {
      const s = appState.students[id];
      if (!s) return;
      const isMove = isMoveTargetStudent(s);
      const recommended = getFixedRoomForStudent(id);
      const actual = getActualRoomForStudent(key, id) || recommended;
      const seatInfo = appState.fixedRoomSeats[id] || getSeatInfoForStudent(id, g.day, g.period, g.subject);
      const courseRoom = s.courseRooms[g.subject] || Object.values(s.courseRooms).find(Boolean) || '';

      html += `<tr>
        <td>${id}</td><td>${s.name}</td><td>${s.grade}-${s.classNo}</td><td>${s.number}</td>
        <td>${courseRoom}</td>
        <td>${isMove ? '이동' : '-'}</td>
        <td>${recommended}</td>
        <td>${actual || '<span class="validation-warn">미배정</span>'}</td>
        <td>${seatInfo ? formatSeatLabelForStudent(id, seatInfo.seatNo, actual || recommended) : '-'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  });

  $('#exam-groups-table').innerHTML = html || '<p class="hint">응시 그룹 없음. 시험 일정을 먼저 생성하세요.</p>';
}

function populateExamGroupFilters() {
  const gradeSel = $('#exam-group-grade-filter');
  const daySel = $('#exam-group-day-filter');
  const grades = [...new Set(appState.examGroups.map(g => g.grade))].sort();
  const days = [...new Set(appState.examGroups.map(g => g.day))].sort((a, b) => a - b);
  gradeSel.innerHTML = '<option value="">전체</option>' + grades.map(g => `<option value="${g}">${g}학년</option>`).join('');
  daySel.innerHTML = '<option value="">전체</option>' + days.map(d => `<option value="${d}">${d}일차</option>`).join('');
}

function renderRoomAssignmentPanel() {
  const panel = $('#room-assignment-panel');
  if (!panel) return;
  if (!appState.examGroups.length) {
    panel.innerHTML = '<p class="hint">응시 그룹이 없습니다.</p>';
    return;
  }

  const roomOptions = sortClassRoomNames(appState.rooms.map(r => r.name))
    .map(name => {
      const r = getRoomByName(name);
      return r ? `<option value="${r.name}">${r.name} (${roomTypeLabel(r.type)}, ${r.capacity}석)</option>` : '';
    })
    .join('');

  panel.innerHTML = appState.examGroups.map(g => {
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const existing = appState.roomAssignments[key];
    const assignedIds = new Set();
    if (existing) {
      existing.rooms.forEach(r => r.students.forEach(id => assignedIds.add(id)));
    }
    const unassigned = g.students.filter(id => !assignedIds.has(id));

    const wholeGrade = isWholeGradeExam(g);
    return `
      <div class="assignment-block" data-key="${key}">
        <h4>${g.grade}학년 ${g.day}일차 ${g.period}교시 — ${g.subject} (${g.students.length}명)${wholeGrade ? ' [전체응시·자동배정됨]' : ' [선택과목·수동배정]'}</h4>
        <div class="assignment-controls">
          <select class="assign-room-select" data-key="${key}">
            <option value="">고사실 선택</option>${roomOptions}
          </select>
          <button type="button" class="btn btn-sm btn-primary btn-assign-all" data-key="${key}">전원 배정</button>
          <button type="button" class="btn btn-sm btn-secondary btn-assign-unassigned" data-key="${key}">미배정만 배정</button>
          ${!wholeGrade ? `<button type="button" class="btn btn-sm btn-secondary btn-assign-recommended" data-key="${key}">추천 고사실별 배정</button>` : ''}
          <span class="${unassigned.length ? 'validation-warn' : 'validation-ok'}">
            미배정: ${unassigned.length}명
          </span>
        </div>
        <div class="student-chips">
          ${sortStudentsByClass(g.students).map(id => {
            const s = appState.students[id];
            const isAssigned = assignedIds.has(id);
            return `<span class="chip ${isAssigned ? 'assigned' : 'unassigned'}">${s?.name || id}</span>`;
          }).join('')}
        </div>
        ${existing ? renderAssignmentDetail(existing) : ''}
      </div>`;
  }).join('');
}

function renderAssignmentDetail(assignment) {
  return assignment.rooms.map(r => {
    const room = getRoomByName(r.roomName);
    const over = room && r.students.length > room.capacity;
    return `<p style="margin-top:0.3rem;font-size:0.85rem" class="${over ? 'validation-error' : ''}">
      → ${r.roomName}: ${r.students.length}명 배정${over ? ' (정원 초과!)' : ''}
    </p>`;
  }).join('');
}

function assignStudentsToRoom(key, studentIds, roomName) {
  if (!roomName) { alert('고사실을 선택하세요.'); return; }

  const parts = key.split('-');
  const grade = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const period = parseInt(parts[2], 10);
  const subject = parts.slice(3).join('-');

  if (!appState.roomAssignments[key]) {
    appState.roomAssignments[key] = { grade, day, period, subject, rooms: [] };
  }
  const assignment = appState.roomAssignments[key];
  let roomEntry = assignment.rooms.find(r => r.roomName === roomName);
  if (!roomEntry) {
    roomEntry = { roomName, students: [] };
    assignment.rooms.push(roomEntry);
  }
  studentIds.forEach(id => {
    assignment.rooms.forEach(r => {
      r.students = r.students.filter(sid => sid !== id);
    });
    if (!roomEntry.students.includes(id)) roomEntry.students.push(id);
  });
  assignment.rooms = assignment.rooms.filter(r => r.students.length > 0);
  renderRoomAssignmentPanel();
  renderExamGroupsTable();
  syncStateToWindow();
}

function assignAllForGroup(key, onlyUnassigned) {
  if (guardIfLocked('시험실 배정')) return;
  const group = appState.examGroups.find(g => examGroupKey(g.grade, g.day, g.period, g.subject) === key);
  if (!group) return;
  const select = document.querySelector(`.assign-room-select[data-key="${key}"]`);
  const roomName = select?.value;
  if (!roomName) { alert('고사실을 선택하세요.'); return; }

  let ids = group.students;
  if (onlyUnassigned) {
    const existing = appState.roomAssignments[key];
    const assigned = new Set();
    if (existing) existing.rooms.forEach(r => r.students.forEach(id => assigned.add(id)));
    ids = ids.filter(id => !assigned.has(id));
  }
  assignStudentsToRoom(key, ids, roomName);
}

function assignByRecommendedRooms(key) {
  if (guardIfLocked('시험실 배정')) return;
  const group = appState.examGroups.find(g => examGroupKey(g.grade, g.day, g.period, g.subject) === key);
  if (!group) return;

  const byRoom = {};
  group.students.forEach(id => {
    const st = appState.students[id];
    if (!st) return;
    const room = getDefaultExamRoomForStudent(st, group.subject, group.day, group.period);
    if (!byRoom[room]) byRoom[room] = [];
    byRoom[room].push(id);
  });

  const parts = key.split('-');
  const grade = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const period = parseInt(parts[2], 10);
  const subject = parts.slice(3).join('-');

  appState.roomAssignments[key] = {
    grade, day, period, subject,
    rooms: Object.entries(byRoom).map(([roomName, students]) => ({
      roomName,
      students: sortStudentsByClass(students)
    }))
  };
  renderRoomAssignmentPanel();
  renderExamGroupsTable();
  syncStateToWindow();
}

function assignSeats() {
  if (guardIfLocked('좌석 배정')) return;
  if (!Object.keys(appState.students).length) {
    alert('학생 데이터를 먼저 업로드하세요.');
    return;
  }
  if (!getClassRooms().length) {
    alert('Step 1에서 학년별 교실(반)을 먼저 생성하세요.');
    return;
  }
  if (!appState.examGroups.length) {
    alert('시험 일정·응시자를 먼저 생성하세요.');
    return;
  }

  const seatConfig = getSeatConfig();
  const { count, overflowCount } = assignFixedSeats();
  const slotCount = Object.values(appState.seatAssignments).reduce((sum, arr) => sum + arr.length, 0);
  const resultEl = $('#seat-assign-result');
  let msg = `고정 좌석 배정 완료: 학생 ${count}명, 교시 슬롯 ${slotCount}건 (채움: ${seatConfig.fillDirection}, 이동열: ${seatConfig.moveStudentColumnMode})`;
  if (overflowCount) msg += ` — 좌석 수 초과 교실 ${overflowCount}개`;
  resultEl.textContent = msg;
  showEl(resultEl, true);
  renderExamGroupsTable();
  renderRoomOccupancyPanel();
  markPlacementDirty();
  syncStateToWindow();
}

/* ========== Step 5: Validation ========== */

function runValidation() {
  const results = [];
  const students = Object.values(appState.students);

  if (students.length === 0) {
    results.push({ level: 'error', msg: '업로드된 학생이 0명입니다.' });
  } else {
    results.push({ level: 'ok', msg: `학생 ${students.length}명 등록됨` });
  }

  const allSubjects = new Set();
  students.forEach(s => s.subjects.forEach(sub => allSubjects.add(sub)));

  const missingSubjects = [];
  [1, 2, 3].forEach(g => {
    const tt = appState.timetable[g] || {};
    Object.values(tt).forEach(periods => {
      Object.values(periods).forEach(subjects => {
        subjects.forEach(sub => {
          const found = [...allSubjects].some(s => subjectMatches(s, sub));
          if (!found) missingSubjects.push(`${g}학년: ${sub}`);
        });
      });
    });
  });
  if (missingSubjects.length) {
    results.push({ level: 'warn', msg: `시간표 과목 중 학생 데이터에 없는 과목: ${missingSubjects.slice(0, 5).join(', ')}${missingSubjects.length > 5 ? '...' : ''}` });
  } else {
    results.push({ level: 'ok', msg: '시간표 과목이 학생 데이터와 일치합니다.' });
  }

  const noSchedule = students.filter(s => {
    const sch = appState.studentExamSchedules[s.studentId];
    return !sch || sch.length === 0;
  });
  if (noSchedule.length) {
    results.push({ level: 'warn', msg: `시험 일정이 없는 학생 ${noSchedule.length}명` });
  } else if (students.length) {
    results.push({ level: 'ok', msg: '모든 학생에게 시험 일정이 있습니다.' });
  }

  const overflows = findCapacityOverflowDetails();
  if (overflows.length) {
    results.push({ level: 'error', msg: `교실 정원/좌석 초과 ${overflows.length}건` });
  } else if (hasFixedRoomSeats() || getClassRooms().length) {
    results.push({ level: 'ok', msg: '교실별 정원·좌석 수 용량 이내' });
  }

  const seatDupes = findDuplicateSeats();
  if (seatDupes.length) {
    results.push({ level: 'error', msg: `좌석번호 중복 ${seatDupes.length}건` });
  } else if (hasFixedRoomSeats()) {
    results.push({ level: 'ok', msg: '좌석번호 중복 없음' });
  }

  const coordDupes = findDuplicateSeatCoords();
  if (coordDupes.length) {
    results.push({ level: 'error', msg: `좌석 좌표(row/col) 중복 ${coordDupes.length}건` });
  } else if (hasFixedRoomSeats()) {
    results.push({ level: 'ok', msg: '좌석 좌표 중복 없음' });
  }

  const unassignedFixed = getUnassignedStudentCount();
  if (unassignedFixed) {
    results.push({ level: 'error', msg: `고정 좌석 미배정 학생 ${unassignedFixed}명` });
  } else if (hasFixedRoomSeats()) {
    results.push({ level: 'ok', msg: '모든 학생 고정 좌석 배정 완료' });
  }

  let moveCountMismatch = 0;
  [1, 2, 3].forEach(g => {
    const rule = getMoveRules(g);
    if (!rule.enabled) return;
    const classNos = [...new Set(Object.values(appState.students).filter(s => s.grade === g).map(s => s.classNo))];
    const targetCount = rule.toNumber - rule.fromNumber + 1;
    classNos.forEach(classNo => {
      const ids = getMoveTargetStudentIdsByClass(g, classNo);
      if (ids.length !== targetCount) moveCountMismatch++;
    });
  });
  if (moveCountMismatch) {
    results.push({ level: 'warn', msg: `이동 대상 인원이 목표와 다른 학급 ${moveCountMismatch}개 (결번 보정 확인)` });
  }

  const seatConfig = getSeatConfig();
  const moveMode = seatConfig.moveStudentColumnMode;
  const moveColLabel = moveMode === 'odd' ? '홀수열' : '짝수열';
  const homeColLabel = getHomeColumnMode(moveMode) === 'odd' ? '홀수열' : '짝수열';
  let moveColMismatch = 0;
  if (hasFixedRoomSeats()) {
    Object.values(appState.fixedRoomSeats).forEach(fs => {
      if (!usesSplitColumnLayout(fs.roomName) || !fs.col) return;
      const isMoveCol = isMoveColumn(fs.col, moveMode);
      if (!!fs.isMoveStudent !== isMoveCol) moveColMismatch++;
    });
    if (moveColMismatch) {
      results.push({ level: 'warn', msg: `본반/이동반 열 배치 불일치 ${moveColMismatch}건` });
    } else {
      results.push({ level: 'ok', msg: `본반(${homeColLabel})·이동반(${moveColLabel}) 배치 정상` });
    }
  } else {
    Object.values(appState.seatAssignments).forEach(seats => {
      seats.forEach(seat => {
        if (!seat.isMoveStudent || !seat.col) return;
        const ok = isMoverPreferredColumn(seat.col, moveMode);
        if (!ok) moveColMismatch++;
      });
    });
    if (moveColMismatch) {
      results.push({ level: 'warn', msg: `이동 학생이 지정 열이 아닌 곳에 배치됨 ${moveColMismatch}건 (정원 초과 등으로 인한 overflow 가능)` });
    } else if (Object.keys(appState.seatAssignments).length) {
      results.push({ level: 'ok', msg: '이동 학생 열 배치 규칙 준수' });
    }
  }

  if (!hasFixedRoomSeats() && appState.examGroups.length) {
    let unassignedTotal = 0;
    appState.examGroups.forEach(g => {
      const key = examGroupKey(g.grade, g.day, g.period, g.subject);
      const existing = appState.roomAssignments[key];
      const assigned = new Set();
      if (existing) existing.rooms.forEach(r => r.students.forEach(id => assigned.add(id)));
      unassignedTotal += g.students.filter(id => !assigned.has(id)).length;
    });
    if (unassignedTotal) {
      results.push({ level: 'warn', msg: `미배정 학생 ${unassignedTotal}건 (교시·과목별)` });
    } else {
      results.push({ level: 'ok', msg: '모든 응시자가 배정되었습니다.' });
    }
  }

  const placementVal = runPlacementValidation();
  placementVal.errors.forEach(msg => results.push({ level: 'error', msg }));
  placementVal.warnings.forEach(msg => results.push({ level: 'warn', msg }));
  placementVal.oks.forEach(msg => results.push({ level: 'ok', msg: `[자료검증] ${msg}` }));

  const container = $('#validation-results');
  container.innerHTML = results.map(r =>
    `<div class="validation-item validation-${r.level}">${r.level === 'ok' ? '✓' : r.level === 'warn' ? '⚠' : '✗'} ${r.msg}</div>`
  ).join('');
}

function findDuplicateSeats() {
  if (hasFixedRoomSeats()) {
    return findDuplicateFixedSeats().map(d => `${d.roomName}-${d.seatNo}`);
  }
  const seen = {};
  const dupes = [];
  Object.entries(appState.seatAssignments).forEach(([studentId, seats]) => {
    seats.forEach(seat => {
      const key = `${seat.day}-${seat.period}-${seat.roomName}-${seat.seatNo}`;
      if (seen[key]) dupes.push(key);
      else seen[key] = studentId;
    });
  });
  return dupes;
}

function findDuplicateSeatCoords() {
  if (hasFixedRoomSeats()) {
    const seen = {};
    const dupes = [];
    Object.values(appState.fixedRoomSeats).forEach(fs => {
      if (!fs.row || !fs.col) return;
      const key = `${fs.roomName}-${fs.row}-${fs.col}`;
      if (seen[key]) dupes.push(key);
      else seen[key] = true;
    });
    return dupes;
  }
  const seen = {};
  const dupes = [];
  Object.entries(appState.seatAssignments).forEach(([, seats]) => {
    seats.forEach(seat => {
      if (!seat.row || !seat.col) return;
      const key = `${seat.day}-${seat.period}-${seat.roomName}-${seat.row}-${seat.col}`;
      if (seen[key]) dupes.push(key);
      else seen[key] = true;
    });
  });
  return dupes;
}

/* ========== Step 4: Placement Editor ========== */

const ABSENCE_TYPES = ['병결', '공결', '미인정결', '별도시험실', '기타'];
const PLACEMENT_PAGE_SIZE = 80;

let placementPage = 1;
let placementRoomIndex = 0;
let placementEditorDirty = true;
let placementFilterDelegationBound = false;
let placementPagerDelegationBound = false;
let placementRoomNavBound = false;

function placementOverrideKey(studentId, day, period) {
  return `${studentId}-${day}-${period}`;
}

function inferAttendanceType(note) {
  const n = (note || '').trim();
  if (!n) return '정상';
  for (const t of ABSENCE_TYPES) {
    if (n.includes(t)) return t;
  }
  return '기타';
}

function buildAttendanceNote(attendanceType, memo) {
  const memoTrim = (memo || '').trim();
  if (!attendanceType || attendanceType === '정상') return memoTrim;
  return memoTrim ? `${attendanceType} ${memoTrim}` : attendanceType;
}

function getBaseSeatEntry(studentId, day, period) {
  const arr = appState.seatAssignments[studentId];
  if (!arr) return null;
  return arr.find(s => s.day === day && s.period === period) || null;
}

function getEffectivePlacement(studentId, day, period) {
  const base = getBaseSeatEntry(studentId, day, period);
  if (!base) return null;
  const st = appState.students[studentId];
  const key = placementOverrideKey(studentId, day, period);
  const ov = appState.placementOverrides[key] || {};
  const noteKey = `${studentId}-${day}-${period}`;
  const baseNote = appState.attendanceNotes[noteKey] || '';
  const attendanceType = ov.attendanceType ?? inferAttendanceType(baseNote);
  const memo = ov.memo !== undefined ? ov.memo : (attendanceType === '정상' ? baseNote : '');
  return {
    studentId,
    grade: base.grade,
    day,
    period,
    subject: base.subject,
    roomName: ov.roomName ?? base.roomName,
    seatNo: ov.seatNo ?? base.seatNo,
    attendanceType,
    memo,
    note: buildAttendanceNote(attendanceType, memo),
    name: st?.name || '',
    homeClass: st ? `${st.grade}-${st.classNo}` : '',
    number: st?.number ?? '',
    row: base.row,
    col: base.col,
    isMoveStudent: base.isMoveStudent
  };
}

function setPlacementOverride(studentId, day, period, patch) {
  if (guardIfLocked('자료검증 수정')) return;
  const key = placementOverrideKey(studentId, day, period);
  const prev = getEffectivePlacement(studentId, day, period);
  if (!prev) return;

  appState.placementOverrides[key] = {
    ...(appState.placementOverrides[key] || {}),
    ...patch
  };

  syncPlacementToSources(studentId, day, period);

  const next = getEffectivePlacement(studentId, day, period);
  Object.keys(patch).forEach(field => {
    if (prev[field] !== next[field]) {
      recordPlacementChange(prev.name, field, prev[field], next[field]);
    }
  });
  syncStateToWindow();
}

function syncPlacementToSources(studentId, day, period) {
  const eff = getEffectivePlacement(studentId, day, period);
  if (!eff) return;

  if (appState.fixedRoomSeats[studentId]) {
    appState.fixedRoomSeats[studentId] = {
      ...appState.fixedRoomSeats[studentId],
      roomName: eff.roomName,
      seatNo: parseInt(eff.seatNo, 10) || appState.fixedRoomSeats[studentId].seatNo
    };
    rebuildSeatAssignmentsFromFixed();
    syncDerivedRoomAssignments();
  } else {
    const arr = appState.seatAssignments[studentId];
    if (arr) {
      const idx = arr.findIndex(s => s.day === day && s.period === period);
      if (idx >= 0) {
        arr[idx] = {
          ...arr[idx],
          roomName: eff.roomName,
          seatNo: parseInt(eff.seatNo, 10) || arr[idx].seatNo
        };
      }
    }
  }

  const noteKey = `${studentId}-${day}-${period}`;
  appState.attendanceNotes[noteKey] = eff.note;
}

function recordPlacementChange(studentName, field, fromVal, toVal) {
  const labels = {
    roomName: '시험실',
    seatNo: '좌석번호',
    attendanceType: '결시유형',
    memo: '비고'
  };
  appState.placementChangeHistory.unshift({
    at: new Date().toISOString(),
    studentName,
    field: labels[field] || field,
    from: fromVal,
    to: toVal
  });
  if (appState.placementChangeHistory.length > 20) {
    appState.placementChangeHistory = appState.placementChangeHistory.slice(0, 20);
  }
}

function buildPlacementRecordFast(studentId, seat) {
  const st = appState.students[studentId];
  const key = placementOverrideKey(studentId, seat.day, seat.period);
  const ov = appState.placementOverrides[key] || {};
  const noteKey = `${studentId}-${seat.day}-${seat.period}`;
  const baseNote = appState.attendanceNotes[noteKey] || '';
  const attendanceType = ov.attendanceType ?? inferAttendanceType(baseNote);
  const memo = ov.memo !== undefined ? ov.memo : (attendanceType === '정상' ? baseNote : '');
  return {
    studentId,
    grade: seat.grade,
    day: seat.day,
    period: seat.period,
    subject: seat.subject,
    roomName: ov.roomName ?? seat.roomName,
    seatNo: ov.seatNo ?? seat.seatNo,
    attendanceType,
    memo,
    name: st?.name || '',
    homeClass: st ? `${st.grade}-${st.classNo}` : '',
    number: st?.number ?? ''
  };
}

function markPlacementDirty() {
  placementEditorDirty = true;
}

function getStudentSeatGroup(studentId) {
  const fs = appState.fixedRoomSeats?.[studentId];
  if (fs) return fs.seatGroup || (fs.isMoveStudent ? 'move' : 'home');
  const seat = (appState.seatAssignments[studentId] || [])[0];
  if (seat) return seat.seatGroup || (seat.isMoveStudent ? 'move' : 'home');
  return 'home';
}

function getSeatGroupPrefix(studentId, roomName) {
  if (!usesSplitColumnLayout(roomName)) return '';
  return getStudentSeatGroup(studentId) === 'move' ? '이동' : '본반';
}

function comparePlacementRecords(a, b) {
  if (a.roomName !== b.roomName) return compareClassRoomNames(a.roomName, b.roomName);

  const ga = getStudentSeatGroup(a.studentId) === 'move' ? 1 : 0;
  const gb = getStudentSeatGroup(b.studentId) === 'move' ? 1 : 0;
  if (ga !== gb) return ga - gb;

  const sa = appState.students[a.studentId];
  const sb = appState.students[b.studentId];
  if (sa && sb) {
    if (sa.grade !== sb.grade) return sa.grade - sb.grade;
    if (sa.classNo !== sb.classNo) return sa.classNo - sb.classNo;
    if (sa.number !== sb.number) return sa.number - sb.number;
  }

  const fa = appState.fixedRoomSeats?.[a.studentId];
  const fb = appState.fixedRoomSeats?.[b.studentId];
  if (fa?.col != null && fb?.col != null) {
    if (fa.col !== fb.col) return fa.col - fb.col;
    return (fa.row || 0) - (fb.row || 0);
  }
  return (a.seatNo || 0) - (b.seatNo || 0);
}

function getAllPlacementRecords(filters) {
  const records = [];
  Object.keys(appState.seatAssignments).forEach(studentId => {
    appState.seatAssignments[studentId].forEach(seat => {
      if (filters.day && seat.day !== filters.day) return;
      if (filters.period && seat.period !== filters.period) return;
      const rec = buildPlacementRecordFast(studentId, seat);
      if (filters.room && rec.roomName !== filters.room) return;
      records.push(rec);
    });
  });
  return records.sort(comparePlacementRecords);
}

function placementConflictKey(rec) {
  const fs = appState.fixedRoomSeats?.[rec.studentId];
  if (fs?.row && fs?.col) {
    return `${rec.day}|${rec.period}|${rec.roomName}|${fs.row}|${fs.col}`;
  }
  const group = fs?.seatGroup || (fs?.isMoveStudent ? 'move' : 'home');
  return `${rec.day}|${rec.period}|${rec.roomName}|${group}|${rec.seatNo}`;
}

function buildConflictStudentIds(records) {
  const map = {};
  records.forEach(r => {
    const k = placementConflictKey(r);
    if (!map[k]) map[k] = [];
    map[k].push(r.studentId);
  });
  const ids = new Set();
  Object.values(map).forEach(list => {
    if (list.length > 1) list.forEach(id => ids.add(id));
  });
  return ids;
}

function findSeatConflictDetails() {
  if (hasFixedRoomSeats()) {
    return findDuplicateFixedSeats().map(d => ({
      day: 0,
      period: 0,
      roomName: d.roomName,
      seatNo: d.seatNo,
      students: d.students.map(id => {
        const st = appState.students[id];
        return { studentId: id, name: st?.name || id };
      })
    }));
  }
  const map = {};
  Object.keys(appState.seatAssignments).forEach(studentId => {
    appState.seatAssignments[studentId].forEach(seat => {
      const eff = buildPlacementRecordFast(studentId, seat);
      const k = `${seat.day}|${seat.period}|${eff.roomName}|${eff.seatNo}`;
      if (!map[k]) map[k] = [];
      const st = appState.students[studentId];
      map[k].push({ studentId, name: st?.name || studentId });
    });
  });
  const conflicts = [];
  Object.entries(map).forEach(([k, list]) => {
    if (list.length > 1) {
      const [day, period, roomName, seatNo] = k.split('|');
      conflicts.push({ day: parseInt(day, 10), period: parseInt(period, 10), roomName, seatNo: parseInt(seatNo, 10), students: list });
    }
  });
  return conflicts;
}

function findCapacityOverflowDetails() {
  const seatConfig = getSeatConfig();
  const maxSeats = seatConfig.rows * seatConfig.cols;
  const overflows = [];

  if (appState.examGroups.length || hasFixedRoomSeats()) {
    getClassRooms().forEach(room => {
      const residents = getResidentsForRoom(room.name);
      const caps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
      const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
      const moveCount = residents.length - homeCount;
      if (residents.length > room.capacity) {
        overflows.push({ day: 0, period: 0, roomName: room.name, count: residents.length, capacity: room.capacity });
      }
      if (homeCount > caps.home) {
        overflows.push({ day: 0, period: 0, roomName: room.name, count: homeCount, capacity: caps.home, label: '본반 좌석' });
      }
      if (moveCount > caps.move) {
        overflows.push({ day: 0, period: 0, roomName: room.name, count: moveCount, capacity: caps.move, label: '이동반 좌석' });
      }
    });
    return overflows;
  }

  const sessionMap = {};
  Object.keys(appState.seatAssignments).forEach(studentId => {
    appState.seatAssignments[studentId].forEach(seat => {
      const eff = buildPlacementRecordFast(studentId, seat);
      const sk = `${seat.day}|${seat.period}|${eff.roomName}`;
      if (!sessionMap[sk]) sessionMap[sk] = { day: seat.day, period: seat.period, roomName: eff.roomName, count: 0 };
      sessionMap[sk].count++;
    });
  });

  Object.values(sessionMap).forEach(s => {
    const room = getRoomByName(s.roomName);
    const cap = room?.capacity;
    if (cap && s.count > cap) {
      overflows.push({ ...s, capacity: cap });
    }
  });
  return overflows;
}

function getPlacementBlockingErrors() {
  const errors = [];
  findSeatConflictDetails().forEach(c => {
    const seatLabel = formatSeatNumberLabel(c.seatNo, {
      roomName: c.roomName,
      isMoveStudent: appState.fixedRoomSeats?.[c.students[0]?.studentId]?.isMoveStudent,
      seatGroup: appState.fixedRoomSeats?.[c.students[0]?.studentId]?.seatGroup
    });
    errors.push(`좌석번호 중복: ${c.roomName} 고사실 ${seatLabel} — ${c.students.map(s => s.name).join(', ')}`);
  });
  findCapacityOverflowDetails().forEach(o => {
    errors.push(`정원 초과: ${o.roomName} (정원 ${o.capacity}명, 배정 ${o.count}명)`);
  });
  return errors;
}

function getUnassignedStudentCount() {
  if (appState.examGroups.length) {
    return Object.keys(appState.students).filter(id => !appState.fixedRoomSeats?.[id]).length;
  }
  let count = 0;
  appState.examGroups.forEach(g => {
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const existing = appState.roomAssignments[key];
    const assigned = new Set();
    if (existing) existing.rooms.forEach(r => r.students.forEach(id => assigned.add(id)));
    count += g.students.filter(id => !assigned.has(id)).length;
  });
  return count;
}

function getOperationDiagnosisErrors() {
  return runOperationDiagnosis().items.filter(i => i.status === 'error');
}

function getExportBlockingMessage() {
  const errors = getOperationDiagnosisErrors();
  if (!errors.length) return null;
  const first = errors[0].message;
  if (first.includes('좌석 중복') || first.includes('좌석번호 중복')) {
    return '좌석 중복이 존재하여 출력할 수 없습니다.';
  }
  if (first.includes('정원 초과')) {
    return '정원 초과가 존재하여 출력할 수 없습니다.';
  }
  if (first.includes('미배정') || first.includes('배정')) {
    return `${first} — 출력할 수 없습니다.`;
  }
  if (first.includes('불일치')) {
    return '데이터 불일치가 존재하여 출력할 수 없습니다.';
  }
  return `운영 진단 오류 — ${first}`;
}

function findStudentDuplicateRoomAssignments() {
  const issues = [];
  const byKey = {};
  Object.keys(appState.seatAssignments).forEach(studentId => {
    appState.seatAssignments[studentId].forEach(seat => {
      const eff = getEffectivePlacement(studentId, seat.day, seat.period);
      if (!eff?.roomName) return;
      const k = `${studentId}|${seat.day}|${seat.period}`;
      if (!byKey[k]) byKey[k] = new Set();
      byKey[k].add(eff.roomName);
    });
  });
  Object.entries(byKey).forEach(([k, rooms]) => {
    if (rooms.size > 1) {
      const studentId = k.split('|')[0];
      const st = appState.students[studentId];
      issues.push({
        studentId,
        name: st?.name || studentId,
        day: parseInt(k.split('|')[1], 10),
        period: parseInt(k.split('|')[2], 10),
        rooms: [...rooms]
      });
    }
  });
  return issues;
}

function findDuplicatePeriodExams() {
  const issues = [];
  Object.keys(appState.students).forEach(studentId => {
    const schedule = appState.studentExamSchedules[studentId] || [];
    const map = {};
    schedule.forEach(e => {
      const k = `${e.day}|${e.period}`;
      if (!map[k]) map[k] = [];
      map[k].push(e.subject);
    });
    Object.entries(map).forEach(([k, subjects]) => {
      if (subjects.length > 1) {
        const [day, period] = k.split('|');
        const st = appState.students[studentId];
        issues.push({
          studentId,
          name: st?.name || studentId,
          day: parseInt(day, 10),
          period: parseInt(period, 10),
          subjects
        });
      }
    });
  });
  return issues;
}

function checkOutputConsistency() {
  const issues = [];
  const days = appState.examMeta.days;
  const periods = appState.examMeta.periodsPerDay;

  [1, 2, 3].forEach(grade => {
    for (let day = 1; day <= days; day++) {
      for (let period = 1; period <= periods; period++) {
        getRoomsForSession(grade, day, period).forEach(room => {
          const attCount = getAttendanceRows(grade, day, period, room).length;
          const { seatByCoord } = getSeatDataForSession(grade, day, period, room);
          const seatCount = Object.keys(seatByCoord).length;
          if (attCount !== seatCount) {
            issues.push({
              type: 'attendance-seat',
              message: `응시현황표 ≠ 좌석배치도 — ${grade}학년 ${day}일차 ${period}교시 ${room} (${attCount}명 / ${seatCount}명)`
            });
          }
        });
      }
    }
  });

  return issues;
}

function runOperationDiagnosis() {
  const items = [];
  const studentIds = Object.keys(appState.students);

  if (!studentIds.length) {
    items.push({ category: '학생', status: 'error', message: '등록된 학생이 없습니다.' });
  } else {
    const dupExams = findDuplicatePeriodExams();
    if (dupExams.length) {
      dupExams.forEach(d => {
        items.push({
          category: '학생',
          status: 'error',
          message: `중복 응시 — ${d.name} ${d.day}일차 ${d.period}교시: ${d.subjects.join(', ')}`
        });
      });
    } else {
      items.push({ category: '학생', status: 'ok', message: '중복 응시 없음' });
    }

    const unassigned = getUnassignedStudentCount();
    if (unassigned) {
      items.push({ category: '학생', status: 'error', message: `고정 좌석 미배정 학생 ${unassigned}명` });
    } else if (hasFixedRoomSeats()) {
      items.push({ category: '학생', status: 'ok', message: '모든 학생 고정 좌석 배정 완료' });
    } else {
      items.push({ category: '학생', status: 'ok', message: '모든 학생 시험실 배정 완료' });
    }

    if (!hasFixedRoomSeats()) {
      let missingSeat = 0;
      studentIds.forEach(id => {
        (appState.studentExamSchedules[id] || []).forEach(e => {
          const eff = getEffectivePlacement(id, e.day, e.period);
          if (!eff?.seatNo) missingSeat++;
        });
      });
      if (missingSeat) {
        items.push({ category: '학생', status: 'error', message: `좌석 미배정 ${missingSeat}건` });
      } else if (Object.keys(appState.studentExamSchedules).length) {
        items.push({ category: '학생', status: 'ok', message: '모든 응시 좌석 배정 완료' });
      }
    }

    let noSchedule = studentIds.filter(id => !(appState.studentExamSchedules[id] || []).length).length;
    if (noSchedule) {
      items.push({ category: '학생', status: 'warning', message: `시험 일정 없는 학생 ${noSchedule}명` });
    }
  }

  const conflicts = findSeatConflictDetails();
  if (conflicts.length) {
    conflicts.forEach(c => {
      items.push({
        category: '시험실',
        status: 'error',
        message: `좌석 중복 — ${c.roomName} ${formatSeatNumberLabel(c.seatNo, { roomName: c.roomName, seatGroup: appState.fixedRoomSeats?.[c.students[0]?.studentId]?.seatGroup, isMoveStudent: appState.fixedRoomSeats?.[c.students[0]?.studentId]?.isMoveStudent })}: ${c.students.map(s => s.name).join(', ')}`
      });
    });
  } else if (Object.keys(appState.seatAssignments).length) {
    items.push({ category: '시험실', status: 'ok', message: '좌석번호 중복 없음' });
  }

  const dupRooms = findStudentDuplicateRoomAssignments();
  if (dupRooms.length) {
    dupRooms.forEach(d => {
      items.push({
        category: '시험실',
        status: 'error',
        message: `학생 중복 배정 — ${d.name} ${d.day}일차 ${d.period}교시: ${d.rooms.join(', ')}`
      });
    });
  } else if (Object.keys(appState.seatAssignments).length) {
    items.push({ category: '시험실', status: 'ok', message: '학생 중복 배정 없음' });
  }

  const overflows = findCapacityOverflowDetails();
  if (overflows.length) {
    overflows.forEach(o => {
      items.push({
        category: '시험실',
        status: 'error',
        message: `정원 초과 — ${o.roomName} (정원 ${o.capacity}명, 배정 ${o.count}명)`
      });
    });
  } else if (Object.keys(appState.seatAssignments).length) {
    items.push({ category: '시험실', status: 'ok', message: '시험실 정원 이내' });
  }

  const emptyRoomSessions = [];
  for (let day = 1; day <= appState.examMeta.days; day++) {
    for (let period = 1; period <= appState.examMeta.periodsPerDay; period++) {
      const assignedRoomNames = new Set();
      appState.examGroups.forEach(g => {
        if (g.day !== day || g.period !== period) return;
        const key = examGroupKey(g.grade, g.day, g.period, g.subject);
        const existing = appState.roomAssignments[key];
        if (existing) existing.rooms.forEach(r => assignedRoomNames.add(r.roomName));
      });
      const usedRoomNames = new Set(getRoomOperationData(day, period).map(r => r.roomName));
      [...assignedRoomNames].filter(name => !usedRoomNames.has(name)).forEach(name => {
        emptyRoomSessions.push(`${day}일차 ${period}교시 ${name}`);
      });
    }
  }
  if (emptyRoomSessions.length) {
    items.push({
      category: '시험실',
      status: 'warning',
      message: `빈 시험실 ${emptyRoomSessions.length}건 (${emptyRoomSessions.slice(0, 3).join(', ')}${emptyRoomSessions.length > 3 ? '…' : ''})`
    });
  } else if (Object.keys(appState.roomAssignments).length) {
    items.push({ category: '시험실', status: 'ok', message: '빈 시험실 없음' });
  }

  const consistency = checkOutputConsistency();
  if (consistency.length) {
    consistency.forEach(c => {
      items.push({ category: '출력물', status: 'error', message: `데이터 불일치 — ${c.message}` });
    });
  } else if (Object.keys(appState.seatAssignments).length) {
    items.push({ category: '출력물', status: 'ok', message: '출력물 간 인원 데이터 일치' });
  }

  const summary = {
    errors: items.filter(i => i.status === 'error').length,
    warnings: items.filter(i => i.status === 'warning').length,
    ok: items.filter(i => i.status === 'ok').length
  };
  let status = 'ok';
  if (summary.errors) status = 'error';
  else if (summary.warnings) status = 'warning';

  return { status, summary, items };
}

function isOperationLocked() {
  return !!appState.operationLocked;
}

function guardIfLocked(actionLabel) {
  if (!isOperationLocked()) return false;
  alert(`🔒 운영 잠금 상태입니다.\n\n${actionLabel || '데이터 수정'}이 제한됩니다.\nStep 5 출력·Export만 가능합니다.\n\n「운영 잠금 해제」 후 다시 시도하세요.`);
  return true;
}

function confirmOperationLock() {
  if (!confirm('운영을 확정하시겠습니까?\n\n확정 후 Step 1~4 수정이 잠깁니다.\nStep 5 출력·Export는 계속 가능합니다.')) return;
  appState.operationLocked = true;
  applyLockStateToUI();
  saveToLocalSilent();
  alert('운영이 확정되었습니다. 운영 잠금 상태입니다.');
}

function unlockOperation() {
  if (!confirm('잠금을 해제하시겠습니까?\n\nStep 1~4 수정이 다시 가능해집니다.')) return;
  appState.operationLocked = false;
  applyLockStateToUI();
  saveToLocalSilent();
  alert('운영 잠금이 해제되었습니다.');
}

function saveToLocalSilent() {
  try {
    collectAllSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (_) { /* ignore */ }
}

function applyLockStateToUI() {
  document.body.classList.toggle('operation-locked', isOperationLocked());
  const statusEl = $('#operation-lock-status');
  const lockBtn = $('#btn-lock-operation');
  const unlockBtn = $('#btn-unlock-operation');
  if (statusEl) {
    statusEl.className = `operation-lock-status ${isOperationLocked() ? 'locked' : 'unlocked'}`;
    statusEl.textContent = isOperationLocked() ? '🔒 운영 잠금' : '🔓 수정 가능';
  }
  if (lockBtn) lockBtn.style.display = isOperationLocked() ? 'none' : '';
  if (unlockBtn) unlockBtn.style.display = isOperationLocked() ? '' : 'none';
}

function renderOperationDiagnosis() {
  const summaryEl = $('#diagnosis-summary');
  const tableEl = $('#diagnosis-results-table');
  const statusEl = $('#diagnosis-status-badge');
  if (!summaryEl || !tableEl) return;

  const cached = appState._lastDiagnosis;
  if (!cached) {
    summaryEl.textContent = '「운영 진단 실행」을 클릭하세요.';
    tableEl.innerHTML = '';
    if (statusEl) {
      statusEl.className = 'diagnosis-status-badge pending';
      statusEl.textContent = '—';
    }
    return;
  }

  const { status, summary, items } = cached;
  summaryEl.innerHTML = `오류 <strong>${summary.errors}</strong>건 · 경고 <strong>${summary.warnings}</strong>건 · 정상 <strong>${summary.ok}</strong>건`;

  if (statusEl) {
    const labels = { ok: '✅ 정상', warning: '⚠ 경고', error: '❌ 오류' };
    statusEl.className = `diagnosis-status-badge ${status}`;
    statusEl.textContent = labels[status] || '—';
  }

  const statusIcon = { ok: '✅', warning: '⚠', error: '❌' };
  let html = '<table class="diagnosis-table"><thead><tr><th>구분</th><th>상태</th><th>내용</th></tr></thead><tbody>';
  items.forEach(item => {
    html += `<tr class="diag-${item.status}"><td>${item.category}</td><td>${statusIcon[item.status] || ''}</td><td>${item.message}</td></tr>`;
  });
  html += '</tbody></table>';
  tableEl.innerHTML = html;
}

function runAndShowOperationDiagnosis() {
  appState._lastDiagnosis = runOperationDiagnosis();
  renderOperationDiagnosis();
  renderOutputValidationBanner();
  syncStateToWindow();
}

function buildTemplateFilename() {
  const m = appState.examMeta;
  return `examflow-template-${m.year}-${m.semester}-${m.round}.json`;
}

function buildBackupFilename() {
  const m = appState.examMeta;
  return `examflow-backup-${m.year}-${m.semester}-${m.round}.json`;
}

function exportSettingsTemplate() {
  collectAllSettings();
  const template = {
    _type: 'examflow-template',
    _version: '0.8',
    examMeta: { ...appState.examMeta },
    moveRules: JSON.parse(JSON.stringify(appState.examRules.movementRules)),
    seatConfig: JSON.parse(JSON.stringify(appState.examRules.seatDefaults)),
    rooms: JSON.parse(JSON.stringify(appState.rooms))
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = buildTemplateFilename();
  a.click();
}

function importSettingsTemplate(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data._type !== 'examflow-template') {
        alert('설정 템플릿 파일이 아닙니다.\n(examflow-template 형식 필요)');
        return;
      }
      if (guardIfLocked('설정 템플릿 불러오기')) return;
      if (data.examMeta) Object.assign(appState.examMeta, data.examMeta);
      if (data.moveRules) appState.examRules.movementRules = data.moveRules;
      if (data.seatConfig) {
        appState.examRules.seatDefaults = data.seatConfig;
        migrateLoadedState();
      }
      if (data.rooms) appState.rooms = data.rooms;
      restoreUI();
      syncStateToWindow();
      alert('설정 템플릿을 적용했습니다.\nStep 1 화면을 확인하세요.');
    } catch (e) {
      alert('템플릿 파싱 실패: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function exportOperationBackup() {
  collectAllSettings();
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = buildBackupFilename();
  a.click();
}

function runPlacementValidation() {
  const errors = [];
  const warnings = [];
  const oks = [];

  const conflicts = findSeatConflictDetails();
  if (conflicts.length) {
    errors.push(...conflicts.map(c => {
      const firstId = c.students[0]?.studentId;
      const fs = appState.fixedRoomSeats?.[firstId];
      const label = formatSeatNumberLabel(c.seatNo, { roomName: c.roomName, seatGroup: fs?.seatGroup, isMoveStudent: fs?.isMoveStudent });
      return `좌석번호 중복 — ${c.roomName} ${label}: ${c.students.map(s => s.name).join(', ')}`;
    }));
  } else if (Object.keys(appState.seatAssignments).length) {
    oks.push('좌석번호 중복 없음');
  }

  const overflows = findCapacityOverflowDetails();
  if (overflows.length) {
    errors.push(...overflows.map(o => `${o.roomName} 정원 초과 (${o.count}/${o.capacity})`));
  } else if (Object.keys(appState.seatAssignments).length) {
    oks.push('시험실 정원 이내');
  }

  const assignedRoomNames = new Set();
  Object.keys(appState.seatAssignments).forEach(id => {
    appState.seatAssignments[id].forEach(seat => {
      const eff = buildPlacementRecordFast(id, seat);
      assignedRoomNames.add(eff.roomName);
    });
  });

  const emptyRooms = appState.rooms.filter(r => !assignedRoomNames.has(r.name));
  if (emptyRooms.length && appState.rooms.length) {
    warnings.push(`배정 없는 고사실 ${emptyRooms.length}개`);
  }

  return { errors, warnings, oks };
}

function renderPlacementValidationBanner() {
  const banner = $('#placement-validation-banner');
  if (!banner) return;
  const { errors, warnings, oks } = runPlacementValidation();
  if (errors.length) {
    banner.className = 'placement-validation-banner blocking';
    banner.innerHTML = '<strong>오류 — 출력 불가</strong><br>' + errors.map(e => `✗ ${e}`).join('<br>');
    return;
  }
  if (warnings.length) {
    banner.className = 'placement-validation-banner warning-only';
    banner.innerHTML = warnings.map(w => `⚠ ${w}`).join('<br>') + (oks.length ? '<br>✓ ' + oks.join(', ') : '');
    return;
  }
  banner.className = 'placement-validation-banner ok';
  banner.textContent = '✓ 자료검증 정상';
}

function getPlacementBrowseRooms() {
  const classRooms = appState.rooms
    .filter(r => r.type === 'class')
    .sort(compareRooms)
    .map(r => r.name);
  const others = appState.rooms
    .filter(r => r.type !== 'class')
    .sort(compareRooms)
    .map(r => r.name);
  return [...classRooms, ...others];
}

function getPlacementBrowseRoom() {
  const rooms = getPlacementBrowseRooms();
  if (!rooms.length) return '';
  if (placementRoomIndex >= rooms.length) placementRoomIndex = rooms.length - 1;
  if (placementRoomIndex < 0) placementRoomIndex = 0;
  return rooms[placementRoomIndex];
}

function formatPlacementRoomLabel(roomName) {
  if (!roomName) return '—';
  const parsed = parseClassRoomName(roomName);
  return parsed ? `${parsed.grade}학년 ${parsed.classNo}반` : roomName;
}

function buildPlacementSeatCellHtml(r) {
  const seatPrefix = getSeatGroupPrefix(r.studentId, r.roomName);
  const seatLabel = seatPrefix ? `${seatPrefix}${r.seatNo}` : String(r.seatNo);
  const prefixHtml = seatPrefix ? `<span class="seat-no-prefix">${seatPrefix}</span>` : '';
  return `<td class="col-seat-no">
    <span class="seat-no-inline" title="${seatLabel}">
      ${prefixHtml}<input type="number" class="pl-edit-seat" data-sid="${r.studentId}" data-day="${r.day}" data-period="${r.period}" value="${r.seatNo}" min="1" aria-label="좌석번호 ${seatLabel}">
    </span>
  </td>`;
}

function renderPlacementRoomNav() {
  const rooms = getPlacementBrowseRooms();
  const label = $('#placement-room-label');
  const prev = $('#placement-room-prev');
  const next = $('#placement-room-next');
  if (!label) return;

  if (!rooms.length) {
    label.textContent = '교실 없음';
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    return;
  }

  if (placementRoomIndex >= rooms.length) placementRoomIndex = rooms.length - 1;
  if (placementRoomIndex < 0) placementRoomIndex = 0;

  label.textContent = formatPlacementRoomLabel(rooms[placementRoomIndex]);
  if (prev) prev.disabled = placementRoomIndex <= 0;
  if (next) next.disabled = placementRoomIndex >= rooms.length - 1;
}

function bindPlacementRoomNav() {
  if (placementRoomNavBound) return;
  placementRoomNavBound = true;

  $('#placement-room-prev')?.addEventListener('click', () => {
    if (placementRoomIndex <= 0) return;
    placementRoomIndex--;
    placementPage = 1;
    renderPlacementRoomNav();
    renderPlacementTable();
    renderPlacementValidationBanner();
  });

  $('#placement-room-next')?.addEventListener('click', () => {
    const rooms = getPlacementBrowseRooms();
    if (placementRoomIndex >= rooms.length - 1) return;
    placementRoomIndex++;
    placementPage = 1;
    renderPlacementRoomNav();
    renderPlacementTable();
    renderPlacementValidationBanner();
  });
}

function getRoomOptionsHtml(selected) {
  const names = getSortedRoomNames();
  const extras = ['별도시험실A', '별도시험실B'];
  const all = sortClassRoomNames([...new Set([...names, ...extras])]);
  return all.map(n => `<option value="${n}" ${n === selected ? 'selected' : ''}>${n}</option>`).join('');
}

function getPlacementFilters() {
  const container = $('#placement-filters');
  if (!container) return { day: '', period: '', room: '' };
  const get = id => container.querySelector(`#${id}`)?.value;
  const browseRooms = getPlacementBrowseRooms();
  return {
    day: get('pf-day') ? parseInt(get('pf-day'), 10) : '',
    period: get('pf-period') ? parseInt(get('pf-period'), 10) : '',
    room: browseRooms.length ? getPlacementBrowseRoom() : ''
  };
}

function renderPlacementFilters() {
  const container = $('#placement-filters');
  if (!container) return;

  const days = Array.from({ length: appState.examMeta.days }, (_, i) => i + 1);
  const periods = Array.from({ length: appState.examMeta.periodsPerDay }, (_, i) => i + 1);

  const prev = getPlacementFilters();
  const prevRoom = getPlacementBrowseRoom();

  container.innerHTML = `
    <label>일자 <select id="pf-day"><option value="">전체</option>${days.map(d => `<option value="${d}">${d}일차</option>`).join('')}</select></label>
    <label>교시 <select id="pf-period"><option value="">전체</option>${periods.map(p => `<option value="${p}">${p}교시</option>`).join('')}</select></label>
  `;

  if (prev.day) container.querySelector('#pf-day').value = prev.day;
  if (prev.period) container.querySelector('#pf-period').value = prev.period;

  if (prevRoom) {
    const rooms = getPlacementBrowseRooms();
    const idx = rooms.indexOf(prevRoom);
    if (idx >= 0) placementRoomIndex = idx;
  }

  renderPlacementRoomNav();

  const bulkRoom = $('#bulk-room');
  if (bulkRoom) {
    bulkRoom.innerHTML = '<option value="">시험실</option>' + getRoomOptionsHtml('');
  }

  const sepSel = $('#separate-room-select');
  if (sepSel) {
    const special = appState.rooms.filter(r => r.type === 'special' || r.type === 'waiting');
    const names = special.length ? special.map(r => r.name) : ['별도시험실A', '별도시험실B'];
    sepSel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  }
}

function buildRoomSelectOptions(selected) {
  const names = getSortedRoomNames();
  const extras = ['별도시험실A', '별도시험실B'];
  return sortClassRoomNames([...new Set([...names, ...extras])])
    .map(n => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`)
    .join('');
}

function renderPlacementTable() {
  const wrap = $('#placement-table-wrap');
  if (!wrap) return;

  const filters = getPlacementFilters();
  const records = getAllPlacementRecords(filters);

  if (!records.length) {
    const roomLabel = formatPlacementRoomLabel(filters.room);
    wrap.innerHTML = `<p class="hint">${roomLabel} · 선택한 일자·교시에 배치 데이터가 없습니다.</p>`;
    return;
  }

  const conflictIds = buildConflictStudentIds(records);

  let html = `<table class="placement-table placement-table--compact"><thead><tr>
    <th class="col-check"><input type="checkbox" id="placement-head-check"></th>
    <th>학번</th><th>성명</th><th>원반</th><th>번호</th><th>과목</th>
    <th>시험실</th><th>좌석번호</th>
  </tr></thead><tbody>`;

  records.forEach(r => {
    const rowClass = conflictIds.has(r.studentId) ? ' row-conflict' : '';
    html += `<tr class="placement-row${rowClass}" data-sid="${r.studentId}" data-day="${r.day}" data-period="${r.period}">
      <td class="col-check"><input type="checkbox" class="placement-row-check" data-sid="${r.studentId}" data-day="${r.day}" data-period="${r.period}"></td>
      <td>${r.studentId}</td><td>${r.name}</td><td>${r.homeClass}</td><td class="col-number">${r.number}</td><td class="col-subject">${r.subject}</td>
      <td class="col-room"><select class="pl-edit-room" data-sid="${r.studentId}" data-day="${r.day}" data-period="${r.period}">${buildRoomSelectOptions(r.roomName)}</select></td>
      ${buildPlacementSeatCellHtml(r)}
    </tr>`;
  });
  html += '</tbody></table>';
  html += `<p class="hint placement-record-count">총 ${records.length}명</p>`;

  wrap.innerHTML = html;

  wrap.querySelector('#placement-head-check')?.addEventListener('change', e => {
    wrap.querySelectorAll('.placement-row-check').forEach(cb => { cb.checked = e.target.checked; });
  });
}

function bindPlacementFilterDelegation() {
  if (placementFilterDelegationBound) return;
  placementFilterDelegationBound = true;
  $('#placement-filters')?.addEventListener('change', e => {
    if (e.target.tagName !== 'SELECT') return;
    placementPage = 1;
    renderPlacementTable();
    requestAnimationFrame(() => renderPlacementValidationBanner());
  });
}

function bindPlacementPagerDelegation() {
  if (placementPagerDelegationBound) return;
  placementPagerDelegationBound = true;
  $('#placement-table-wrap')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-placement-page]');
    if (!btn || btn.disabled) return;
    const totalPages = parseInt(btn.dataset.totalPages, 10) || 1;
    if (btn.dataset.placementPage === 'prev' && placementPage > 1) placementPage--;
    else if (btn.dataset.placementPage === 'next' && placementPage < totalPages) placementPage++;
    else return;
    renderPlacementTable();
  });
}

function refreshPlacementRowConflict(rowEl, studentId) {
  if (!rowEl) return;
  const filters = getPlacementFilters();
  const conflictIds = buildConflictStudentIds(getAllPlacementRecords(filters));
  rowEl.classList.toggle('row-conflict', conflictIds.has(studentId));
}

function renderPlacementChangeHistory() {
  const el = $('#placement-change-history');
  if (!el) return;
  if (!appState.placementChangeHistory.length) {
    el.innerHTML = '<p class="hint">변경 이력이 없습니다.</p>';
    return;
  }
  el.innerHTML = appState.placementChangeHistory.map(h => `
    <div class="history-item">
      <strong>${h.studentName}</strong> — ${h.field}: ${h.from} → ${h.to}
      <span style="color:var(--muted);font-size:0.75rem"> (${new Date(h.at).toLocaleString('ko-KR')})</span>
    </div>
  `).join('');
}

function getSelectedPlacementRows() {
  const rows = [];
  $$('.placement-row-check:checked').forEach(cb => {
    rows.push({
      studentId: cb.dataset.sid,
      day: parseInt(cb.dataset.day, 10),
      period: parseInt(cb.dataset.period, 10)
    });
  });
  return rows;
}

function applyBulkPlacementChanges() {
  const rows = getSelectedPlacementRows();
  if (!rows.length) { alert('학생을 선택하세요.'); return; }

  const room = $('#bulk-room')?.value;
  if (!room) { alert('일괄 변경할 시험실을 선택하세요.'); return; }

  rows.forEach(({ studentId, day, period }) => {
    setPlacementOverride(studentId, day, period, { roomName: room });
  });

  renderPlacementTable();
  renderPlacementValidationBanner();
  renderPlacementChangeHistory();
  renderOutputValidationBanner();
}

function assignSeparateRoomToSelected() {
  const rows = getSelectedPlacementRows();
  const roomName = $('#separate-room-select')?.value;
  if (!rows.length) { alert('학생을 선택하세요.'); return; }
  if (!roomName) { alert('별도시험실을 선택하세요.'); return; }

  rows.forEach(({ studentId, day, period }) => {
    setPlacementOverride(studentId, day, period, { roomName });
  });

  renderPlacementTable();
  renderPlacementValidationBanner();
  renderPlacementChangeHistory();
  renderOutputValidationBanner();
}

function applyDefaultPlacementFiltersIfNeeded() {
  const container = $('#placement-filters');
  if (!container) return;
  const daySel = container.querySelector('#pf-day');
  const periodSel = container.querySelector('#pf-period');
  if (daySel && !daySel.value) daySel.value = '1';
  if (periodSel && !periodSel.value) periodSel.value = '1';

  const rooms = getPlacementBrowseRooms();
  const idx = rooms.indexOf('1-1');
  placementRoomIndex = idx >= 0 ? idx : 0;
  renderPlacementRoomNav();
}

function initPlacementEditor() {
  bindPlacementFilterDelegation();
  bindPlacementPagerDelegation();
  bindPlacementRoomNav();
  renderPlacementFilters();
  applyDefaultPlacementFiltersIfNeeded();
  renderPlacementChangeHistory();

  const wrap = $('#placement-table-wrap');
  if (wrap) wrap.innerHTML = '<p class="placement-loading">자료검증 표를 준비하는 중...</p>';

  placementPage = 1;
  requestAnimationFrame(() => {
    renderPlacementTable();
    requestAnimationFrame(() => renderPlacementValidationBanner());
    placementEditorDirty = false;
  });
}

function initPlacementEditorEvents() {
  $('#placement-select-all')?.addEventListener('change', e => {
    $$('.placement-row-check').forEach(cb => { cb.checked = e.target.checked; });
  });

  $('#btn-bulk-apply')?.addEventListener('click', applyBulkPlacementChanges);
  $('#btn-assign-separate-room')?.addEventListener('click', assignSeparateRoomToSelected);

  $('#placement-table-wrap')?.addEventListener('change', e => {
    const t = e.target;
    const sid = t.dataset.sid;
    const day = parseInt(t.dataset.day, 10);
    const period = parseInt(t.dataset.period, 10);
    if (!sid) return;

    if (t.classList.contains('pl-edit-room')) {
      setPlacementOverride(sid, day, period, { roomName: t.value });
    } else if (t.classList.contains('pl-edit-seat')) {
      setPlacementOverride(sid, day, period, { seatNo: parseInt(t.value, 10) });
    }
    refreshPlacementRowConflict(t.closest('.placement-row'), sid);
    renderPlacementValidationBanner();
    renderPlacementChangeHistory();
    renderOutputValidationBanner();
  });
}

/* ========== Step 5: Output Documents ========== */

const OUTPUT_FILTER_MAP = {
  'seat-map': 'filters-seat-map',
  attendance: 'filters-attendance',
  'elective-students': 'filters-elective-students',
  personal: 'filters-personal',
  'room-assignment': 'filters-room-assignment'
};

const OUTPUT_DEFAULT_PRINT_SIZE = {
  'seat-map': 'a4-portrait',
  attendance: 'a4-portrait',
  'elective-students': 'b4-landscape',
  personal: 'a4-portrait',
  'room-assignment': 'a4-portrait'
};

const ELECTIVE_STUDENTS_MAX_ROWS = 20;

const DEFAULT_PRINT_SIZE = 'a4-portrait';

let currentPreviewType = 'seat-map';

function formatDate(day) {
  const d = appState.examMeta.dates[day];
  if (!d) return `${day}일차`;
  const dt = new Date(d + 'T00:00:00');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일(${weekdays[dt.getDay()]})`;
}

function formatDateShort(day) {
  const d = appState.examMeta.dates[day];
  if (!d) return `${day}일차`;
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function getSchoolNameLine() {
  return (appState.examMeta.schoolName || '').trim();
}

function getExamTitleLine() {
  const m = appState.examMeta;
  return `${m.year}학년도 ${m.semester}학기 ${m.round}차 ${m.examName}`;
}

function getExamTitleShort() {
  const m = appState.examMeta;
  return `${m.year}학년도 ${m.round}차 ${m.examName}`;
}

function formatElectiveStudentNumber(num) {
  if (num == null || num === '') return '';
  return num < 10 ? String(num).padStart(2, '0') : String(num);
}

function getElectiveStudentsColumns(grade, classNo) {
  return appState.examGroups
    .filter(g => g.grade === grade && !isWholeGradeExam(g))
    .sort((a, b) => a.day - b.day || a.period - b.period || a.subject.localeCompare(b.subject, 'ko'))
    .map(g => {
      const students = g.students
        .filter(id => {
          const st = appState.students[id];
          return st && st.grade === grade && st.classNo === classNo;
        })
        .map(id => {
          const st = appState.students[id];
          return { number: st.number, name: st.name };
        })
        .sort((a, b) => a.number - b.number);
      if (!students.length) return null;
      return {
        day: g.day,
        period: g.period,
        subject: g.subject,
        dateLabel: formatDate(g.day),
        periodLabel: `${g.period}교시`,
        students
      };
    })
    .filter(Boolean);
}

function buildElectiveStudentsTableHtml(columns) {
  if (!columns.length) return '';

  let h1 = '<tr><th rowspan="3" class="es-col-order">순</th>';
  for (let i = 0; i < columns.length;) {
    const day = columns[i].day;
    let count = 0;
    while (i + count < columns.length && columns[i + count].day === day) count++;
    h1 += `<th colspan="${count * 2}">${columns[i].dateLabel}</th>`;
    i += count;
  }
  h1 += '</tr>';

  let h2 = '<tr>';
  columns.forEach(col => {
    h2 += `<th colspan="2">${col.periodLabel}</th>`;
  });
  h2 += '</tr>';

  let h3 = '<tr>';
  columns.forEach(col => {
    h3 += `<th colspan="2">${col.subject}</th>`;
  });
  h3 += '</tr>';

  let body = '';
  for (let r = 0; r < ELECTIVE_STUDENTS_MAX_ROWS; r++) {
    body += `<tr><td class="es-col-order">${r + 1}</td>`;
    columns.forEach(col => {
      const st = col.students[r];
      body += `<td class="es-col-num">${st ? formatElectiveStudentNumber(st.number) : ''}</td>`;
      body += `<td class="es-col-name">${st ? st.name : ''}</td>`;
    });
    body += '</tr>';
  }

  let foot = '<tr class="es-total-row"><td class="es-col-order">계</td>';
  columns.forEach(col => {
    foot += `<td colspan="2" class="es-col-total">${col.students.length} 명</td>`;
  });
  foot += '</tr>';

  return `<table class="doc-table elective-students-table"><thead>${h1}${h2}${h3}</thead><tbody>${body}${foot}</tbody></table>`;
}

function renderElectiveStudentsPage(grade, classNo) {
  const columns = getElectiveStudentsColumns(grade, classNo);
  if (!columns.length) {
    return `<div class="print-doc print-elective-students"><p class="hint">해당 학급의 선택과목 응시 데이터가 없습니다.</p></div>`;
  }

  const roomName = `${grade}-${classNo}`;
  const table = buildElectiveStudentsTableHtml(columns);

  return `<div class="print-doc print-elective-students">
    ${renderDocValidationInline()}
    <header class="doc-header doc-header-print es-header">
      ${getSchoolNameLine() ? `<p class="doc-school">${getSchoolNameLine()}</p>` : ''}
      <h1>${getExamTitleShort()}</h1>
      <p class="doc-sub es-subtitle">[${roomName}반 교실] ${grade}학년 ${classNo}반 선택과목 응시 학생</p>
      <p class="es-room-label">시험실: ${roomName}</p>
    </header>
    ${table}
  </div>`;
}

function renderElectiveStudentsDocument(f) {
  if (f.bulkPrint) {
    const classes = sortClassNos(
      Object.values(appState.students).filter(s => s.grade === f.grade).map(s => s.classNo)
    );
    if (!classes.length) return '<p class="hint">해당 학년 학급이 없습니다.</p>';
    return `<div class="elective-students-batch">${classes.map(c => renderElectiveStudentsPage(f.grade, c)).join('')}</div>`;
  }
  return renderElectiveStudentsPage(f.grade, f.classNo);
}

function getPersonalScheduleData(studentId) {
  const st = appState.students[studentId];
  if (!st) return null;
  const schedule = (appState.studentExamSchedules[studentId] || []).map(entry => {
    const seat = (appState.seatAssignments[studentId] || []).find(s =>
      s.day === entry.day && s.period === entry.period && s.subject === entry.subject
    );
    return {
      day: entry.day,
      date: formatDateShort(entry.day),
      period: entry.period,
      subject: entry.subject,
      room: seat?.roomName || '-',
      seatNo: seat?.seatNo ?? '-'
    };
  }).sort((a, b) => a.day - b.day || a.period - b.period);
  return { student: st, schedule };
}

function maskName(name) {
  if (!name) return '';
  if (name.length === 1) return name;
  return name[0] + '○'.repeat(Math.max(1, name.length - 1));
}

function classifyAbsence(note) {
  const n = (note || '').trim();
  if (!n) return null;
  for (const t of ABSENCE_TYPES) {
    if (n.includes(t)) return t;
  }
  return '기타';
}

function isAbsenceNote(note) {
  return classifyAbsence(note) !== null;
}

function buildNoteSelectHtml(noteKey, current) {
  const opts = ['', ...ABSENCE_TYPES].map(v =>
    `<option value="${v}" ${current === v ? 'selected' : ''}>${v || '(없음)'}</option>`
  ).join('');
  return `<select class="attendance-note note-select-screen no-print" data-key="${noteKey}">${opts}</select>
    <span class="print-only-note">${current || ''}</span>`;
}

function getSeatDataForSession(grade, day, period, room) {
  if (hasFixedRoomSeats()) {
    return getFixedSeatDataForRoom(room);
  }

  const seatConfig = getSeatConfig();
  const positions = generateSeatPositions(seatConfig.rows, seatConfig.cols, seatConfig.fillDirection);
  const seatNoToCoord = {};
  positions.forEach(p => { seatNoToCoord[p.seatNo] = p; });

  const seatByCoord = {};
  let subject = '';

  Object.entries(appState.seatAssignments).forEach(([studentId, arr]) => {
    arr.forEach(seat => {
      if (seat.grade !== grade || seat.day !== day || seat.period !== period) return;
      const eff = getEffectivePlacement(studentId, day, period);
      if (!eff || eff.roomName !== room) return;
      if (!subject) subject = eff.subject;
      const st = appState.students[studentId];
      const coord = (eff.row && eff.col)
        ? { row: eff.row, col: eff.col }
        : seatNoToCoord[eff.seatNo];
      if (!coord) return;
      seatByCoord[`${coord.row}-${coord.col}`] = {
        ...seat,
        ...eff,
        row: coord.row,
        col: coord.col,
        studentId,
        name: st?.name || '',
        seatNo: eff.seatNo,
        subject: eff.subject
      };
    });
  });

  return { seatConfig, positions, seatByCoord, subject };
}

function getRoomsForDay(day) {
  const rooms = new Set();
  if (hasFixedRoomSeats()) {
    getClassRooms().forEach(r => {
      if (getResidentsForRoom(r.name).length) rooms.add(r.name);
    });
  } else {
    Object.values(appState.seatAssignments).forEach(arr => {
      arr.forEach(seat => {
        if (seat.day === day) rooms.add(seat.roomName);
      });
    });
  }
  return sortClassRoomNames([...rooms]);
}

function getAttendanceGroupsForRoom(roomName) {
  const residents = getResidentsForRoom(roomName);
  const parsed = parseClassRoomName(roomName);
  const homeKey = parsed ? `${parsed.grade}-${parsed.classNo}` : '';
  const groupMap = new Map();

  residents.forEach(id => {
    const st = appState.students[id];
    if (!st) return;
    const key = `${st.grade}-${st.classNo}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        grade: st.grade,
        classNo: st.classNo,
        label: `${st.grade}학년 ${st.classNo}반`,
        isHome: key === homeKey,
        studentIds: []
      });
    }
    groupMap.get(key).studentIds.push(id);
  });

  return [...groupMap.values()]
    .sort((a, b) => compareGradeClass(a.grade, a.classNo, b.grade, b.classNo))
    .map(g => ({ ...g, studentIds: sortStudentsByClass(g.studentIds) }));
}

function getPeriodHeaderLabel(grade, day, period) {
  const subjects = appState.timetable[grade]?.[day]?.[period] || [];
  const subj = subjects.length ? subjects.join('/') : '-';
  return `${period}교시(${subj})`;
}

function isElectiveExamForStudent(studentId, day, period, subject) {
  if (!subject) return false;
  const st = appState.students[studentId];
  if (!st) return false;
  const group = appState.examGroups.find(g =>
    g.grade === st.grade && g.day === day && g.period === period && subjectMatches(g.subject, subject)
  );
  if (!group) return false;
  return !isWholeGradeExam(group);
}

function getStudentAttendanceCell(studentId, day, period) {
  const st = appState.students[studentId];
  const schedule = appState.studentExamSchedules[studentId] || [];
  const entry = schedule.find(e => e.day === day && e.period === period);
  const subject = entry?.subject || '';
  const isElective = !!(entry && subject && isElectiveExamForStudent(studentId, day, period, subject));

  return {
    number: st?.number ?? '',
    name: st?.name ?? '',
    isElective,
    hasExam: !!entry
  };
}

function getAttendanceRoomDayData(room, day) {
  const periods = appState.examMeta.periodsPerDay;
  const periodNums = Array.from({ length: periods }, (_, i) => i + 1);
  const groups = getAttendanceGroupsForRoom(room);

  return {
    room,
    day,
    dateLabel: formatDate(day),
    periodNums,
    groups: groups.map(g => ({
      ...g,
      rowCount: getAttendanceGroupRowCount(g),
      periodHeaders: periodNums.map(p => getPeriodHeaderLabel(g.grade, day, p)),
      rows: g.studentIds.map((id, idx) => ({
        order: idx + 1,
        studentId: id,
        cells: periodNums.map(p => getStudentAttendanceCell(id, day, p))
      }))
    }))
  };
}

const ATTENDANCE_DATA_ROWS = 21;

function getAttendanceGroupRowCount(group) {
  const count = group.studentIds.length;
  if (group.isHome || count >= 20) return ATTENDANCE_DATA_ROWS;
  return Math.max(count, 1);
}

function renderAttendanceGroupColgroup(periodNums) {
  let html = '<colgroup><col class="att-col-group"><col class="att-col-order">';
  periodNums.forEach(() => {
    html += '<col class="att-col-num"><col class="att-col-name"><col class="att-col-status">';
  });
  html += '</colgroup>';
  return html;
}

function renderAttendanceGroupTable(group, day, periodNums) {
  const dataRows = getAttendanceGroupRowCount(group);
  const labelRowSpan = 2 + dataRows + 1;
  let html = `<table class="attendance-group-table" data-att-data-rows="${dataRows}">`;
  html += renderAttendanceGroupColgroup(periodNums);
  html += '<tbody>';

  html += '<tr class="att-period-subject-row">';
  html += `<th class="att-group-label" rowspan="${labelRowSpan}"><span>${group.grade}학년<br>${group.classNo}반</span></th>`;
  html += '<th class="att-col-order att-corner"></th>';
  periodNums.forEach(p => {
    html += `<th colspan="3" class="att-period-subject">${getPeriodHeaderLabel(group.grade, day, p)}</th>`;
  });
  html += '</tr>';

  html += '<tr class="att-column-head">';
  html += '<th class="att-col-order">순</th>';
  periodNums.forEach(() => {
    html += '<th class="att-col-num">번호</th><th class="att-col-name">이름</th><th class="att-col-status">응시현황</th>';
  });
  html += '</tr>';

  for (let i = 0; i < dataRows; i++) {
    const id = group.studentIds[i];
    html += '<tr class="att-data-row">';
    html += `<td class="att-col-order">${i + 1}</td>`;
    periodNums.forEach(p => {
      if (id) {
        const cell = getStudentAttendanceCell(id, day, p);
        const electiveClass = cell.isElective ? ' is-elective' : '';
        html += `<td class="att-num">${cell.number}</td>`;
        html += `<td class="att-name">${cell.name}</td>`;
        html += `<td class="att-status-cell${electiveClass}"></td>`;
      } else {
        html += '<td class="att-num"></td><td class="att-name"></td><td class="att-status-cell"></td>';
      }
    });
    html += '</tr>';
  }

  html += '<tr class="att-sign-row">';
  html += '<td class="att-col-order"></td>';
  periodNums.forEach(() => {
    html += '<td colspan="2" class="att-sign-writer">작성자</td><td class="att-sign-seal">(인)</td>';
  });
  html += '</tr>';

  html += '</tbody></table>';
  return html;
}

function renderAttendanceRoomDaySheet(room, day) {
  const periodNums = Array.from({ length: appState.examMeta.periodsPerDay }, (_, i) => i + 1);
  const groups = getAttendanceGroupsForRoom(room);
  if (!groups.length) {
    return `<div class="print-doc print-attendance"><p class="hint">${room} 교실 상주 학생이 없습니다.</p></div>`;
  }

  const roomLabel = parseClassRoomName(room)
    ? `[${room}반 교실]`
    : `[${room}]`;

  const totalDataRows = groups.reduce((sum, g) => sum + getAttendanceGroupRowCount(g), 0);
  const groupsHtml = groups.map(g => renderAttendanceGroupTable(g, day, periodNums)).join('');

  return `<div class="print-doc print-attendance print-attendance-matrix" data-att-groups="${groups.length}" data-att-data-rows="${totalDataRows}">
    ${renderDocValidationInline()}
    <header class="att-matrix-header">
      <h1 class="att-main-title">${getExamTitleLine()} 응시현황표</h1>
      <p class="att-room-title">${roomLabel}</p>
      <div class="att-date-bar">
        <span class="att-date">${formatDate(day)}</span>
        <span class="att-instruction">*결시자 표시-질병/미인정/인정/기타</span>
      </div>
    </header>
    <div class="att-group-stack">${groupsHtml}</div>
    <p class="attendance-matrix-legend"><span class="att-legend-mark" aria-hidden="true"></span>음영 표시는 선택과목 응시자입니다.</p>
  </div>`;
}

function getAttendanceRows(grade, day, period, room) {
  const rows = [];
  Object.entries(appState.seatAssignments).forEach(([studentId, arr]) => {
    arr.forEach(seat => {
      if (seat.day !== day || seat.period !== period) return;
      const eff = getEffectivePlacement(studentId, day, period);
      if (!eff || eff.roomName !== room) return;
      const st = appState.students[studentId];
      const noteKey = `${studentId}-${day}-${period}`;
      rows.push({
        studentId,
        noteKey,
        seatNo: eff.seatNo,
        name: st?.name || '',
        homeClass: st ? `${st.grade}-${st.classNo}` : '',
        subject: eff.subject,
        courseRoom: st?.courseRooms[eff.subject] || '',
        note: eff.note,
        absenceType: eff.attendanceType === '정상' ? null : (eff.attendanceType || classifyAbsence(eff.note))
      });
    });
  });
  return rows.sort((a, b) => {
    const fa = appState.fixedRoomSeats?.[a.studentId];
    const fb = appState.fixedRoomSeats?.[b.studentId];
    if (fa?.col != null && fb?.col != null) {
      if (fa.col !== fb.col) return fa.col - fb.col;
      return (fa.row || 0) - (fb.row || 0);
    }
    return a.seatNo - b.seatNo;
  });
}

function getRoomsForSession(grade, day, period) {
  const rooms = new Set();
  Object.values(appState.seatAssignments).forEach(arr => {
    arr.forEach(seat => {
      if (seat.day !== day || seat.period !== period) return;
      const parsed = parseClassRoomName(seat.roomName);
      if (parsed) {
        if (parsed.grade === grade) rooms.add(seat.roomName);
      } else {
        rooms.add(seat.roomName);
      }
    });
  });
  return sortClassRoomNames([...rooms]);
}

function renderDocValidationInline() {
  const warnings = getCompactValidationWarnings();
  if (!warnings.length) return '';
  return `<div class="doc-validation-inline">⚠ ${warnings.join(' · ')}</div>`;
}

function getCompactValidationWarnings() {
  const warnings = [];
  const blocking = getPlacementBlockingErrors();
  if (blocking.length) {
    return blocking.map(msg => `출력불가: ${msg}`);
  }
  const dupes = findDuplicateSeats();
  if (dupes.length) warnings.push(`좌석 중복 ${dupes.length}건`);

  const unassigned = getUnassignedStudentCount();
  if (unassigned) warnings.push(`고정 좌석 미배정 ${unassigned}명`);

  findCapacityOverflowDetails().forEach(o => {
    warnings.push(`${o.roomName} 교실 정원/좌석 초과 (${o.count}/${o.capacity})`);
  });

  return warnings;
}

function renderOutputValidationBanner() {
  const banner = $('#output-validation-banner');
  if (!banner) return;
  const diagErrors = getOperationDiagnosisErrors();
  if (diagErrors.length) {
    banner.className = 'output-validation-banner blocking';
    banner.innerHTML = '<strong>출력 차단</strong> — ' + diagErrors.slice(0, 3).map(w => `❌ ${w.message}`).join(' &nbsp;|&nbsp; ');
    return;
  }
  if (appState._lastDiagnosis) {
    const w = appState._lastDiagnosis.items.filter(i => i.status === 'warning');
    if (w.length) {
      banner.className = 'output-validation-banner has-warnings';
      banner.innerHTML = w.slice(0, 3).map(x => `⚠ ${x.message}`).join(' &nbsp;|&nbsp; ');
      return;
    }
  }
  const blocking = getPlacementBlockingErrors();
  if (blocking.length) {
    banner.className = 'output-validation-banner blocking';
    banner.innerHTML = '<strong>출력 차단</strong> — ' + blocking.map(w => `⚠ ${w}`).join(' &nbsp;|&nbsp; ');
    return;
  }
  const warnings = getCompactValidationWarnings();
  if (!warnings.length) {
    banner.className = 'output-validation-banner all-clear';
    banner.textContent = '✓ 출력 전 검증: 특이사항 없음';
    return;
  }
  banner.className = 'output-validation-banner has-warnings';
  banner.innerHTML = warnings.map(w => `⚠ ${w}`).join(' &nbsp;|&nbsp; ');
}

function renderDocHeader(title, lines) {
  const school = getSchoolNameLine();
  return `<header class="doc-header doc-header-print">
    ${school ? `<p class="doc-school">${school}</p>` : ''}
    <h1>${getExamTitleLine()}</h1>
    ${title ? `<p class="doc-sub">${title}</p>` : ''}
    ${lines.map(l => `<p class="doc-meta">${l}</p>`).join('')}
  </header>`;
}

function isMoveSeat(seat) {
  return !!(seat && (seat.seatGroup === 'move' || seat.isMoveStudent));
}

function getMoveStudentColumns(seatByCoord) {
  const cols = new Set();
  Object.values(seatByCoord).forEach(seat => {
    if (seat.col && isMoveSeat(seat)) cols.add(seat.col);
  });
  return cols;
}

function getSeatMapBulkRooms(f) {
  if (hasFixedRoomSeats()) {
    return getClassRooms()
      .map(r => r.name)
      .filter(name => {
        const p = parseClassRoomName(name);
        return !f.grade || (p && p.grade === f.grade);
      });
  }
  return getRoomsForSession(f.grade, f.day, f.period);
}

function renderSeatMapPage(f) {
  const fixed = hasFixedRoomSeats();
  const { seatConfig, seatByCoord, subject } = getSeatDataForSession(f.grade, f.day, f.period, f.room);
  const { rows, cols } = seatConfig;
  const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const split = usesSplitColumnLayout(f.room);
  const assigned = Object.keys(seatByCoord).length;

  if (!assigned) {
    return `<div class="print-doc print-seat-map">
      ${renderDocValidationInline()}
      <p class="hint">배정된 좌석 데이터가 없습니다. Step 3에서 고정 좌석을 배정하세요.</p>
    </div>`;
  }

  let colLabels = '';
  if (split) {
    colLabels = '<thead><tr class="seat-map-col-labels">';
    for (let c = 1; c <= cols; c++) {
      const isMoveCol = isMoveColumn(c, moveMode);
      colLabels += `<th class="seat-map-col-label${isMoveCol ? ' seat-map-col-move' : ''}">${isMoveCol ? '이동반' : '본반'}</th>`;
    }
    colLabels += '</tr></thead>';
  }

  let tbody = '<tbody>';
  for (let r = 1; r <= rows; r++) {
    tbody += '<tr>';
    for (let c = 1; c <= cols; c++) {
      const seat = seatByCoord[`${r}-${c}`];
      const isMoveCol = split && isMoveColumn(c, moveMode);
      const colClass = isMoveCol ? ' seat-map-col-move' : '';
      if (seat) {
        tbody += `<td class="seat-filled${colClass}">
          <div class="seat-id">${seat.studentId}</div>
          <div class="seat-name">${seat.name}</div>
        </td>`;
      } else {
        tbody += `<td class="seat-empty${colClass}" aria-hidden="true"></td>`;
      }
    }
    tbody += '</tr>';
  }
  tbody += '</tbody>';

  const metaLine = fixed
    ? `고사실 : ${f.room}`
    : `${f.day}일차 ${f.period}교시 · 고사실 ${f.room}${subject ? ` · ${subject}` : ''}`;

  return `<div class="print-doc print-seat-map" data-seat-body-rows="${rows}"${split ? ' data-seat-has-thead="1"' : ''}>
    ${renderDocValidationInline()}
    <header class="seat-map-sheet-header">
      <h1 class="seat-map-sheet-title">좌석배치표</h1>
      <p class="seat-map-sheet-subtitle">${getExamTitleLine()}</p>
      <p class="seat-map-sheet-meta">${metaLine}</p>
    </header>
    <div class="seat-map-orient-top">
      <span class="seat-map-teacher-desk">교 탁</span>
      <span class="seat-map-door-front">&lt; 출입문 앞쪽 &gt;</span>
    </div>
    <table class="seat-layout-table seat-map-sheet-table" style="--seat-cols:${cols};--seat-rows:${rows}">
      ${colLabels}
      ${tbody}
    </table>
    <div class="seat-map-orient-bottom">
      <span class="seat-map-door-back">&lt; 출입문 뒷쪽 &gt;</span>
    </div>
  </div>`;
}

function renderSeatMapDocument(f) {
  if (f.bulkPrint) {
    const rooms = getSeatMapBulkRooms(f);
    if (!rooms.length) return '<p class="hint">일괄 출력할 교실이 없습니다.</p>';
    return `<div class="seat-map-batch">${rooms.map(room => renderSeatMapPage({ ...f, room })).join('')}</div>`;
  }

  return renderSeatMapPage(f);
}

function renderAttendanceDocument(f) {
  const rooms = f.bulkPrint ? getRoomsForDay(f.day) : [f.room];
  if (!rooms.length || !f.day) {
    return '<p class="hint">해당 일차 배정 데이터가 없습니다. Step 3에서 고정 좌석을 배정하세요.</p>';
  }
  return rooms.map(room => renderAttendanceRoomDaySheet(room, f.day)).join('');
}

function renderPersonalStudentDoc(studentId) {
  const st = appState.students[studentId];
  if (!st) return '';

  const schedule = (appState.studentExamSchedules[studentId] || []).map(entry => {
    const seat = (appState.seatAssignments[studentId] || []).find(s =>
      s.day === entry.day && s.period === entry.period && s.subject === entry.subject
    );
    return {
      day: entry.day,
      date: formatDateShort(entry.day),
      period: entry.period,
      subject: entry.subject,
      room: seat?.roomName || '-',
      seatNo: seat?.seatNo ?? '-'
    };
  }).sort((a, b) => a.day - b.day || a.period - b.period);

  let table = `<table class="doc-table"><thead><tr>
    <th>일차</th><th>날짜</th><th>교시</th><th>과목</th><th>시험실</th><th>좌석</th>
  </tr></thead><tbody>`;
  schedule.forEach(s => {
    table += `<tr>
      <td>${s.day}</td><td>${s.date}</td><td>${s.period}</td>
      <td>${s.subject}</td><td>${s.room}</td><td>${formatSeatLabelForStudent(studentId, s.seatNo, s.room)}</td>
    </tr>`;
  });
  table += '</tbody></table>';

  return `<div class="print-doc print-personal">
    ${renderDocHeader('개인별 시험 시간표', [
      `${st.grade}학년 ${st.classNo}반 ${st.number}번`,
      st.name
    ])}
    ${table}
  </div>`;
}

function renderPersonalDocument(f) {
  if (f.bulkPrint) {
    const students = Object.values(appState.students)
      .filter(s => s.grade === f.grade && s.classNo === f.classNo)
      .sort((a, b) => a.number - b.number);
    if (!students.length) return '<p class="hint">해당 학급 학생이 없습니다.</p>';
    return `<div class="personal-class-batch">${students.map(s => renderPersonalStudentDoc(s.studentId)).join('')}</div>`;
  }
  const doc = renderPersonalStudentDoc(f.studentId);
  return doc || '<p class="hint">학생을 선택하세요.</p>';
}

/* ---------- 시험실배정현황 / 운영현황 조회 ---------- */

function getClassAssignmentData(day, grade, classNo) {
  const periods = appState.examMeta.periodsPerDay;
  const students = Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo)
    .sort((a, b) => a.number - b.number);

  return students.map(st => {
    const periodData = {};
    for (let p = 1; p <= periods; p++) {
      const hasExam = (appState.studentExamSchedules[st.studentId] || [])
        .some(e => e.day === day && e.period === p);
      if (!hasExam) {
        periodData[p] = null;
        continue;
      }
      const eff = getEffectivePlacement(st.studentId, day, p);
      periodData[p] = eff ? {
        subject: eff.subject,
        roomName: eff.roomName,
        seatNo: eff.seatNo,
        isMoveStudent: eff.isMoveStudent
      } : null;
    }
    return {
      studentId: st.studentId,
      number: st.number,
      name: st.name,
      periods: periodData
    };
  });
}

function getRoomAssignmentData(day, grade) {
  const classNos = sortClassNos(
    Object.values(appState.students).filter(s => s.grade === grade).map(s => s.classNo)
  );

  return classNos.map(classNo => ({
    grade,
    classNo,
    students: getClassAssignmentData(day, grade, classNo)
  }));
}

function getRoomOperationData(day, period) {
  const agg = {};

  Object.keys(appState.seatAssignments).forEach(studentId => {
    const arr = appState.seatAssignments[studentId];
    const seat = arr?.find(s => s.day === day && s.period === period);
    if (!seat) return;
    const eff = getEffectivePlacement(studentId, day, period);
    if (!eff) return;
    const st = appState.students[studentId];
    const courseRoom = st?.courseRooms[eff.subject] || '-';
    const key = `${eff.roomName}|${eff.subject}|${courseRoom}`;
    if (!agg[key]) {
      agg[key] = { roomName: eff.roomName, subject: eff.subject, courseRoom, count: 0 };
    }
    agg[key].count++;
  });

  const byRoom = {};
  Object.values(agg).forEach(row => {
    if (!byRoom[row.roomName]) byRoom[row.roomName] = [];
    byRoom[row.roomName].push(row);
  });

  return sortClassRoomNames(Object.keys(byRoom)).map(roomName => ({
    roomName,
    lines: byRoom[roomName].sort((a, b) => a.subject.localeCompare(b.subject))
  }));
}

function getOperationDashboardStats() {
  const totalStudents = Object.keys(appState.students).length;
  const totalRooms = appState.rooms.length;
  const usedRooms = new Set();
  const subjects = new Set();
  let assignedCount = 0;
  const sessionUsage = {};

  Object.keys(appState.seatAssignments).forEach(studentId => {
    appState.seatAssignments[studentId].forEach(seat => {
      const eff = getEffectivePlacement(studentId, seat.day, seat.period);
      if (!eff) return;
      usedRooms.add(eff.roomName);
      subjects.add(eff.subject);
      assignedCount++;
      const sk = `${seat.day}|${seat.period}|${eff.roomName}`;
      sessionUsage[sk] = (sessionUsage[sk] || 0) + 1;
    });
  });

  let totalSeats = 0;
  appState.rooms.forEach(r => { totalSeats += r.capacity; });
  const specialRooms = appState.rooms.filter(r => r.type === 'special' || r.type === 'waiting').length;

  let emptySeats = 0;
  Object.entries(sessionUsage).forEach(([sk, count]) => {
    const roomName = sk.split('|')[2];
    const room = getRoomByName(roomName);
    if (room?.capacity) emptySeats += Math.max(0, room.capacity - count);
  });

  return {
    totalStudents,
    totalRooms,
    usedRooms: usedRooms.size,
    specialRooms,
    subjectCount: subjects.size,
    totalSeats,
    assignedCount,
    emptySeats
  };
}

function getOperationWarnings(day, period) {
  const warnings = [];
  const conflicts = findSeatConflictDetails().filter(c => c.day === day && c.period === period);
  if (conflicts.length) warnings.push(`좌석번호 중복 ${conflicts.length}건`);

  let unassigned = 0;
  appState.examGroups.forEach(g => {
    if (g.day !== day || g.period !== period) return;
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const existing = appState.roomAssignments[key];
    const assigned = new Set();
    if (existing) existing.rooms.forEach(r => r.students.forEach(id => assigned.add(id)));
    unassigned += g.students.filter(id => !assigned.has(id)).length;
  });
  if (unassigned) warnings.push(`미배정 학생 ${unassigned}명`);

  const overflows = findCapacityOverflowDetails().filter(o => o.day === day && o.period === period);
  if (overflows.length) warnings.push(`정원 초과 시험실 ${overflows.length}개`);

  const usedRoomNames = new Set(getRoomOperationData(day, period).map(r => r.roomName));
  const assignedRoomNames = new Set();
  appState.examGroups.forEach(g => {
    if (g.day !== day || g.period !== period) return;
    const key = examGroupKey(g.grade, g.day, g.period, g.subject);
    const existing = appState.roomAssignments[key];
    if (existing) existing.rooms.forEach(r => assignedRoomNames.add(r.roomName));
  });
  const emptyRooms = [...assignedRoomNames].filter(name => !usedRoomNames.has(name)).length;
  if (emptyRooms) warnings.push(`빈 시험실 ${emptyRooms}개`);

  return warnings;
}

function renderPeriodCell(data) {
  if (!data) return '<td class="period-cell empty-cell">-</td>';
  const seatLabel = formatSeatNumberLabel(data.seatNo, {
    roomName: data.roomName,
    isMoveStudent: data.isMoveStudent
  });
  return `<td class="period-cell">
    <div class="pc-subject">${data.subject}</div>
    <div class="pc-room">${data.roomName}</div>
    <div class="pc-seat">${seatLabel}</div>
  </td>`;
}

function renderClassAssignmentPage(day, grade, classNo) {
  const students = getClassAssignmentData(day, grade, classNo);
  const periods = appState.examMeta.periodsPerDay;

  let header = '<th>번호</th><th>성명</th>';
  for (let p = 1; p <= periods; p++) header += `<th>${p}교시</th>`;

  const body = students.map(st => {
    let row = `<tr><td>${st.number}</td><td>${st.name}</td>`;
    for (let p = 1; p <= periods; p++) row += renderPeriodCell(st.periods[p]);
    return row + '</tr>';
  }).join('');

  return `<div class="print-doc print-room-assignment">
    ${renderDocHeader(`${day}일차 시험실배정현황`, [`${grade}학년 ${classNo}반`])}
    <table class="doc-table class-assignment-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

function renderRoomAssignmentDocument(f) {
  if (f.bulkPrint) {
    const classes = getRoomAssignmentData(f.day, f.grade);
    if (!classes.length) return '<p class="hint">해당 학년 학급 데이터가 없습니다.</p>';
    return `<div class="room-assignment-batch">${classes.map(c => renderClassAssignmentPage(f.day, c.grade, c.classNo)).join('')}</div>`;
  }
  return renderClassAssignmentPage(f.day, f.grade, f.classNo);
}

function renderOperationDashboard() {
  const el = $('#operation-dashboard-stats');
  if (!el) return;
  const s = getOperationDashboardStats();
  const items = [
    ['전체 학생', s.totalStudents],
    ['전체 시험실', s.totalRooms],
    ['사용 중 시험실', s.usedRooms],
    ['특별실', s.specialRooms],
    ['운영 교과', s.subjectCount],
    ['좌석 수', s.totalSeats],
    ['배정 인원', s.assignedCount],
    ['빈 좌석', s.emptySeats]
  ];
  el.innerHTML = items.map(([label, value]) => `
    <div class="op-stat-item"><div class="op-value">${value}</div><div class="op-label">${label}</div></div>
  `).join('');
}

function renderOutputDocument(type, f) {
  switch (type) {
    case 'seat-map': return renderSeatMapDocument(f);
    case 'attendance': return renderAttendanceDocument(f);
    case 'elective-students': return renderElectiveStudentsDocument(f);
    case 'personal': return renderPersonalDocument(f);
    case 'room-assignment': return renderRoomAssignmentDocument(f);
    default: return '<p class="hint">출력물을 선택하세요.</p>';
  }
}

function refreshOutputFilters() {
  const seatMapFields = hasFixedRoomSeats()
    ? ['grade', 'room']
    : ['grade', 'day', 'period', 'room'];
  renderFilterGroup('filters-seat-map', [...seatMapFields, 'bulkPrint']);
  renderFilterGroup('filters-attendance', ['day', 'room', 'bulkPrint']);
  renderFilterGroup('filters-elective-students', ['grade', 'class', 'bulkPrint']);
  renderFilterGroup('filters-personal', ['grade', 'class', 'student', 'bulkPrint']);
  renderFilterGroup('filters-room-assignment', ['grade', 'day', 'class', 'bulkPrint']);
}

function renderFilterGroup(containerId, fields) {
  const container = $(`#${containerId}`);
  if (!container) return;

  const grades = [1, 2, 3];
  const days = Array.from({ length: appState.examMeta.days }, (_, i) => i + 1);
  const periods = Array.from({ length: appState.examMeta.periodsPerDay }, (_, i) => i + 1);
  const rooms = getSortedRoomNames();
  const subjects = [...new Set(appState.examGroups.map(g => g.subject))].sort();

  let html = '';
  if (fields.includes('grade')) {
    const allOpt = fields.includes('gradeOptional') ? '<option value="">전체</option>' : '';
    html += `<label>학년 <select class="filter-grade">${allOpt}${grades.map(g => `<option value="${g}">${g}</option>`).join('')}</select></label>`;
  }
  if (fields.includes('day')) {
    html += `<label>일차 <select class="filter-day">${days.map(d => `<option value="${d}">${d}일차</option>`).join('')}</select></label>`;
  }
  if (fields.includes('period')) {
    html += `<label>교시 <select class="filter-period">${periods.map(p => `<option value="${p}">${p}교시</option>`).join('')}</select></label>`;
  }
  if (fields.includes('room')) {
    html += `<label>고사실 <select class="filter-room">${rooms.map(r => `<option value="${r}">${r}</option>`).join('')}</select></label>`;
  }
  if (fields.includes('class')) {
    html += `<label>반 <select class="filter-class"></select></label>`;
  }
  if (fields.includes('student')) {
    html += `<label>학생 <select class="filter-student"></select></label>`;
  }
  if (fields.includes('subject')) {
    html += `<label>과목 <select class="filter-subject">${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>`;
  }
  if (fields.includes('bulkPrint')) {
    html += `<label class="filter-check"><input type="checkbox" class="filter-bulk-print"> 일괄출력</label>`;
  }
  container.innerHTML = html;

  if (fields.includes('class')) {
    updatePersonalFilters(container);
  }
}

function updatePersonalFilters(container) {
  const grade = parseInt(container.querySelector('.filter-grade')?.value, 10);
  const classSel = container.querySelector('.filter-class');
  const studentSel = container.querySelector('.filter-student');
  const bulkPrint = container.querySelector('.filter-bulk-print');
  if (!classSel) return;

  const classes = sortClassNos(
    Object.values(appState.students).filter(s => s.grade === grade).map(s => s.classNo)
  );

  const prevClass = classSel.value;
  classSel.innerHTML = classes.map(c => `<option value="${c}">${c}반</option>`).join('');
  if (prevClass && classes.includes(parseInt(prevClass, 10))) classSel.value = prevClass;

  const classNo = parseInt(classSel.value, 10);
  const students = Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo)
    .sort((a, b) => a.number - b.number);

  if (studentSel) {
    const prevStudent = studentSel.value;
    studentSel.innerHTML = students.map(s =>
      `<option value="${s.studentId}">${s.number}번 ${s.name}</option>`
    ).join('');
    if (prevStudent && students.some(s => s.studentId === prevStudent)) studentSel.value = prevStudent;
    studentSel.disabled = !!bulkPrint?.checked;
  }
}

function getFiltersFromCard(type) {
  const container = $(`#${OUTPUT_FILTER_MAP[type]}`);
  const get = cls => container?.querySelector(cls)?.value;
  const bulkPrint = !!container?.querySelector('.filter-bulk-print')?.checked;
  const dayRaw = parseInt(get('.filter-day'), 10);
  const periodRaw = parseInt(get('.filter-period'), 10);
  return {
    grade: parseInt(get('.filter-grade'), 10),
    day: Number.isFinite(dayRaw) ? dayRaw : 1,
    period: Number.isFinite(periodRaw) ? periodRaw : 1,
    room: get('.filter-room'),
    bulkPrint,
    printScope: bulkPrint ? 'all' : 'single',
    classNo: parseInt(get('.filter-class'), 10),
    studentId: get('.filter-student'),
    classAll: bulkPrint,
    subject: get('.filter-subject')
  };
}

function updatePrintSizeForCurrentOutput() {
  const sizeSel = $('#print-size-select');
  if (!sizeSel) return;
  sizeSel.value = OUTPUT_DEFAULT_PRINT_SIZE[currentPreviewType] || DEFAULT_PRINT_SIZE;
  applyPrintSizeClass();
}

function selectOutputType(type) {
  currentPreviewType = type;
  $$('.output-index-tab').forEach(el => {
    const on = el.dataset.output === type;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.output-tab-panel').forEach(el => {
    const on = el.dataset.output === type;
    el.classList.toggle('active', on);
    el.hidden = !on;
  });
  const sizeSel = $('#print-size-select');
  if (sizeSel) {
    sizeSel.value = OUTPUT_DEFAULT_PRINT_SIZE[type] || DEFAULT_PRINT_SIZE;
    applyPrintSizeClass();
  }
  refreshOutputPreview();
}

const ATTENDANCE_PAGE = {
  'a4-portrait': { heightMm: 268, widthMm: 186 },
  'a4-landscape': { heightMm: 186, widthMm: 277 },
  'b4-portrait': { heightMm: 342, widthMm: 241 },
  'b4-landscape': { heightMm: 232, widthMm: 344 }
};

const ATTENDANCE_FOOTER_RESERVE_MM = 2;
const ATTENDANCE_SAFETY_MM = 8;
const ATTENDANCE_GROUP_FIXED_MM = 16;
const ATTENDANCE_MIN_DATA_ROW_MM = 2.8;
const ATTENDANCE_PRINT_BUFFER_MM = 6;

function measureAttendanceChromePx(doc, stack) {
  let chrome = 0;
  Array.from(doc.children).forEach(child => {
    if (child === stack) return;
    const style = getComputedStyle(child);
    chrome += child.offsetHeight;
    chrome += parseFloat(style.marginTop) || 0;
    chrome += parseFloat(style.marginBottom) || 0;
  });
  if (stack) {
    const ss = getComputedStyle(stack);
    chrome += parseFloat(ss.marginTop) || 0;
    chrome += parseFloat(ss.marginBottom) || 0;
    stack.querySelectorAll('.attendance-group-table').forEach((table, idx) => {
      if (idx > 0) {
        const ts = getComputedStyle(table);
        chrome += parseFloat(ts.marginTop) || 0;
      }
    });
  }
  return chrome;
}

function fitAttendanceSheetsToPage() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const page = ATTENDANCE_PAGE[size] || ATTENDANCE_PAGE['a4-portrait'];

  $$('#output-preview .print-attendance-matrix').forEach(doc => {
    doc.classList.remove('attendance-fit-applied');
    doc.style.removeProperty('--att-data-row-mm');

    const stack = doc.querySelector('.att-group-stack');
    const table = stack?.querySelector('.attendance-group-table');
    if (!stack || !table) return;

    const dataRowCount = parseInt(doc.dataset.attDataRows || '21', 10);
    const pxPerMm = table.offsetWidth > 0 ? table.offsetWidth / page.widthMm : 3.78;
    const pageHeightPx = page.heightMm * pxPerMm;
    const reserveMm = ATTENDANCE_FOOTER_RESERVE_MM + ATTENDANCE_SAFETY_MM;
    const chromePx = measureAttendanceChromePx(doc, stack);
    const groupCount = parseInt(doc.dataset.attGroups || '1', 10);
    const fixedMm = groupCount * ATTENDANCE_GROUP_FIXED_MM;
    let dataRowMm = Math.max(
      ATTENDANCE_MIN_DATA_ROW_MM,
      (page.heightMm - chromePx / pxPerMm - reserveMm - fixedMm - ATTENDANCE_PRINT_BUFFER_MM) / dataRowCount
    );

    for (let attempt = 0; attempt < 8; attempt++) {
      doc.style.setProperty('--att-data-row-mm', `${dataRowMm.toFixed(2)}mm`);
      doc.classList.add('attendance-fit-applied');
      void doc.offsetHeight;
      if (doc.scrollHeight <= pageHeightPx * 0.992) break;
      const overflowMm = (doc.scrollHeight - pageHeightPx) / pxPerMm + 1.5;
      const nextRowMm = Math.max(ATTENDANCE_MIN_DATA_ROW_MM, dataRowMm - overflowMm / dataRowCount);
      if (nextRowMm >= dataRowMm - 0.03) break;
      dataRowMm = nextRowMm;
    }
  });
}

const SEAT_MAP_PAGE = {
  'a4-portrait': { heightMm: 273, widthMm: 186 },
  'a4-landscape': { heightMm: 190, widthMm: 277 },
  'b4-portrait': { heightMm: 348, widthMm: 241 },
  'b4-landscape': { heightMm: 237, widthMm: 344 }
};

const SEAT_MAP_FOOTER_RESERVE_MM = 2;
const SEAT_MAP_SAFETY_MM = 5;
const SEAT_MAP_MIN_CELL_MM = 8;
const SEAT_MAP_MIN_COL_LABEL_MM = 5;
const SEAT_MAP_FIT_MAX_ATTEMPTS = 16;
const SEAT_MAP_FIT_TOLERANCE = 0.992;

function measureSeatMapChromePx(doc, table) {
  let chrome = 0;
  Array.from(doc.children).forEach(child => {
    if (child === table) return;
    const style = getComputedStyle(child);
    chrome += child.offsetHeight;
    chrome += parseFloat(style.marginTop) || 0;
    chrome += parseFloat(style.marginBottom) || 0;
  });
  if (table) {
    const ts = getComputedStyle(table);
    chrome += parseFloat(ts.marginTop) || 0;
    chrome += parseFloat(ts.marginBottom) || 0;
  }
  return chrome;
}

function measureSeatMapTheadPx(table) {
  const thead = table?.querySelector('thead');
  return thead ? thead.offsetHeight : 0;
}

function getSeatMapPxPerMm(table, pageWidthMm) {
  const widthPx = table?.offsetWidth || 0;
  if (widthPx > 0 && pageWidthMm > 0) return widthPx / pageWidthMm;
  return 3.78;
}

function measureSeatMapDocHeightMm(doc, pxPerMm) {
  return doc.getBoundingClientRect().height / pxPerMm;
}

function applySeatMapCellSizing(doc, table, cellMm) {
  const colLabelMm = Math.max(
    SEAT_MAP_MIN_COL_LABEL_MM,
    Math.min(8, cellMm * 0.32)
  );
  doc.style.setProperty('--seat-cell-mm', `${cellMm.toFixed(2)}mm`);
  doc.style.setProperty('--seat-col-label-mm', `${colLabelMm.toFixed(2)}mm`);
  doc.classList.toggle('seat-map-compact', cellMm < 13.5);
  doc.classList.add('seat-map-fit-applied');
  void doc.offsetHeight;
  void table?.offsetHeight;
}

function resetSeatMapFit(doc) {
  doc.classList.remove('seat-map-fit-applied', 'seat-map-compact');
  doc.style.removeProperty('--seat-cell-mm');
  doc.style.removeProperty('--seat-col-label-mm');
  doc.style.removeProperty('width');
  doc.style.removeProperty('max-width');
}

function fitSingleSeatMapDoc(doc, page) {
  resetSeatMapFit(doc);

  const table = doc.querySelector('.seat-layout-table');
  if (!table) return;

  const bodyRows = parseInt(
    doc.dataset.seatBodyRows ||
    table.style.getPropertyValue('--seat-rows') ||
    getComputedStyle(table).getPropertyValue('--seat-rows') ||
    '5',
    10
  );
  if (!bodyRows) return;

  doc.style.setProperty('--seat-page-width-mm', `${page.widthMm}mm`);
  doc.style.setProperty('--seat-printable-height-mm', `${page.heightMm}mm`);
  doc.style.width = `${page.widthMm}mm`;
  doc.style.maxWidth = '100%';

  let pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
  const reserveMm = SEAT_MAP_FOOTER_RESERVE_MM + SEAT_MAP_SAFETY_MM;
  const pageLimitMm = page.heightMm * SEAT_MAP_FIT_TOLERANCE;

  const chromePx = measureSeatMapChromePx(doc, table);
  const theadPx = measureSeatMapTheadPx(table);
  let availableMm = page.heightMm - (chromePx / pxPerMm) - (theadPx / pxPerMm) - reserveMm;
  let cellMm = Math.max(SEAT_MAP_MIN_CELL_MM, availableMm / bodyRows);

  applySeatMapCellSizing(doc, table, cellMm);
  pxPerMm = getSeatMapPxPerMm(table, page.widthMm);

  for (let attempt = 0; attempt < SEAT_MAP_FIT_MAX_ATTEMPTS; attempt++) {
    const docHeightMm = measureSeatMapDocHeightMm(doc, pxPerMm);
    if (docHeightMm <= pageLimitMm) return;

    const overflowMm = docHeightMm - pageLimitMm + 1.2;
    const nextCellMm = Math.max(
      SEAT_MAP_MIN_CELL_MM,
      cellMm - overflowMm / bodyRows
    );
    if (nextCellMm >= cellMm - 0.02) break;
    cellMm = nextCellMm;
    applySeatMapCellSizing(doc, table, cellMm);
    pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
  }

  while (cellMm > SEAT_MAP_MIN_CELL_MM) {
    const docHeightMm = measureSeatMapDocHeightMm(doc, pxPerMm);
    if (docHeightMm <= pageLimitMm) return;
    cellMm = Math.max(SEAT_MAP_MIN_CELL_MM, cellMm - 0.4);
    applySeatMapCellSizing(doc, table, cellMm);
    pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
  }
}

function fitSeatMapsToPage() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const page = SEAT_MAP_PAGE[size] || SEAT_MAP_PAGE['a4-portrait'];
  $$('#output-preview .print-seat-map').forEach(doc => fitSingleSeatMapDoc(doc, page));
}

function fitOutputPreviewToPage() {
  fitAttendanceSheetsToPage();
  fitSeatMapsToPage();
}

function refreshOutputPreview() {
  renderOperationDashboard();
  if (Object.keys(appState.students).length) {
    appState._lastDiagnosis = runOperationDiagnosis();
  }
  renderOperationDiagnosis();
  renderOutputValidationBanner();
  const f = getFiltersFromCard(currentPreviewType);
  updatePrintSizeForCurrentOutput();
  $('#output-preview').innerHTML = renderOutputDocument(currentPreviewType, f);
  requestAnimationFrame(() => requestAnimationFrame(fitOutputPreviewToPage));
}

function handleExcelExport(outputType) {
  const type = outputType || currentPreviewType;
  if (!type) {
    alert('출력물을 선택하세요.');
    return;
  }
  if (!window.ExamFlowExcel) {
    alert('엑셀보내기 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    return;
  }
  const f = getFiltersFromCard(type);
  window.ExamFlowExcel.exportToExcel(type, f);
}

function handleDashboardExcelExport() {
  if (!window.ExamFlowExcel) {
    alert('엑셀보내기 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    return;
  }
  window.ExamFlowExcel.exportDashboardExcel();
}

let step5OutputInitialized = false;

function initStep5Output() {
  if (step5OutputInitialized) {
    refreshOutputFilters();
    refreshOutputPreview();
    return;
  }
  step5OutputInitialized = true;

  $$('.output-index-tab').forEach(tab => {
    tab.addEventListener('click', () => selectOutputType(tab.dataset.output));
  });

  $('#output-work-card')?.addEventListener('change', e => {
    const container = e.target.closest('.output-filters');
    if (!container) return;
    if (container.id === 'filters-personal' || container.id === 'filters-room-assignment' || container.id === 'filters-elective-students') {
      updatePersonalFilters(container);
    }
    refreshOutputPreview();
  });

  $('#btn-export-excel')?.addEventListener('click', () => handleExcelExport());
  $$('.btn-excel-export').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleExcelExport(btn.dataset.output);
    });
  });
  $('#btn-export-dashboard')?.addEventListener('click', handleDashboardExcelExport);
  $('#print-size-select')?.addEventListener('change', applyPrintSizeClass);

  window.addEventListener('beforeprint', () => {
    if (currentPreviewType === 'seat-map' || $$('#output-preview .print-seat-map').length) {
      fitSeatMapsToPage();
    }
  });

  refreshOutputFilters();
  selectOutputType('seat-map');
}

function applyPrintSizeClass() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  document.body.classList.remove(
    'print-size-a4-portrait', 'print-size-a4-landscape',
    'print-size-b4-landscape', 'print-size-b4-portrait'
  );
  document.body.classList.add(`print-size-${size}`);
  fitOutputPreviewToPage();
}

function preparePrintEnhancements() {
  removePrintEnhancements();
  fitOutputPreviewToPage();
}

function removePrintEnhancements() {
  $$('.print-page-footer').forEach(el => el.remove());
  [
    ['.print-attendance-matrix', 'attendance-fit-applied'],
    ['.print-seat-map', 'seat-map-fit-applied']
  ].forEach(([selector, appliedClass]) => {
    $$(selector).forEach(doc => {
      doc.classList.remove(appliedClass);
      doc.style.removeProperty('transform');
      doc.style.removeProperty('transform-origin');
      doc.style.removeProperty('width');
      doc.style.removeProperty('max-width');
      doc.style.removeProperty('margin-bottom');
      if (appliedClass === 'seat-map-fit-applied') {
        doc.classList.remove('seat-map-compact');
        doc.style.removeProperty('--seat-cell-mm');
        doc.style.removeProperty('--seat-col-label-mm');
        doc.style.removeProperty('--seat-page-width-mm');
        doc.style.removeProperty('--seat-printable-height-mm');
      }
      if (appliedClass === 'attendance-fit-applied') {
        doc.style.removeProperty('--att-data-row-mm');
      }
    });
  });
}

function getPrintDocumentTitle() {
  const f = getFiltersFromCard(currentPreviewType);
  if (currentPreviewType !== 'attendance') {
    if (currentPreviewType === 'seat-map') {
      return f.bulkPrint ? `좌석배치표_${f.day}일차_전체` : `좌석배치표_${f.room}`;
    }
    return document.title;
  }

  const d = appState.examMeta.dates[f.day];
  let dateSuffix = `${f.day}일차`;
  if (d) {
    const dt = new Date(d + 'T00:00:00');
    dateSuffix = `${dt.getMonth() + 1}.${dt.getDate()}`;
  }
  if (f.bulkPrint) return `응시현황표_${f.day}일차_전체`;
  const roomPart = f.room || '교실';
  return `응시현황표_${roomPart}반_${dateSuffix}`;
}

function printOutput() {
  if (!currentPreviewType) { alert('출력물을 선택하세요.'); return; }
  const blockMsg = getExportBlockingMessage();
  if (blockMsg) {
    alert(`출력이 차단되었습니다.\n\n⚠ ${blockMsg}\n\n「운영 진단 실행」으로 확인하세요.`);
    return;
  }
  const warnings = getCompactValidationWarnings();
  if (warnings.length && !confirm(`검증 경고가 있습니다.\n${warnings.join('\n')}\n\n그래도 인쇄하시겠습니까?`)) return;

  applyPrintSizeClass();
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const pageSizes = {
    'a4-portrait': 'A4 portrait',
    'a4-landscape': 'A4 landscape',
    'b4-landscape': 'B4 landscape',
    'b4-portrait': 'B4 portrait'
  };
  const marginMap = {
    'a4-portrait': '10mm 12mm 14mm',
    'a4-landscape': '8mm 10mm 12mm',
    'b4-landscape': '8mm 10mm 12mm',
    'b4-portrait': '6mm 8mm 10mm'
  };
  let styleEl = document.getElementById('dynamic-print-page');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-print-page';
    document.head.appendChild(styleEl);
  }
  const pageSize = pageSizes[size] || 'A4 portrait';
  const margin = marginMap[size] || '10mm 12mm 14mm';
  styleEl.textContent = `@media print {
    @page { size: ${pageSize}; margin: ${margin}; }
  }`;

  preparePrintEnhancements();
  document.body.classList.add('print-mode');
  requestAnimationFrame(() => {
    fitOutputPreviewToPage();
    requestAnimationFrame(() => {
      const prevTitle = document.title;
      document.title = getPrintDocumentTitle();
      window.print();
      setTimeout(() => {
        document.title = prevTitle;
        removePrintEnhancements();
        document.body.classList.remove(
          'print-mode', 'print-size-a4-portrait', 'print-size-a4-landscape',
          'print-size-b4-landscape', 'print-size-b4-portrait'
        );
      }, 500);
    });
  });
}

/* ========== Storage ========== */

let autoSaveTimer = null;
let autoSavePaused = false;

function syncStateToWindow() {
  window.examFlowState = appState;
  scheduleAutoSave();
}

function scheduleAutoSave() {
  if (autoSavePaused) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveToLocalSilent(), 500);
}

function collectAllSettings() {
  collectMetaFromDOM();
  collectTimetableFromDOM();
  collectMovementRulesFromDOM();
  collectSeatDefaultsFromDOM();
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
  collectAllSettings();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    alert('작업이 저장되었습니다. (localStorage)');
  } catch (e) {
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
  normalizeMoveRulesInState();
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
    alert('작업을 불러왔습니다.');
  } catch (e) {
    alert('불러오기 실패: ' + e.message);
  }
}

function exportJson() {
  collectAllSettings();
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
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

  renderUnifiedTimetable();
  renderMovementRules();
  rebuildMoveTargetCache();
  renderMovementPreview();
  renderSeatConfigPreview();
  renderRoomsGradeSetup();
  renderRoomsList();

  [1, 2, 3].forEach(g => {
    const count = Object.values(appState.students).filter(s => s.grade === g).length;
    const statusEl = $(`#status-grade-${g}`);
    if (count) {
      statusEl.textContent = `완료 (${count}명)`;
      statusEl.classList.add('done');
    }
  });

  renderStudentSummary();
  renderSubjectStats();
  renderStudentList();
  populateExamGroupFilters();
  renderExamGroupsTable();
  renderRoomOccupancyPanel();
  markPlacementDirty();
  initStep5Output();
  applyLockStateToUI();
  syncStateToWindow();
}

/* ========== Navigation ========== */

function initStepNav() {
  $$('.step-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const step = tab.dataset.step;
      $$('.step-tab').forEach(t => t.classList.remove('active'));
      $$('.step-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#step-${step}`).classList.add('active');
      if (step === '4') {
        if (placementEditorDirty) initPlacementEditor();
        else requestAnimationFrame(() => renderPlacementValidationBanner());
      }
      if (step === '5') initStep5Output();
    });
  });
}

/* ========== Event Bindings ========== */

function initEvents() {
  $('#btn-apply-meta').addEventListener('click', applyExamMeta);
  $('#meta-days').addEventListener('change', () => {
    renderExamDates();
    renderUnifiedTimetable();
  });
  $('#meta-periods')?.addEventListener('change', renderUnifiedTimetable);
  $('#exam-dates-container')?.addEventListener('change', e => {
    if (e.target.classList.contains('exam-date-input')) renderUnifiedTimetable();
  });
  $('#btn-save-timetable').addEventListener('click', saveTimetable);

  $('#movement-rules-container').addEventListener('change', () => {
    saveMovementRules();
    renderMovementPreview();
  });
  $('#movement-rules-container').addEventListener('input', () => {
    saveMovementRules();
    renderMovementPreview();
  });
  $('#movement-preview-select')?.addEventListener('change', renderMovementPreview);
  ['#seat-rows', '#seat-cols', '#seat-fill-direction', '#seat-move-column', '#seat-door-side'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => {
      renderSeatConfigPreview();
      saveSeatDefaults();
    });
    el.addEventListener('input', renderSeatConfigPreview);
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
      refreshOutputPreview();
    }
  });

  $('#btn-save-local').addEventListener('click', saveToLocal);
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
}

/* ========== Init ========== */

function init() {
  autoSavePaused = true;
  normalizeMoveRulesInState();

  const loaded = tryLoadLocalOnInit();
  if (!loaded) {
    renderExamDates();
    renderUnifiedTimetable();
    renderMovementRules();
    renderMovementPreview();
    renderSeatConfigPreview();
    renderRoomsGradeSetup();
    renderRoomsList();
    renderStudentSummary();
    renderStudentList();
    renderSubjectStats();
    renderRoomOccupancyPanel();
  }

  initStepNav();
  initEvents();
  initPlacementEditorEvents();
  initStep5Output();
  applyLockStateToUI();
  autoSavePaused = false;
  window.examFlowState = appState;
}

window.examFlowExportApi = {
  getSchoolNameLine,
  getExamTitleLine,
  getExamMeta: () => appState.examMeta,
  getPeriodsPerDay: () => appState.examMeta.periodsPerDay,
  getClassAssignmentData,
  getRoomAssignmentData,
  getRoomOperationData,
  getOperationDashboardStats,
  getAttendanceRows,
  getAttendanceRoomDayData,
  getAttendanceGroupRowCount,
  getRoomsForDay,
  getRoomsForSession,
  getSortedRoomNames,
  sortClassRoomNames,
  compareClassRoomNames,
  getPlacementBlockingErrors,
  getExportBlockingMessage,
  getUnassignedStudentCount,
  getSeatInfoForStudent,
  getSeatDataForSession,
  getSeatMapBulkRooms,
  getMoveStudentColumns,
  getClassRooms: () => getClassRooms(),
  hasFixedRoomSeats,
  getResidentsForRoom,
  getSeatConfig,
  usesSplitColumnLayout,
  formatSeatNumberLabel,
  formatSeatLabelForStudent,
  getSplitSeatLabelAtCoord,
  getExamTitleShort,
  getElectiveStudentsColumns,
  buildElectiveStudentsTableHtml,
  formatElectiveStudentNumber,
  getPersonalScheduleData,
  sortStudentsByClass,
  examGroupKey,
  maskName,
  isAbsenceNote,
  runOperationDiagnosis,
  getOperationDiagnosisErrors
};

document.addEventListener('DOMContentLoaded', init);
