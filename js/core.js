/** Exam Flow — js/core.js (classic script, file:// 호환. ES module 아님) */

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
    /** exam=응시, host=미응시·교실만 제공, off=완전 미참여 */
    gradeParticipation: { 1: 'exam', 2: 'exam', 3: 'exam' },
    movementRules: {
      1: { enabled: false, targetGrade: null, mode: 'from-front', count: 14, rangeStart: 1, rangeEnd: 14 },
      2: { enabled: false, targetGrade: 1, mode: 'from-front', count: 14, rangeStart: 1, rangeEnd: 14 },
      3: { enabled: false, targetGrade: 2, mode: 'from-front', count: 14, rangeStart: 1, rangeEnd: 14 }
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

/* ========== Grade Participation ========== */

const ALL_GRADES = [1, 2, 3];
const GRADE_PARTICIPATION_MODES = ['exam', 'host', 'off'];
const GRADE_PARTICIPATION_LABELS = {
  exam: '응시',
  host: '교실만 제공',
  off: '미참여'
};

const GRADE_PARTICIPATION_HINTS = {
  exam: '시간표·이동·좌석·출력에 포함',
  host: '미응시 · 타학년 이동 교실로만 사용',
  off: '이번 고사에서 완전 제외'
};

function normalizeGradeParticipationMode(mode) {
  return GRADE_PARTICIPATION_MODES.includes(mode) ? mode : 'exam';
}

function ensureGradeParticipationState() {
  if (!appState.examRules.gradeParticipation) {
    appState.examRules.gradeParticipation = { 1: 'exam', 2: 'exam', 3: 'exam' };
  }
  ALL_GRADES.forEach(g => {
    appState.examRules.gradeParticipation[g] = normalizeGradeParticipationMode(
      appState.examRules.gradeParticipation[g]
    );
  });
}

function getGradeParticipation(grade) {
  ensureGradeParticipationState();
  return appState.examRules.gradeParticipation[grade] || 'exam';
}

/** 이번 고사에 응시하는 학년 */
function isGradeTakingExam(grade) {
  return getGradeParticipation(grade) === 'exam';
}

/** 학급 교실을 고사실로 쓰는 학년 (응시 또는 교실만 제공) */
function isGradeHostingRooms(grade) {
  const mode = getGradeParticipation(grade);
  return mode === 'exam' || mode === 'host';
}

function getExamGrades() {
  return ALL_GRADES.filter(isGradeTakingExam);
}

function getHostingGrades() {
  return ALL_GRADES.filter(isGradeHostingRooms);
}

function describeGradeParticipationSummary() {
  const exam = getExamGrades();
  const host = ALL_GRADES.filter(g => getGradeParticipation(g) === 'host');
  const off = ALL_GRADES.filter(g => getGradeParticipation(g) === 'off');
  const parts = [];
  if (exam.length) parts.push(`${exam.join('·')}학년 응시`);
  if (host.length) parts.push(`${host.join('·')}학년 교실만 제공`);
  if (off.length) parts.push(`${off.join('·')}학년 미참여`);
  return parts.join(' · ') || '학년 참여 설정을 확인하세요';
}

/** 응시 학년의 이동/본반 잔류 한줄 요약 */
function describeMovementOverviewSummary() {
  const parts = [];
  getExamGrades().forEach(g => {
    const rule = getMoveRules(g);
    if (rule.enabled && rule.targetGrade) {
      parts.push(`${g}학년→${rule.targetGrade}학년 (${describeMoveRule(rule)})`);
    } else {
      parts.push(`${g}학년 본반 잔류`);
    }
  });
  ALL_GRADES.filter(g => getGradeParticipation(g) === 'host').forEach(g => {
    parts.push(`${g}학년 교실 제공`);
  });
  ALL_GRADES.filter(g => getGradeParticipation(g) === 'off').forEach(g => {
    parts.push(`${g}학년 미참여`);
  });
  return parts.join(' · ') || '이동·잔류 설정을 확인하세요';
}

function describeOpsSetupLiveSummary() {
  return `${describeGradeParticipationSummary()} ｜ ${describeMovementOverviewSummary()}`;
}

function sanitizeMovementRulesForParticipation() {
  ensureGradeParticipationState();
  ALL_GRADES.forEach(g => {
    const rule = appState.examRules.movementRules[g];
    if (!rule) return;
    if (!isGradeTakingExam(g)) {
      rule.enabled = false;
    }
    if (rule.targetGrade != null && !isGradeHostingRooms(rule.targetGrade)) {
      rule.targetGrade = null;
      rule.enabled = false;
    }
  });
}

/** 미응시 학년의 일정·그룹·고정좌석 정리 */
function pruneNonExamOperationalData() {
  Object.keys(appState.studentExamSchedules || {}).forEach(id => {
    const st = appState.students[id];
    if (!st || !isGradeTakingExam(st.grade)) delete appState.studentExamSchedules[id];
  });
  appState.examGroups = (appState.examGroups || []).filter(g => isGradeTakingExam(g.grade));
  Object.keys(appState.fixedRoomSeats || {}).forEach(id => {
    const st = appState.students[id];
    if (!st || !isGradeTakingExam(st.grade)) delete appState.fixedRoomSeats[id];
  });
  Object.keys(appState.seatAssignments || {}).forEach(id => {
    const st = appState.students[id];
    if (!st || !isGradeTakingExam(st.grade)) delete appState.seatAssignments[id];
  });
}

/* ========== Move Rules (이동반) ========== */

const MOVE_MODES = ['from-front', 'from-back', 'from-number', 'range'];

function normalizeMoveMode(mode) {
  return MOVE_MODES.includes(mode) ? mode : 'range';
}

function getMoveRules(grade) {
  const rule = appState.examRules.movementRules[grade] || {};
  const fromNumber = rule.fromNumber ?? rule.rangeStart ?? 1;
  const toNumber = rule.toNumber ?? rule.rangeEnd ?? 14;
  const mode = normalizeMoveMode(rule.mode || (rule.fromNumber || rule.rangeStart ? 'range' : 'from-front'));
  const inferredCount = Math.max(1, toNumber - fromNumber + 1);
  return {
    enabled: !!rule.enabled,
    targetGrade: rule.targetGrade ?? null,
    mode,
    fromNumber,
    toNumber,
    count: Math.max(1, parseInt(rule.count, 10) || inferredCount)
  };
}

function getMoveTargetCount(rule) {
  if (!rule) return 0;
  if (rule.mode === 'range') {
    return Math.max(0, (rule.toNumber || 0) - (rule.fromNumber || 0) + 1);
  }
  return Math.max(0, parseInt(rule.count, 10) || 0);
}

function describeMoveRule(rule) {
  const count = getMoveTargetCount(rule);
  switch (rule.mode) {
    case 'from-front': return `앞번호부터 ${count}명`;
    case 'from-back': return `뒷번호부터 ${count}명`;
    case 'from-number': return `${rule.fromNumber}번부터 ${count}명`;
    default: return `번호 ${rule.fromNumber}~${rule.toNumber} (${count}명)`;
  }
}

function normalizeMoveRulesInState() {
  [1, 2, 3].forEach(g => {
    const rule = appState.examRules.movementRules[g];
    if (!rule) return;
    rule.fromNumber = rule.fromNumber ?? rule.rangeStart ?? 1;
    rule.toNumber = rule.toNumber ?? rule.rangeEnd ?? 14;
    rule.rangeStart = rule.fromNumber;
    rule.rangeEnd = rule.toNumber;
    if (!rule.mode) {
      rule.mode = (rule.fromNumber === 1 && rule.toNumber) ? 'from-front' : 'range';
      if (rule.mode === 'from-front') rule.count = rule.toNumber;
    }
    rule.mode = normalizeMoveMode(rule.mode);
    rule.count = Math.max(1, parseInt(rule.count, 10) || Math.max(1, rule.toNumber - rule.fromNumber + 1));
  });
}

function getMoveTargetStudentIdsByClass(grade, classNo) {
  const rule = getMoveRules(grade);
  if (!isGradeTakingExam(grade)) return [];
  if (!rule.enabled || !rule.targetGrade) return [];
  if (!isGradeHostingRooms(rule.targetGrade)) return [];

  const students = Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo)
    .sort((a, b) => a.number - b.number);

  const targetCount = getMoveTargetCount(rule);
  if (!targetCount || !students.length) return [];

  if (rule.mode === 'from-front') {
    return students.slice(0, targetCount).map(s => s.studentId);
  }
  if (rule.mode === 'from-back') {
    return students.slice(-targetCount).map(s => s.studentId);
  }
  if (rule.mode === 'from-number') {
    return students.filter(s => s.number >= rule.fromNumber).slice(0, targetCount).map(s => s.studentId);
  }
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
  return Number(a) - Number(b);
}

