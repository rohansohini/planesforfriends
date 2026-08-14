/* Confirmation-ID lookup + Hobbs time logging. No account needed — the ID is the key. */

(function () {
  const msg = $('#msg');
  const hobbsMsg = $('#hobbs-msg');
  const input = $('#conf-input');
  let current = null;

  $('#lookup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await lookup(input.value);
  });

  $('#hobbs-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current) return;
    const button = $('#hobbs-btn');
    showMessage(hobbsMsg, '');
    button.disabled = true;
    try {
      const updated = await api(`/api/reservations/${encodeURIComponent(current.confirmationId)}/hobbs`, {
        method: 'POST',
        body: { hobbsTime: $('#hobbs-input').value },
      });
      current = updated;
      render(updated);
      showMessage(hobbsMsg, `Saved. Hobbs time logged as ${updated.hobbsTime}.`, 'ok');
    } catch (err) {
      showMessage(hobbsMsg, err.message);
    } finally {
      button.disabled = false;
    }
  });

  const prefill = new URLSearchParams(window.location.search).get('id');
  if (prefill) {
    input.value = prefill;
    lookup(prefill);
  }

  async function lookup(rawId) {
    const id = String(rawId || '').trim();
    showMessage(msg, '');
    showMessage(hobbsMsg, '');
    if (!id) return showMessage(msg, 'Please type in your confirmation number.');

    const button = $('#lookup-btn');
    button.disabled = true;
    try {
      const reservation = await api(`/api/reservations/${encodeURIComponent(id)}`);
      current = reservation;
      render(reservation);
      $('#result').classList.remove('hidden');
    } catch (err) {
      current = null;
      $('#result').classList.add('hidden');
      showMessage(msg, err.message);
    } finally {
      button.disabled = false;
    }
  }

  function render(reservation) {
    const cancelled = reservation.status !== 'confirmed';

    // A cancelled booking is the one case where the renter needs to be told
    // something rather than shown a form, so say it plainly and give them the
    // owner's number.
    const alert = $('#result-alert');
    if (cancelled) {
      showMessage(
        alert,
        `This reservation was cancelled. The plane is not being held for you. ` +
          `Please call ${reservation.contactName}${reservation.contactPhone ? ` at ${reservation.contactPhone}` : ''} ` +
          'if you have questions or want to book another time.',
        'error'
      );
    } else {
      showMessage(alert, '');
    }
    $('#hobbs-card').classList.toggle('hidden', cancelled);
    $('#reminders-card').classList.toggle('hidden', cancelled);

    const status = $('#result-status');
    status.textContent = cancelled ? 'Cancelled' : 'Confirmed';
    status.className = `badge ${cancelled ? 'badge-bad' : 'badge-good'}`;
    $('#result-title').textContent = `${reservation.planeTail} · ${reservation.confirmationId}`;

    const details = $('#result-details');
    details.replaceChildren();
    const rows = [
      ['Plane', [reservation.planeTail, reservation.planeNickname, reservation.planeModel].filter(Boolean).join(' · ')],
      ['Owner', reservation.ownerName],
      ['Who to call', `${reservation.contactName}${reservation.contactPhone ? ` · ${reservation.contactPhone}` : ''}`],
      ['When', formatRange(reservation.start, reservation.end)],
      ['How long', durationLabel(reservation.start, reservation.end)],
      ['Renter', reservation.renterName],
      [
        'Hobbs time',
        reservation.hobbsTime == null
          ? 'Not logged yet'
          : `${reservation.hobbsTime} (logged ${fmtDateTime.format(new Date(reservation.hobbsLoggedAt))})`,
      ],
    ];
    for (const [label, value] of rows) {
      details.append(el('div', { class: 'detail-row' }, el('dt', {}, label), el('dd', {}, value)));
    }

    const list = $('#result-instructions');
    list.replaceChildren();
    for (const line of reservation.instructions) list.append(el('li', {}, line));

    $('#hobbs-input').value = reservation.hobbsTime == null ? '' : reservation.hobbsTime;
    $('#hobbs-help').textContent =
      reservation.hobbsTime == null
        ? 'Type in the Hobbs time for this flight. You can change it later if you need to.'
        : 'Hobbs time is already saved. Type a new number if you need to correct it.';
    $('#hobbs-btn').textContent = reservation.hobbsTime == null ? 'Save Hobbs time' : 'Update Hobbs time';
  }
})();
