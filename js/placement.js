/** Exam Flow — js/placement.js (classic script, file:// 호환. ES module 아님) */

/* ========== Step 4: Placement Editor ========== */

const ABSENCE_TYPES = ['병결', '공결', '미인정결', '별도시험실', '기타'];
const PLACEMENT_PAGE_SIZE = 80;

let placementPage = 1;
let placementRoomIndex = 0;
let placementEditorDirty = true;
let placementFilterDelegationBound = false;
let placementPagerDelegationBound = false;
let placementRoomNavBound = false;

const stepUIReady = {};
let step5PreviewStale = false;
let outputPreviewDebounce = null;
let movementPreviewDebounce = null;
let seatPreviewDebounce = null;

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
  const roomName = ov.roomName ?? base.roomName;
  const seatNo = ov.seatNo ?? base.seatNo;
  const seatGroup = base.seatGroup || (base.isMoveStudent ? 'move' : 'home');
  const coord = resolveSeatRowCol(roomName, seatNo, seatGroup, base.isMoveStudent);
  return {
    studentId,
    grade: base.grade,
    day,
    period,
    subject: base.subject,
    roomName,
    seatNo,
    attendanceType,
    memo,
    note: buildAttendanceNote(attendanceType, memo),
    name: st?.name || '',
    homeClass: st ? `${st.grade}-${st.classNo}` : '',
    number: st?.number ?? '',
    row: coord?.row ?? base.row,
    col: coord?.col ?? base.col,
    isMoveStudent: base.isMoveStudent,
    seatGroup
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

function reconcileFixedSeatCoords() {
  if (!hasFixedRoomSeats()) return;
  let changed = false;
  Object.values(appState.fixedRoomSeats).forEach(fs => {
    const coord = resolveSeatRowCol(fs.roomName, fs.seatNo, fs.seatGroup, fs.isMoveStudent);
    if (coord && (fs.row !== coord.row || fs.col !== coord.col)) {
      fs.row = coord.row;
      fs.col = coord.col;
      changed = true;
    }
  });
  if (changed) {
    rebuildSeatAssignmentsFromFixed();
    syncDerivedRoomAssignments();
  }
}

function syncPlacementToSources(studentId, day, period) {
  const eff = getEffectivePlacement(studentId, day, period);
  if (!eff) return;

  const seatNo = parseInt(eff.seatNo, 10);
  const coord = resolveSeatRowCol(eff.roomName, seatNo, eff.seatGroup, eff.isMoveStudent);

  if (appState.fixedRoomSeats[studentId]) {
    appState.fixedRoomSeats[studentId] = {
      ...appState.fixedRoomSeats[studentId],
      roomName: eff.roomName,
      seatNo: Number.isFinite(seatNo) ? seatNo : appState.fixedRoomSeats[studentId].seatNo,
      ...(coord ? { row: coord.row, col: coord.col } : {})
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
          seatNo: Number.isFinite(seatNo) ? seatNo : arr[idx].seatNo,
          ...(coord ? { row: coord.row, col: coord.col } : {})
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
      const homeCount = residents.filter(id => !isMoveTargetStudent(appState.students[id])).length;
      const moveCount = residents.length - homeCount;
      if (residents.length > room.capacity) {
        overflows.push({ day: 0, period: 0, roomName: room.name, count: residents.length, capacity: room.capacity });
      }
      if (roomHasIncomingMovers(room.name, residents)) {
        const caps = getSplitSeatCapacities(seatConfig.rows, seatConfig.cols, seatConfig.moveStudentColumnMode);
        if (homeCount > caps.home) {
          overflows.push({ day: 0, period: 0, roomName: room.name, count: homeCount, capacity: caps.home, label: '본반 좌석' });
        }
        if (moveCount > caps.move) {
          overflows.push({ day: 0, period: 0, roomName: room.name, count: moveCount, capacity: caps.move, label: '이동반 좌석' });
        }
      } else if (residents.length > maxSeats) {
        overflows.push({ day: 0, period: 0, roomName: room.name, count: residents.length, capacity: maxSeats, label: '전좌석' });
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
  return Object.keys(appState.students).filter(id => {
    const st = appState.students[id];
    if (!st || !isGradeTakingExam(st.grade)) return false;
    return !appState.fixedRoomSeats?.[id];
  }).length;
}

function getOperationDiagnosisErrors() {
  if (appState._lastDiagnosis) {
    return appState._lastDiagnosis.items.filter(i => i.status === 'error');
  }
  return getPlacementBlockingErrors().map(message => ({ message }));
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
    if (!isGradeTakingExam(grade)) return;
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

    let noSchedule = studentIds.filter(id => {
      const st = appState.students[id];
      if (!st || !isGradeTakingExam(st.grade)) return false;
      return !(appState.studentExamSchedules[id] || []).length;
    }).length;
    if (noSchedule) {
      items.push({ category: '학생', status: 'warning', message: `시험 일정 없는 학생 ${noSchedule}명` });
    }

    const skipped = ALL_GRADES.filter(g => !isGradeTakingExam(g));
    if (skipped.length) {
      items.push({
        category: '운영',
        status: 'ok',
        message: `학년 참여: ${describeGradeParticipationSummary()}`
      });
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
      const assignedRoomNames = getFixedAssignedRoomNames(day, period);
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

function getPersistableState() {
  const { seatAssignments, roomAssignments, _lastDiagnosis, ...rest } = appState;
  return rest;
}

function saveToLocalSilent() {
  try {
    if (isStepActive('1')) collectAllSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistableState()));
    setSaveStatus('💾 저장됨');
  } catch (e) {
    console.warn('Exam Flow: localStorage 저장 실패', e);
    setSaveStatus('⚠️ 저장 실패');
  }
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
  window.examFlowUI?.refreshDiagnosisPills();
}

function invalidateDiagnosis() {
  appState._lastDiagnosis = null;
  if ($('#step-5')?.classList.contains('active')) {
    renderOperationDiagnosis();
    renderOutputValidationBanner();
    window.examFlowUI?.refreshDiagnosisPills();
  }
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
    _version: '0.9',
    examMeta: { ...appState.examMeta },
    gradeParticipation: JSON.parse(JSON.stringify(appState.examRules.gradeParticipation || { 1: 'exam', 2: 'exam', 3: 'exam' })),
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
      if (data.gradeParticipation) {
        appState.examRules.gradeParticipation = data.gradeParticipation;
      }
      if (data.moveRules) appState.examRules.movementRules = data.moveRules;
      if (data.seatConfig) {
        appState.examRules.seatDefaults = data.seatConfig;
        migrateLoadedState();
      }
      ensureGradeParticipationState();
      sanitizeMovementRulesForParticipation();
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
  const blob = new Blob([JSON.stringify(getPersistableState(), null, 2)], { type: 'application/json' });
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
  if ($('#step-5')?.classList.contains('active')) scheduleRefreshOutputPreview();
  else invalidateSteps('5');
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
  if ($('#step-5')?.classList.contains('active')) scheduleRefreshOutputPreview();
  else invalidateSteps('5');
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
  reconcileFixedSeatCoords();
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
    if ($('#step-5')?.classList.contains('active')) scheduleRefreshOutputPreview();
  else invalidateSteps('5');
  });
}

