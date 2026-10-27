/**
 * RFC 4180-style parser (quoted fields, "" escapes, commas/newlines inside quotes, CRLF, BOM).
 * Returns [{ line, cells }] where line is the 1-based CSV record number (header = 1, blank lines count).
 * Throws on an unterminated quote. Blank records are dropped from the result.
 */
export function parseCsvRecords(text) {
  const out = [];
  let row = [], field = '', inQ = false, n = 0;
  const s = String(text).replace(/^\uFEFF/, '');
  const endRow = () => { row.push(field); field = ''; n++; if (row.some((c) => c.trim() !== '')) out.push({ line: n, cells: row }); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; endRow(); }
    else field += ch;
  }
  if (inQ) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length) endRow();
  return out;
}
