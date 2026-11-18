'use strict';

/* Turns a message into the two shapes an email needs: the HTML most people
 * will see, and the plain text behind it for anyone whose mail app does not
 * show HTML. Both come from the same blocks, so they can never drift apart.
 *
 * Email HTML is not web HTML: no stylesheets, no flexbox, no grid. Tables and
 * inline styles are what every mail app agrees on, so that is what this emits.
 */

/* Single quotes inside the stack on purpose: this string is dropped into
   style="..." attributes, and a double quote would end the attribute early and
   throw away every declaration after it. */
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#101f2c';
const INK_SOFT = '#3a5061';
const INK_FAINT = '#566c7e';
const SKY = '#15618f';
const SKY_DARK = '#0f4a6f';
const SKY_SOFT = '#e6f1f8';
const LINE = '#e3eaf0';
const PAGE = '#f2f6f9';

const esc = (value) =>
  String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/* ---------- plain text ---------- */

function renderText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.p) parts.push(block.p);
    else if (block.facts)
      parts.push(
        block.facts
          .map((row) => (row === 'gap' ? '' : `${row[0]}: ${row[1]}`))
          .join('\n')
          .replace(/\n\n+/g, '\n\n')
      );
    else if (block.steps) {
      parts.push([`${block.steps.title}:`, ...block.steps.items.map((s, i) => `  ${i + 1}. ${s}`)].join('\n'));
    } else if (block.bullets) parts.push(block.bullets.map((b) => `  • ${b}`).join('\n'));
    else if (block.note) parts.push(block.note);
    else if (block.action) parts.push(`${block.action.label}: ${block.action.url}`);
    else if (block.fine) parts.push(block.fine);
  }
  return parts.join('\n\n');
}

/* ---------- HTML ---------- */

/* Outlook does not reliably inherit font-family into table cells, so every
   piece of text names it rather than leaning on the container. */
const p = (text, extra = '') =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK};${extra}">${esc(text)}</p>`;

/* One table per message, so every value lines up in the same column. A 'gap'
   row leaves a space between groups of facts without starting a new table,
   which would let each group pick its own label width. */
function factsTable(rows) {
  const cells = rows
    .map((row) => {
      if (row === 'gap') return '<tr><td colspan="2" style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>';
      const [label, value] = row;
      return `<tr>
           <td style="padding:7px 14px 7px 0;font-family:${FONT};font-size:14px;color:${INK_FAINT};white-space:nowrap;vertical-align:top;width:110px">${esc(label)}</td>
           <td style="padding:7px 0;font-family:${FONT};font-size:16px;color:${INK};font-weight:600;vertical-align:top">${esc(value)}</td>
         </tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;border-collapse:collapse">${cells}</table>`;
}

function stepsList({ title, items }) {
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 9px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK};padding-left:4px">${esc(item)}</li>`
    )
    .join('');
  return (
    `<p style="margin:0 0 10px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${INK_FAINT}">${esc(title)}</p>` +
    `<ol style="margin:0 0 20px;padding-left:22px">${lis}</ol>`
  );
}

const bulletList = (items) =>
  `<ul style="margin:0 0 20px;padding-left:22px">${items
    .map(
      (b) =>
        `<li style="margin:0 0 7px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK}">${esc(b)}</li>`
    )
    .join('')}</ul>`;

const noteBox = (text) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;border-collapse:separate">
     <tr><td style="background:${SKY_SOFT};border-radius:10px;padding:14px 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK}">${esc(text)}</td></tr>
   </table>`;

const button = ({ label, url }) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
     <tr><td style="background:${SKY};border-radius:10px">
       <a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${esc(label)}</a>
     </td></tr>
   </table>`;

function renderHtml(blocks, { title, siteTitle }) {
  const inner = blocks
    .map((block) => {
      if (!block) return '';
      if (block.p) return p(block.p);
      if (block.facts) return factsTable(block.facts);
      if (block.steps) return stepsList(block.steps);
      if (block.bullets) return bulletList(block.bullets);
      if (block.note) return noteBox(block.note);
      if (block.action) return button(block.action);
      if (block.fine) return p(block.fine, `font-size:13px;color:${INK_FAINT};margin-bottom:0`);
      return '';
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PAGE}">
 <tr><td align="center" style="padding:24px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
   <tr><td style="background:${SKY_DARK};padding:18px 28px">
     <span style="font-family:${FONT};font-size:17px;font-weight:700;color:#ffffff;letter-spacing:0.01em">✈&#xFE0E; ${esc(siteTitle)}</span>
   </td></tr>
   <tr><td style="padding:28px;font-family:${FONT}">${inner}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:${INK_SOFT}">${esc(siteTitle)}</p>
 </td></tr>
</table>
</body></html>`;
}

module.exports = { renderText, renderHtml };