function compareGradeClass(gradeA, classA, gradeB, classB) {
  if (gradeA !== gradeB) return gradeA - gradeB;
  return Number(classA) - Number(classB);
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
  return [...new Set(classNos.map(n => Number(n)).filter(n => Number.isFinite(n)))].sort(compareClassNos);
}

function getOrderedClassNosForGrade(grade) {
  const classNos = new Set();
  getClassRooms().forEach(r => {
    const parsed = parseClassRoomName(r.name);
    if (parsed && parsed.grade === grade) classNos.add(parsed.classNo);
  });
  Object.values(appState.students).forEach(s => {
    if (s.grade === grade) classNos.add(s.classNo);
  });
  return sortClassNos([...classNos]);
}

/** 출력 탭 고사실 목록 — 학년·반(1~12) 숫자 순 */
function getOutputRoomNames(grade) {
  const classNames = getClassRooms()
    .map(r => r.name)
    .filter(name => {
      if (!grade) return true;
      const parsed = parseClassRoomName(name);
      return parsed && parsed.grade === grade;
    });
  const sortedClass = sortClassRoomNames(classNames);
  if (grade) return sortedClass;
  const others = appState.rooms
    .filter(r => r.type !== 'class')
    .map(r => r.name)
    .sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  return [...sortedClass, ...others];
}

