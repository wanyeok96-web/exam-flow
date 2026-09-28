/** Exam Flow — js/outputs.js (classic script, file:// 호환. ES module 아님) */

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
  personal: 'b4-landscape',
  'room-assignment': 'a4-portrait'
};

const ELECTIVE_STUDENTS_MIN_ROWS = 20;

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

function sanitizeDownloadFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function formatRoomGradeClassLabel(roomName, gradeFallback) {
  const parsed = parseClassRoomName(roomName);
  if (parsed) return `${parsed.grade}학년 ${parsed.classNo}반`;
  if (Number.isFinite(gradeFallback)) return `${gradeFallback}학년`;
  return roomName || '고사실';
}

function getExamDateSlash(day) {
  const d = appState.examMeta.dates[day];
  if (!d) return `${day}일차`;
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function getOutputDownloadFilename(type, f) {
  const examTitle = getExamTitleLine();
  const bulk = !!f.bulkPrint;
  const allGrades = f.bulkScope === 'all-grades';

  switch (type) {
    case 'seat-map': {
      const layout = getSeatMapLayoutLabel(f.seatMapLayout || 'board');
      if (allGrades) {
        return sanitizeDownloadFilename(`${examTitle}_좌석배치도(${layout})_전체학년`);
      }
      if (bulk) {
        return sanitizeDownloadFilename(`${examTitle}_좌석배치도(${layout})_${f.grade}학년 전체`);
      }
      return sanitizeDownloadFilename(
        `${examTitle}_좌석배치도(${layout})_${formatRoomGradeClassLabel(f.room, f.grade)}`
      );
    }
    case 'attendance': {
      if (allGrades) {
        return sanitizeDownloadFilename(`${examTitle}_응시 현황표_전체`);
      }
      const datePart = getExamDateSlash(f.day);
      if (bulk) {
        return sanitizeDownloadFilename(`${examTitle}_응시 현황표(${datePart})_전체`);
      }
      return sanitizeDownloadFilename(
        `${examTitle}_응시 현황표(${datePart})_${formatRoomGradeClassLabel(f.room)}`
      );
    }
    case 'elective-students': {
      if (bulk || allGrades) {
        return sanitizeDownloadFilename(`${examTitle}_선택과목 응시 현황_전체`);
      }
      return sanitizeDownloadFilename(
        `${examTitle}_선택과목 응시 현황_${formatRoomGradeClassLabel(f.room)}`
      );
    }
    case 'personal': {
      if (allGrades) {
        return sanitizeDownloadFilename(`${examTitle}_개인별 시험 시간표_전체`);
      }
      if (bulk) {
        return sanitizeDownloadFilename(`${examTitle}_개인별 시험 시간표_${f.grade}학년 전체`);
      }
      return sanitizeDownloadFilename(
        `${examTitle}_개인별 시험 시간표_${f.grade}학년 ${f.classNo}반`
      );
    }
    case 'room-assignment': {
      if (bulk || allGrades) {
        return sanitizeDownloadFilename(`${examTitle}_시험실배정현황_${f.day || 1}일차_전체`);
      }
      return sanitizeDownloadFilename(
        `${examTitle}_시험실배정현황_${f.day || 1}일차_${f.grade}학년 ${f.classNo}반`
      );
    }
    default:
      return sanitizeDownloadFilename(document.title);
  }
}

function formatElectiveStudentNumber(num) {
  if (num == null || num === '') return '';
  return num < 10 ? String(num).padStart(2, '0') : String(num);
}

function getActiveGrades() {
  return getExamGrades().filter(g =>
    Object.values(appState.students).some(s => s.grade === g) ||
    getOrderedClassNosForGrade(g).length > 0
  );
}

function getSeatMapBulkGrades() {
  return getHostingGrades().filter(g => getOrderedClassNosForGrade(g).length > 0);
}

function getElectiveStudentGradesInRoom(roomName) {
  if (!roomName) return [];
  const grades = new Set();
  Object.keys(appState.seatAssignments).forEach(studentId => {
    const st = appState.students[studentId];
    if (!st) return;
    (appState.seatAssignments[studentId] || []).forEach(seat => {
      const eff = getEffectivePlacement(studentId, seat.day, seat.period);
      if (!eff || eff.roomName !== roomName) return;
      if (!eff.subject || !isElectiveExamForStudent(studentId, seat.day, seat.period, eff.subject)) return;
      grades.add(st.grade);
    });
  });
  return [...grades].sort((a, b) => a - b);
}

function getElectiveStudentsColumnsForRoom(roomName, studentGrade) {
  if (!roomName) return [];

  const slotMap = new Map();
  Object.keys(appState.seatAssignments).forEach(studentId => {
    const st = appState.students[studentId];
    if (!st) return;
    if (studentGrade != null && st.grade !== studentGrade) return;

    (appState.seatAssignments[studentId] || []).forEach(seat => {
      const eff = getEffectivePlacement(studentId, seat.day, seat.period);
      if (!eff || eff.roomName !== roomName) return;
      if (!eff.subject || !isElectiveExamForStudent(studentId, seat.day, seat.period, eff.subject)) return;

      const key = `${seat.day}-${seat.period}-${eff.subject}`;
      if (!slotMap.has(key)) {
        slotMap.set(key, {
          day: seat.day,
          period: seat.period,
          subject: eff.subject,
          dateLabel: formatDate(seat.day),
          periodLabel: `${seat.period}교시`,
          studentIds: new Set()
        });
      }
      slotMap.get(key).studentIds.add(studentId);
    });
  });

  return [...slotMap.values()]
    .sort((a, b) => a.day - b.day || a.period - b.period || a.subject.localeCompare(b.subject, 'ko'))
    .map(slot => ({
      day: slot.day,
      period: slot.period,
      subject: slot.subject,
      dateLabel: slot.dateLabel,
      periodLabel: slot.periodLabel,
      students: sortStudentsByClass([...slot.studentIds]).map(id => {
        const st = appState.students[id];
        return { number: st.number, name: st.name };
      })
    }))
    .filter(col => col.students.length > 0);
}

function getElectiveStudentsSectionsForRoom(roomName) {
  return getElectiveStudentGradesInRoom(roomName)
    .map(grade => ({
      grade,
      columns: getElectiveStudentsColumnsForRoom(roomName, grade)
    }))
    .filter(section => section.columns.length > 0);
}

/** @deprecated 고사실 기준 API 사용 — getElectiveStudentsColumnsForRoom */
function getElectiveStudentsColumns(grade, classNo) {
  return getElectiveStudentsColumnsForRoom(`${grade}-${classNo}`);
}

function formatElectiveRoomHeader(roomName, studentGrade) {
  const parsed = parseClassRoomName(roomName);
  const gradeLine = studentGrade != null ? `${studentGrade}학년 선택과목 응시 학생` : '선택과목 응시 학생';
  if (parsed) {
    const isResident = studentGrade === parsed.grade;
    const audience = studentGrade == null
      ? '본 반·이동 학생 포함'
      : isResident ? '본 반 학생' : `${studentGrade}학년 이동 학생`;
    return {
      roomLabel: `[${roomName}반 교실]`,
      subtitle: `${parsed.grade}학년 ${parsed.classNo}반 고사실 · ${gradeLine}`,
      roomLine: `시험실: ${roomName} · ${audience}`
    };
  }
  return {
    roomLabel: `[${roomName}]`,
    subtitle: `${roomName} · ${gradeLine}`,
    roomLine: studentGrade != null ? `시험실: ${roomName} · ${studentGrade}학년` : `시험실: ${roomName}`
  };
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

  const rowCount = Math.max(
    ELECTIVE_STUDENTS_MIN_ROWS,
    ...columns.map(col => col.students.length)
  );

  let body = '';
  for (let r = 0; r < rowCount; r++) {
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

function renderElectiveStudentsGradePage(roomName, studentGrade, columns) {
  const header = formatElectiveRoomHeader(roomName, studentGrade);
  const table = buildElectiveStudentsTableHtml(columns);

  return `<div class="print-doc print-elective-students">
    ${renderDocValidationInline()}
    <header class="doc-header doc-header-print es-header">
      ${getSchoolNameLine() ? `<p class="doc-school">${getSchoolNameLine()}</p>` : ''}
      <h1>${getExamTitleShort()}</h1>
      <p class="doc-sub es-subtitle">${header.roomLabel} ${header.subtitle}</p>
      <p class="es-room-label">${header.roomLine}</p>
    </header>
    ${table}
  </div>`;
}

function renderElectiveStudentsPage(roomName) {
  const sections = getElectiveStudentsSectionsForRoom(roomName);
  if (!sections.length) {
    return `<div class="print-doc print-elective-students"><p class="hint">${roomName || '고사실'} · 해당 교실에서 응시하는 선택과목 데이터가 없습니다.</p></div>`;
  }

  return sections.map(({ grade, columns }) =>
    renderElectiveStudentsGradePage(roomName, grade, columns)
  ).join('');
}

function renderElectiveStudentsDocument(f) {
  if (f.bulkPrint) {
    const rooms = getOutputRoomNames();
    if (!rooms.length) return '<p class="hint">고사실이 없습니다.</p>';
    return `<div class="elective-students-batch">${rooms.map(r => renderElectiveStudentsPage(r)).join('')}</div>`;
  }
  if (!f.room) return '<p class="hint">고사실을 선택하세요.</p>';
  return `<div class="elective-students-batch">${renderElectiveStudentsPage(f.room)}</div>`;
}

function mapPersonalScheduleEntry(studentId, entry) {
  const eff = getEffectivePlacement(studentId, entry.day, entry.period);
  return {
    day: entry.day,
    date: formatDateShort(entry.day),
    period: entry.period,
    subject: eff?.subject ?? entry.subject,
    room: eff?.roomName || '-',
    seatNo: eff?.seatNo ?? '-'
  };
}

function getPersonalScheduleData(studentId) {
  const st = appState.students[studentId];
  if (!st) return null;
  const schedule = (appState.studentExamSchedules[studentId] || [])
    .map(entry => mapPersonalScheduleEntry(studentId, entry))
    .sort((a, b) => a.day - b.day || a.period - b.period);
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
      const coord = resolveSeatRowCol(eff.roomName, eff.seatNo, eff.seatGroup, eff.isMoveStudent)
        || (eff.row && eff.col ? { row: eff.row, col: eff.col } : null)
        || seatNoToCoord[eff.seatNo];
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
  if (group.isHome || count >= 20) return Math.max(count, ATTENDANCE_DATA_ROWS);
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
    return `<div class="print-doc print-attendance"><p class="hint">${room} 교실에 배치된 학생이 없습니다.</p></div>`;
  }

  const roomLabel = parseClassRoomName(room)
    ? `[${room}반 교실]`
    : `[${room}]`;

  const totalDataRows = groups.reduce((sum, g) => sum + getAttendanceGroupRowCount(g), 0);
  const groupsHtml = groups.map(g => renderAttendanceGroupTable(g, day, periodNums)).join('');

  return `<div class="print-doc print-attendance print-attendance-matrix" data-att-groups="${groups.length}" data-att-data-rows="${totalDataRows}">
    ${renderDocValidationInline()}
    <header class="att-matrix-header">
      <h1 class="att-main-title">${getExamTitleLine()} 결시현황표</h1>
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

/** 출력물 페이지마다 검증을 반복하지 않도록 렌더 패스당 1회만 계산 */
let _compactValidationWarnings = null;
let _compactValidationInlineHtml = null;

function clearCompactValidationCache() {
  _compactValidationWarnings = null;
  _compactValidationInlineHtml = null;
}

function renderDocValidationInline() {
  if (_compactValidationInlineHtml !== null) return _compactValidationInlineHtml;
  const warnings = getCompactValidationWarnings();
  _compactValidationInlineHtml = warnings.length
    ? `<div class="doc-validation-inline">⚠ ${warnings.join(' · ')}</div>`
    : '';
  return _compactValidationInlineHtml;
}

function getCompactValidationWarnings() {
  if (_compactValidationWarnings) return _compactValidationWarnings;

  const warnings = [];
  const blocking = getPlacementBlockingErrors();
  if (blocking.length) {
    _compactValidationWarnings = blocking.map(msg => `출력불가: ${msg}`);
    return _compactValidationWarnings;
  }
  const dupes = findDuplicateSeats();
  if (dupes.length) warnings.push(`좌석 중복 ${dupes.length}건`);

  const unassigned = getUnassignedStudentCount();
  if (unassigned) warnings.push(`고정 좌석 미배정 ${unassigned}명`);

  findCapacityOverflowDetails().forEach(o => {
    warnings.push(`${o.roomName} 교실 정원/좌석 초과 (${o.count}/${o.capacity})`);
  });

  _compactValidationWarnings = warnings;
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

function isDeskSeatMapLayout(layout) {
  return layout === 'desk';
}

function getSeatMapLayoutLabel(layout) {
  return isDeskSeatMapLayout(layout) ? '교탁 부착용' : '칠판 부착용';
}

function getSeatMapRowColOrders(rows, cols, layout) {
  const desk = isDeskSeatMapLayout(layout);
  const rowOrder = Array.from({ length: rows }, (_, i) => (desk ? rows - i : i + 1));
  const colOrder = Array.from({ length: cols }, (_, i) => (desk ? cols - i : i + 1));
  return { rowOrder, colOrder };
}

function getSeatMapBulkRooms(f) {
  if (hasFixedRoomSeats()) {
    return sortClassRoomNames(
      getClassRooms()
        .map(r => r.name)
        .filter(name => {
          const p = parseClassRoomName(name);
          return !f.grade || (p && p.grade === f.grade);
        })
    );
  }
  return getRoomsForSession(f.grade, f.day, f.period);
}

function renderSeatMapPage(f) {
  const fixed = hasFixedRoomSeats();
  const layout = f.seatMapLayout || 'board';
  const desk = isDeskSeatMapLayout(layout);
  const { seatConfig, seatByCoord, subject } = getSeatDataForSession(f.grade, f.day, f.period, f.room);
  const { rows, cols } = seatConfig;
  const moveMode = normalizeMoveColumnMode(seatConfig.moveStudentColumnMode);
  const split = usesSplitColumnLayout(f.room);
  const assigned = Object.keys(seatByCoord).length;
  const { rowOrder, colOrder } = getSeatMapRowColOrders(rows, cols, layout);

  if (!assigned) {
    return `<div class="print-doc print-seat-map${desk ? ' print-seat-map--desk' : ''}">
      ${renderDocValidationInline()}
      <p class="hint">배정된 좌석 데이터가 없습니다. Step 3에서 고정 좌석을 배정하세요.</p>
    </div>`;
  }

  let colLabels = '';
  if (split) {
    colLabels = '<thead><tr class="seat-map-col-labels">';
    colOrder.forEach(c => {
      const isMoveCol = isMoveColumn(c, moveMode);
      colLabels += `<th class="seat-map-col-label${isMoveCol ? ' seat-map-col-move' : ''}">${isMoveCol ? '이동반' : '본반'}</th>`;
    });
    colLabels += '</tr></thead>';
  }

  let tbody = '<tbody>';
  rowOrder.forEach(r => {
    tbody += '<tr>';
    colOrder.forEach(c => {
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
    });
    tbody += '</tr>';
  });
  tbody += '</tbody>';

  const metaLine = fixed
    ? `고사실 : ${f.room} · ${getSeatMapLayoutLabel(layout)}`
    : `${f.day}일차 ${f.period}교시 · 고사실 ${f.room}${subject ? ` · ${subject}` : ''} · ${getSeatMapLayoutLabel(layout)}`;

  const orientTop = desk
    ? `<div class="seat-map-orient-top">
      <span class="seat-map-door-back">&lt; 출입문 뒷쪽 &gt;</span>
    </div>`
    : `<div class="seat-map-orient-top seat-map-orient-top--board">
      <span class="seat-map-orient-fill" aria-hidden="true"></span>
      <span class="seat-map-teacher-desk">교 탁</span>
      <span class="seat-map-door-front">&lt; 출입문 앞쪽 &gt;</span>
    </div>`;

  const orientBottom = desk
    ? `<div class="seat-map-orient-bottom seat-map-orient-bottom--desk">
      <span class="seat-map-door-front">&lt; 출입문 앞쪽 &gt;</span>
      <span class="seat-map-teacher-desk">교 탁</span>
      <span class="seat-map-orient-fill" aria-hidden="true"></span>
    </div>`
    : `<div class="seat-map-orient-bottom">
      <span class="seat-map-door-back">&lt; 출입문 뒷쪽 &gt;</span>
    </div>`;

  return `<div class="print-doc print-seat-map${desk ? ' print-seat-map--desk' : ''}" data-seat-body-rows="${rows}"${split ? ' data-seat-has-thead="1"' : ''}>
    ${renderDocValidationInline()}
    <header class="seat-map-sheet-header">
      <h1 class="seat-map-sheet-title">좌석배치표</h1>
      <p class="seat-map-sheet-subtitle">${getExamTitleLine()}</p>
      <p class="seat-map-sheet-meta">${metaLine}</p>
    </header>
    ${orientTop}
    <table class="seat-layout-table seat-map-sheet-table" style="--seat-cols:${cols};--seat-rows:${rows}">
      ${colLabels}
      ${tbody}
    </table>
    ${orientBottom}
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

function getPeriodsForDay(day) {
  let max = 0;
  getExamGrades().forEach(grade => {
    const periods = appState.timetable[grade]?.[day];
    if (!periods) return;
    Object.entries(periods).forEach(([p, subjects]) => {
      if (subjects && subjects.length) {
        max = Math.max(max, parseInt(p, 10));
      }
    });
  });
  return max || appState.examMeta.periodsPerDay;
}

function getPersonalBoardPeriodSlots() {
  const slots = [];
  for (let day = 1; day <= appState.examMeta.days; day++) {
    const periodCount = getPeriodsForDay(day);
    for (let period = 1; period <= periodCount; period++) {
      slots.push({
        day,
        period,
        dateLabel: formatDate(day),
        periodLabel: `${period}교시`
      });
    }
  }
  return slots;
}

function getSubjectForStudentSlot(studentId, day, period) {
  const entry = (appState.studentExamSchedules[studentId] || [])
    .find(e => e.day === day && e.period === period);
  return entry?.subject || '';
}

function getPersonalBoardClassKeys(grade) {
  const keys = new Map();
  Object.values(appState.students).forEach(s => {
    if (!isGradeTakingExam(s.grade)) return;
    if (Number.isFinite(grade) && s.grade !== grade) return;
    keys.set(`${s.grade}-${s.classNo}`, { grade: s.grade, classNo: s.classNo });
  });
  return [...keys.values()].sort((a, b) => compareGradeClass(a.grade, a.classNo, b.grade, b.classNo));
}

function getPersonalBoardStudentsForClass(grade, classNo) {
  return getStudentsInClass(grade, classNo).map(s => s.studentId);
}

function formatPersonalBoardClassLabel(grade, classNo) {
  return `${grade}-${classNo} 학급 게시용`;
}

function getPersonalBoardFooterNote() {
  const ranges = [];
  for (let day = 1; day <= appState.examMeta.days; ) {
    const periods = getPeriodsForDay(day);
    let endDay = day;
    while (endDay < appState.examMeta.days && getPeriodsForDay(endDay + 1) === periods) endDay++;
    const startLabel = formatDateShort(day);
    const datePart = endDay > day
      ? `${startLabel}~${formatDateShort(endDay).split('/')[1]}`
      : startLabel;
    ranges.push(`${datePart}은 ${periods}교시까지`);
    day = endDay + 1;
  }
  return `*빈칸은 시험이 없는 시간임(시험이 없어도 ${ranges.join(', ')} 모두 본인 자리에서 자습)`;
}

function buildPersonalBoardTableHtml(studentIds, slots) {
  if (!studentIds.length) return '';

  let h1 = '<tr><th rowspan="2" class="pb-col-id">학번</th><th rowspan="2" class="pb-col-name">이름</th>';
  for (let i = 0; i < slots.length;) {
    const day = slots[i].day;
    let count = 0;
    while (i + count < slots.length && slots[i + count].day === day) count++;
    h1 += `<th colspan="${count}">${slots[i].dateLabel}</th>`;
    i += count;
  }
  h1 += '<th rowspan="2" class="pb-side-head" aria-hidden="true"></th></tr>';

  let h2 = '<tr>';
  slots.forEach(slot => { h2 += `<th>${slot.periodLabel}</th>`; });
  h2 += '</tr>';

  let body = '';
  for (let i = 0; i < studentIds.length;) {
    const st = appState.students[studentIds[i]];
    const isMove = isMoveTargetStudent(st);
    const label = isMove ? '이동' : '고정';
    let j = i + 1;
    while (j < studentIds.length) {
      const stj = appState.students[studentIds[j]];
      const moveJ = isMoveTargetStudent(stj);
      if ((moveJ ? '이동' : '고정') !== label) break;
      j++;
    }
    const span = j - i;

    for (let k = i; k < j; k++) {
      const sid = studentIds[k];
      const student = appState.students[sid];
      body += `<tr class="pb-row-${isMove ? 'move' : 'fixed'}">`;
      body += `<td class="pb-col-id">${sid}</td>`;
      body += `<td class="pb-col-name">${student.name}</td>`;
      slots.forEach(slot => {
        const subject = getSubjectForStudentSlot(sid, slot.day, slot.period);
        body += `<td class="pb-subject">${subject}</td>`;
      });
      if (k === i) {
        body += `<td rowspan="${span}" class="pb-side-label pb-side-${isMove ? 'move' : 'fixed'}">${label}</td>`;
      }
      body += '</tr>';
    }
    i = j;
  }

  return `<table class="doc-table personal-board-table"><thead>${h1}${h2}</thead><tbody>${body}</tbody></table>`;
}

function renderPersonalBoardPage(grade, classNo) {
  const studentIds = getPersonalBoardStudentsForClass(grade, classNo);
  const slots = getPersonalBoardPeriodSlots();
  if (!studentIds.length) {
    return `<div class="print-doc print-personal-board"><p class="hint">${grade}학년 ${classNo}반 · 학생 데이터가 없습니다.</p></div>`;
  }

  const table = buildPersonalBoardTableHtml(studentIds, slots);
  const classLabel = formatPersonalBoardClassLabel(grade, classNo);
  const footer = getPersonalBoardFooterNote();

  return `<div class="print-doc print-personal-board" data-pb-body-rows="${studentIds.length}">
    ${renderDocValidationInline()}
    <header class="doc-header doc-header-print pb-header">
      ${getSchoolNameLine() ? `<p class="doc-school">${getSchoolNameLine()}</p>` : ''}
      <h1>${getExamTitleShort()}</h1>
      <p class="doc-sub pb-subtitle">개인별 시험 시간표(${classLabel})</p>
    </header>
    ${table}
    <p class="pb-footer-note">${footer}</p>
  </div>`;
}

function renderPersonalDocument(f) {
  if (f.bulkPrint) {
    const classes = f.bulkScope === 'all-grades'
      ? getPersonalBoardClassKeys()
      : getPersonalBoardClassKeys(f.grade);
    if (!classes.length) return '<p class="hint">학급 데이터가 없습니다.</p>';
    return `<div class="personal-board-batch">${classes.map(c => renderPersonalBoardPage(c.grade, c.classNo)).join('')}</div>`;
  }
  if (!Number.isFinite(f.grade) || !Number.isFinite(f.classNo)) {
    return '<p class="hint">학년·반을 선택하세요.</p>';
  }
  return `<div class="personal-board-batch">${renderPersonalBoardPage(f.grade, f.classNo)}</div>`;
}

/* ---------- 시험실배정현황 / 운영현황 조회 ---------- */

function getClassAssignmentData(day, grade, classNo) {
  const periods = appState.examMeta.periodsPerDay;
  const students = Object.values(appState.students)
    .filter(s => s.grade === grade && s.classNo === classNo && isGradeTakingExam(s.grade))
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

  const unassigned = appState.examGroups.reduce((n, g) => {
    if (g.day !== day || g.period !== period) return n;
    return n + g.students.filter(id => !appState.fixedRoomSeats?.[id]).length;
  }, 0);
  if (unassigned) warnings.push(`미배정 학생 ${unassigned}명`);

  const overflows = findCapacityOverflowDetails().filter(o => o.day === day && o.period === period);
  if (overflows.length) warnings.push(`정원 초과 시험실 ${overflows.length}개`);

  const usedRoomNames = new Set(getRoomOperationData(day, period).map(r => r.roomName));
  const assignedRoomNames = getFixedAssignedRoomNames(day, period);
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

function renderOutputDocumentAllGrades(type, f) {
  const grades = getActiveGrades();
  switch (type) {
    case 'seat-map': {
      const seatGrades = getSeatMapBulkGrades();
      if (!seatGrades.length) return '<p class="hint">출력할 교실이 없습니다.</p>';
      const parts = seatGrades.map(g => renderSeatMapDocument({ ...f, grade: g, bulkPrint: true }));
      return `<div class="seat-map-batch seat-map-all-grades">${parts.join('')}</div>`;
    }
    case 'attendance': {
      const days = Array.from({ length: appState.examMeta.days }, (_, i) => i + 1);
      const parts = days.map(d => renderAttendanceDocument({ ...f, day: d, bulkPrint: true }));
      return parts.join('') || '<p class="hint">응시현황표 데이터가 없습니다.</p>';
    }
    case 'elective-students':
      return renderElectiveStudentsDocument({ ...f, bulkPrint: true });
    case 'personal':
      return renderPersonalDocument({ ...f, bulkPrint: true, bulkScope: 'all-grades' });
    case 'room-assignment': {
      if (!grades.length) return '<p class="hint">학생 데이터가 없습니다.</p>';
      const parts = grades.map(g => renderRoomAssignmentDocument({ ...f, grade: g, bulkPrint: true }));
      return `<div class="room-assignment-all-grades">${parts.join('')}</div>`;
    }
    default:
      return '<p class="hint">출력물을 선택하세요.</p>';
  }
}

function outputHtmlHasDocuments(html) {
  return html.includes('print-doc') || html.includes('print-seat-map') || html.includes('print-attendance-matrix') || html.includes('print-personal-board');
}

function refreshOutputFilters() {
  const seatMapFields = hasFixedRoomSeats()
    ? ['grade', 'room']
    : ['grade', 'day', 'period', 'room'];
  renderFilterGroup('filters-seat-map', [...seatMapFields, 'seatMapLayout', 'bulkPrint']);
  renderFilterGroup('filters-attendance', ['day', 'room', 'bulkPrint']);
  renderFilterGroup('filters-elective-students', ['room', 'bulkPrint']);
  renderFilterGroup('filters-personal', ['grade', 'class', 'bulkPrint']);
  renderFilterGroup('filters-room-assignment', ['grade', 'day', 'class', 'bulkPrint']);
  renderBulkGradeClassTree();
}

function renderFilterGroup(containerId, fields) {
  const container = $(`#${containerId}`);
  if (!container) return;

  const useExamOnly = containerId === 'filters-personal' || containerId === 'filters-room-assignment';
  const grades = (useExamOnly ? getExamGrades() : getHostingGrades());
  const days = Array.from({ length: appState.examMeta.days }, (_, i) => i + 1);
  const periods = Array.from({ length: appState.examMeta.periodsPerDay }, (_, i) => i + 1);
  const subjects = [...new Set(appState.examGroups.map(g => g.subject))].sort();

  let html = '';
  if (fields.includes('grade')) {
    const allOpt = fields.includes('gradeOptional') ? '<option value="">전체</option>' : '';
    const gradeOpts = grades.length
      ? grades.map(g => `<option value="${g}">${g}</option>`).join('')
      : '<option value="">-</option>';
    html += `<label>학년 <select class="filter-grade">${allOpt}${gradeOpts}</select></label>`;
  }
  if (fields.includes('day')) {
    html += `<label>일차 <select class="filter-day">${days.map(d => `<option value="${d}">${d}일차</option>`).join('')}</select></label>`;
  }
  if (fields.includes('period')) {
    html += `<label>교시 <select class="filter-period">${periods.map(p => `<option value="${p}">${p}교시</option>`).join('')}</select></label>`;
  }
  if (fields.includes('room')) {
    html += `<label>고사실 <select class="filter-room"></select></label>`;
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
  if (fields.includes('seatMapLayout')) {
    html += `<label>용도 <select class="filter-seat-map-layout">
      <option value="board">칠판 부착용</option>
      <option value="desk">교탁 부착용</option>
    </select></label>`;
  }
  if (fields.includes('bulkPrint')) {
    html += `<label class="filter-check"><input type="checkbox" class="filter-bulk-print"> 일괄출력</label>`;
  }
  container.innerHTML = html;

  if (fields.includes('class')) {
    updatePersonalFilters(container);
  }
  if (fields.includes('room')) {
    updateOutputRoomFilter(container);
  }
}

function updatePersonalFilters(container) {
  const grade = parseInt(container.querySelector('.filter-grade')?.value, 10);
  const classSel = container.querySelector('.filter-class');
  const studentSel = container.querySelector('.filter-student');
  const bulkPrint = container.querySelector('.filter-bulk-print');
  if (!classSel) return;

  const classes = getOrderedClassNosForGrade(grade);

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
    subject: get('.filter-subject'),
    seatMapLayout: get('.filter-seat-map-layout') || 'board'
  };
}

function setPrintSizeClassOnly() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  document.body.classList.remove(
    'print-size-a4-portrait', 'print-size-a4-landscape',
    'print-size-b4-landscape', 'print-size-b4-portrait'
  );
  document.body.classList.add(`print-size-${size}`);
}

function updatePrintSizeForCurrentOutput() {
  const sizeSel = $('#print-size-select');
  if (!sizeSel) return;
  sizeSel.value = OUTPUT_DEFAULT_PRINT_SIZE[currentPreviewType] || DEFAULT_PRINT_SIZE;
  setPrintSizeClassOnly();
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
  refreshOutputPreview({ refreshChrome: true });
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
const ATTENDANCE_MAX_DATA_FONT_PT = 8.5;
const ATTENDANCE_MIN_DATA_FONT_PT = 5.5;

/** 표 셀은 글자 높이보다 작아지지 않으므로 행 높이에 맞춰 글자 크기도 줄인다 */
function getAttendanceDataFontPt(rowMm) {
  const fitPt = (rowMm - 0.9) / 1.15 / 0.3528;
  return Math.min(ATTENDANCE_MAX_DATA_FONT_PT, Math.max(ATTENDANCE_MIN_DATA_FONT_PT, fitPt));
}

function applyAttendanceRowSize(doc, rowMm) {
  doc.style.setProperty('--att-data-row-mm', `${rowMm.toFixed(2)}mm`);
  doc.style.setProperty('--att-data-font-pt', `${getAttendanceDataFontPt(rowMm).toFixed(2)}pt`);
}

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

  $$('#output-preview .print-attendance-matrix, #bulk-export-stage .print-attendance-matrix').forEach(doc => {
    doc.classList.remove('attendance-fit-applied');
    doc.style.removeProperty('--att-data-row-mm');
    doc.style.removeProperty('--att-data-font-pt');

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
      applyAttendanceRowSize(doc, dataRowMm);
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

const PERSONAL_BOARD_PAGE = {
  'a4-portrait': { heightMm: 273, widthMm: 186 },
  'a4-landscape': { heightMm: 190, widthMm: 277 },
  'b4-portrait': { heightMm: 348, widthMm: 241 },
  'b4-landscape': { heightMm: 237, widthMm: 344 }
};

const PERSONAL_BOARD_FOOTER_RESERVE_MM = 2;
const PERSONAL_BOARD_SAFETY_MM = 2;
const PERSONAL_BOARD_TARGET_ROW_MM = 6.5;
const PERSONAL_BOARD_MAX_STUDENTS = 35;
const PERSONAL_BOARD_MIN_DATA_ROW_MM = 2.2;
const PERSONAL_BOARD_ABSOLUTE_MIN_ROW_MM = 2.0;
const PERSONAL_BOARD_COMPACT_THRESHOLD_MM = 3.2;
const PERSONAL_BOARD_TIGHT_CHROME_THRESHOLD_MM = 3.8;
const PERSONAL_BOARD_FIT_MAX_ATTEMPTS = 8;
const PERSONAL_BOARD_FIT_TOLERANCE = 0.992;

function measurePersonalBoardChromePx(doc, table) {
  return measureSeatMapChromePx(doc, table);
}

function resetPersonalBoardFit(doc) {
  doc.classList.remove('personal-board-fit-applied', 'personal-board-compact', 'personal-board-tight-chrome', 'personal-board-ultra-fit');
  doc.style.removeProperty('--pb-data-row-mm');
  doc.style.removeProperty('--pb-page-width-mm');
  doc.style.removeProperty('--pb-printable-height-mm');
  doc.style.removeProperty('width');
  doc.style.removeProperty('max-width');
}

function measurePersonalBoardDocHeightMm(doc, pxPerMm) {
  const rectMm = doc.getBoundingClientRect().height / pxPerMm;
  const scrollMm = doc.scrollHeight / pxPerMm;
  return Math.max(rectMm, scrollMm);
}

function applyPersonalBoardRowSizing(doc, rowMm, { ultraFit = false } = {}) {
  doc.style.setProperty('--pb-data-row-mm', `${rowMm.toFixed(2)}mm`);
  doc.classList.toggle('personal-board-compact', rowMm < PERSONAL_BOARD_COMPACT_THRESHOLD_MM);
  doc.classList.toggle('personal-board-tight-chrome', rowMm < PERSONAL_BOARD_TIGHT_CHROME_THRESHOLD_MM);
  doc.classList.toggle('personal-board-ultra-fit', ultraFit);
  doc.classList.add('personal-board-fit-applied');
  void doc.offsetHeight;
}

function shrinkPersonalBoardToPage(doc, page, bodyRows, startRowMm, startHeightMm, pageLimitMm) {
  let rowMm = startRowMm;
  let ultraFit = false;
  let table = doc.querySelector('.personal-board-table');

  const tryFit = () => {
    applyPersonalBoardRowSizing(doc, rowMm, { ultraFit });
    table = doc.querySelector('.personal-board-table');
    const pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
    return measurePersonalBoardDocHeightMm(doc, pxPerMm);
  };

  // 1회 비율 추정으로 대부분 맞춤 (강제 리플로우 횟수 감소)
  if (startHeightMm > pageLimitMm && startHeightMm > 0) {
    rowMm = Math.max(
      PERSONAL_BOARD_MIN_DATA_ROW_MM,
      startRowMm * (pageLimitMm / startHeightMm) * 0.97
    );
  }

  let docHeightMm = tryFit();

  for (let attempt = 0; attempt < PERSONAL_BOARD_FIT_MAX_ATTEMPTS && docHeightMm > pageLimitMm; attempt++) {
    const overflowMm = docHeightMm - pageLimitMm + 0.8;
    const nextRowMm = Math.max(PERSONAL_BOARD_MIN_DATA_ROW_MM, rowMm - overflowMm / bodyRows);
    if (nextRowMm >= rowMm - 0.02) break;
    rowMm = nextRowMm;
    docHeightMm = tryFit();
  }

  if (docHeightMm > pageLimitMm && !ultraFit) {
    ultraFit = true;
    docHeightMm = tryFit();
  }

  if (docHeightMm > pageLimitMm && rowMm > PERSONAL_BOARD_ABSOLUTE_MIN_ROW_MM) {
    rowMm = PERSONAL_BOARD_ABSOLUTE_MIN_ROW_MM;
    docHeightMm = tryFit();
  }

  return docHeightMm <= pageLimitMm;
}

function fitSinglePersonalBoardDoc(doc, page) {
  resetPersonalBoardFit(doc);

  const table = doc.querySelector('.personal-board-table');
  if (!table) return;

  const bodyRows = parseInt(
    doc.dataset.pbBodyRows || table.querySelectorAll('tbody tr').length || '0',
    10
  );
  if (!bodyRows) return;

  doc.style.setProperty('--pb-page-width-mm', `${page.widthMm}mm`);
  doc.style.setProperty('--pb-printable-height-mm', `${page.heightMm}mm`);
  doc.style.width = `${page.widthMm}mm`;
  doc.style.maxWidth = '100%';

  const pageLimitMm = page.heightMm * PERSONAL_BOARD_FIT_TOLERANCE;
  let rowMm = PERSONAL_BOARD_TARGET_ROW_MM;

  applyPersonalBoardRowSizing(doc, rowMm);
  const pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
  const docHeightMm = measurePersonalBoardDocHeightMm(doc, pxPerMm);

  if (docHeightMm > pageLimitMm) {
    shrinkPersonalBoardToPage(doc, page, bodyRows, rowMm, docHeightMm, pageLimitMm);
  }
}

function fitPersonalBoardsToPage() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const page = PERSONAL_BOARD_PAGE[size] || PERSONAL_BOARD_PAGE['b4-landscape'];
  $$('#output-preview .print-personal-board, #bulk-export-stage .print-personal-board').forEach(doc => fitSinglePersonalBoardDoc(doc, page));
}

/* CSS @page size "B4"는 ISO B4(250×353mm)이므로 여백을 뺀 실제 인쇄 영역 기준 */
const ELECTIVE_STUDENTS_PAGE = {
  'a4-portrait': { heightMm: 273, widthMm: 186 },
  'a4-landscape': { heightMm: 190, widthMm: 277 },
  'b4-portrait': { heightMm: 337, widthMm: 234 },
  'b4-landscape': { heightMm: 230, widthMm: 333 }
};

const CSS_PX_PER_MM = 96 / 25.4;
const ELECTIVE_STUDENTS_TARGET_ROW_MM = 6.4;
const ELECTIVE_STUDENTS_MIN_ROW_MM = 1.9;
const ELECTIVE_STUDENTS_COMPACT_ROW_MM = 4.2;
const ELECTIVE_STUDENTS_FIT_TOLERANCE = 0.97;
const ELECTIVE_STUDENTS_FIT_MAX_ATTEMPTS = 10;

function resetElectiveStudentsFit(doc) {
  doc.classList.remove('elective-fit-applied', 'elective-fit-compact');
  doc.style.removeProperty('--es-row-mm');
  doc.style.removeProperty('width');
  doc.style.removeProperty('max-width');
}

function applyElectiveStudentsRowSizing(doc, rowMm) {
  doc.style.setProperty('--es-row-mm', `${rowMm.toFixed(2)}mm`);
  doc.classList.toggle('elective-fit-compact', rowMm < ELECTIVE_STUDENTS_COMPACT_ROW_MM);
  doc.classList.add('elective-fit-applied');
  void doc.offsetHeight;
}

function measureElectiveStudentsDocHeightMm(doc) {
  return Math.max(doc.getBoundingClientRect().height, doc.scrollHeight) / CSS_PX_PER_MM;
}

function fitSingleElectiveStudentsDoc(doc, page) {
  resetElectiveStudentsFit(doc);

  const table = doc.querySelector('.elective-students-table');
  if (!table) return;
  const bodyRows = table.querySelectorAll('tbody tr').length;
  if (!bodyRows) return;

  // 미리보기 폭이 아닌 실제 용지 폭에서 측정해야 인쇄 높이와 일치
  doc.style.width = `${page.widthMm}mm`;
  doc.style.maxWidth = 'none';

  const pageLimitMm = page.heightMm * ELECTIVE_STUDENTS_FIT_TOLERANCE;
  let rowMm = ELECTIVE_STUDENTS_TARGET_ROW_MM;
  applyElectiveStudentsRowSizing(doc, rowMm);
  let heightMm = measureElectiveStudentsDocHeightMm(doc);

  for (let attempt = 0; attempt < ELECTIVE_STUDENTS_FIT_MAX_ATTEMPTS && heightMm > pageLimitMm; attempt++) {
    const overflowMm = heightMm - pageLimitMm + 0.5;
    const nextRowMm = Math.max(ELECTIVE_STUDENTS_MIN_ROW_MM, rowMm - overflowMm / bodyRows);
    if (nextRowMm >= rowMm - 0.02) break;
    rowMm = nextRowMm;
    applyElectiveStudentsRowSizing(doc, rowMm);
    heightMm = measureElectiveStudentsDocHeightMm(doc);
  }

  doc.style.maxWidth = '100%';
}

function fitElectiveStudentsToPage() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const page = ELECTIVE_STUDENTS_PAGE[size] || ELECTIVE_STUDENTS_PAGE['b4-landscape'];
  $$('#output-preview .print-elective-students, #bulk-export-stage .print-elective-students').forEach(doc => fitSingleElectiveStudentsDoc(doc, page));
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
const SEAT_MAP_FIT_MAX_ATTEMPTS = 8;
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

  let docHeightMm = measureSeatMapDocHeightMm(doc, pxPerMm);
  if (docHeightMm > pageLimitMm && docHeightMm > 0) {
    cellMm = Math.max(SEAT_MAP_MIN_CELL_MM, cellMm * (pageLimitMm / docHeightMm) * 0.97);
    applySeatMapCellSizing(doc, table, cellMm);
    pxPerMm = getSeatMapPxPerMm(table, page.widthMm);
  }

  for (let attempt = 0; attempt < SEAT_MAP_FIT_MAX_ATTEMPTS; attempt++) {
    docHeightMm = measureSeatMapDocHeightMm(doc, pxPerMm);
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

  if (cellMm > SEAT_MAP_MIN_CELL_MM) {
    docHeightMm = measureSeatMapDocHeightMm(doc, pxPerMm);
    if (docHeightMm > pageLimitMm) {
      cellMm = SEAT_MAP_MIN_CELL_MM;
      applySeatMapCellSizing(doc, table, cellMm);
    }
  }
}

function fitSeatMapsToPage() {
  const size = $('#print-size-select')?.value || DEFAULT_PRINT_SIZE;
  const page = SEAT_MAP_PAGE[size] || SEAT_MAP_PAGE['a4-portrait'];
  $$('#output-preview .print-seat-map, #bulk-export-stage .print-seat-map').forEach(doc => fitSingleSeatMapDoc(doc, page));
}

function fitOutputPreviewToPage() {
  const roots = '#output-preview, #bulk-export-stage';
  if (document.querySelector(`${roots} .print-attendance-matrix`)) fitAttendanceSheetsToPage();
  if (document.querySelector(`${roots} .print-seat-map`)) fitSeatMapsToPage();
  if (document.querySelector(`${roots} .print-personal-board`)) fitPersonalBoardsToPage();
  if (document.querySelector(`${roots} .print-elective-students`)) fitElectiveStudentsToPage();
}

/* ========== 반별·시험실 일괄 zip 저장 ========== */

const BULK_EXPORT_PRINT_SIZE = {
  'seat-map-board': 'a4-portrait',
  'seat-map-desk': 'a4-portrait',
  attendance: 'a4-portrait',
  elective: 'b4-landscape',
  personal: 'b4-landscape',
  'room-assignment': 'a4-portrait'
};

const PDF_PAGE_CONFIG = {
  'a4-portrait': { format: 'a4', orientation: 'portrait', margin: 10, contentWidthMm: 186, contentHeightMm: 273 },
  'a4-landscape': { format: 'a4', orientation: 'landscape', margin: 8, contentWidthMm: 277, contentHeightMm: 190 },
  'b4-landscape': { format: [353, 250], orientation: 'landscape', margin: 8, contentWidthMm: 344, contentHeightMm: 237 },
  'b4-portrait': { format: [250, 353], orientation: 'portrait', margin: 6, contentWidthMm: 241, contentHeightMm: 348 }
};

const BULK_EXPORT_PRINT_DOC_SELECTOR = '.print-doc, .print-seat-map, .print-attendance-matrix, .print-personal-board, .print-elective-students, .print-room-assignment';

function getBulkExportSelections() {
  const panel = $('#class-bulk-work-card');
  if (!panel) return null;
  return {
    seatMapBoard: !!panel.querySelector('[data-bulk="seat-map-board"]')?.checked,
    seatMapDesk: !!panel.querySelector('[data-bulk="seat-map-desk"]')?.checked,
    attendance: !!panel.querySelector('[data-bulk="attendance"]')?.checked,
    elective: !!panel.querySelector('[data-bulk="elective"]')?.checked,
    personal: !!panel.querySelector('[data-bulk="personal"]')?.checked,
    roomAssignment: !!panel.querySelector('[data-bulk="room-assignment"]')?.checked,
    classes: [...panel.querySelectorAll('[data-bulk-class]:checked')].map(cb => ({
      grade: parseInt(cb.dataset.grade, 10),
      classNo: parseInt(cb.dataset.class, 10)
    }))
  };
}

function getBulkExamNamePrefix() {
  if (typeof collectMetaFromDOM === 'function') collectMetaFromDOM();
  const m = appState.examMeta;
  const examName = (m.examName || '정기시험').trim();
  return `${m.semester}학기 ${m.round}차 ${examName}`.replace(/\s+/g, ' ').trim();
}

function getBulkBundleZipName() {
  return sanitizeDownloadFilename(`${getBulkExamNamePrefix()}_반별출력물.zip`);
}

function getBulkGradeFolderName(grade) {
  return sanitizeDownloadFilename(`${grade}학년`);
}

function getBulkClassFolderName(grade, classNo) {
  return sanitizeDownloadFilename(`${grade}-${classNo}`);
}

function getBulkClassFileName(outputLabel, grade, classNo, day) {
  const prefix = getBulkExamNamePrefix();
  const className = `${grade}-${classNo}`;
  const output = Number.isFinite(day) ? `${outputLabel}(${day}일차)` : outputLabel;
  return sanitizeDownloadFilename(`${prefix}_${output}_${className}.pdf`);
}

function getClassHomeroomRoom(grade, classNo) {
  const name = `${grade}-${classNo}`;
  return appState.rooms.some(r => r.name === name) ? name : null;
}

/** 반별 zip 폴더용 시험실 = 학급교실(2-1). 본 반 학생 + 내려온 이동반이 배치되는 공간 */
function getClassExamRoom(grade, classNo) {
  return getClassHomeroomRoom(grade, classNo);
}

function getSeatMapFiltersForRoom(room, layout, grade) {
  const parsed = parseClassRoomName(room);
  return {
    room,
    grade: grade ?? parsed?.grade ?? 1,
    day: 1,
    period: 1,
    seatMapLayout: layout
  };
}

function getExamDayNumbers() {
  return Array.from({ length: appState.examMeta.days }, (_, i) => i + 1);
}

function buildClassBulkFiles(selections, grade, classNo) {
  const files = [];
  const days = getExamDayNumbers();
  const examRoom = getClassExamRoom(grade, classNo);
  const takingExam = isGradeTakingExam(grade);

  if (selections.personal && takingExam) {
    const html = renderPersonalBoardPage(grade, classNo);
    if (outputHtmlHasDocuments(html)) {
      files.push({
        name: getBulkClassFileName('개인별 시험 시간표', grade, classNo),
        html: `<div class="personal-board-batch">${html}</div>`,
        printSize: BULK_EXPORT_PRINT_SIZE.personal
      });
    }
  }

  if (selections.roomAssignment && takingExam) {
    days.forEach(day => {
      const html = renderClassAssignmentPage(day, grade, classNo);
      if (outputHtmlHasDocuments(html)) {
        files.push({
          name: getBulkClassFileName('시험실배정현황', grade, classNo, day),
          html,
          printSize: BULK_EXPORT_PRINT_SIZE['room-assignment']
        });
      }
    });
  }

  if (!examRoom) return files;

  if (selections.seatMapBoard) {
    const html = renderSeatMapPage(getSeatMapFiltersForRoom(examRoom, 'board', grade));
    if (outputHtmlHasDocuments(html)) {
      files.push({
        name: getBulkClassFileName('좌석배치도(칠판부착용)', grade, classNo),
        html,
        printSize: BULK_EXPORT_PRINT_SIZE['seat-map-board']
      });
    }
  }

  if (selections.seatMapDesk) {
    const html = renderSeatMapPage(getSeatMapFiltersForRoom(examRoom, 'desk', grade));
    if (outputHtmlHasDocuments(html)) {
      files.push({
        name: getBulkClassFileName('좌석배치도(교탁부착용)', grade, classNo),
        html,
        printSize: BULK_EXPORT_PRINT_SIZE['seat-map-desk']
      });
    }
  }

  if (selections.attendance) {
    days.forEach(day => {
      const html = renderAttendanceRoomDaySheet(examRoom, day);
      if (outputHtmlHasDocuments(html)) {
        files.push({
          name: getBulkClassFileName('응시현황표', grade, classNo, day),
          html,
          printSize: BULK_EXPORT_PRINT_SIZE.attendance
        });
      }
    });
  }

  if (selections.elective) {
    const html = renderElectiveStudentsPage(examRoom);
    if (outputHtmlHasDocuments(html)) {
      files.push({
        name: getBulkClassFileName('선택과목 응시 학생', grade, classNo),
        html: `<div class="elective-students-batch">${html}</div>`,
        printSize: BULK_EXPORT_PRINT_SIZE.elective
      });
    }
  }

  return files;
}

function buildBulkZipPlans(selections) {
  const byGrade = new Map();
  selections.classes.forEach(({ grade, classNo }) => {
    const files = buildClassBulkFiles(selections, grade, classNo);
    if (!files.length) return;
    if (!byGrade.has(grade)) byGrade.set(grade, []);
    byGrade.get(grade).push({
      folderName: getBulkClassFolderName(grade, classNo),
      files
    });
  });

  return [...byGrade.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([grade, classFolders]) => ({
      gradeFolder: getBulkGradeFolderName(grade),
      classFolders
    }))
    .filter(plan => plan.classFolders.length);
}

function waitAnimationFrames(count = 2) {
  return new Promise(resolve => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function renderHtmlToPdfBlob(html, printSize, stageEl) {
  const jsPDF = window.jspdf?.jsPDF;
  const html2canvasFn = window.html2canvas;
  if (!jsPDF || !html2canvasFn) {
    throw new Error('PDF 생성 라이브러리(html2canvas/jsPDF)를 불러오지 못했습니다.');
  }

  const cfg = PDF_PAGE_CONFIG[printSize] || PDF_PAGE_CONFIG['a4-portrait'];
  const sizeSel = $('#print-size-select');
  if (sizeSel) sizeSel.value = printSize;

  stageEl.innerHTML = `<div class="bulk-export-render-root">${html}</div>`;
  stageEl.style.width = `${cfg.contentWidthMm}mm`;
  stageEl.style.maxWidth = 'none';

  setPrintSizeClassOnly();
  document.body.classList.add('bulk-export-active', 'print-mode');
  applyDynamicPrintPageStyle();

  await waitAnimationFrames(2);
  fitOutputPreviewToPage();
  await waitAnimationFrames(2);

  if (!outputHtmlHasDocuments(stageEl.innerHTML)) {
    stageEl.innerHTML = '';
    document.body.classList.remove('print-mode');
    return null;
  }

  const root = stageEl.querySelector('.bulk-export-render-root');
  const elements = root.querySelectorAll(BULK_EXPORT_PRINT_DOC_SELECTOR);
  const targets = elements.length ? [...elements] : [root];

  const pdf = new jsPDF({
    unit: 'mm',
    format: cfg.format,
    orientation: cfg.orientation,
    compress: true
  });

  try {
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      if (i > 0) pdf.addPage(cfg.format, cfg.orientation);

      el.style.width = `${cfg.contentWidthMm}mm`;
      el.style.maxWidth = `${cfg.contentWidthMm}mm`;
      el.style.boxSizing = 'border-box';

      const canvas = await html2canvasFn(el, {
        scale: 1.5,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: el.offsetWidth,
        height: el.offsetHeight,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = cfg.margin;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgRatio = canvas.width / canvas.height;
      const boxRatio = maxW / maxH;

      let drawW;
      let drawH;
      if (imgRatio > boxRatio) {
        drawW = maxW;
        drawH = maxW / imgRatio;
      } else {
        drawH = maxH;
        drawW = maxH * imgRatio;
      }

      const offsetX = margin + (maxW - drawW) / 2;
      const offsetY = margin + (maxH - drawH) / 2;
      pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawW, drawH, undefined, 'FAST');
    }

    return pdf.output('blob');
  } catch (err) {
    throw new Error(`PDF 변환 실패 (${printSize}): ${err.message || err}`);
  } finally {
    stageEl.innerHTML = '';
    stageEl.style.width = '';
    stageEl.style.maxWidth = '';
    document.body.classList.remove('print-mode');
  }
}

function downloadBlobFile(blob, filename) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(resolve, 350);
  });
}

async function runClassBulkExport() {
  if (typeof JSZip === 'undefined') {
    alert('zip 생성 라이브러리(JSZip)를 불러오지 못했습니다.');
    return;
  }

  const sel = getBulkExportSelections();
  if (!sel.classes.length) {
    alert('반을 하나 이상 선택하세요. 학년 버튼을 누르면 반 목록이 열립니다.');
    return;
  }

  const hasAnyOutput = sel.seatMapBoard || sel.seatMapDesk || sel.attendance
    || sel.elective || sel.personal || sel.roomAssignment;
  if (!hasAnyOutput) {
    alert('출력물을 하나 이상 선택하세요.');
    return;
  }
  if (!confirmPrintWarnings()) return;
  clearCompactValidationCache();

  const allPlans = buildBulkZipPlans(sel);

  if (!allPlans.length) {
    alert('선택한 조건에 해당하는 출력 데이터가 없습니다.');
    return;
  }

  const totalPdfs = allPlans.reduce(
    (sum, plan) => sum + plan.classFolders.reduce((folderSum, folder) => folderSum + folder.files.length, 0),
    0
  );
  if (totalPdfs > 40 && !confirm(`총 ${totalPdfs}개 PDF를 생성합니다.\n시간이 다소 걸릴 수 있습니다. 계속하시겠습니까?`)) return;

  const btn = $('#btn-class-bulk-save');
  const prevBtnText = btn?.textContent;
  const stageEl = $('#bulk-export-stage');
  const sizeSel = $('#print-size-select');
  const prevSize = sizeSel?.value;

  if (!stageEl) {
    alert('내부 렌더 영역을 찾을 수 없습니다.');
    return;
  }

  document.body.classList.add('bulk-export-active');
  if (btn) btn.disabled = true;

  let done = 0;
  try {
    const zip = new JSZip();
    for (const plan of allPlans) {
      for (const classFolder of plan.classFolders) {
        for (const file of classFolder.files) {
          done += 1;
          if (btn) btn.textContent = `생성 중… (${done}/${totalPdfs})`;
          const blob = await renderHtmlToPdfBlob(file.html, file.printSize, stageEl);
          if (blob) zip.file(`${plan.gradeFolder}/${classFolder.folderName}/${file.name}`, blob);
        }
      }
    }
    if (!Object.keys(zip.files).length) {
      alert('PDF 생성에 실패했습니다.\n출력 데이터가 없거나 브라우저에서 PDF 변환을 차단했을 수 있습니다.');
      return;
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    await downloadBlobFile(zipBlob, getBulkBundleZipName());
    alert('zip 파일 저장을 시작했습니다.\n브라우저 다운로드 폴더를 확인하세요.');
  } catch (e) {
    alert('일괄 저장 실패: ' + e.message);
  } finally {
    stageEl.innerHTML = '';
    if (sizeSel) sizeSel.value = prevSize;
    document.body.classList.remove('bulk-export-active', 'print-mode');
    setPrintSizeClassOnly();
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevBtnText;
    }
  }
}

function refreshOutputPreview(options = {}) {
  const { refreshChrome = false } = options;
  clearCompactValidationCache();

  if (refreshChrome) {
    renderOperationDashboard();
    renderOperationDiagnosis();
  }
  renderOutputValidationBanner();

  const f = getFiltersFromCard(currentPreviewType);
  updatePrintSizeForCurrentOutput();
  $('#output-preview').innerHTML = renderOutputDocument(currentPreviewType, f);
  requestAnimationFrame(() => requestAnimationFrame(fitOutputPreviewToPage));
}

function scheduleRefreshOutputPreview() {
  clearTimeout(outputPreviewDebounce);
  outputPreviewDebounce = setTimeout(() => refreshOutputPreview(), 120);
}

let step5OutputInitialized = false;

function closeAllBulkClassBubbles() {
  $$('.bulk-grade-item.is-open').forEach(item => setBulkGradeOpen(item, false));
}

function layoutBulkClassBubble(item) {
  const bubble = item?.querySelector('.bulk-grade-classes');
  const toggle = item?.querySelector('.bulk-grade-toggle');
  if (!bubble || !toggle || bubble.hidden) return;

  const rect = toggle.getBoundingClientRect();
  const bubbleW = bubble.offsetWidth || 240;
  const bubbleH = bubble.offsetHeight || 160;
  const gap = 12;
  let left = rect.left - bubbleW - gap;
  let placeRight = left < 12;
  if (placeRight) {
    left = Math.min(rect.right + gap, window.innerWidth - bubbleW - 12);
    left = Math.max(12, left);
  }
  let top = rect.top + rect.height / 2 - Math.min(28, bubbleH / 2);
  top = Math.max(12, Math.min(top, window.innerHeight - bubbleH - 12));
  bubble.classList.toggle('is-right', placeRight);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.setProperty('--arrow-top', `${rect.top + rect.height / 2 - top}px`);
}

function setBulkGradeOpen(item, open) {
  if (!item) return;
  if (open) {
    $$('.bulk-grade-item.is-open').forEach(el => {
      if (el !== item) setBulkGradeOpen(el, false);
    });
  }
  item.classList.toggle('is-open', open);
  const box = item.querySelector('.bulk-grade-classes');
  const toggle = item.querySelector('.bulk-grade-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!box) return;
  if (open) {
    box.hidden = false;
    layoutBulkClassBubble(item);
    requestAnimationFrame(() => layoutBulkClassBubble(item));
  } else {
    box.hidden = true;
    box.classList.remove('is-right');
    box.style.left = '';
    box.style.top = '';
  }
}

function updateBulkGradeMeta(grade) {
  const panel = $('#class-bulk-work-card');
  if (!panel) return;
  const classes = [...panel.querySelectorAll(`[data-bulk-class][data-grade="${grade}"]`)];
  const checked = classes.filter(cb => cb.checked).length;
  const meta = panel.querySelector(`[data-grade-meta="${grade}"]`);
  if (!meta) return;
  meta.textContent = checked
    ? `${checked}/${classes.length}개 반 선택`
    : `${classes.length}개 반`;
}

function syncBulkGradeChecks(grade) {
  const panel = $('#class-bulk-work-card');
  if (!panel) return;
  const classes = [...panel.querySelectorAll(`[data-bulk-class][data-grade="${grade}"]`)];
  const checked = classes.filter(cb => cb.checked).length;
  const allOn = classes.length > 0 && checked === classes.length;
  const some = checked > 0 && checked < classes.length;
  const gradeCb = panel.querySelector(`[data-bulk-grade="${grade}"]`);
  const allCb = panel.querySelector(`[data-bulk-class-all="${grade}"]`);
  if (gradeCb) {
    gradeCb.checked = allOn;
    gradeCb.indeterminate = some;
  }
  if (allCb) {
    allCb.checked = allOn;
    allCb.indeterminate = some;
  }
  updateBulkGradeMeta(grade);
}

function syncBulkSelectAllClasses() {
  const panel = $('#class-bulk-work-card');
  const master = panel?.querySelector('#bulk-select-all-grades');
  if (!panel || !master) return;
  const classes = [...panel.querySelectorAll('[data-bulk-class]')];
  const checked = classes.filter(cb => cb.checked).length;
  master.checked = classes.length > 0 && checked === classes.length;
  master.indeterminate = checked > 0 && checked < classes.length;
}

function setBulkClassesChecked(grade, checked) {
  const panel = $('#class-bulk-work-card');
  if (!panel) return;
  panel.querySelectorAll(`[data-bulk-class][data-grade="${grade}"]`).forEach(cb => {
    cb.checked = checked;
  });
  syncBulkGradeChecks(grade);
}

function renderBulkGradeClassTree() {
  const tree = $('#bulk-grade-class-tree');
  const panel = $('#class-bulk-work-card');
  if (!tree || !panel) return;

  const prevSelected = new Set(
    [...panel.querySelectorAll('[data-bulk-class]:checked')].map(cb => cb.value)
  );
  const prevOpen = new Set(
    [...tree.querySelectorAll('.bulk-grade-item.is-open')].map(el => el.dataset.grade)
  );
  closeAllBulkClassBubbles();

  tree.innerHTML = getHostingGrades().map(g => {
    const classNos = getOrderedClassNosForGrade(g);
    const classItems = classNos.map(c => `
      <label class="class-bulk-check bulk-class-check">
        <input type="checkbox" data-bulk-class="${g}-${c}" data-grade="${g}" data-class="${c}" value="${g}-${c}">
        <span class="class-bulk-check-label">${g}-${c}</span>
      </label>`).join('');
    const empty = classNos.length
      ? ''
      : '<p class="bulk-grade-empty">반 목록이 없습니다. 고사실을 만들거나 학생을 업로드하세요.</p>';
    const modeNote = getGradeParticipation(g) === 'host' ? ' · 교실만' : '';
    return `
      <div class="bulk-grade-item" data-grade="${g}">
        <div class="bulk-grade-row">
          <button type="button" class="bulk-grade-toggle" data-grade="${g}" aria-expanded="false" aria-haspopup="dialog">
            <span class="bulk-grade-caret" aria-hidden="true">▸</span>
            <span class="bulk-grade-name">${g}학년</span>
            <span class="bulk-grade-meta" data-grade-meta="${g}">${classNos.length}개 반${modeNote}</span>
          </button>
          <label class="bulk-grade-pick" title="${g}학년 전체 선택">
            <input type="checkbox" data-bulk-grade="${g}">
            <span class="visually-hidden">${g}학년 전체 선택</span>
          </label>
        </div>
        <div class="bulk-grade-classes" data-grade="${g}" hidden role="dialog" aria-label="${g}학년 반 선택">
          <label class="class-bulk-check class-bulk-check--all bulk-class-all">
            <input type="checkbox" data-bulk-class-all="${g}">
            <span class="class-bulk-check-label">전체선택</span>
          </label>
          <div class="bulk-class-grid">${classItems || empty}</div>
        </div>
      </div>`;
  }).join('') || '<p class="hint">참여 중인 학년이 없습니다. 운영설정에서 학년별 참여를 확인하세요.</p>';

  prevSelected.forEach(value => {
    const cb = tree.querySelector(`[data-bulk-class][value="${value}"]`);
    if (cb) cb.checked = true;
  });
  prevOpen.forEach(grade => {
    setBulkGradeOpen(tree.querySelector(`.bulk-grade-item[data-grade="${grade}"]`), true);
  });
  getHostingGrades().forEach(g => syncBulkGradeChecks(g));
  syncBulkSelectAllClasses();
}

function initClassBulkExportUI() {
  const panel = $('#class-bulk-work-card');
  if (!panel || panel.dataset.bulkUiReady === '1') return;
  panel.dataset.bulkUiReady = '1';

  const allOutputs = panel.querySelector('#bulk-select-all-outputs');
  const outputChecks = [...panel.querySelectorAll('[data-bulk]')];

  const syncSelectAll = (master, items) => {
    if (!master || !items.length) return;
    const checkedCount = items.filter(cb => cb.checked).length;
    master.checked = checkedCount === items.length;
    master.indeterminate = checkedCount > 0 && checkedCount < items.length;
  };

  allOutputs?.addEventListener('change', () => {
    outputChecks.forEach(cb => { cb.checked = allOutputs.checked; });
    allOutputs.indeterminate = false;
  });
  outputChecks.forEach(cb => {
    cb.addEventListener('change', () => syncSelectAll(allOutputs, outputChecks));
  });

  panel.addEventListener('click', e => {
    const toggle = e.target.closest('.bulk-grade-toggle');
    if (!toggle || !panel.contains(toggle)) return;
    e.stopPropagation();
    const item = toggle.closest('.bulk-grade-item');
    setBulkGradeOpen(item, !item.classList.contains('is-open'));
  });

  document.addEventListener('click', e => {
    if (!document.querySelector('.bulk-grade-item.is-open')) return;
    if (e.target.closest('.bulk-grade-item.is-open')) return;
    if (e.target.closest('.bulk-grade-classes:not([hidden])')) return;
    closeAllBulkClassBubbles();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllBulkClassBubbles();
  });
  window.addEventListener('resize', () => {
    const open = document.querySelector('.bulk-grade-item.is-open');
    if (open) layoutBulkClassBubble(open);
  });
  window.addEventListener('scroll', () => {
    const open = document.querySelector('.bulk-grade-item.is-open');
    if (open) layoutBulkClassBubble(open);
  }, true);

  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'bulk-select-all-grades') {
      panel.querySelectorAll('[data-bulk-class]').forEach(cb => { cb.checked = t.checked; });
      panel.querySelectorAll('[data-bulk-grade], [data-bulk-class-all]').forEach(cb => {
        cb.checked = t.checked;
        cb.indeterminate = false;
      });
      t.indeterminate = false;
      getHostingGrades().forEach(g => updateBulkGradeMeta(g));
      return;
    }
    if (t.matches('[data-bulk-grade]')) {
      const g = t.dataset.bulkGrade;
      setBulkClassesChecked(g, t.checked);
      syncBulkSelectAllClasses();
      return;
    }
    if (t.matches('[data-bulk-class-all]')) {
      const g = t.dataset.bulkClassAll;
      setBulkClassesChecked(g, t.checked);
      syncBulkSelectAllClasses();
      return;
    }
    if (t.matches('[data-bulk-class]')) {
      syncBulkGradeChecks(t.dataset.grade);
      syncBulkSelectAllClasses();
    }
  });

  renderBulkGradeClassTree();
}

function initStep5Output() {
  if (step5OutputInitialized) {
    refreshOutputFilters();
    refreshOutputPreview({ refreshChrome: true });
    return;
  }
  step5OutputInitialized = true;

  initClassBulkExportUI();

  $$('.output-index-tab').forEach(tab => {
    tab.addEventListener('click', () => selectOutputType(tab.dataset.output));
  });

  $('#output-work-card')?.addEventListener('change', e => {
    const container = e.target.closest('.output-filters');
    if (!container) return;
    if (e.target.classList.contains('filter-grade')) {
      if (container.querySelector('.filter-room')) updateOutputRoomFilter(container);
      if (container.querySelector('.filter-class')) updatePersonalFilters(container);
    }
    if (container.id === 'filters-personal' || container.id === 'filters-room-assignment') {
      updatePersonalFilters(container);
    }
    scheduleRefreshOutputPreview();
  });

  $$('.output-btn-pdf-all').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      downloadAllGradesPdf(btn.dataset.output);
    });
  });
  $('#btn-class-bulk-save')?.addEventListener('click', runClassBulkExport);
  $('#print-size-select')?.addEventListener('change', applyPrintSizeClass);

  window.addEventListener('beforeprint', () => {
    fitOutputPreviewToPage();
  });

  refreshOutputFilters();
  selectOutputType('seat-map');
}

