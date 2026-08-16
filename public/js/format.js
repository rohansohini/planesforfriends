/* Contact-detail tidying, shared by the browser and the server.

   Loaded as a plain script on every page and required by src/store.js, so a
   number typed into a form and a number posted straight to the API end up
   stored the same way. Keep it free of DOM and of Node built-ins. */

/**
 * Formats as you type: (555) 123-4567. Deliberately partial — three digits
 * gives "(555" with no trailing bracket, so backspace still deletes something
 * visible instead of fighting the formatter.
 *
 * Anything that is not a plain ten-digit North American number is handed back
 * untouched: a leading +, an extension, letters of any kind. Guessing at those
 * mangles real numbers, and this is a phone book the owners actually dial.
 */
function formatPhone(value) {
  const raw = value == null ? '' : String(value);
  if (/[a-zA-Z+]/.test(raw)) return raw;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length > 10) return raw;
  if (!digits) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The settled version, used when a field loses focus and before anything is
 * stored. A complete number becomes (555) 123-4567; anything short of that is
 * left as the person typed it, minus the half-finished brackets this file's
 * own live formatting may have added.
 */
function tidyPhone(value) {
  const raw = (value == null ? '' : String(value)).trim();
  if (!raw) return '';
  if (/[a-zA-Z+]/.test(raw)) return raw;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length === 10) return formatPhone(digits);
  return raw === formatPhone(digits) ? digits : raw;
}

/** Addresses are stored lowercase so the same person is the same person. */
function tidyEmail(value) {
  return (value == null ? '' : String(value)).replace(/\s+/g, '').toLowerCase();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatPhone, tidyPhone, tidyEmail };
}
