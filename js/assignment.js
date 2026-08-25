/** Exam Flow — js/assignment.js (classic script, file:// 호환. ES module 아님) */

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
  } else {
    tryAutoAssignFixedSeats();
  }

  const wholeGradeCount = appState.examGroups.filter(isWholeGradeExam).length;
  const resultEl = $('#schedule-gen-result');
  resultEl.textContent = `생성 완료: 학생 ${Object.keys(schedules).length}명, 응시 그룹 ${appState.examGroups.length}개 (전체응시 ${wholeGradeCount}개)`;
  showEl(resultEl, true);

  populateExamGroupFilters();
  touchStepUI('3', renderStep3UI);
  if (isStepActive('5')) refreshOutputFilters();
  else invalidateSteps('5');
  invalidateSteps('4');
  invalidateDiagnosis();
  syncStateToWindow();
}

function renderExamGroupsTable() {
  const gradeSel = $('#exam-group-grade-filter');
  const daySel = $('#exam-group-day-filter');
  const table = $('#exam-groups-table');
  if (!table) return;

  const gradeFilter = gradeSel?.value || '';
  const dayFilter = daySel?.value || '';

  const groups = appState.examGroups.filter(g => {
    if (gradeFilter && g.grade !== parseInt(gradeFilter, 10)) return false;
    if (dayFilter && g.day !== parseInt(dayFilter, 10)) return false;
    return true;
  });

  if (!groups.length) {
    table.innerHTML = '<p class="hint">응시 그룹 없음. 시험 일정을 먼저 생성하세요.</p>';
    return;
  }

  let html = `<table class="data-table"><thead><tr>
    <th>학년</th><th>일차</th><th>교시</th><th>과목</th>
    <th>응시</th><th>고정 좌석</th><th>비고</th>
  </tr></thead><tbody>`;

  groups.forEach(g => {
    const assigned = g.students.filter(id => appState.fixedRoomSeats?.[id]).length;
    const missing = g.students.length - assigned;
    const wholeGrade = isWholeGradeExam(g);
    html += `<tr>
      <td>${g.grade}</td>
      <td>${g.day}</td>
      <td>${g.period}</td>
      <td>${g.subject}</td>
      <td>${g.students.length}명</td>
      <td>${assigned}명${missing ? ' <span class="validation-warn">(미배정 ' + missing + ')</span>' : ''}</td>
      <td>${wholeGrade ? '<span class="validation-ok">전체응시</span>' : '선택과목'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  table.innerHTML = html;
}

function populateExamGroupFilters() {
  const gradeSel = $('#exam-group-grade-filter');
  const daySel = $('#exam-group-day-filter');
  const grades = [...new Set(appState.examGroups.map(g => g.grade))].sort();
  const days = [...new Set(appState.examGroups.map(g => g.day))].sort((a, b) => a - b);
  gradeSel.innerHTML = '<option value="">전체</option>' + grades.map(g => `<option value="${g}">${g}학년</option>`).join('');
  daySel.innerHTML = '<option value="">전체</option>' + days.map(d => `<option value="${d}">${d}일차</option>`).join('');
}

function canRunFixedSeatAssignment() {
  return !isOperationLocked()
    && Object.keys(appState.students).length > 0
    && getClassRooms().length > 0
    && appState.examGroups.length > 0;
}

function shouldAutoAssignFixedSeats() {
  if (!canRunFixedSeatAssignment()) return false;
  if (!hasFixedRoomSeats()) return true;
  return getUnassignedStudentCount() > 0;
}

function applyFixedSeatAssignmentResult({ count, overflowCount }, { prefix = '' } = {}) {
  const seatConfig = getSeatConfig();
  const slotCount = Object.values(appState.seatAssignments).reduce((sum, arr) => sum + arr.length, 0);
  const resultEl = $('#seat-assign-result');
  let msg = `${prefix}고정 좌석 배정 완료: 학생 ${count}명, 교시 슬롯 ${slotCount}건 (채움: ${seatConfig.fillDirection}, 이동열: ${seatConfig.moveStudentColumnMode})`;
  if (overflowCount) msg += ` — 좌석 수 초과 교실 ${overflowCount}개`;
  if (resultEl) {
    resultEl.textContent = msg;
    showEl(resultEl, true);
  }
  touchStepUI('3', renderStep3UI);
  invalidateSteps('4', '5');
  invalidateDiagnosis();
  syncStateToWindow();
  saveToLocalSilent();
  return msg;
}

/** 조건 충족 시 고정 좌석 자동 배정 (미배정·저장 복원 후 등) */
function tryAutoAssignFixedSeats() {
  if (!shouldAutoAssignFixedSeats()) return null;
  const { count, overflowCount } = assignFixedSeats();
  return applyFixedSeatAssignmentResult({ count, overflowCount }, { prefix: '자동 ' });
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

  const { count, overflowCount } = assignFixedSeats();
  applyFixedSeatAssignmentResult({ count, overflowCount });
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
    const targetCount = getMoveTargetCount(rule);
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

  if (appState.examGroups.length && !hasFixedRoomSeats()) {
    results.push({ level: 'warn', msg: '고정 좌석이 없습니다. 시험 일정 생성 시 자동 배정됩니다.' });
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

