/* Week-view availability calendar.
   Booked time is hard-blocked: those slots are disabled and greyed out, and a
   selection is refused if it would run through one. No renter details ever
   reach this component — the server only sends anonymous busy windows. */

function createWeekCalendar(options) {
  const {
    mount,
    openHour = 6,
    closeHour = 21,
    slotMinutes = 30,
    allowPast = false,
    onSelectionChange = () => {},
    onNotice = () => {},
    loadBusy = async () => [],
  } = options;

  const slotsPerDay = Math.max(1, Math.round(((closeHour - openHour) * 60) / slotMinutes));
  const state = {
    weekStart: startOfWeek(Date.now()),
    busy: [],
    selection: null,
    loading: false,
    enabled: true,
    requestId: 0,
  };

  const rangeLabel = el('span', { class: 'cal-range' });
  const prevBtn = el('button', { class: 'secondary small', type: 'button', onclick: () => shiftWeek(-7) }, '‹ Prev');
  const nextBtn = el('button', { class: 'secondary small', type: 'button', onclick: () => shiftWeek(7) }, 'Next ›');
  const todayBtn = el(
    'button',
    { class: 'secondary small', type: 'button', onclick: () => setWeek(Date.now()) },
    'Today'
  );
  const toolbar = el(
    'div',
    { class: 'cal-toolbar' },
    rangeLabel,
    el('div', { class: 'cal-nav' }, prevBtn, todayBtn, nextBtn)
  );

  const grid = el('div', { class: 'cal-grid' });
  const scroller = el('div', { class: 'cal-scroll' }, grid);
  const legend = el(
    'div',
    { class: 'cal-legend' },
    el('span', {}, el('i', { class: 'swatch free' }), 'Available'),
    el('span', {}, el('i', { class: 'swatch busy' }), 'Already booked'),
    el('span', {}, el('i', { class: 'swatch sel' }), 'Your selection')
  );

  mount.append(toolbar, scroller, legend);

  function slotStartAt(dayStart, index) {
    const d = new Date(dayStart);
    d.setHours(0, openHour * 60 + index * slotMinutes, 0, 0);
    return d.getTime();
  }

  function overlapsBusy(start, end) {
    return state.busy.some((b) => b.start < end && b.end > start);
  }

  function isSelected(start, end) {
    return state.selection && start >= state.selection.start && end <= state.selection.end;
  }

  function handleSlotClick(start, end) {
    if (!state.enabled) return;
    const sel = state.selection;
    if (sel && sel.start === start && sel.end === end) {
      setSelection(null);
      return;
    }
    if (!sel || start < sel.start) {
      setSelection({ start, end });
      return;
    }
    if (overlapsBusy(sel.start, end)) {
      onNotice('That stretch runs into time that is already booked. Pick a shorter window or a new start time.');
      setSelection({ start, end });
      return;
    }
    setSelection({ start: sel.start, end });
  }

  function render() {
    grid.replaceChildren();
    const now = Date.now();
    const weekEnd = addDays(state.weekStart, 6);
    rangeLabel.textContent = `${fmtDate.format(new Date(state.weekStart))} – ${fmtDate.format(new Date(weekEnd))}`;

    grid.append(el('div', { class: 'cal-head' }));
    for (let d = 0; d < 7; d += 1) {
      const dayStart = addDays(state.weekStart, d);
      const date = new Date(dayStart);
      grid.append(
        el(
          'div',
          { class: `cal-head${isSameDay(dayStart, now) ? ' today' : ''}` },
          el('div', { class: 'dow' }, date.toLocaleDateString(undefined, { weekday: 'short' })),
          el('div', { class: 'dom' }, date.getDate())
        )
      );
    }

    for (let i = 0; i < slotsPerDay; i += 1) {
      const minutesIn = i * slotMinutes;
      const onHour = minutesIn % 60 === 0;
      const labelDate = new Date(slotStartAt(state.weekStart, i));
      grid.append(
        el('div', { class: 'cal-time' }, onHour ? labelDate.toLocaleTimeString(undefined, { hour: 'numeric' }) : '')
      );

      for (let d = 0; d < 7; d += 1) {
        const dayStart = addDays(state.weekStart, d);
        const start = slotStartAt(dayStart, i);
        const end = start + slotMinutes * MINUTE;
        const busy = overlapsBusy(start, end);
        const past = !allowPast && end <= now;
        const classes = ['cal-slot'];
        if (onHour) classes.push('hour-start');
        if (busy) classes.push('busy');
        else if (past) classes.push('past');
        if (isSelected(start, end)) classes.push('selected');

        const disabled = busy || past || state.loading || !state.enabled;
        const title = busy
          ? 'Already booked'
          : past
            ? 'In the past'
            : `${fmtDate.format(new Date(start))} ${fmtTime.format(new Date(start))}`;

        grid.append(
          el('button', {
            type: 'button',
            class: classes.join(' '),
            title,
            'aria-label': busy ? `${title}, unavailable` : title,
            disabled: disabled || undefined,
            onclick: () => handleSlotClick(start, end),
          })
        );
      }
    }
  }

  async function refresh() {
    const from = state.weekStart;
    const to = addDays(state.weekStart, 7);
    const requestId = (state.requestId += 1);
    state.loading = true;
    render();
    try {
      const busy = await loadBusy(from, to);
      if (requestId !== state.requestId) return;
      state.busy = Array.isArray(busy) ? busy : [];
    } catch (err) {
      if (requestId !== state.requestId) return;
      state.busy = [];
      onNotice(err.message || 'Could not load the calendar.');
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        render();
      }
    }
  }

  function setWeek(ts) {
    state.weekStart = startOfWeek(ts);
    refresh();
  }

  function shiftWeek(days) {
    setWeek(addDays(state.weekStart, days));
  }

  function setSelection(selection, { silent = false } = {}) {
    state.selection = selection;
    render();
    if (!silent) onSelectionChange(selection);
  }

  function setEnabled(enabled) {
    state.enabled = enabled;
    render();
  }

  render();

  return {
    refresh,
    setWeek,
    setSelection,
    setEnabled,
    getSelection: () => state.selection,
    getBusy: () => state.busy.slice(),
    overlapsBusy,
    clearSelection: () => setSelection(null, { silent: true }),
  };
}
