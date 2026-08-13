/* Confirmation-ID lookup + tach time logging. No account needed — the ID is the key. */

(function () {
  const msg = $('#msg');
  const tachMsg = $('#tach-msg');
  const input = $('#conf-input');
  let current = null;

  api('/api/config')
    .then((config) => {
      if (config.siteTitle) $('#site-title').textContent = config.siteTitle;
    })
    .catch(() => {});

  $('#lookup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await lookup(input.value);
  });

  $('#tach-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current) return;
    const button = $('#tach-btn');
    showMessage(tachMsg, '');
    button.disabled = true;
    try {
      const updated = await api(`/api/reservations/${encodeURIComponent(current.confirmationId)}/tach`, {
        method: 'POST',
        body: { tachTime: $('#tach-input').value },
      });
      current = updated;
      render(updated);
      showMessage(tachMsg, `Saved. Tach time logged as ${updated.tachTime}.`, 'ok');
    } catch (err) {
      showMessage(tachMsg, err.message);
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
    showMessage(tachMsg, '');
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
          `Please call ${reservation.ownerName}${reservation.ownerPhone ? ` at ${reservation.ownerPhone}` : ''} ` +
          'if you have questions or want to book another time.',
        'error'
      );
    } else {
      showMessage(alert, '');
    }
    $('#tach-card').classList.toggle('hidden', cancelled);
    $('#reminders-card').classList.toggle('hidden', cancelled);

    const status = $('#result-status');
    status.textContent = cancelled ? 'Cancelled' : 'Confirmed';
    status.className = `badge ${cancelled ? 'badge-bad' : 'badge-good'}`;
    $('#result-title').textContent = `${reservation.planeTail} · ${reservation.confirmationId}`;

    const details = $('#result-details');
    details.replaceChildren();
    const rows = [
      ['Plane', [reservation.planeTail, reservation.planeNickname, reservation.planeModel].filter(Boolean).join(' · ')],
      ['Owner', `${reservation.ownerName}${reservation.ownerPhone ? ` · ${reservation.ownerPhone}` : ''}`],
      ['When', formatRange(reservation.start, reservation.end)],
      ['How long', durationLabel(reservation.start, reservation.end)],
      ['Renter', reservation.renterName],
      [
        'Tach time',
        reservation.tachTime == null
          ? 'Not logged yet'
          : `${reservation.tachTime} (logged ${fmtDateTime.format(new Date(reservation.tachLoggedAt))})`,
      ],
    ];
    for (const [label, value] of rows) {
      details.append(el('div', { class: 'detail-row' }, el('dt', {}, label), el('dd', {}, value)));
    }

    const list = $('#result-instructions');
    list.replaceChildren();
    for (const line of reservation.instructions) list.append(el('li', {}, line));

    $('#tach-input').value = reservation.tachTime == null ? '' : reservation.tachTime;
    $('#tach-help').textContent =
      reservation.tachTime == null
        ? 'Type in the tach time for this flight. You can change it later if you need to.'
        : 'Tach time is already saved. Type a new number if you need to correct it.';
    $('#tach-btn').textContent = reservation.tachTime == null ? 'Save tach time' : 'Update tach time';
  }
})();
