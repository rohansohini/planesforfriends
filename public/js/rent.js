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
        ? `Call ${data.owner.name} at ${data.owner.phone} about pricing. Book your time below.`
        : `Contact ${data.owner.name} about pricing. Book your time below.`;

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
            class: 'picker-option',
            'aria-pressed': 'false',
            dataset: { planeId: String(plane.id) },
            onclick: () => selectPlane(plane.id),
          },
          el('div', { class: 'picker-title tail' }, plane.tailNumber),
          el('div', { class: 'picker-meta' }, [plane.nickname, plane.model].filter(Boolean).join(' · ') || 'Aircraft')
        )
      );
    }
  }

  function selectPlane(planeId) {
    state.planeId = planeId;
    $$('#plane-picker .picker-option').forEach((btn) => {
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
      loadEvents: async (from, to) => {
        if (!state.planeId) return [];
        const data = await api(`/api/availability?planeId=${state.planeId}&from=${from}&to=${to}`);
        // Anonymous on purpose: the server never tells us who booked it.
        return data.busy.map((window) => ({
          start: window.start,
          end: window.end,
          title: 'Booked',
          tone: 'busy',
          blocks: true,
        }));
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
    const detail = $('#selection-detail');
    if (!state.selection) {
      summary.className = 'muted';
      summary.style.margin = '0';
      summary.textContent = 'Nothing picked yet — tap a start time on the calendar above.';
      detail.classList.add('hidden');
      startInput.value = '';
      endInput.value = '';
      return;
    }
    const { start, end } = state.selection;
    summary.className = '';
    summary.replaceChildren(
      el('strong', { style: 'font-size:1.15rem' }, formatRange(start, end)),
      el('span', {}, ` — ${durationLabel(start, end)}`)
    );
    detail.classList.remove('hidden');
    startInput.value = toLocalInput(start);
    endInput.value = toLocalInput(end);
  }

  function onManualTimeChange() {
    const start = fromLocalInput(startInput.value);
    const end = fromLocalInput(endInput.value);
    if (start == null || end == null) return;
    if (end <= start) {
      showMessage(formMsg, 'The finish time has to be after the start time.');
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

    if (!state.planeId) return showMessage(formMsg, 'Please choose a plane in step 1.');
    if (!state.selection) return showMessage(formMsg, 'Please pick a time on the calendar in step 2.');

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
      $('#form-msg').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      ['Your name', reservation.renterName],
      ['Contact', `${reservation.renterPhone} · ${reservation.renterEmail}`],
    ];
    for (const [label, value] of rows) {
      details.append(el('div', { class: 'detail-row' }, el('dt', {}, label), el('dd', {}, value)));
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
