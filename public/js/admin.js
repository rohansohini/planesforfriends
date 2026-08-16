/* Admin console: schedule, planes, owners, settings. */

(function () {
  const state = {
    owners: [],
    planes: [],
    settings: null,
    reservations: [],
    calendar: null,
    filters: { planeId: '', from: null, to: null, paid: '' },
  };

  const msg = $('#msg');

  boot();

  async function boot() {
    const { authed } = await api('/api/admin/session');
    if (authed) return showConsole();
    $('#login').classList.remove('hidden');
    $('#password').focus();
  }

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage($('#login-msg'), '');
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('#password').value } });
      $('#login').classList.add('hidden');
      await showConsole();
    } catch (err) {
      showMessage($('#login-msg'), err.message);
    }
  });

  $('#logout-link').addEventListener('click', async (event) => {
    event.preventDefault();
    await api('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  });

  async function showConsole() {
    $('#console').classList.remove('hidden');
    $('#logout-link').classList.remove('hidden');
    const today = startOfDay(Date.now());
    $('#filter-from').value = toDateInput(addDays(today, -7));
    $('#filter-to').value = toDateInput(addDays(today, 60));
    readFilters();
    await reloadAll();
  }

  async function reloadAll() {
    const data = await api('/api/admin/bootstrap');
    state.owners = data.owners;
    state.planes = data.planes;
    state.settings = data.settings;
    renderPlaneSelects();
    renderPlanes();
    renderOwners();
    fillSettings();
    $('#summary-line').textContent =
      `${state.owners.length} owner${state.owners.length === 1 ? '' : 's'} · ` +
      `${state.planes.length} plane${state.planes.length === 1 ? '' : 's'}`;
    const firstLoad = !state.calendar;
    setupCalendar();
    await Promise.all([loadReservations(), state.calendar.refresh({ keepScroll: !firstLoad })]);
  }

  /* ---------- tabs ---------- */

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
      if (tab.dataset.tab === 'calendar' && state.calendar) state.calendar.refresh({ keepScroll: true });
    });
  });

  /* ---------- calendar view ---------- */

  function setupCalendar() {
    if (state.calendar) return;
    state.calendar = createWeekCalendar({
      mount: $('#admin-calendar'),
      openHour: state.settings.openHour,
      closeHour: state.settings.closeHour,
      slotMinutes: 30,
      allowPast: true,
      selectable: false,
      legendItems: [
        { tone: 'rental', label: 'Rental' },
        { tone: 'paid', label: 'Rental — paid' },
        { tone: 'block', label: 'Blocked off' },
        { tone: 'cancelled', label: 'Cancelled' },
      ],
      onNotice: (text) => showMessage(msg, text),
      onEmptyClick: (start, end) => {
        const planeId = Number($('#cal-plane').value) || null;
        openReservationModal(null, 'rental', { start, end, planeId, onSaved: refreshCalendar });
      },
      loadEvents: async (from, to) => {
        const planeId = $('#cal-plane').value;
        const params = new URLSearchParams({ from: String(from), to: String(to) });
        if (planeId) params.set('planeId', planeId);
        const reservations = await api(`/api/admin/reservations?${params}`);
        return reservations.map((r) => ({
          start: r.start,
          end: r.end,
          title: r.kind === 'block' ? 'Blocked off' : r.renterName || 'Reservation',
          subtitle: [r.planeTail, r.paid ? 'paid' : null, r.hobbsTime != null ? `hobbs ${r.hobbsTime}` : null]
            .filter(Boolean)
            .join(' · '),
          tone:
            r.status !== 'confirmed'
              ? 'cancelled'
              : r.kind === 'block'
                ? 'block'
                : r.paid
                  ? 'paid'
                  : 'rental',
          blocks: r.status === 'confirmed',
          onClick: () => openReservationModal(r, r.kind, { onSaved: refreshCalendar }),
        }));
      },
    });
  }

  function refreshCalendar() {
    if (state.calendar) state.calendar.refresh({ keepScroll: true });
    loadReservations();
  }

  $('#cal-plane').addEventListener('change', () => refreshCalendar());
  $('#cal-add-btn').addEventListener('click', () => {
    const planeId = Number($('#cal-plane').value) || null;
    openReservationModal(null, 'rental', { planeId, onSaved: refreshCalendar });
  });
  $('#cal-block-btn').addEventListener('click', () => {
    const planeId = Number($('#cal-plane').value) || null;
    openReservationModal(null, 'block', { planeId, onSaved: refreshCalendar });
  });

  /* ---------- shared select builders ---------- */

  function planeLabel(plane) {
    const bits = [plane.tailNumber];
    if (plane.nickname) bits.push(plane.nickname);
    else if (plane.model) bits.push(plane.model);
    return `${bits.join(' · ')} (${plane.ownerName})`;
  }

  function planeOptions(select, { includeAll = false, selected = '', allLabel = 'All planes', placeholder = null } = {}) {
    select.replaceChildren();
    if (includeAll) select.append(el('option', { value: '' }, allLabel));
    else if (placeholder) select.append(el('option', { value: '' }, placeholder));
    const byOwner = new Map();
    for (const plane of state.planes) {
      if (!byOwner.has(plane.ownerName)) byOwner.set(plane.ownerName, []);
      byOwner.get(plane.ownerName).push(plane);
    }
    for (const [ownerName, planes] of byOwner) {
      const group = el('optgroup', { label: ownerName });
      for (const plane of planes) {
        group.append(
          el(
            'option',
            { value: String(plane.id), selected: String(plane.id) === String(selected) || undefined },
            `${plane.tailNumber}${plane.nickname ? ` · ${plane.nickname}` : plane.model ? ` · ${plane.model}` : ''}${plane.active ? '' : ' (unlisted)'}`
          )
        );
      }
      select.append(group);
    }
    if (includeAll && !selected) select.value = '';
    else if (selected) select.value = String(selected);
  }

  function renderPlaneSelects() {
    managerOptions($('#owner-manager'), { selected: $('#owner-manager').value });
    planeOptions($('#filter-plane'), { includeAll: true, selected: state.filters.planeId });
    planeOptions($('#cal-plane'), { includeAll: true, allLabel: 'All planes together', selected: $('#cal-plane').value });
    const ownerSelect = $('#plane-owner');
    const previous = ownerSelect.value;
    ownerSelect.replaceChildren(
      ...state.owners.map((o) => el('option', { value: String(o.id) }, o.name + (o.active ? '' : ' (hidden)')))
    );
    if (previous) ownerSelect.value = previous;
  }

  /* ---------- schedule ---------- */

  function readFilters() {
    state.filters.planeId = $('#filter-plane').value;
    state.filters.from = fromDateInput($('#filter-from').value);
    state.filters.to = fromDateInput($('#filter-to').value, true);
    state.filters.paid = $('#filter-paid').value;
  }

  function filterQuery() {
    const params = new URLSearchParams();
    if (state.filters.planeId) params.set('planeId', state.filters.planeId);
    if (state.filters.from != null) params.set('from', String(state.filters.from));
    if (state.filters.to != null) params.set('to', String(state.filters.to));
    if (state.filters.paid !== '') params.set('paid', state.filters.paid);
    return params;
  }

  async function loadReservations() {
    showMessage(msg, '');
    try {
      const params = filterQuery();
      state.reservations = await api(`/api/admin/reservations?${params}`);
      renderReservations();
      $('#export-link').href = `/api/admin/export.csv?${params}`;
      updateFilterHint();
    } catch (err) {
      showMessage(msg, err.message);
    }
  }

  function updateFilterHint() {
    const plane = state.planes.find((p) => String(p.id) === String(state.filters.planeId));
    const scope = plane ? `${plane.tailNumber} (${plane.ownerName})` : 'all planes';
    const rentals = state.reservations.filter((r) => r.kind === 'rental' && r.status === 'confirmed');
    const unpaid = rentals.filter((r) => !r.paid).length;
    const hours = rentals.reduce((sum, r) => sum + (r.hobbsTime || 0), 0);
    const collected = state.reservations.reduce((sum, r) => sum + (Number(r.paidAmount) || 0), 0);
    $('#filter-hint').textContent =
      `Showing ${state.reservations.length} record${state.reservations.length === 1 ? '' : 's'} for ${scope} · ` +
      `${unpaid} unpaid · ${hours.toFixed(1)} Hobbs hours logged · ${fmtMoney.format(collected)} recorded. ` +
      'The CSV download uses these same filters.';
  }

  $('#filter-paid').addEventListener('change', () => {
    readFilters();
    loadReservations();
  });
  $('#filter-apply').addEventListener('click', () => {
    readFilters();
    loadReservations();
  });
  $('#filter-plane').addEventListener('change', () => {
    readFilters();
    loadReservations();
  });
  $('#filter-reset').addEventListener('click', () => {
    const today = startOfDay(Date.now());
    $('#filter-plane').value = '';
    $('#filter-paid').value = '';
    $('#filter-from').value = toDateInput(addDays(today, -7));
    $('#filter-to').value = toDateInput(addDays(today, 60));
    readFilters();
    loadReservations();
  });

  function renderReservations() {
    const body = $('#res-body');
    body.replaceChildren();
    $('#res-empty').classList.toggle('hidden', state.reservations.length > 0);

    for (const r of state.reservations) {
      const cancelled = r.status !== 'confirmed';
      const isBlock = r.kind === 'block';
      body.append(
        el(
          'tr',
          { class: cancelled ? 'cancelled' : '' },
          el(
            'td',
            {},
            el('div', { class: 'mono tiny' }, r.confirmationId),
            cancelled ? el('div', { class: 'badge badge-bad' }, 'Cancelled') : null,
            el(
              'button',
              { class: 'secondary small', type: 'button', style: 'margin-top:0.3rem', onclick: () => openReservationModal(r) },
              'Edit'
            )
          ),
          el('td', {}, el('div', { class: 'mono' }, r.planeTail), el('div', { class: 'tiny muted' }, r.ownerName)),
          el(
            'td',
            { class: 'nowrap' },
            el('div', {}, fmtDate.format(new Date(r.start))),
            el(
              'div',
              { class: 'tiny muted' },
              `${fmtTime.format(new Date(r.start))} – ${fmtTime.format(new Date(r.end))} · ${durationLabel(r.start, r.end)}`
            )
          ),
          el(
            'td',
            {},
            isBlock ? el('span', { class: 'badge badge-warn' }, 'Blocked off') : el('div', {}, r.renterName || '—'),
            isBlock ? null : el('div', { class: 'tiny' }, r.renterPhone || ''),
            isBlock ? null : el('div', { class: 'tiny muted' }, r.renterEmail || ''),
            r.notes ? el('div', { class: 'tiny muted' }, `“${r.notes}”`) : null
          ),
          el('td', {}, hobbsCell(r)),
          el('td', { class: 'center' }, paidCell(r)),
          el('td', {}, amountCell(r)),
          el('td', {}, adminNotesCell(r))
        )
      );
    }
  }

  /* Saves one field of one reservation, rolling the control back if the
     server refuses. Used by the three in-place editors below. */
  async function patchField(reservation, patch, control, revert, successText) {
    control.disabled = true;
    try {
      const updated = await api(`/api/admin/reservations/${reservation.id}`, { method: 'PATCH', body: patch });
      Object.assign(reservation, updated);
      showMessage(msg, successText, 'ok');
      return updated;
    } catch (err) {
      revert();
      showMessage(msg, err.message);
      return null;
    } finally {
      control.disabled = false;
    }
  }

  /* Paid is a single click — the owners tick it off as money comes in. */
  function paidCell(reservation) {
    const box = el('input', {
      type: 'checkbox',
      class: 'paid-box',
      checked: reservation.paid || undefined,
      title: reservation.paid
        ? `Paid${reservation.paidAt ? ` on ${fmtDateTime.format(new Date(reservation.paidAt))}` : ''}`
        : 'Not paid yet',
    });
    box.addEventListener('change', async () => {
      const wanted = box.checked;
      const updated = await patchField(
        reservation,
        { paid: wanted },
        box,
        () => {
          box.checked = !wanted;
        },
        `${reservation.confirmationId} marked ${wanted ? 'paid' : 'unpaid'}.`
      );
      if (updated) {
        box.title = updated.paid
          ? `Paid${updated.paidAt ? ` on ${fmtDateTime.format(new Date(updated.paidAt))}` : ''}`
          : 'Not paid yet';
        if (state.filters.paid !== '') loadReservations();
        else updateFilterHint();
      }
    });
    return box;
  }

  /* Money reads as money: 240 comes back as 240.00, blank stays blank. */
  const amountValue = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2));

  /* How much they actually paid, alongside the tick box. Saves the same way as
     Hobbs: type a number, tab away. Blank means nothing recorded yet. */
  function amountCell(reservation) {
    const wrap = el('div', { class: 'amount-wrap' }, el('span', { class: 'amount-prefix' }, '$'));
    const input = el('input', {
      type: 'number',
      step: '0.01',
      min: '0',
      class: 'amount-inline',
      placeholder: '—',
      title: 'How much the renter paid — type a number and tab away to save',
      value: amountValue(reservation.paidAmount),
    });
    wrap.append(input);
    let last = input.value;
    input.addEventListener('change', async () => {
      if (input.value === last) return;
      const updated = await patchField(
        reservation,
        { paidAmount: input.value === '' ? null : input.value },
        input,
        () => {
          input.value = last;
        },
        `Amount saved for ${reservation.confirmationId}.`
      );
      if (updated) {
        last = amountValue(updated.paidAmount);
        input.value = last;
        updateFilterHint();
      }
    });
    return wrap;
  }

  /* Owner notes: private to Vinod and Soney, never sent to a renter. */
  function adminNotesCell(reservation) {
    const input = el('input', {
      class: 'notes-inline',
      placeholder: 'Add a note…',
      title: 'Owner-only note — renters never see this',
      value: reservation.adminNotes || '',
    });
    let last = input.value;
    input.addEventListener('change', async () => {
      if (input.value === last) return;
      const wanted = input.value;
      const updated = await patchField(
        reservation,
        { adminNotes: wanted },
        input,
        () => {
          input.value = last;
        },
        `Note saved for ${reservation.confirmationId}.`
      );
      if (updated) {
        last = updated.adminNotes || '';
        input.value = last;
      }
    });
    return input;
  }

  /* Hobbs time is the field owners touch most, so it edits in place: type a
     number, tab away, saved. Everything else lives in the edit modal. */
  function hobbsCell(reservation) {
    const input = el('input', {
      type: 'number',
      step: '0.1',
      min: '0',
      class: 'hobbs-inline',
      placeholder: '—',
      title: 'Hobbs time — type a number and tab away to save',
      value: reservation.hobbsTime == null ? '' : String(reservation.hobbsTime),
    });
    let last = input.value;
    input.addEventListener('change', async () => {
      if (input.value === last) return;
      const updated = await patchField(
        reservation,
        { hobbsTime: input.value === '' ? null : input.value },
        input,
        () => {
          input.value = last;
        },
        `Hobbs time saved for ${reservation.confirmationId}.`
      );
      if (updated) {
        last = updated.hobbsTime == null ? '' : String(updated.hobbsTime);
        input.value = last;
      }
    });
    return input;
  }

  $('#add-res-btn').addEventListener('click', () => openReservationModal(null, 'rental'));
  $('#add-block-btn').addEventListener('click', () => openReservationModal(null, 'block'));

  /* ---------- reservation modal ---------- */

  function openReservationModal(reservation, defaultKind = 'rental', prefill = {}) {
    const isNew = !reservation;
    const kind = reservation ? reservation.kind : defaultKind;
    const defaultStart = prefill.start || startOfDay(Date.now()) + 9 * HOUR;
    const defaultEnd = prefill.end || defaultStart + 2 * HOUR;
    const afterSave = prefill.onSaved || loadReservations;

    const form = el('form', { class: 'stack', novalidate: true });
    const modalMsg = el('div', { class: 'hidden' });

    const planeSelect = el('select', { id: 'm-plane' });
    const hasRenter = !isNew && reservation.kind === 'rental' && !!reservation.renterName;
    const kindSelect = el(
      'select',
      { id: 'm-kind', disabled: hasRenter || undefined },
      el('option', { value: 'rental', selected: kind === 'rental' || undefined }, 'Rental'),
      el('option', { value: 'block', selected: kind === 'block' || undefined }, 'Blocked / maintenance')
    );
    const statusSelect = el(
      'select',
      { id: 'm-status' },
      el('option', { value: 'confirmed' }, 'Confirmed'),
      el('option', { value: 'cancelled' }, 'Cancelled')
    );
    if (reservation) statusSelect.value = reservation.status;

    const startField = el('input', {
      type: 'datetime-local',
      id: 'm-start',
      step: '900',
      value: toLocalInput(reservation ? reservation.start : defaultStart),
    });
    const endField = el('input', {
      type: 'datetime-local',
      id: 'm-end',
      step: '900',
      value: toLocalInput(reservation ? reservation.end : defaultEnd),
    });
    const nameField = el('input', { id: 'm-name', value: reservation ? reservation.renterName : '' });
    const phoneField = el('input', { id: 'm-phone', type: 'tel', value: reservation ? reservation.renterPhone : '' });
    const emailField = el('input', { id: 'm-email', type: 'email', value: reservation ? reservation.renterEmail : '' });
    const hobbsField = el('input', {
      id: 'm-hobbs',
      type: 'number',
      step: '0.1',
      min: '0',
      value: reservation && reservation.hobbsTime != null ? String(reservation.hobbsTime) : '',
    });
    const notesField = el('textarea', { id: 'm-notes' }, reservation ? reservation.notes : '');
    const adminNotesField = el('textarea', { id: 'm-admin-notes' }, reservation ? reservation.adminNotes : '');
    const paidField = el('input', {
      type: 'checkbox',
      id: 'm-paid',
      class: 'paid-box',
      checked: (reservation && reservation.paid) || undefined,
    });
    const amountField = el('input', {
      id: 'm-amount',
      type: 'number',
      step: '0.01',
      min: '0',
      class: 'amount-inline',
      placeholder: 'Amount',
      value: reservation ? amountValue(reservation.paidAmount) : '',
    });

    form.append(
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-plane' }, 'Plane'), planeSelect),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'm-kind' }, 'Type'),
          kindSelect,
          hasRenter
            ? el('p', { class: 'field-hint' }, 'Booked by a renter. To take this time for yourself, use the button below.')
            : null
        )
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-start' }, 'Start'), startField),
        el('div', { class: 'field' }, el('label', { for: 'm-end' }, 'End'), endField)
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-name' }, 'Renter name'), nameField),
        el('div', { class: 'field' }, el('label', { for: 'm-phone' }, 'Phone'), phoneField)
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-email' }, 'Email'), emailField),
        el('div', { class: 'field' }, el('label', { for: 'm-hobbs' }, 'Hobbs time'), hobbsField)
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-status' }, 'Status'), statusSelect),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'm-paid' }, 'Payment'),
          el(
            'div',
            { class: 'pay-line' },
            el('label', { class: 'check-line', for: 'm-paid' }, paidField, 'Paid'),
            el('div', { class: 'amount-wrap' }, el('span', { class: 'amount-prefix' }, '$'), amountField)
          ),
          el('p', { class: 'field-hint' }, 'Leave the amount blank if you have not recorded one yet.')
        )
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'm-notes' }, 'Renter’s note'), notesField),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'm-admin-notes' }, 'Owner notes (renters never see these)'),
          adminNotesField
        )
      ),
      modalMsg
    );

    // Adding from the all-planes view used to silently land on whichever plane
    // sorted first, so bookings quietly attached to the wrong aircraft and never
    // appeared where anyone expected. Make the choice explicit instead.
    planeOptions(planeSelect, {
      selected: reservation ? reservation.planeId : prefill.planeId || '',
      placeholder: reservation || prefill.planeId ? null : 'Choose a plane…',
    });

    const saveBtn = el('button', { type: 'submit' }, isNew ? 'Create' : 'Save changes');
    const takeBackBtn =
      hasRenter && reservation.status === 'confirmed'
        ? el(
            'button',
            {
              type: 'button',
              class: 'secondary',
              onclick: () => takeTimeBack(reservation, () => close(), afterSave, modalMsg),
            },
            'Take this time back'
          )
        : null;
    const footer = el(
      'div',
      { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
      takeBackBtn,
      !isNew
        ? el(
            'button',
            {
              type: 'button',
              class: 'danger',
              onclick: async () => {
                if (!window.confirm(`Delete ${reservation.confirmationId} for good? This cannot be undone.`)) return;
                try {
                  await api(`/api/admin/reservations/${reservation.id}`, { method: 'DELETE' });
                  close();
                  afterSave();
                } catch (err) {
                  showMessage(modalMsg, err.message);
                }
              },
            },
            'Delete'
          )
        : null,
      el('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'Cancel'),
      saveBtn
    );
    form.append(footer);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(modalMsg, '');
      const payload = {
        planeId: Number(planeSelect.value),
        kind: kindSelect.value,
        start: fromLocalInput(startField.value),
        end: fromLocalInput(endField.value),
        renterName: nameField.value.trim(),
        renterPhone: phoneField.value.trim(),
        renterEmail: emailField.value.trim(),
        notes: notesField.value.trim(),
        adminNotes: adminNotesField.value.trim(),
        paid: paidField.checked,
        paidAmount: amountField.value === '' ? null : amountField.value,
        status: statusSelect.value,
        hobbsTime: hobbsField.value === '' ? null : hobbsField.value,
      };
      if (!planeSelect.value) return showMessage(modalMsg, 'Choose which plane this is for.');
      if (payload.start == null || payload.end == null) return showMessage(modalMsg, 'Enter a start and end time.');
      saveBtn.disabled = true;
      try {
        if (isNew) {
          const created = await api('/api/admin/reservations', { method: 'POST', body: payload });
          if (payload.status === 'cancelled') {
            await api(`/api/admin/reservations/${created.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
          }
        } else {
          await api(`/api/admin/reservations/${reservation.id}`, { method: 'PATCH', body: payload });
        }
        close();
        afterSave();
      } catch (err) {
        showMessage(modalMsg, err.message);
      } finally {
        saveBtn.disabled = false;
      }
    });

    const { close } = openModal(isNew ? (kind === 'block' ? 'Block off time' : 'Add reservation') : `Edit ${reservation.confirmationId}`, form);
  }

  /* One button for "I need my plane back that day": cancels the booking so the
     renter still sees what happened, blocks the time off, and then puts their
     phone number in front of the owner so the call actually gets made. */
  async function takeTimeBack(reservation, closeEdit, afterSave, modalMsg) {
    const when = formatRange(reservation.start, reservation.end);
    const confirmed = window.confirm(
      `Take back ${reservation.planeTail} on ${when}?\n\n` +
        `• ${reservation.renterName}'s reservation is cancelled\n` +
        '• the time is blocked off for you\n' +
        `• they will see it as cancelled when they look up ${reservation.confirmationId}\n\n` +
        'You should call them afterwards — the site does not send messages.'
    );
    if (!confirmed) return;
    try {
      const result = await api(`/api/admin/reservations/${reservation.id}/take-back`, { method: 'POST', body: {} });
      closeEdit();
      afterSave();
      showCallReminder(result.cancelled);
    } catch (err) {
      showMessage(modalMsg, err.message);
    }
  }

  function showCallReminder(reservation) {
    const phone = reservation.renterPhone || '';
    const digits = phone.replace(/[^0-9+]/g, '');
    const body = el(
      'div',
      {},
      el('p', { class: 'lead' }, `The time is blocked off and ${reservation.renterName || 'the renter'} is cancelled. Please let them know.`),
      el(
        'dl',
        { class: 'detail-list' },
        el('div', { class: 'detail-row' }, el('dt', {}, 'Renter'), el('dd', {}, reservation.renterName || '—')),
        el(
          'div',
          { class: 'detail-row' },
          el('dt', {}, 'Phone'),
          el('dd', {}, digits ? el('a', { href: `tel:${digits}`, style: 'font-size:1.15rem;font-weight:700' }, phone) : '—')
        ),
        el(
          'div',
          { class: 'detail-row' },
          el('dt', {}, 'Email'),
          el(
            'dd',
            {},
            reservation.renterEmail
              ? el('a', { href: `mailto:${reservation.renterEmail}` }, reservation.renterEmail)
              : '—'
          )
        ),
        el('div', { class: 'detail-row' }, el('dt', {}, 'Was'), el('dd', {}, formatRange(reservation.start, reservation.end)))
      )
    );
    const { close } = openModal('Call the renter', body);
    body.append(
      el(
        'div',
        { class: 'row', style: 'justify-content:flex-end;margin-top:1.25rem' },
        el('button', { type: 'button', onclick: () => close() }, 'Done')
      )
    );
  }

  function openModal(title, content) {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, el('h2', {}, title), content);
    backdrop.append(modal);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    $('#modal-root').append(backdrop);

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }
    return { close };
  }

  /* ---------- planes ---------- */

  function renderPlanes() {
    const body = $('#planes-body');
    body.replaceChildren();
    if (!state.planes.length) {
      body.append(el('tr', {}, el('td', { colspan: '7', class: 'muted center' }, 'No planes yet.')));
      return;
    }
    for (const plane of state.planes) {
      body.append(
        el(
          'tr',
          {},
          el('td', { class: 'mono' }, plane.tailNumber),
          el('td', {}, plane.ownerName),
          el('td', {}, plane.model || '—'),
          el('td', {}, plane.nickname || '—'),
          el('td', { class: 'tiny muted' }, plane.notes || '—'),
          el('td', {}, el('span', { class: `badge ${plane.active ? 'badge-good' : 'badge-grey'}` }, plane.active ? 'Listed' : 'Hidden')),
          el(
            'td',
            { class: 'actions' },
            el('button', { class: 'secondary small', type: 'button', onclick: () => openPlaneModal(plane) }, 'Edit')
          )
        )
      );
    }
  }

  $('#plane-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage($('#plane-msg'), '');
    try {
      await api('/api/admin/planes', {
        method: 'POST',
        body: {
          ownerId: Number($('#plane-owner').value),
          tailNumber: $('#plane-tail').value,
          model: $('#plane-model').value,
          nickname: $('#plane-nickname').value,
          notes: $('#plane-notes').value,
        },
      });
      $('#plane-form').reset();
      showMessage($('#plane-msg'), 'Plane added — it is live on the owner’s page now.', 'ok');
      await reloadAll();
    } catch (err) {
      showMessage($('#plane-msg'), err.message);
    }
  });

  function openPlaneModal(plane) {
    const form = el('form', { class: 'stack', novalidate: true });
    const modalMsg = el('div', { class: 'hidden' });
    const ownerSelect = el(
      'select',
      {},
      ...state.owners.map((o) =>
        el('option', { value: String(o.id), selected: o.id === plane.ownerId || undefined }, o.name)
      )
    );
    const tail = el('input', { value: plane.tailNumber });
    const model = el('input', { value: plane.model });
    const nickname = el('input', { value: plane.nickname });
    const notes = el('textarea', {}, plane.notes);
    const active = el('select', {},
      el('option', { value: 'yes', selected: plane.active || undefined }, 'Listed for rent'),
      el('option', { value: 'no', selected: !plane.active || undefined }, 'Hidden from renters')
    );

    form.append(
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', {}, 'Owner'), ownerSelect),
        el('div', { class: 'field' }, el('label', {}, 'Tail number'), tail)
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', {}, 'Model'), model),
        el('div', { class: 'field' }, el('label', {}, 'Nickname'), nickname)
      ),
      el('div', { class: 'field' }, el('label', {}, 'Notes for renters'), notes),
      el('div', { class: 'field' }, el('label', {}, 'Visibility'), active),
      modalMsg
    );

    const saveBtn = el('button', { type: 'submit' }, 'Save changes');
    form.append(
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
        el('button', {
          type: 'button',
          class: 'danger',
          onclick: async () => {
            if (!window.confirm(`Delete ${plane.tailNumber} and every reservation on it? This cannot be undone.`)) return;
            try {
              await api(`/api/admin/planes/${plane.id}`, { method: 'DELETE' });
              close();
              reloadAll();
            } catch (err) {
              showMessage(modalMsg, err.message);
            }
          },
        }, 'Delete plane'),
        el('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'Cancel'),
        saveBtn
      )
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(modalMsg, '');
      saveBtn.disabled = true;
      try {
        await api(`/api/admin/planes/${plane.id}`, {
          method: 'PATCH',
          body: {
            ownerId: Number(ownerSelect.value),
            tailNumber: tail.value,
            model: model.value,
            nickname: nickname.value,
            notes: notes.value,
            active: active.value === 'yes',
          },
        });
        close();
        reloadAll();
      } catch (err) {
        showMessage(modalMsg, err.message);
      } finally {
        saveBtn.disabled = false;
      }
    });

    const { close } = openModal(`Edit ${plane.tailNumber}`, form);
  }

  /* ---------- owners ---------- */

  function renderOwners() {
    const body = $('#owners-body');
    body.replaceChildren();
    for (const owner of state.owners) {
      const planeCount = state.planes.filter((p) => p.ownerId === owner.id).length;
      body.append(
        el(
          'tr',
          {},
          el('td', {}, owner.name),
          el('td', {}, el('a', { href: `/rent/${owner.slug}`, target: '_blank', class: 'mono tiny' }, `/rent/${owner.slug}`)),
          el(
            'td',
            {},
            el('div', {}, owner.contactPhone || '—'),
            owner.managerName
              ? el('div', { class: 'tiny muted' }, `via ${owner.managerName}`)
              : null
          ),
          el('td', { class: 'tiny' }, owner.email || '—'),
          el('td', {}, String(planeCount)),
          el('td', {}, el('span', { class: `badge ${owner.active ? 'badge-good' : 'badge-grey'}` }, owner.active ? 'Live' : 'Hidden')),
          el(
            'td',
            { class: 'actions' },
            el('button', { class: 'secondary small', type: 'button', onclick: () => openOwnerModal(owner) }, 'Edit')
          )
        )
      );
    }
  }

  $('#owner-managed').addEventListener('change', () => {
    $('#owner-manager-wrap').classList.toggle('hidden', !$('#owner-managed').checked);
  });

  function managerOptions(select, { selected = null, excludeId = null } = {}) {
    // Only people who are not themselves managed can manage somebody, which
    // keeps "who do I call" one hop away at most.
    const eligible = state.owners.filter((o) => o.id !== excludeId && !o.managerId);
    select.replaceChildren(
      el('option', { value: '' }, eligible.length ? 'Choose a person…' : 'Nobody available yet'),
      ...eligible.map((o) =>
        el('option', { value: String(o.id), selected: String(o.id) === String(selected) || undefined }, o.name)
      )
    );
    if (selected) select.value = String(selected);
  }

  $('#owner-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage($('#owner-msg'), '');
    try {
      const owner = await api('/api/admin/owners', {
        method: 'POST',
        body: {
          name: $('#owner-name').value,
          phone: $('#owner-phone').value,
          email: $('#owner-email').value,
          slug: $('#owner-slug').value,
          managerId: $('#owner-managed').checked ? $('#owner-manager').value || null : null,
        },
      });
      $('#owner-form').reset();
      $('#owner-manager-wrap').classList.add('hidden');
      showMessage($('#owner-msg'), `Added ${owner.name}. Their page is live at /rent/${owner.slug}.`, 'ok');
      await reloadAll();
    } catch (err) {
      showMessage($('#owner-msg'), err.message);
    }
  });

  function openOwnerModal(owner) {
    const form = el('form', { class: 'stack', novalidate: true });
    const modalMsg = el('div', { class: 'hidden' });
    const name = el('input', { value: owner.name });
    const slug = el('input', { value: owner.slug, class: 'mono' });
    const phone = el('input', { value: owner.phone, type: 'tel' });
    const email = el('input', { value: owner.email, type: 'email' });
    const active = el('select', {},
      el('option', { value: 'yes', selected: owner.active || undefined }, 'Live on the site'),
      el('option', { value: 'no', selected: !owner.active || undefined }, 'Hidden')
    );
    const managerSelect = el('select', {});
    managerOptions(managerSelect, { selected: owner.managerId, excludeId: owner.id });
    const managedBox = el('input', {
      type: 'checkbox',
      class: 'paid-box',
      checked: !!owner.managerId || undefined,
    });
    const managerWrap = el(
      'div',
      { class: owner.managerId ? '' : 'hidden' },
      el('label', {}, 'Who renters should contact'),
      managerSelect,
      el('p', { class: 'field-hint' }, 'Renters see this person instead of the owner, everywhere.')
    );
    managedBox.addEventListener('change', () => managerWrap.classList.toggle('hidden', !managedBox.checked));

    form.append(
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', {}, 'Name'), name),
        el('div', { class: 'field' }, el('label', {}, 'Page address (/rent/…)'), slug)
      ),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', {}, 'Phone'), phone),
        el('div', { class: 'field' }, el('label', {}, 'Email'), email)
      ),
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'check-line' }, managedBox, 'Somebody else handles their renting'),
        managerWrap
      ),
      el('div', { class: 'field' }, el('label', {}, 'Visibility'), active),
      modalMsg
    );

    const saveBtn = el('button', { type: 'submit' }, 'Save changes');
    form.append(
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
        el('button', {
          type: 'button',
          class: 'danger',
          onclick: async () => {
            if (!window.confirm(`Remove ${owner.name}?`)) return;
            try {
              await api(`/api/admin/owners/${owner.id}`, { method: 'DELETE' });
              close();
              reloadAll();
            } catch (err) {
              showMessage(modalMsg, err.message);
            }
          },
        }, 'Delete'),
        el('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'Cancel'),
        saveBtn
      )
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(modalMsg, '');
      saveBtn.disabled = true;
      try {
        await api(`/api/admin/owners/${owner.id}`, {
          method: 'PATCH',
          body: {
            name: name.value,
            slug: slug.value,
            phone: phone.value,
            email: email.value,
            managerId: managedBox.checked ? managerSelect.value || null : null,
            active: active.value === 'yes',
          },
        });
        close();
        reloadAll();
      } catch (err) {
        showMessage(modalMsg, err.message);
      } finally {
        saveBtn.disabled = false;
      }
    });

    const { close } = openModal(`Edit ${owner.name}`, form);
  }

  /* ---------- settings ---------- */

  function fillSettings() {
    const s = state.settings;
    $('#set-site-title').value = s.siteTitle || '';
    $('#set-tz').value = s.timezone || '';
    $('#set-ops-name').value = s.opsContactName || '';
    $('#set-ops-phone').value = s.opsContactPhone || '';
    $('#set-open').value = s.openHour;
    $('#set-close').value = s.closeHour;
    $('#set-ahead').value = s.maxDaysAhead;
  }

  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage($('#settings-msg'), '');
    const openHour = Number($('#set-open').value);
    const closeHour = Number($('#set-close').value);
    if (!(closeHour > openHour)) {
      return showMessage($('#settings-msg'), 'The calendar end hour has to be after the start hour.');
    }
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: {
          site_title: $('#set-site-title').value.trim() || 'Planes for Rent',
          timezone: $('#set-tz').value.trim() || 'America/Chicago',
          ops_contact_name: $('#set-ops-name').value.trim(),
          ops_contact_phone: $('#set-ops-phone').value.trim(),
          open_hour: String(openHour),
          close_hour: String(closeHour),
          max_days_ahead: String(Number($('#set-ahead').value) || 180),
        },
      });
      showMessage($('#settings-msg'), 'Saved.', 'ok');
      await reloadAll();
    } catch (err) {
      showMessage($('#settings-msg'), err.message);
    }
  });

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage($('#password-msg'), '');
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: { currentPassword: $('#cur-password').value, newPassword: $('#new-password').value },
      });
      showMessage($('#password-msg'), 'Password changed. Signing you back in…', 'ok');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showMessage($('#password-msg'), err.message);
    }
  });
})();
