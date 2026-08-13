/* Renter-facing booking flow for /rent/<owner>. */

(function () {
  const slug = window.location.pathname.split('/').filter(Boolean)[1] || '';

  const state = {
    owner: null,
    planes: [],
    planeId: null,
    config: null,
    selection: null,
    calendar: null,
    submitting: false,
  };

  const msg = $('#msg');
  const formMsg = $('#form-msg');
  const startInput = $('#start-input');
  const endInput = $('#end-input');

  init();

  async function init() {
    try {
      const [config, data] = await Promise.all([api('/api/config'), api(`/api/owners/${encodeURIComponent(slug)}`)]);
      state.config = config;
      state.owner = data.owner;
      state.planes = data.planes;

      if (config.siteTitle) $('#site-title').textContent = config.siteTitle;
      document.title = `Rent from ${data.owner.name} · ${config.siteTitle || 'Planes for Friends'}`;
      $('#owner-heading').textContent = `Rent from ${data.owner.name}`;
      $('#owner-sub').textContent = data.owner.phone
        ? `Questions or pricing: ${data.owner.name} at ${data.owner.phone}`
        : `Reach out to ${data.owner.name} for pricing.`;

      renderPlanePicker();
      setupCalendar();
      wireForm();

      if (state.planes.length) selectPlane(state.planes[0].id);
    } catch (err) {
      showMessage(msg, err.status === 404 ? 'We could not find that page. Check the link and try again.' : err.message);
      $('#booking').classList.add('hidden');
    }
  }

  /* ---------- plane picker (always shown, even for a single plane) ---------- */

  function renderPlanePicker() {
    const picker = $('#plane-picker');
    picker.replaceChildren();
    $('#plane-count').textContent = `${state.planes.length} plane${state.planes.length === 1 ? '' : 's'}`;

    if (!state.planes.length) {
      picker.append(el('p', { class: 'muted' }, `${state.owner.name} has not listed a plane yet.`));
      return;
    }

    for (const plane of state.planes) {
      picker.append(
        el(
          'button',
          {
            type: 'button',
            class: 'plane-option',
            'aria-pressed': 'false',
            dataset: { planeId: String(plane.id) },
            onclick: () => selectPlane(plane.id),
          },
          el('div', { class: 'tail' }, plane.tailNumber),
          el('div', { class: 'meta' }, [plane.nickname, plane.model].filter(Boolean).join(' · ') || 'Aircraft')
        )
      );
    }
  }

  function selectPlane(planeId) {
    state.planeId = planeId;
    $$('#plane-picker .plane-option').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.planeId) === planeId));
    });
    const plane = state.planes.find((p) => p.id === planeId);
    $('#plane-notes').textContent = plane && plane.notes ? plane.notes : '';
    setSelection(null);
    state.calendar.refresh();
  }

  /* ---------- calendar ---------- */

  function setupCalendar() {
    state.calendar = createWeekCalendar({
      mount: $('#calendar'),
      openHour: state.config.openHour,
      closeHour: state.config.closeHour,
      slotMinutes: 30,
      onNotice: (text) => showMessage(formMsg, text, 'info'),
      onSelectionChange: (selection) => {
        state.selection = selection;
        syncSelectionUi();
        showMessage(formMsg, '');
      },
      loadBusy: async (from, to) => {
        if (!state.planeId) return [];
        const data = await api(`/api/availability?planeId=${state.planeId}&from=${from}&to=${to}`);
        return data.busy;
      },
    });
  }

  function setSelection(selection) {
    state.selection = selection;
    state.calendar.setSelection(selection, { silent: true });
    syncSelectionUi();
  }

  function syncSelectionUi() {
    const summary = $('#selection-summary');
    if (!state.selection) {
      summary.className = 'muted';
      summary.textContent = 'Tap a start time, then tap an end time on the calendar.';
      startInput.value = '';
      endInput.value = '';
      return;
    }
    const { start, end } = state.selection;
    summary.className = '';
    summary.innerHTML = '';
    summary.append(
      el('strong', {}, formatRange(start, end)),
      el('span', { class: 'muted' }, ` · ${durationLabel(start, end)}`)
    );
    startInput.value = toLocalInput(start);
    endInput.value = toLocalInput(end);
  }

  function onManualTimeChange() {
    const start = fromLocalInput(startInput.value);
    const end = fromLocalInput(endInput.value);
    if (start == null || end == null) return;
    if (end <= start) {
      showMessage(formMsg, 'The end time has to be after the start time.');
      return;
    }
    if (state.calendar.overlapsBusy(start, end)) {
      showMessage(formMsg, 'That window overlaps time that is already booked on this plane.');
      return;
    }
    showMessage(formMsg, '');
    state.selection = { start, end };
    state.calendar.setWeek(start);
    state.calendar.setSelection(state.selection, { silent: true });
    syncSelectionUi();
  }

  /* ---------- booking ---------- */

  function wireForm() {
    startInput.addEventListener('change', onManualTimeChange);
    endInput.addEventListener('change', onManualTimeChange);
    $('#clear-selection').addEventListener('click', () => setSelection(null));
    $('#book-form').addEventListener('submit', submitBooking);
    $('#book-another').addEventListener('click', () => {
      $('#confirmation').classList.add('hidden');
      $('#booking').classList.remove('hidden');
      $('#book-form').reset();
      setSelection(null);
      state.calendar.refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#print-conf').addEventListener('click', () => window.print());
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (state.submitting) return;
    showMessage(formMsg, '');

    if (!state.planeId) return showMessage(formMsg, 'Pick a plane first.');
    if (!state.selection) return showMessage(formMsg, 'Pick a time on the calendar.');

    const payload = {
      planeId: state.planeId,
      start: state.selection.start,
      end: state.selection.end,
      renterName: $('#renter-name').value.trim(),
      renterPhone: $('#renter-phone').value.trim(),
      renterEmail: $('#renter-email').value.trim(),
      notes: $('#renter-notes').value.trim(),
    };

    state.submitting = true;
    const button = $('#submit-btn');
    button.disabled = true;
    button.textContent = 'Reserving…';

    try {
      const reservation = await api('/api/reservations', { method: 'POST', body: payload });
      showConfirmation(reservation);
    } catch (err) {
      showMessage(formMsg, err.message);
      if (err.status === 409) {
        setSelection(null);
        state.calendar.refresh();
      }
    } finally {
      state.submitting = false;
      button.disabled = false;
      button.textContent = 'Reserve this plane';
    }
  }

  function showConfirmation(reservation) {
    $('#conf-code').textContent = reservation.confirmationId;

    const details = $('#conf-details');
    details.replaceChildren();
    const rows = [
      ['Plane', `${reservation.planeTail}${reservation.planeModel ? ` · ${reservation.planeModel}` : ''}`],
      ['Owner', reservation.ownerName],
      ['When', formatRange(reservation.start, reservation.end)],
      ['How long', durationLabel(reservation.start, reservation.end)],
      ['Renter', reservation.renterName],
      ['Contact', `${reservation.renterPhone} · ${reservation.renterEmail}`],
    ];
    for (const [label, value] of rows) {
      details.append(
        el(
          'div',
          { class: 'row', style: 'gap:0.5rem;align-items:baseline;border-bottom:1px solid var(--line);padding:0.4rem 0' },
          el('dt', { style: 'flex:0 0 110px;color:var(--ink-soft);font-size:0.82rem;font-weight:600' }, label),
          el('dd', { style: 'margin:0;flex:1 1 200px' }, value)
        )
      );
    }

    const list = $('#conf-instructions');
    list.replaceChildren();
    for (const line of reservation.instructions) list.append(el('li', {}, line));

    $('#conf-lookup-link').href = `/lookup?id=${encodeURIComponent(reservation.confirmationId)}`;

    $('#booking').classList.add('hidden');
    $('#confirmation').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
