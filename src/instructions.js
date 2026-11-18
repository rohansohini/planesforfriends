'use strict';

/* The "Before you fly" list. Lives on its own because three places need it: the
   confirmation screen, the lookup page, and the email a renter gets. */

const { getSetting } = require('./db');

function instructionsFor(reservation) {
  // Whoever handles this owner's rentals — the manager if there is one.
  const ownerName = reservation.contactName || reservation.ownerName || 'the owner';
  const ownerPhone = reservation.contactPhone || reservation.ownerPhone || 'the number on file';
  // Problems go to the same person when this plane is managed for its owner:
  // Soney fielding calls for Vinod's plane is who a renter should ring either
  // way. Only an owner who handles their own renting falls back to the
  // site-wide contact in Settings.
  const managed = !!reservation.managerName;
  const opsName = managed ? reservation.managerName : getSetting('ops_contact_name', 'Soney');
  const opsPhone = managed ? reservation.managerPhone : getSetting('ops_contact_phone', '');
  return [
    `Contact ${ownerName} at ${ownerPhone} about renting.`,
    'Treat the plane as if it was your own.',
    'Top off the gas once you are finished. Fill the fuel tanks all the way back to full before you leave.',
    'Payment is due once you land, by the end of the day you fly.',
    `Contact ${opsName} at ${opsPhone} if there are any problems.`,
  ];
}

/** Who a renter should ring about this reservation, as a "Name at number". */
function contactLine(reservation) {
  const name = reservation.contactName || reservation.ownerName || 'the owner';
  const phone = reservation.contactPhone || reservation.ownerPhone || '';
  return phone ? `${name} at ${phone}` : name;
}

module.exports = { instructionsFor, contactLine };