function applyPrintSizeClass() {
  setPrintSizeClassOnly();
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
    ['.print-seat-map', 'seat-map-fit-applied'],
    ['.print-personal-board', 'personal-board-fit-applied'],
    ['.print-elective-students', 'elective-fit-applied']
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
        doc.style.removeProperty('--att-data-font-pt');
      }
      if (appliedClass === 'personal-board-fit-applied') {
        doc.classList.remove('personal-board-compact', 'personal-board-tight-chrome', 'personal-board-ultra-fit');
        doc.style.removeProperty('--pb-data-row-mm');
        doc.style.removeProperty('--pb-page-width-mm');
        doc.style.removeProperty('--pb-printable-height-mm');
      }
      if (appliedClass === 'elective-fit-applied') {
        doc.classList.remove('elective-fit-compact');
        doc.style.removeProperty('--es-row-mm');
      }
    });
  });
}

function getAllGradesPdfTitle(type, f) {
  return getOutputDownloadFilename(type, { ...f, bulkPrint: true, bulkScope: 'all-grades' });
}

function confirmPrintWarnings() {
  const blockMsg = getExportBlockingMessage();
  if (blockMsg) {
    alert(`출력이 차단되었습니다.\n\n⚠ ${blockMsg}\n\n「운영 진단 실행」으로 확인하세요.`);
    return false;
  }
  const warnings = getCompactValidationWarnings();
  if (warnings.length && !confirm(`검증 경고가 있습니다.\n${warnings.join('\n')}\n\n그래도 인쇄하시겠습니까?`)) return false;
  return true;
}

