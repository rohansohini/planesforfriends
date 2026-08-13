/* Week calendar shared by the renter pages and the admin console.
   Booked time is drawn as one solid labelled block per reservation rather than
   a stripe pattern, so it is obvious at a glance what is taken and what is free.
   Renters only ever receive anonymous busy windows; the admin passes real
   reservations in and gets click-to-edit. */

const CAL_VIEW_HOUR = 7;

function createWeekCalendar(options) {
  const {
    mount,
    openHour = 5,
    closeHour = 24,
    slotMinutes = 30,
    slotHeight = 34,
    allowPast = false,
    selectable = true,
    loadEvents = async () => [],
    onSelectionChange = () => {},
    onNotice = () => {},
    onEmptyClick = null,
    legendItems = [
      { tone: 'free', label: 'Open — tap to pick' },
      { tone: 'busy', label: 'Already booked' },
      { tone: 'past', label: 'Past' },
      { tone: 'selected', label: 'Your time' },
    ],
  } = options;

  const slotsPerDay = Math.max(1, Math.round(((closeHour - openHour) * 60) / slotMinutes));
  const slotsPerHour = Math.max(1, Math.round(60 / slotMinutes));
  const dayHeight = slotsPerDay * slotHeight;
  const openMinutes = openHour * 60;
  const closeMinutes = closeHour * 60;

  const state = {
    anchor: Date.now(),
    dayCount: 7,
    events: [],
    selection: null,
    loading: false,
    requestId: 0,
    offscreen: 0,
  };

  /* Narrow screens get one day at a time — nobody should have to scroll a phone
     sideways to find Thursday. */
  function daysForWidth() {
    const width = mount.clientWidth || window.innerWidth;
    if (width < 620) return 1;
    if (width < 900) return 3;
    return 7;
  }

  function viewStart() {
    return state.dayCount === 7 ? startOfWeek(state.anchor) : startOfDay(state.anchor);
  }

  function viewEnd() {
    return addDays(viewStart(), state.dayCount);
  }

  /* ---------- chrome ---------- */

  const rangeLabel = el('div', { class: 'cal-range' });
  const prevBtn = el(
    'button',
    { class: 'secondary', type: 'button', 'aria-label': 'Show earlier days', onclick: () => shiftView(-1) },
    '‹ Earlier'
  );
  const todayBtn = el('button', { class: 'secondary', type: 'button', onclick: () => setWeek(Date.now()) }, 'Today');
  const nextBtn = el(
    'button',
    { class: 'secondary', type: 'button', 'aria-label': 'Show later days', onclick: () => shiftView(1) },
    'Later ›'
  );

  const headRow = el('div', { class: 'cal-headrow' });
  const bodyGrid = el('div', { class: 'cal-body' });
  const inner = el('div', { class: 'cal-inner' }, headRow, bodyGrid);
  const scroller = el('div', { class: 'cal-scroll' }, inner);
  const footNote = el('p', { class: 'cal-note hidden' });
  const legend = el(
    'div',
    { class: 'cal-legend' },
    ...legendItems.map((item) => el('span', {}, el('i', { class: `swatch swatch-${item.tone}` }), item.label))
  );

  mount.append(
    el('div', { class: 'cal-toolbar' }, rangeLabel, el('div', { class: 'cal-nav' }, prevBtn, todayBtn, nextBtn)),
    scroller,
    legend,
    footNote
  );

  /* ---------- geometry (wall-clock based, so DST days stay aligned) ---------- */

  function dayBounds(dayStart) {
    const from = new Date(dayStart);
    from.setHours(0, openMinutes, 0, 0);
    const to = new Date(dayStart);
    to.setHours(0, closeMinutes, 0, 0);
    return { from: from.getTime(), to: to.getTime() };
  }

  function slotStartAt(dayStart, index) {
    const d = new Date(dayStart);
    d.setHours(0, openMinutes + index * slotMinutes, 0, 0);
    return d.getTime();
  }

  /** Pixel offset of a timestamp within a day column, clamped to the visible hours. */
  function offsetFor(ts, dayStart, bounds) {
    if (ts <= bounds.from) return 0;
    if (ts >= bounds.to) return dayHeight;
    const d = new Date(ts);
    const minutes = d.getHours() * 60 + d.getMinutes() - openMinutes;
    return (minutes / slotMinutes) * slotHeight;
  }

  function blockingEvents() {
    return state.events.filter((e) => e.blocks !== false);
  }

  function overlapsBusy(start, end) {
    return blockingEvents().some((e) => e.start < end && e.end > start);
  }

  function isSelected(start, end) {
    return state.selection && start >= state.selection.start && end <= state.selection.end;
  }

  /* ---------- selection ---------- */

  function handleSlotClick(start, end) {
    if (!selectable) {
      if (onEmptyClick) onEmptyClick(start, end);
      return;
    }
    const sel = state.selection;
    if (sel && sel.start === start && sel.end === end) return setSelection(null);
    if (!sel || start < sel.start) return setSelection({ start, end });
    if (overlapsBusy(sel.start, end)) {
      onNotice('That would run into time somebody else has booked. Pick a shorter window, or start somewhere else.');
      return setSelection({ start, end });
    }
    setSelection({ start: sel.start, end });
  }

  /** Overlapping blocks share the width of the day column, side by side. */
  function assignColumns(items) {
    items.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let cluster = [];
    let clusterEnd = -Infinity;

    const close = () => {
      if (!cluster.length) return;
      const columnEnds = [];
      for (const item of cluster) {
        let column = columnEnds.findIndex((end) => end <= item.top);
        if (column === -1) {
          column = columnEnds.length;
          columnEnds.push(item.bottom);
        } else {
          columnEnds[column] = item.bottom;
        }
        item.column = column;
      }
      for (const item of cluster) item.columns = columnEnds.length;
      cluster = [];
      clusterEnd = -Infinity;
    };

    for (const item of items) {
      if (item.top >= clusterEnd) close();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.bottom);
    }
    close();
  }

  /* ---------- rendering ---------- */

  function render() {
    const now = Date.now();
    const start = viewStart();
    const columns = `74px repeat(${state.dayCount}, minmax(${state.dayCount === 1 ? 120 : 96}px, 1fr))`;
    headRow.style.gridTemplateColumns = columns;
    bodyGrid.style.gridTemplateColumns = columns;
    inner.style.minWidth = state.dayCount > 3 ? '760px' : 'auto';

    rangeLabel.textContent =
      state.dayCount === 1
        ? fmtDateLong.format(new Date(start))
        : `${fmtDate.format(new Date(start))} – ${fmtDate.format(new Date(addDays(start, state.dayCount - 1)))}`;
    todayBtn.textContent = state.dayCount === 7 ? 'This week' : 'Today';
    prevBtn.disabled = !allowPast && addDays(start, -1) < startOfDay(now);

    // header
    headRow.replaceChildren(el('div', { class: 'cal-corner' }));
    for (let d = 0; d < state.dayCount; d += 1) {
      const dayStart = addDays(start, d);
      const date = new Date(dayStart);
      const today = isSameDay(dayStart, now);
      headRow.append(
        el(
          'div',
          { class: `cal-dayhead${today ? ' today' : ''}` },
          el('span', { class: 'dow' }, date.toLocaleDateString(undefined, { weekday: 'short' })),
          el('span', { class: 'dom' }, date.getDate()),
          today ? el('span', { class: 'tag' }, 'Today') : null
        )
      );
    }

    // hour gutter
    const gutter = el('div', { class: 'cal-gutter' });
    for (let hour = openHour; hour < closeHour; hour += 1) {
      const label = new Date(2000, 0, 1, hour % 24).toLocaleTimeString(undefined, { hour: 'numeric' });
      gutter.append(el('div', { class: 'cal-hour', style: `height:${slotHeight * slotsPerHour}px` }, label));
    }
    bodyGrid.replaceChildren(gutter);

    state.offscreen = 0;

    for (let d = 0; d < state.dayCount; d += 1) {
      const dayStart = addDays(start, d);
      const bounds = dayBounds(dayStart);
      const column = el('div', { class: 'cal-day', style: `height:${dayHeight}px` });

      // clickable empty slots
      for (let i = 0; i < slotsPerDay; i += 1) {
        const start = slotStartAt(dayStart, i);
        const end = start + slotMinutes * MINUTE;
        const past = !allowPast && end <= now;
        const busy = overlapsBusy(start, end);
        const classes = ['cal-slot'];
        if ((i + 1) % slotsPerHour === 0) classes.push('hour-end');
        if (past) classes.push('past');
        column.append(
          el('button', {
            type: 'button',
            class: classes.join(' '),
            style: `height:${slotHeight}px`,
            disabled: past || state.loading || (busy && selectable) || (!selectable && !onEmptyClick) || undefined,
            'aria-label': `${fmtDate.format(new Date(start))} ${fmtTime.format(new Date(start))}${busy ? ', booked' : ''}`,
            title: past ? 'In the past' : `${fmtTime.format(new Date(start))} – ${fmtTime.format(new Date(end))}`,
            onclick: () => handleSlotClick(start, end),
          })
        );
      }

      // events for this day, laid out side by side where they overlap
      const placed = [];
      for (const event of state.events) {
        if (event.end <= bounds.from || event.start >= bounds.to) {
          if (event.start >= startOfDay(dayStart) && event.start < addDays(dayStart, 1)) state.offscreen += 1;
          continue;
        }
        const top = offsetFor(event.start, dayStart, bounds);
        const bottom = Math.max(top + slotHeight, offsetFor(event.end, dayStart, bounds));
        placed.push({ event, top, bottom });
      }
      assignColumns(placed);

      for (const item of placed) {
        const height = item.bottom - item.top - 2;
        const short = height < slotHeight * 1.6 || item.columns > 1;
        const width = 100 / item.columns;
        const block = el(
          item.event.onClick ? 'button' : 'div',
          {
            type: item.event.onClick ? 'button' : undefined,
            class: `cal-event tone-${item.event.tone || 'busy'}${short ? ' short' : ''}`,
            style:
              `top:${item.top + 1}px;height:${height}px;` +
              `left:calc(${item.column * width}% + 3px);width:calc(${width}% - 6px)`,
            title: item.event.title + (item.event.subtitle ? ` · ${item.event.subtitle}` : ''),
            onclick: item.event.onClick || undefined,
          },
          el('span', { class: 'cal-event-time' }, `${fmtTime.format(new Date(item.event.start))}`),
          el('span', { class: 'cal-event-title' }, item.event.title),
          !short && item.event.subtitle ? el('span', { class: 'cal-event-sub' }, item.event.subtitle) : null
        );
        column.append(block);
      }

      // past shading + "now" line
      if (!allowPast || isSameDay(dayStart, now)) {
        if (now >= bounds.to) {
          column.append(el('div', { class: 'cal-pastfill', style: `top:0;height:${dayHeight}px` }));
        } else if (now > bounds.from) {
          const cut = offsetFor(now, dayStart, bounds);
          column.append(el('div', { class: 'cal-pastfill', style: `top:0;height:${cut}px` }));
          column.append(el('div', { class: 'cal-now', style: `top:${cut}px` }));
        }
      }

      // selection
      if (state.selection) {
        const sel = state.selection;
        if (sel.end > bounds.from && sel.start < bounds.to) {
          const top = offsetFor(sel.start, dayStart, bounds);
          const bottom = offsetFor(sel.end, dayStart, bounds);
          column.append(
            el(
              'div',
              { class: 'cal-event tone-selected', style: `top:${top + 1}px;height:${Math.max(slotHeight - 2, bottom - top - 2)}px` },
              el('span', { class: 'cal-event-time' }, fmtTime.format(new Date(sel.start))),
              el('span', { class: 'cal-event-title' }, 'Your time')
            )
          );
        }
      }

      bodyGrid.append(column);
    }

    if (state.offscreen > 0) {
      footNote.classList.remove('hidden');
      footNote.textContent = `${state.offscreen} booking${state.offscreen === 1 ? '' : 's'} this week fall outside the hours shown. Widen the calendar hours in Settings to see them here.`;
    } else {
      footNote.classList.add('hidden');
    }
  }

  function scrollToHour(hour) {
    const target = Math.min(Math.max(hour, openHour), closeHour - 1);
    scroller.scrollTop = Math.max(0, (target - openHour) * slotsPerHour * slotHeight);
  }

  /* ---------- data ---------- */

  async function refresh({ keepScroll = false } = {}) {
    state.dayCount = daysForWidth();
    const from = viewStart();
    const to = viewEnd();
    const requestId = (state.requestId += 1);
    const previousScroll = scroller.scrollTop;
    state.loading = true;
    render();
    try {
      const events = await loadEvents(from, to);
      if (requestId !== state.requestId) return;
      state.events = Array.isArray(events) ? events : [];
    } catch (err) {
      if (requestId !== state.requestId) return;
      state.events = [];
      onNotice(err.message || 'Could not load the calendar.');
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        render();
        if (keepScroll) scroller.scrollTop = previousScroll;
        else scrollToHour(state.selection ? new Date(state.selection.start).getHours() - 1 : CAL_VIEW_HOUR);
      }
    }
  }

  function setWeek(ts, opts) {
    state.anchor = ts;
    return refresh(opts);
  }

  function shiftView(direction) {
    setWeek(addDays(viewStart(), direction * state.dayCount), { keepScroll: true });
  }

  function setSelection(selection, { silent = false } = {}) {
    state.selection = selection;
    render();
    if (!silent) onSelectionChange(selection);
  }

  // Re-lay out when the window is resized across one of the breakpoints.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (daysForWidth() === state.dayCount) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => refresh({ keepScroll: true }), 150);
  });

  state.dayCount = daysForWidth();
  render();

  return {
    refresh,
    setWeek,
    setSelection,
    clearSelection: () => setSelection(null, { silent: true }),
    getSelection: () => state.selection,
    overlapsBusy,
    scrollToHour,
  };
}
