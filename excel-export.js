/**
 * Exam Flow — Excel Export (SheetJS)
 * 브라우저에서만 동작, 서버 전송 없음
 */

const ExamFlowExcel = (function () {
  const EXPORTABLE_TYPES = [
    'seat-map', 'attendance', 'elective-students', 'personal', 'room-assignment'
  ];

  const BORDER_THIN = {
    top: { style: 'thin', color: { rgb: 'FF000000' } },
    bottom: { style: 'thin', color: { rgb: 'FF000000' } },
    left: { style: 'thin', color: { rgb: 'FF000000' } },
    right: { style: 'thin', color: { rgb: 'FF000000' } }
  };

  const STYLE_TITLE = {
    font: { bold: true, sz: 14 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  };
  const STYLE_SUBTITLE = {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  };
  const STYLE_HEADER = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'FFD9D9D9' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER_THIN
  };
  const STYLE_DATA = {
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER_THIN
  };
  const STYLE_DATA_LEFT = {
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: BORDER_THIN
  };
  const STYLE_SUMMARY = {
    font: { bold: true },
    alignment: { horizontal: 'left', vertical: 'center' }
  };
  const STYLE_MOVE_SHADE = {
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    fill: { fgColor: { rgb: 'FFD9D9D9' } },
    border: BORDER_THIN
  };
  const STYLE_BOARD_NUM = {
    font: { bold: true, sz: 16 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER_THIN
  };

  function api() { return window.examFlowExportApi; }

  function createWorkbook() { return XLSX.utils.book_new(); }

  function setCell(ws, r, c, value, style) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (value === '' || value == null) {
      ws[ref] = { t: 's', v: '' };
    } else if (typeof value === 'number') {
      ws[ref] = { t: 'n', v: value };
    } else {
      ws[ref] = { t: 's', v: String(value) };
    }
    if (style) ws[ref].s = style;
  }

  function addMerge(ws, r1, c1, r2, c2) {
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  }

  function applyBorderStyle(baseStyle) {
    return { ...baseStyle, border: BORDER_THIN };
  }

  function applyMergedTitle(ws, row, text, colCount, style) {
    setCell(ws, row, 0, text, style || STYLE_TITLE);
    if (colCount > 1) addMerge(ws, row, 0, row, colCount - 1);
  }

  function applySchoolHeader(ws, startRow, colCount, subtitles) {
    let row = startRow;
    const school = api().getSchoolNameLine();
    if (school) {
      applyMergedTitle(ws, row, school, colCount, STYLE_TITLE);
      row++;
    }
    applyMergedTitle(ws, row, api().getExamTitleLine(), colCount, STYLE_SUBTITLE);
    row++;
    (subtitles || []).forEach(text => {
      applyMergedTitle(ws, row, text, colCount, STYLE_SUBTITLE);
      row++;
    });
    return row;
  }

  function applyHeaderStyle(ws, row, colCount) {
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r: row, c });
      if (ws[ref]) ws[ref].s = STYLE_HEADER;
    }
  }

  function applyPrintArea(ws, startRow, endRow, startCol, endCol) {
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: startRow, c: startCol },
      e: { r: endRow, c: endCol }
    });
  }

  function autoFitColumns(ws, maxRow, colCount) {
    const cols = [];
    for (let c = 0; c < colCount; c++) {
      let maxLen = 8;
      for (let r = 0; r <= maxRow; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        if (!cell || cell.v == null) continue;
        String(cell.v).split('\n').forEach(line => { maxLen = Math.max(maxLen, line.length); });
      }
      cols.push({ wch: Math.min(maxLen + 2, 45) });
    }
    ws['!cols'] = cols;
  }

  function applyRowHeights(ws, heights) {
    ws['!rows'] = heights.map(h => (h ? { hpt: h } : {}));
  }

  function finalizeSheet(ws, maxRow, colCount, rowHeights) {
    applyPrintArea(ws, 0, maxRow, 0, colCount - 1);
    autoFitColumns(ws, maxRow, colCount);
    if (rowHeights) applyRowHeights(ws, rowHeights);
  }

  function sanitizeSheetName(name) {
    return String(name).replace(/[\\/*?:\[\]]/g, '_').slice(0, 31) || 'Sheet1';
  }

  function examMetaSlug() {
    const m = api().getExamMeta();
    return `${m.year}학년도${m.semester}학기${m.round}차`;
  }

  function downloadWorkbook(wb, filename) {
    XLSX.writeFile(wb, filename, { bookType: 'xlsx', cellStyles: true });
  }

  function validateExport() {
    const msg = api().getExportBlockingMessage();
    if (msg) { alert(`⚠ ${msg}`); return false; }
    return true;
  }

  function formatPeriodCell(data) {
    if (!data) return '-';
    const seatLabel = api().formatSeatNumberLabel(data.seatNo, {
      roomName: data.roomName,
      isMoveStudent: data.isMoveStudent
    });
    return `${data.subject}\n${data.roomName}\n${seatLabel}`;
  }

  /* ---------- 시험실배정현황 ---------- */

  function buildClassAssignmentSheet(day, grade, classNo) {
    const periods = api().getPeriodsPerDay();
    const students = api().getClassAssignmentData(day, grade, classNo);
    const colCount = 2 + periods;
    const headers = ['번호', '성명'];
    for (let p = 1; p <= periods; p++) headers.push(`${p}교시`);

    const ws = {};
    let row = applySchoolHeader(ws, 0, colCount, [
      `${day}일차 시험실배정현황`,
      `${grade}학년 ${classNo}반`
    ]);
    row++;

    headers.forEach((h, c) => setCell(ws, row, c, h, STYLE_HEADER));
    applyHeaderStyle(ws, row, colCount);
    row++;

    students.forEach(st => {
      setCell(ws, row, 0, st.number, STYLE_DATA);
      setCell(ws, row, 1, st.name, STYLE_DATA);
      for (let p = 1; p <= periods; p++) {
        setCell(ws, row, 1 + p, formatPeriodCell(st.periods[p]), STYLE_DATA);
      }
      row++;
    });

    finalizeSheet(ws, row - 1, colCount);
    return ws;
  }

  function exportClassAssignmentsExcel(f) {
    if (!validateExport()) return;
    const wb = createWorkbook();
    const { day, grade, classNo, classAll, bulkPrint } = f;
    const classes = (classAll || bulkPrint)
      ? api().getRoomAssignmentData(day, grade)
      : [{ grade, classNo, students: api().getClassAssignmentData(day, grade, classNo) }];
    if (!classes.length) { alert('해당 학년 학급 데이터가 없습니다.'); return; }
    classes.forEach(cls => {
      XLSX.utils.book_append_sheet(wb, buildClassAssignmentSheet(day, cls.grade, cls.classNo),
        sanitizeSheetName(`${cls.grade}-${cls.classNo}`));
    });
    downloadWorkbook(wb, `시험실배정현황_${examMetaSlug()}_${day}일차.xlsx`);
  }

  /* ---------- 응시현황표 ---------- */

  function buildAttendanceSheet(room, day) {
    const data = api().getAttendanceRoomDayData(room, day);
    const periodCount = data.periodNums.length;
    const colCount = 2 + periodCount * 3;
    const ws = {};
    const roomLabel = room.includes('-') ? `[${room}반 교실]` : `[${room}]`;
    let row = applySchoolHeader(ws, 0, colCount, [
      `${api().getExamTitleLine()} 응시현황표`,
      roomLabel,
      `${data.dateLabel} *결시자 표시-질병/미인정/인정/기타`
    ]);
    row++;

    setCell(ws, row, 0, '순', STYLE_HEADER);
    setCell(ws, row, 1, '학급', STYLE_HEADER);
    data.periodNums.forEach((p, i) => {
      setCell(ws, row, 2 + i * 3, `${p}교시`, STYLE_HEADER);
      addMerge(ws, row, 2 + i * 3, row, 2 + i * 3 + 2);
    });
    row++;
    setCell(ws, row, 0, '', STYLE_HEADER);
    setCell(ws, row, 1, '', STYLE_HEADER);
    data.periodNums.forEach((p, i) => {
      const base = 2 + i * 3;
      ['번호', '이름', '응시현황'].forEach((h, j) => setCell(ws, row, base + j, h, STYLE_HEADER));
    });
    applyHeaderStyle(ws, row - 1, colCount);
    applyHeaderStyle(ws, row, colCount);
    row++;

    data.groups.forEach(group => {
      setCell(ws, row, 1, group.label, STYLE_DATA_LEFT);
      group.periodHeaders.forEach((h, i) => {
        setCell(ws, row, 2 + i * 3, h, STYLE_DATA_LEFT);
        addMerge(ws, row, 2 + i * 3, row, 2 + i * 3 + 2);
      });
      row++;

      group.rows.forEach(r => {
        setCell(ws, row, 0, r.order, STYLE_DATA);
        setCell(ws, row, 1, group.label, STYLE_DATA);
        r.cells.forEach((cell, i) => {
          const base = 2 + i * 3;
          const style = cell.isElective ? STYLE_MOVE_SHADE : STYLE_DATA;
          setCell(ws, row, base, cell.number, style);
          setCell(ws, row, base + 1, cell.name, style);
          setCell(ws, row, base + 2, '', cell.isElective ? STYLE_MOVE_SHADE : style);
        });
        row++;
      });

      const padRows = Math.max(0, (group.rowCount || 21) - group.rows.length);
      for (let i = 0; i < padRows; i++) {
        setCell(ws, row, 0, group.rows.length + i + 1, STYLE_DATA);
        setCell(ws, row, 1, '', STYLE_DATA);
        data.periodNums.forEach((p, pi) => {
          const base = 2 + pi * 3;
          setCell(ws, row, base, '', STYLE_DATA);
          setCell(ws, row, base + 1, '', STYLE_DATA);
          setCell(ws, row, base + 2, '', STYLE_DATA);
        });
        row++;
      }

      data.periodNums.forEach((p, i) => {
        const base = 2 + i * 3;
        setCell(ws, row, base, '작성자', STYLE_DATA);
        setCell(ws, row, base + 1, '', STYLE_DATA);
        setCell(ws, row, base + 2, '(인)', STYLE_DATA);
      });
      row++;
    });

    setCell(ws, row, 0, '* 음영 표시는 선택과목 응시자입니다.', STYLE_SUMMARY);
    addMerge(ws, row, 0, row, colCount - 1);

    finalizeSheet(ws, row, colCount);
    return ws;
  }

  function exportAttendanceExcel(f) {
    if (!validateExport()) return;
    const rooms = f.bulkPrint || f.printScope === 'all'
      ? api().getRoomsForDay(f.day) : [f.room];
    if (!rooms.length) { alert('해당 일차 배정 데이터가 없습니다.'); return; }
    const wb = createWorkbook();
    rooms.forEach(room => {
      XLSX.utils.book_append_sheet(wb, buildAttendanceSheet(room, f.day),
        sanitizeSheetName(room));
    });
    const roomPart = f.bulkPrint ? `${f.day}일차_전체` : f.room;
    downloadWorkbook(wb, `응시현황표_${roomPart}.xlsx`);
  }

  /* ---------- 선택과목 응시 학생 ---------- */

  function buildElectiveStudentsSheet(roomName, studentGrade, columns) {
    const cols = columns || api().getElectiveStudentsColumnsForRoom(roomName, studentGrade);
    if (!cols.length) return null;

    const colCount = 1 + cols.length * 2;
    const ws = {};
    const header = api().formatElectiveRoomHeader(roomName, studentGrade);
    let row = applySchoolHeader(ws, 0, colCount, [
      api().getExamTitleShort(),
      `${header.roomLabel} ${header.subtitle}`,
      header.roomLine
    ]);
    row++;

    const headerStart = row;
    setCell(ws, headerStart, 0, '순', STYLE_HEADER);
    addMerge(ws, headerStart, 0, headerStart + 2, 0);
    for (let i = 0; i < cols.length;) {
      const day = cols[i].day;
      let count = 0;
      while (i + count < cols.length && cols[i + count].day === day) count++;
      setCell(ws, headerStart, 1 + i * 2, cols[i].dateLabel, STYLE_HEADER);
      addMerge(ws, headerStart, 1 + i * 2, headerStart, 1 + (i + count) * 2 - 1);
      i += count;
    }

    cols.forEach((col, idx) => {
      setCell(ws, headerStart + 1, 1 + idx * 2, col.periodLabel, STYLE_HEADER);
      addMerge(ws, headerStart + 1, 1 + idx * 2, headerStart + 1, 1 + idx * 2 + 1);
    });

    cols.forEach((col, idx) => {
      setCell(ws, headerStart + 2, 1 + idx * 2, col.subject, STYLE_HEADER);
      addMerge(ws, headerStart + 2, 1 + idx * 2, headerStart + 2, 1 + idx * 2 + 1);
    });
    applyHeaderStyle(ws, headerStart, colCount);
    applyHeaderStyle(ws, headerStart + 1, colCount);
    applyHeaderStyle(ws, headerStart + 2, colCount);
    row = headerStart + 3;

    const maxRows = 20;
    for (let r = 0; r < maxRows; r++) {
      setCell(ws, row, 0, r + 1, STYLE_DATA);
      cols.forEach((col, idx) => {
        const st = col.students[r];
        setCell(ws, row, 1 + idx * 2, st ? api().formatElectiveStudentNumber(st.number) : '', STYLE_DATA);
        setCell(ws, row, 1 + idx * 2 + 1, st ? st.name : '', STYLE_DATA);
      });
      row++;
    }

    setCell(ws, row, 0, '계', STYLE_HEADER);
    cols.forEach((col, idx) => {
      setCell(ws, row, 1 + idx * 2, `${col.students.length} 명`, STYLE_DATA);
      addMerge(ws, row, 1 + idx * 2, row, 1 + idx * 2 + 1);
    });
    applyHeaderStyle(ws, row, colCount);

    finalizeSheet(ws, row, colCount);
    return ws;
  }

  function electiveSheetName(roomName, studentGrade) {
    return sanitizeSheetName(`${roomName}_${studentGrade}학`);
  }

  function exportElectiveStudentsExcel(f) {
    if (!validateExport()) return;
    const { grade, room, bulkPrint } = f;
    const rooms = bulkPrint ? api().getOutputRoomNames(grade) : [room];
    if (!rooms.length) { alert('고사실을 선택하세요.'); return; }

    const wb = createWorkbook();
    let added = 0;
    rooms.forEach(rm => {
      const sections = api().getElectiveStudentsSectionsForRoom(rm);
      sections.forEach(({ grade: studentGrade, columns }) => {
        const ws = buildElectiveStudentsSheet(rm, studentGrade, columns);
        if (!ws) return;
        XLSX.utils.book_append_sheet(wb, ws, electiveSheetName(rm, studentGrade));
        added++;
      });
    });
    if (!added) { alert('해당 고사실의 선택과목 응시 데이터가 없습니다.'); return; }
    const suffix = bulkPrint ? `${grade}학년_전체고사실` : room;
    downloadWorkbook(wb, `선택과목응시학생_${examMetaSlug()}_${suffix}.xlsx`);
  }

  /* ---------- 좌석배치도 ---------- */

  function formatSeatMapCell(seat) {
    if (!seat) return '';
    return `${seat.studentId}\n${seat.name}`;
  }

  function isMoveColumn(col, moveMode) {
    const mode = moveMode === 'even' ? 'even' : 'odd';
    return mode === 'odd' ? col % 2 === 1 : col % 2 === 0;
  }

  function buildSeatMapSheet(grade, day, period, room) {
    const fixed = api().hasFixedRoomSeats();
    const { seatConfig, seatByCoord, subject } = api().getSeatDataForSession(grade, day, period, room);
    const { rows, cols } = seatConfig;
    const moveMode = seatConfig.moveStudentColumnMode;
    const split = api().usesSplitColumnLayout(room);
    const ws = {};
    const subtitles = [
      '좌석배치표',
      api().getExamTitleLine(),
      fixed
        ? `고사실 : ${room}`
        : `${day}일차 ${period}교시 · 고사실 : ${room} · 교과 : ${subject || '-'}`
    ];
    let row = applySchoolHeader(ws, 0, cols, subtitles);
    setCell(ws, row, 0, '교 탁', STYLE_SUBTITLE);
    setCell(ws, row, cols - 1, '< 출입문 앞쪽 >', STYLE_SUBTITLE);
    row++;

    if (split) {
      for (let c = 1; c <= cols; c++) {
        const isMoveCol = isMoveColumn(c, moveMode);
        setCell(ws, row, c - 1, isMoveCol ? '이동반' : '본반', isMoveCol ? STYLE_MOVE_SHADE : STYLE_HEADER);
      }
      row++;
    }

    const rowHeights = new Array(row).fill(18);
    for (let r = 1; r <= rows; r++) {
      let hasSeat = false;
      for (let c = 1; c <= cols; c++) {
        const seat = seatByCoord[`${r}-${c}`];
        if (seat) hasSeat = true;
        const isMoveCol = split && isMoveColumn(c, moveMode);
        const style = isMoveCol ? STYLE_MOVE_SHADE : STYLE_DATA;
        setCell(ws, row, c - 1, formatSeatMapCell(seat), applyBorderStyle(style));
      }
      rowHeights[row] = hasSeat ? 42 : 24;
      row++;
    }

    setCell(ws, row, cols - 1, '< 출입문 뒷쪽 >', STYLE_SUBTITLE);
    rowHeights[row] = 18;
    finalizeSheet(ws, row, cols, rowHeights);
    return ws;
  }

  function exportSeatMapExcel(f) {
    if (!validateExport()) return;
    const { grade, day, period, room, bulkPrint } = f;
    const rooms = bulkPrint ? api().getSeatMapBulkRooms(f) : [room];
    if (!rooms.length) {
      alert('일괄 출력할 교실이 없습니다.');
      return;
    }
    const wb = createWorkbook();
    let added = 0;
    rooms.forEach(rm => {
      const { seatByCoord } = api().getSeatDataForSession(grade, day, period, rm);
      if (!Object.keys(seatByCoord).length) return;
      XLSX.utils.book_append_sheet(wb, buildSeatMapSheet(grade, day, period, rm), sanitizeSheetName(rm));
      added++;
    });
    if (!added) {
      alert('배정된 좌석 데이터가 없습니다.');
      return;
    }
    const fname = bulkPrint
      ? (api().hasFixedRoomSeats()
        ? `좌석배치표_${grade}학년_전체교실.xlsx`
        : `좌석배치표_${grade}학년_${day}일차_${period}교시_전체.xlsx`)
      : (api().hasFixedRoomSeats()
        ? `좌석배치표_${grade}학년_${room}.xlsx`
        : `좌석배치표_${grade}학년_${day}일차_${period}교시_${room}.xlsx`);
    downloadWorkbook(wb, fname);
  }

  /* ---------- 개인별 시험시간표 ---------- */

  function buildPersonalSheet(studentId) {
    const data = api().getPersonalScheduleData(studentId);
    if (!data) return null;
    const { student: st, schedule } = data;
    const colCount = 6;
    const ws = {};
    let row = applySchoolHeader(ws, 0, colCount, [
      `${st.grade}학년 ${st.classNo}반 ${st.number}번`,
      st.name
    ]);
    row++;

    ['일차', '날짜', '교시', '과목', '시험실', '좌석']
      .forEach((h, c) => setCell(ws, row, c, h, STYLE_HEADER));
    applyHeaderStyle(ws, row, colCount);
    row++;

    schedule.forEach(s => {
      setCell(ws, row, 0, s.day, STYLE_DATA);
      setCell(ws, row, 1, s.date, STYLE_DATA);
      setCell(ws, row, 2, s.period, STYLE_DATA);
      setCell(ws, row, 3, s.subject, STYLE_DATA);
      setCell(ws, row, 4, s.room, STYLE_DATA);
      setCell(ws, row, 5, api().formatSeatLabelForStudent(studentId, s.seatNo, s.room), STYLE_DATA);
      row++;
    });

    finalizeSheet(ws, row - 1, colCount);
    return { ws, name: st.name };
  }

  function exportPersonalExcel(f) {
    if (!validateExport()) return;
    const wb = createWorkbook();

    if (f.bulkPrint || f.classAll) {
      const students = Object.values(window.examFlowState.students)
        .filter(s => s.grade === f.grade && s.classNo === f.classNo)
        .sort((a, b) => a.number - b.number);
      if (!students.length) { alert('해당 학급 학생이 없습니다.'); return; }
      students.forEach(st => {
        const built = buildPersonalSheet(st.studentId);
        if (built) XLSX.utils.book_append_sheet(wb, built.ws, sanitizeSheetName(built.name));
      });
      downloadWorkbook(wb, `시험시간표_${f.grade}학년${f.classNo}반.xlsx`);
      return;
    }

    const built = buildPersonalSheet(f.studentId);
    if (!built) { alert('학생을 선택하세요.'); return; }
    XLSX.utils.book_append_sheet(wb, built.ws, '개인시간표');
    downloadWorkbook(wb, `시험시간표_${built.name}.xlsx`);
  }

  /* ---------- 운영요약 ---------- */

  function exportDashboardExcel() {
    if (!validateExport()) return;
    const stats = api().getOperationDashboardStats();
    const items = [
      ['전체 학생 수', stats.totalStudents],
      ['전체 시험실 수', stats.totalRooms],
      ['사용 중 시험실 수', stats.usedRooms],
      ['특별실 수', stats.specialRooms],
      ['운영 교과 수', stats.subjectCount],
      ['좌석 수', stats.totalSeats],
      ['배정 인원', stats.assignedCount],
      ['빈 좌석 수', stats.emptySeats]
    ];

    const colCount = 2;
    const ws = {};
    let row = applySchoolHeader(ws, 0, colCount, ['시험 운영 요약']);
    row++;

    setCell(ws, row, 0, '항목', STYLE_HEADER);
    setCell(ws, row, 1, '값', STYLE_HEADER);
    applyHeaderStyle(ws, row, colCount);
    row++;

    items.forEach(([label, value]) => {
      setCell(ws, row, 0, label, STYLE_DATA_LEFT);
      setCell(ws, row, 1, value, STYLE_DATA);
      row++;
    });

    finalizeSheet(ws, row - 1, colCount);
    const wb = createWorkbook();
    XLSX.utils.book_append_sheet(wb, ws, '운영요약');
    downloadWorkbook(wb, '시험운영요약.xlsx');
  }

  /* ---------- 라우터 ---------- */

  function exportToExcel(type, filters) {
    if (!EXPORTABLE_TYPES.includes(type)) {
      alert('지원하지 않는 출력물입니다.');
      return;
    }
    switch (type) {
      case 'seat-map':
        exportSeatMapExcel(filters);
        break;
      case 'attendance': exportAttendanceExcel(filters); break;
      case 'elective-students': exportElectiveStudentsExcel(filters); break;
      case 'personal': exportPersonalExcel(filters); break;
      case 'room-assignment': exportClassAssignmentsExcel(filters); break;
      default: alert('지원하지 않는 출력물입니다.');
    }
  }

  return {
    createWorkbook,
    autoFitColumns,
    applyHeaderStyle,
    applySchoolHeader,
    applyMergedTitle,
    applyBorderStyle,
    applyPrintArea,
    validateExport,
    exportClassAssignmentsExcel,
    exportAttendanceExcel,
    exportElectiveStudentsExcel,
    exportSeatMapExcel,
    exportPersonalExcel,
    exportDashboardExcel,
    exportToExcel,
    EXPORTABLE_TYPES
  };
})();

window.ExamFlowExcel = ExamFlowExcel;