function applyDynamicPrintPageStyle() {
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
}

function executePrintJob(title, onComplete) {
  applyPrintSizeClass();
  applyDynamicPrintPageStyle();
  preparePrintEnhancements();
  document.body.classList.add('print-mode');
  requestAnimationFrame(() => {
    fitOutputPreviewToPage();
    requestAnimationFrame(() => {
      const prevTitle = document.title;
      document.title = title || document.title;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        document.title = prevTitle;
        removePrintEnhancements();
        document.body.classList.remove(
          'print-mode', 'print-size-a4-portrait', 'print-size-a4-landscape',
          'print-size-b4-landscape', 'print-size-b4-portrait'
        );
        window.removeEventListener('afterprint', finish);
        onComplete?.();
      };
      window.addEventListener('afterprint', finish);
      window.print();
      setTimeout(finish, 2000);
    });
  });
}

function downloadAllGradesPdf(outputType) {
  if (!outputType) { alert('출력물을 선택하세요.'); return; }
  if (!confirmPrintWarnings()) return;

  selectOutputType(outputType);
  const f = getFiltersFromCard(outputType);
  if (outputType === 'personal') {
    const classes = getPersonalBoardClassKeys();
    if (classes.length > 24 && !confirm(`전체 학급 개인시간표는 ${classes.length}개 학급 분량입니다.\nPDF 저장에 시간이 걸릴 수 있습니다. 계속하시겠습니까?`)) return;
  }

  clearCompactValidationCache();
  const html = renderOutputDocumentAllGrades(outputType, f);
  if (!outputHtmlHasDocuments(html)) {
    alert('전체 출력할 데이터가 없습니다.');
    return;
  }

  const previewEl = $('#output-preview');
  const prevHtml = previewEl.innerHTML;
  previewEl.innerHTML = html;

  executePrintJob(getAllGradesPdfTitle(outputType, f), () => {
    previewEl.innerHTML = prevHtml;
    requestAnimationFrame(() => requestAnimationFrame(fitOutputPreviewToPage));
  });
}

function getPrintDocumentTitle() {
  const f = getFiltersFromCard(currentPreviewType);
  return getOutputDownloadFilename(currentPreviewType, f);
}

function printOutput() {
  if (!currentPreviewType) { alert('출력물을 선택하세요.'); return; }
  if (!confirmPrintWarnings()) return;
  executePrintJob(getPrintDocumentTitle());
}