function updateOutputRoomFilter(container) {
  const roomSel = container?.querySelector('.filter-room');
  if (!roomSel) return;
  const gradeSel = container.querySelector('.filter-grade');
  const grade = gradeSel ? parseInt(gradeSel.value, 10) : null;
  const prev = roomSel.value;
  const rooms = getOutputRoomNames(Number.isFinite(grade) ? grade : null);
  roomSel.innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  if (prev && rooms.includes(prev)) roomSel.value = prev;
  else if (rooms.length) roomSel.value = rooms[0];
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
  if (!isGradeHostingRooms(parsed.grade)) return [];

  rebuildMoveTargetCache();
  const { grade: homeGrade, classNo: homeClassNo } = parsed;
  const residentIds = new Set();

  // 본반 잔류: 응시 학년만 (host/off 학년 학생은 좌석·출력 제외)
  if (isGradeTakingExam(homeGrade)) {
    getStudentsInClass(homeGrade, homeClassNo).forEach(s => {
      if (!isMoveTargetStudent(s)) residentIds.add(s.studentId);
    });
  }

  Object.values(appState.students).forEach(s => {
    if (!isGradeTakingExam(s.grade)) return;
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
    const coord = resolveSeatRowCol(room, fixed.seatNo, fixed.seatGroup, fixed.isMoveStudent)
      || (fixed.row && fixed.col ? { row: fixed.row, col: fixed.col } : null)
      || positions.find(p => p.seatNo === fixed.seatNo);
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

    const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
    const moveCount = residents.length - homeCount;
    if (roomHasIncomingMovers(room.name, residents)) {
      const caps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
      if (homeCount > caps.home || moveCount > caps.move) overflowCount++;
    } else if (residents.length > seatConfig.rows * seatConfig.cols) {
      overflowCount++;
    }

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
    panel.innerHTML = '<p class="hint">학생 데이터 업로드 후 교실별 배치 현황이 표시됩니다.</p>';
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
    '<th>교실</th><th>배치 인원</th><th>정원</th><th>좌석 수</th><th>상태</th></tr></thead><tbody>';

  const splitCaps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
  const fullCap = seatConfig.rows * seatConfig.cols;
  classRooms.forEach(room => {
    const residents = getResidentsForRoom(room.name);
    const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
    const moveCount = residents.length - homeCount;
    const split = roomHasIncomingMovers(room.name, residents);
    const overCap = residents.length > room.capacity;
    const overSeats = split
      ? (homeCount > splitCaps.home || moveCount > splitCaps.move)
      : residents.length > fullCap;
    const status = overSeats
      ? '<span class="validation-error">좌석 초과</span>'
      : overCap
        ? '<span class="validation-warn">정원 초과</span>'
        : '<span class="validation-ok">정상</span>';
    const peopleLabel = split
      ? `${residents.length}명 (본 반 ${homeCount} · 이동반 ${moveCount})`
      : `${residents.length}명 (본반만)`;
    const seatLabel = split
      ? `본반 ${splitCaps.home} · 이동반 ${splitCaps.move}`
      : `전좌석 ${fullCap}`;
    html += `<tr>
      <td>${room.name}</td>
      <td>${peopleLabel}</td>
      <td>${room.capacity}명</td>
      <td>${seatLabel}</td>
      <td>${status}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  html += '<p class="hint" style="margin-top:0.5rem">반=교실 원칙: 이동 유입이 있으면 본반·이동반 열 분리, 없으면 전좌석을 본반 기준으로 배치합니다.</p>';
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
  const targetCount = getMoveTargetCount(rule);

  container.innerHTML = `
    <div class="move-preview-panel">
      <h4>${g}학년 ${classNo}반 이동 대상: ${ids.length}명 (목표 ${targetCount}명)</h4>
      <div class="move-preview-meta">방식: ${describeMoveRule(rule)}</div>
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

  // 설정 미리보기는 「이동 유입 교실」분리 배치 예시 (실제 배정은 교실별 유입 여부로 분기)
  const classTable = buildSeatPreviewTable(rows, cols, (r, c) => ({
    label: getSplitSeatLabelAtCoord('1-1', r, c, seatConfig),
    groupClass: isMoveColumn(c, moveMode) ? 'seat-preview-move' : 'seat-preview-home'
  }));
  const classCaps = getSplitSeatCapacities(rows, cols, moveMode);
  const moveColLabel = moveMode === 'odd' ? '홀수열' : '짝수열';
  const fullCap = rows * cols;

  container.innerHTML = `
    <p class="seat-preview-title">이동 유입 시 미리보기 <span class="seat-preview-meta">${rows}행 × ${cols}열 · 본반 ${classCaps.home}석 · 이동반 ${classCaps.move}석</span></p>
    ${classTable}
    <div class="seat-map-footer seat-preview-footer"><div class="door-marker door-${doorSide}">🚪 출입문</div></div>
    <p class="hint seat-preview-legend">회색 음영: ${moveColLabel} · 이동반. 이동 유입이 없는 교실은 전좌석 ${fullCap}석을 순서대로 사용합니다.</p>`;
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

/** 교실에 이동 유입 학생이 있는지 (배정 시 studentIds 전달 가능) */
function roomHasIncomingMovers(roomName, studentIds) {
  if (!parseClassRoomName(roomName)) return false;

  if (Array.isArray(studentIds)) {
    return studentIds.some(id => {
      const st = appState.students[id];
      return st && isMoveTargetStudent(st);
    });
  }

  const fixed = appState.fixedRoomSeats || {};
  let sawRoom = false;
  for (const fs of Object.values(fixed)) {
    if (fs.roomName !== roomName) continue;
    sawRoom = true;
    if (fs.isMoveStudent || fs.seatGroup === 'move') return true;
  }
  if (sawRoom) return false;

  return getResidentsForRoom(roomName).some(id => isMoveTargetStudent(appState.students[id]));
}

/**
 * 교실 좌석: 이동 유입이 있을 때만 본반·이동반 열 분리.
 * 유입이 없으면 전좌석을 채움 방향대로 사용.
 */
function usesSplitColumnLayout(roomName, studentIds) {
  if (!parseClassRoomName(roomName)) return false;
  return roomHasIncomingMovers(roomName, studentIds);
}

/** 교실 좌석번호 표기: 분리 시 본반1~N / 이동1~N, 비분리 시 숫자만 */
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

/** 분리 배치 좌표 → 본반N/이동N 라벨 (설정 미리보기용, 항상 분리 가정) */
function getSplitSeatLabelAtCoord(roomName, row, col, seatConfig) {
  const { rows, cols } = seatConfig;
  const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const isMove = isMoveColumn(col, moveMode);
  const groupParity = isMove ? moveMode : getHomeColumnMode(moveMode);
  const pos = generateGroupColumnPositions(rows, cols, groupParity)
    .find(p => p.row === row && p.col === col);
  if (!pos) return '';
  const n = pos.seatNo;
  return isMove ? `이동${n}` : `본반${n}`;
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

function resolveSeatRowCol(roomName, seatNo, seatGroup, isMoveStudent) {
  const seatConfig = getSeatConfig();
  const num = parseInt(seatNo, 10);
  if (!roomName || !Number.isFinite(num) || num < 1) return null;

  const isMove = seatGroup === 'move' || !!isMoveStudent;
  // 좌석 해석: 이동생·이동 그룹이면 분리 좌표, 그 외는 교실 실제 분리 여부 따름
  const useSplit = isMove || usesSplitColumnLayout(roomName);
  if (useSplit && parseClassRoomName(roomName)) {
    const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
    const parity = isMove ? moveMode : getHomeColumnMode(moveMode);
    const pos = generateGroupColumnPositions(seatConfig.rows, seatConfig.cols, parity)
      .find(p => p.seatNo === num);
    return pos ? { row: pos.row, col: pos.col } : null;
  }

  const pos = generateSeatPositions(seatConfig.rows, seatConfig.cols, seatConfig.fillDirection)
    .find(p => p.seatNo === num);
  return pos ? { row: pos.row, col: pos.col } : null;
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
  let ordered;
  switch (fillDirection) {
    case 'back-to-front':
      // 왼쪽 열부터, 각 열은 뒤→앞
      ordered = [];
      for (let c = 1; c <= cols; c++) {
        for (let r = rows; r >= 1; r--) ordered.push({ row: r, col: c });
      }
      break;
    case 'right-to-left':
      // 오른쪽 열부터, 각 열은 앞→뒤
      ordered = [];
      for (let c = cols; c >= 1; c--) {
        for (let r = 1; r <= rows; r++) ordered.push({ row: r, col: c });
      }
      break;
    case 'left-to-right':
    case 'front-to-back':
    default:
      // 왼쪽 열부터 1번, 같은 열에서 앞→뒤(2번…) — 이동 없음 교실·출력물 기준
      ordered = [];
      for (let c = 1; c <= cols; c++) {
        for (let r = 1; r <= rows; r++) ordered.push({ row: r, col: c });
      }
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
  if (usesSplitColumnLayout(roomName, studentIds)) {
    return assignSeatsSplitByColumn(roomName, studentIds, seatConfig);
  }

  // 이동 유입 없음: 전좌석을 채움 방향대로 사용 (본반1… 아님, 1…N)
  const positions = generateSeatPositions(seatConfig.rows, seatConfig.cols, seatConfig.fillDirection);
  const sorted = sortStudentsByClass(studentIds);
  const results = [];
  sorted.forEach((id, idx) => {
    const pos = positions[idx];
    if (!pos) return;
    const isMove = isMoveTargetStudent(appState.students[id]);
    results.push({
      studentId: id,
      seatNo: pos.seatNo,
      row: pos.row,
      col: pos.col,
      isMoveStudent: !!isMove,
      seatGroup: isMove ? 'move' : 'home'
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

function getActualRoomForStudent(studentId) {
  return appState.fixedRoomSeats?.[studentId]?.roomName
    || getFixedRoomForStudent(studentId)
    || '';
}

function getFixedAssignedRoomNames(day, period) {
  const names = new Set();
  appState.examGroups.forEach(g => {
    if (g.day !== day || g.period !== period) return;
    g.students.forEach(id => {
      const room = appState.fixedRoomSeats?.[id]?.roomName;
      if (room) names.add(room);
    });
  });
  return names;
}

function getSeatInfoForStudent(studentId, day, period, subject) {
  const fs = appState.fixedRoomSeats?.[studentId];
  if (!fs) return null;
  const seats = appState.seatAssignments[studentId] || [];
  const slot = seats.find(s => s.day === day && s.period === period);
  return {
    ...fs,
    day,
    period,
    subject: slot?.subject || subject || ''
  };
}

