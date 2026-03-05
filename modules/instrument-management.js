export function initInstrumentManagement({ state, persist, createId, safeText }) {
  const instrumentForm = document.getElementById('instrument-form');
  const instrumentIdInput = document.getElementById('instrument-id');
  const instrumentNameInput = document.getElementById('instrument-name');
  const instrumentNicknameInput = document.getElementById('instrument-nickname');
  const instrumentCancelBtn = document.getElementById('instrument-cancel-btn');
  const instrumentList = document.getElementById('instrument-list');

  const instrumentDetailPanel = document.getElementById('instrument-detail-panel');
  const instrumentDetailTitle = document.getElementById('instrument-detail-title');
  const instrumentDetailSubtitle = document.getElementById('instrument-detail-subtitle');
  const calendarMonthLabel = document.getElementById('calendar-month-label');
  const calendarPrevBtn = document.getElementById('calendar-prev-btn');
  const calendarTodayBtn = document.getElementById('calendar-today-btn');
  const calendarNextBtn = document.getElementById('calendar-next-btn');
  const calendarMonthViewBtn = document.getElementById('calendar-month-view-btn');
  const calendarWeekViewBtn = document.getElementById('calendar-week-view-btn');
  const instrumentCalendar = document.getElementById('instrument-calendar');

  const reservationForm = document.getElementById('reservation-form');
  const reservationIdInput = document.getElementById('reservation-id');
  const reservationTitleInput = document.getElementById('reservation-title');
  const reservationDateInput = document.getElementById('reservation-date');
  const reservationStartTimeInput = document.getElementById('reservation-start-time');
  const reservationEndTimeInput = document.getElementById('reservation-end-time');
  const reservationNotesInput = document.getElementById('reservation-notes');
  const reservationCancelBtn = document.getElementById('reservation-cancel-btn');
  const reservationList = document.getElementById('reservation-list');

  const PIXELS_PER_HOUR = 48;
  const MINUTES_PER_HOUR = 60;
  const DAY_MINUTES = 24 * MINUTES_PER_HOUR;

  let selectedInstrumentId = '';
  let calendarCursor = normalizeDate(new Date());
  let calendarView = 'month';
  let dragState = null;

  instrumentForm.addEventListener('submit', onInstrumentSubmit);
  instrumentCancelBtn.addEventListener('click', resetInstrumentForm);
  instrumentList.addEventListener('click', onInstrumentListClick);

  calendarPrevBtn.addEventListener('click', () => {
    calendarCursor = calendarView === 'week'
      ? addDays(calendarCursor, -7)
      : new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });

  calendarTodayBtn.addEventListener('click', () => {
    calendarCursor = normalizeDate(new Date());
    renderCalendar();
  });

  calendarNextBtn.addEventListener('click', () => {
    calendarCursor = calendarView === 'week'
      ? addDays(calendarCursor, 7)
      : new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });

  calendarMonthViewBtn.addEventListener('click', () => {
    calendarView = 'month';
    renderCalendar();
  });

  calendarWeekViewBtn.addEventListener('click', () => {
    calendarView = 'week';
    renderCalendar();
  });

  instrumentCalendar.addEventListener('click', (event) => {
    const inlineEdit = event.target.closest('[data-reservation-edit-inline]');
    if (inlineEdit) {
      editReservation(inlineEdit.dataset.reservationEditInline);
      return;
    }

    const dateButton = event.target.closest('[data-calendar-date]');
    if (!dateButton) {
      return;
    }

    reservationDateInput.value = dateButton.dataset.calendarDate;
    onReservationDraftChanged();
  });

  instrumentCalendar.addEventListener('mousedown', (event) => {
    if (calendarView !== 'week' || event.button !== 0) {
      return;
    }

    if (event.target.closest('[data-reservation-edit-inline]')) {
      return;
    }

    const dayColumn = event.target.closest('[data-week-date]');
    if (!dayColumn) {
      return;
    }

    event.preventDefault();
    beginWeekDrag(dayColumn, event.clientY);
  });

  reservationForm.addEventListener('submit', onReservationSubmit);
  reservationCancelBtn.addEventListener('click', resetReservationForm);
  reservationList.addEventListener('click', onReservationListClick);

  reservationDateInput.addEventListener('input', onReservationDraftChanged);
  reservationStartTimeInput.addEventListener('input', onReservationDraftChanged);
  reservationEndTimeInput.addEventListener('input', onReservationDraftChanged);

  function ensureStateShape() {
    if (!Array.isArray(state.instruments)) {
      state.instruments = [];
    }
  }

  function normalizeDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    const next = new Date(date);
    next.setDate(next.getDate() + count);
    return normalizeDate(next);
  }

  function firstOfWeek(date) {
    const normalized = normalizeDate(date);
    return addDays(normalized, -normalized.getDay());
  }

  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseTimeToMinutes(timeText, fallback) {
    if (!timeText) {
      return fallback;
    }

    const [hours, minutes] = String(timeText).split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return fallback;
    }

    return Math.max(0, Math.min(DAY_MINUTES, hours * MINUTES_PER_HOUR + minutes));
  }

  function formatMinutes(minutes) {
    const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, minutes));
    const hour = Math.floor(clamped / MINUTES_PER_HOUR);
    const minute = clamped % MINUTES_PER_HOUR;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function roundToQuarter(minutes) {
    return Math.round(minutes / 15) * 15;
  }

  function rangesOverlap(firstRange, secondRange) {
    return firstRange.start < secondRange.end && secondRange.start < firstRange.end;
  }

  function onReservationDraftChanged() {
    if (calendarView === 'week') {
      renderCalendar();
    }
  }

  function getCurrentUser() {
    const personal = state.settings?.personalInfo || {};
    const name = String(personal.name || '').trim();
    const enanaEmail = String(personal.enanaEmail || '').trim().toLowerCase();

    if (enanaEmail) {
      return {
        key: `email:${enanaEmail}`,
        label: name ? `${name} (${enanaEmail})` : enanaEmail
      };
    }

    if (name) {
      return {
        key: `name:${name.toLowerCase()}`,
        label: name
      };
    }

    return {
      key: 'unknown-user',
      label: 'Unknown User'
    };
  }

  function getSelectedInstrument() {
    if (!selectedInstrumentId) {
      return null;
    }
    return state.instruments.find((instrument) => instrument.id === selectedInstrumentId) || null;
  }

  function normalizeInstrument(instrument) {
    return {
      ...instrument,
      reservations: Array.isArray(instrument.reservations) ? instrument.reservations : []
    };
  }

  function getReservationRangeMinutes(reservation) {
    const start = parseTimeToMinutes(reservation.startTime, 9 * MINUTES_PER_HOUR);
    const endRaw = reservation.endTime
      ? parseTimeToMinutes(reservation.endTime, start + MINUTES_PER_HOUR)
      : start + MINUTES_PER_HOUR;
    const end = Math.max(start + 15, endRaw);

    return {
      start: Math.min(start, DAY_MINUTES - 15),
      end: Math.min(end, DAY_MINUTES)
    };
  }

  function getDraftReservation() {
    const date = reservationDateInput.value;
    if (!date) {
      return null;
    }

    const startTime = reservationStartTimeInput.value;
    const endTime = reservationEndTimeInput.value;
    if (startTime && endTime && parseTimeToMinutes(endTime, 0) <= parseTimeToMinutes(startTime, 0)) {
      return null;
    }

    const draft = {
      id: reservationIdInput.value || '__draft__',
      title: reservationTitleInput.value.trim() || 'Draft reservation',
      date,
      startTime,
      endTime
    };

    return {
      ...draft,
      draftRange: getReservationRangeMinutes(draft)
    };
  }

  function findOverlappingReservation(candidate, reservations, excludeReservationId) {
    if (!candidate.date) {
      return null;
    }

    const candidateRange = getReservationRangeMinutes(candidate);

    return reservations.find((existing) => {
      if (existing.id === excludeReservationId) {
        return false;
      }
      if (existing.date !== candidate.date) {
        return false;
      }

      const existingRange = getReservationRangeMinutes(existing);
      return rangesOverlap(candidateRange, existingRange);
    }) || null;
  }

  function onInstrumentSubmit(event) {
    event.preventDefault();
    ensureStateShape();

    const instrument = {
      id: instrumentIdInput.value || createId(),
      name: instrumentNameInput.value.trim(),
      nickname: instrumentNicknameInput.value.trim()
    };

    if (!instrument.name) {
      return;
    }

    const index = state.instruments.findIndex((item) => item.id === instrument.id);
    if (index >= 0) {
      state.instruments[index] = {
        ...normalizeInstrument(state.instruments[index]),
        ...instrument
      };
    } else {
      state.instruments.push({
        ...instrument,
        reservations: []
      });
    }

    selectedInstrumentId = instrument.id;
    persist();
    resetInstrumentForm();
    render();
  }

  function resetInstrumentForm() {
    instrumentIdInput.value = '';
    instrumentForm.reset();
  }

  function editInstrument(instrumentId) {
    const instrument = state.instruments.find((item) => item.id === instrumentId);
    if (!instrument) {
      return;
    }

    instrumentIdInput.value = instrument.id;
    instrumentNameInput.value = instrument.name || '';
    instrumentNicknameInput.value = instrument.nickname || '';
  }

  function deleteInstrument(instrumentId) {
    state.instruments = state.instruments.filter((item) => item.id !== instrumentId);
    if (selectedInstrumentId === instrumentId) {
      selectedInstrumentId = '';
      instrumentDetailPanel.hidden = true;
      resetReservationForm();
    }

    persist();
    render();
  }

  function openInstrument(instrumentId) {
    selectedInstrumentId = instrumentId;
    resetReservationForm();
    renderDetail();
    renderInstrumentList();
  }

  function onInstrumentListClick(event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }

    if (button.dataset.instrumentOpen) {
      openInstrument(button.dataset.instrumentOpen);
      return;
    }

    if (button.dataset.instrumentEdit) {
      editInstrument(button.dataset.instrumentEdit);
      return;
    }

    if (button.dataset.instrumentDelete) {
      deleteInstrument(button.dataset.instrumentDelete);
    }
  }

  function onReservationSubmit(event) {
    event.preventDefault();

    const instrument = getSelectedInstrument();
    if (!instrument) {
      return;
    }

    const currentUser = getCurrentUser();
    const reservation = {
      id: reservationIdInput.value || createId(),
      title: reservationTitleInput.value.trim(),
      date: reservationDateInput.value,
      startTime: reservationStartTimeInput.value,
      endTime: reservationEndTimeInput.value,
      notes: reservationNotesInput.value.trim()
    };

    if (!reservation.title || !reservation.date) {
      return;
    }

    if (reservation.startTime && reservation.endTime) {
      const startMinutes = parseTimeToMinutes(reservation.startTime, 0);
      const endMinutes = parseTimeToMinutes(reservation.endTime, 0);
      if (endMinutes <= startMinutes) {
        window.alert('End time must be after start time.');
        return;
      }
    }

    const reservations = normalizeInstrument(instrument).reservations;
    const overlap = findOverlappingReservation(reservation, reservations, reservation.id);
    if (overlap) {
      const overlapTitle = overlap.title || 'existing reservation';
      window.alert(`This reservation overlaps with "${overlapTitle}" on ${overlap.date}.`);
      return;
    }

    const index = reservations.findIndex((item) => item.id === reservation.id);

    if (index >= 0) {
      if (reservations[index].createdBy !== currentUser.key) {
        return;
      }

      reservations[index] = {
        ...reservations[index],
        ...reservation,
        updatedAt: new Date().toISOString()
      };
    } else {
      reservations.push({
        ...reservation,
        createdBy: currentUser.key,
        createdByLabel: currentUser.label,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    instrument.reservations = reservations;
    persist();
    resetReservationForm();
    renderInstrumentList();
    renderDetail();
  }

  function resetReservationForm() {
    reservationIdInput.value = '';
    reservationForm.reset();
    onReservationDraftChanged();
  }

  function onReservationListClick(event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }

    if (button.dataset.reservationEdit) {
      editReservation(button.dataset.reservationEdit);
      return;
    }

    if (button.dataset.reservationDelete) {
      deleteReservation(button.dataset.reservationDelete);
    }
  }

  function editReservation(reservationId) {
    const instrument = getSelectedInstrument();
    if (!instrument) {
      return;
    }

    const currentUser = getCurrentUser();
    const reservation = normalizeInstrument(instrument).reservations.find((item) => item.id === reservationId);
    if (!reservation || reservation.createdBy !== currentUser.key) {
      return;
    }

    reservationIdInput.value = reservation.id;
    reservationTitleInput.value = reservation.title || '';
    reservationDateInput.value = reservation.date || '';
    reservationStartTimeInput.value = reservation.startTime || '';
    reservationEndTimeInput.value = reservation.endTime || '';
    reservationNotesInput.value = reservation.notes || '';
    onReservationDraftChanged();
  }

  function deleteReservation(reservationId) {
    const instrument = getSelectedInstrument();
    if (!instrument) {
      return;
    }

    const currentUser = getCurrentUser();
    const reservations = normalizeInstrument(instrument).reservations;
    const reservation = reservations.find((item) => item.id === reservationId);
    if (!reservation || reservation.createdBy !== currentUser.key) {
      return;
    }

    instrument.reservations = reservations.filter((item) => item.id !== reservationId);
    persist();
    renderInstrumentList();
    renderDetail();
  }

  function renderInstrumentList() {
    ensureStateShape();

    if (!state.instruments.length) {
      instrumentList.innerHTML = '<p class="small-note">No instruments yet.</p>';
      return;
    }

    instrumentList.innerHTML = state.instruments.map((instrument) => {
      const reservations = normalizeInstrument(instrument).reservations;
      const selectedClass = selectedInstrumentId === instrument.id ? ' list-row-selected' : '';
      return `
        <article class="list-row instrument-list-row${selectedClass}">
          <button class="ghost-btn list-main-btn" data-instrument-open="${instrument.id}">
            ${safeText(instrument.name)}
          </button>
          <span class="small-note">${safeText(instrument.nickname || '-')}</span>
          <span class="small-note">${reservations.length} reservations</span>
          <div class="card-actions list-actions">
            <button class="ghost-btn" data-instrument-edit="${instrument.id}">Edit</button>
            <button class="danger-btn" data-instrument-delete="${instrument.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderMonthCalendar(reservations) {
    const cursor = firstOfMonth(calendarCursor);
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const todayKey = toDateKey(new Date());

    calendarMonthLabel.textContent = firstDay.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric'
    });

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells = [];

    for (let i = 0; i < startOffset; i += 1) {
      cells.push('<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const date = new Date(year, month, day);
      const dateKey = toDateKey(date);
      const dayEvents = reservations
        .filter((item) => item.date === dateKey)
        .sort((a, b) => {
          const first = `${a.startTime || '00:00'}-${a.title || ''}`;
          const second = `${b.startTime || '00:00'}-${b.title || ''}`;
          return first.localeCompare(second);
        });

      const isToday = dateKey === todayKey;
      const hasEvents = dayEvents.length > 0;
      const topEvents = dayEvents
        .slice(0, 3)
        .map((item) => `<li>${safeText(item.startTime ? `${item.startTime} ` : '')}${safeText(item.title)}</li>`)
        .join('');
      const overflow = dayEvents.length > 3 ? `<li>+${dayEvents.length - 3} more</li>` : '';

      cells.push(`
        <button type="button" class="calendar-day${hasEvents ? ' calendar-day-has-events' : ''}${isToday ? ' calendar-day-today' : ''}" data-calendar-date="${dateKey}">
          <span class="calendar-day-number">${day}</span>
          ${hasEvents ? `<ul class="calendar-day-events">${topEvents}${overflow}</ul>` : '<span class="calendar-day-empty-label">No reservations</span>'}
        </button>
      `);
    }

    instrumentCalendar.innerHTML = `
      <div class="calendar-weekdays">
        ${weekdays.map((name) => `<span>${name}</span>`).join('')}
      </div>
      <div class="calendar-grid">${cells.join('')}</div>
    `;
  }

  function buildWeekDays(anchorDate) {
    const start = firstOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  function formatWeekRange(days) {
    const first = days[0];
    const last = days[days.length - 1];
    const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();

    if (sameMonth) {
      return `${first.toLocaleDateString(undefined, { month: 'short' })} ${first.getDate()}-${last.getDate()}, ${last.getFullYear()}`;
    }

    return `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  function minuteFromClientY(columnElement, clientY) {
    const bounds = columnElement.getBoundingClientRect();
    const offsetY = Math.max(0, Math.min(bounds.height, clientY - bounds.top));
    const minute = (offsetY / PIXELS_PER_HOUR) * MINUTES_PER_HOUR;
    return Math.max(0, Math.min(DAY_MINUTES, roundToQuarter(minute)));
  }

  function updateDragPreview() {
    if (!dragState?.previewElement || !dragState?.columnElement) {
      return;
    }

    const start = Math.min(dragState.startMinute, dragState.currentMinute);
    const end = Math.max(dragState.startMinute, dragState.currentMinute);
    const normalizedEnd = Math.max(start + 15, end);

    dragState.previewElement.style.top = `${(start / MINUTES_PER_HOUR) * PIXELS_PER_HOUR}px`;
    dragState.previewElement.style.height = `${Math.max(6, ((normalizedEnd - start) / MINUTES_PER_HOUR) * PIXELS_PER_HOUR)}px`;
  }

  function beginWeekDrag(columnElement, clientY) {
    const startMinute = minuteFromClientY(columnElement, clientY);
    const previewElement = document.createElement('div');
    previewElement.className = 'week-drag-preview';
    columnElement.classList.add('week-day-column-dragging');
    columnElement.appendChild(previewElement);

    dragState = {
      dateKey: columnElement.dataset.weekDate,
      columnElement,
      previewElement,
      startMinute,
      currentMinute: startMinute
    };
    updateDragPreview();

    document.addEventListener('mousemove', onWeekDragMove);
    document.addEventListener('mouseup', onWeekDragEnd);
  }

  function endWeekDrag(applyResult) {
    if (!dragState) {
      return;
    }

    const { dateKey, startMinute, currentMinute, previewElement, columnElement } = dragState;
    document.removeEventListener('mousemove', onWeekDragMove);
    document.removeEventListener('mouseup', onWeekDragEnd);

    if (previewElement && previewElement.parentElement) {
      previewElement.parentElement.removeChild(previewElement);
    }

    if (columnElement) {
      columnElement.classList.remove('week-day-column-dragging');
    }

    dragState = null;

    if (!applyResult) {
      return;
    }

    const start = Math.min(startMinute, currentMinute);
    const end = Math.max(startMinute, currentMinute);
    const normalizedEnd = Math.max(start + 15, end);

    reservationIdInput.value = '';
    reservationDateInput.value = dateKey;
    reservationStartTimeInput.value = formatMinutes(start);
    reservationEndTimeInput.value = formatMinutes(normalizedEnd);
    onReservationDraftChanged();
    reservationTitleInput.focus();
  }

  function onWeekDragMove(event) {
    if (!dragState) {
      return;
    }

    dragState.currentMinute = minuteFromClientY(dragState.columnElement, event.clientY);
    updateDragPreview();
  }

  function onWeekDragEnd() {
    endWeekDrag(true);
  }

  function renderWeekCalendar(reservations) {
    const days = buildWeekDays(calendarCursor);
    const dayKeys = days.map(toDateKey);
    const todayKey = toDateKey(new Date());
    const currentUser = getCurrentUser();
    const draft = getDraftReservation();

    calendarMonthLabel.textContent = formatWeekRange(days);

    const timeRows = [];
    for (let hour = 0; hour < 24; hour += 1) {
      timeRows.push(`<div class="week-time-label">${formatMinutes(hour * MINUTES_PER_HOUR)}</div>`);
    }

    const dayColumns = days.map((day, index) => {
      const dayKey = dayKeys[index];
      const dayEvents = reservations
        .filter((item) => item.date === dayKey)
        .map((item) => {
          const range = getReservationRangeMinutes(item);
          return {
            ...item,
            blockStart: range.start,
            blockEnd: range.end
          };
        })
        .sort((a, b) => a.blockStart - b.blockStart);

      const draftIsThisDay = draft && draft.date === dayKey;
      const draftRange = draftIsThisDay ? draft.draftRange : null;
      const conflictIds = new Set();

      if (draftRange) {
        dayEvents.forEach((eventItem) => {
          const existingRange = { start: eventItem.blockStart, end: eventItem.blockEnd };
          if (eventItem.id !== draft.id && rangesOverlap(draftRange, existingRange)) {
            conflictIds.add(eventItem.id);
          }
        });
      }

      const eventsHtml = dayEvents.map((eventItem) => {
        const topPx = (eventItem.blockStart / MINUTES_PER_HOUR) * PIXELS_PER_HOUR;
        const heightPx = Math.max(22, ((eventItem.blockEnd - eventItem.blockStart) / MINUTES_PER_HOUR) * PIXELS_PER_HOUR);
        const editableAttr = eventItem.createdBy === currentUser.key
          ? ` data-reservation-edit-inline="${eventItem.id}"`
          : '';
        const conflictClass = conflictIds.has(eventItem.id) ? ' week-event-conflict' : '';

        return `
          <div class="week-event${eventItem.createdBy === currentUser.key ? ' week-event-own' : ''}${conflictClass}" style="top:${topPx}px;height:${heightPx}px;"${editableAttr}>
            <strong>${safeText(eventItem.title)}</strong>
            <span>${safeText(eventItem.startTime || formatMinutes(eventItem.blockStart))} - ${safeText(eventItem.endTime || formatMinutes(eventItem.blockEnd))}</span>
          </div>
        `;
      }).join('');

      const draftHtml = draftRange
        ? `<div class="week-event week-event-draft${conflictIds.size ? ' week-event-draft-conflict' : ''}" style="top:${(draftRange.start / MINUTES_PER_HOUR) * PIXELS_PER_HOUR}px;height:${Math.max(22, ((draftRange.end - draftRange.start) / MINUTES_PER_HOUR) * PIXELS_PER_HOUR)}px;"><strong>${safeText(draft.title)}</strong><span>${formatMinutes(draftRange.start)} - ${formatMinutes(draftRange.end)}</span></div>`
        : '';

      return `
        <div class="week-day-column${dayKey === todayKey ? ' week-day-column-today' : ''}" data-calendar-date="${dayKey}" data-week-date="${dayKey}">
          ${eventsHtml}
          ${draftHtml}
        </div>
      `;
    }).join('');

    instrumentCalendar.innerHTML = `
      <div class="week-header-grid">
        <div class="week-corner"></div>
        ${days.map((day, index) => {
    const key = dayKeys[index];
    const isToday = key === todayKey ? ' week-day-heading-today' : '';
    return `<button type="button" class="week-day-heading${isToday}" data-calendar-date="${key}">${day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</button>`;
  }).join('')}
      </div>
      <div class="week-body-grid">
        <div class="week-time-column">${timeRows.join('')}</div>
        <div class="week-days-columns">${dayColumns}</div>
      </div>
    `;
  }

  function renderCalendar() {
    const instrument = getSelectedInstrument();
    if (!instrument) {
      instrumentCalendar.innerHTML = '';
      return;
    }

    endWeekDrag(false);

    calendarMonthViewBtn.classList.toggle('calendar-view-active', calendarView === 'month');
    calendarWeekViewBtn.classList.toggle('calendar-view-active', calendarView === 'week');

    const reservations = [...normalizeInstrument(instrument).reservations];
    if (calendarView === 'week') {
      renderWeekCalendar(reservations);
      return;
    }

    renderMonthCalendar(reservations);
  }

  function renderReservationList() {
    const instrument = getSelectedInstrument();
    if (!instrument) {
      reservationList.innerHTML = '';
      return;
    }

    const currentUser = getCurrentUser();
    const reservations = [...normalizeInstrument(instrument).reservations].sort((a, b) => {
      const first = `${a.date || ''}-${a.startTime || ''}-${a.title || ''}`;
      const second = `${b.date || ''}-${b.startTime || ''}-${b.title || ''}`;
      return first.localeCompare(second);
    });

    if (!reservations.length) {
      reservationList.innerHTML = '<p class="small-note">No reservations yet.</p>';
      return;
    }

    reservationList.innerHTML = reservations.map((reservation) => {
      const isOwner = reservation.createdBy === currentUser.key;
      const timeText = reservation.startTime || reservation.endTime
        ? `${reservation.startTime || '--:--'} - ${reservation.endTime || '--:--'}`
        : 'All day';
      return `
        <article class="card">
          <h3>${safeText(reservation.title)}</h3>
          <p><strong>Date:</strong> ${safeText(reservation.date)}</p>
          <p><strong>Time:</strong> ${safeText(timeText)}</p>
          <p><strong>Created by:</strong> ${safeText(reservation.createdByLabel || 'Unknown User')}</p>
          <p><strong>Notes:</strong> ${safeText(reservation.notes || '-')}</p>
          <div class="card-actions">
            ${isOwner
    ? `<button class="ghost-btn" data-reservation-edit="${reservation.id}">Edit</button><button class="danger-btn" data-reservation-delete="${reservation.id}">Delete</button>`
    : '<span class="small-note">Only creator can modify this reservation.</span>'}
          </div>
        </article>
      `;
    }).join('');
  }

  function renderDetail() {
    const instrument = getSelectedInstrument();
    if (!instrument) {
      instrumentDetailPanel.hidden = true;
      return;
    }

    instrumentDetailPanel.hidden = false;
    instrumentDetailTitle.textContent = instrument.name || 'Instrument';
    instrumentDetailSubtitle.textContent = instrument.nickname
      ? `Nickname: ${instrument.nickname}`
      : 'No nickname';

    renderCalendar();
    renderReservationList();
  }

  function render() {
    ensureStateShape();
    renderInstrumentList();
    renderDetail();
  }

  return { render };
}
