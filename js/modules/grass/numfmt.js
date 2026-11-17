// numfmt.js — numbers as text.
//
// formatNumber() is how a number reads on the terminal: PRINT, PROMPT, STR,
// and joining a number to a string with & or +. RT/1 kept numbers as 32-bit
// floats and wrote them with gcvt(value, 6, buf), dropping a trailing '.'
// (OPER.C, NDIGIT in DEF.H), so 100/3 prints 33.3333, not
// 33.333333333333336. Whole numbers print whole.
//
// plainNumber() is how Save writes a number: every digit, so a saved
// workspace loads back identical, and never in exponent form, which the
// tokenizer would read as a label (2.5e-14 is the label 2.5E, then -14).

const DIGITS = 6;

// A number as PRINT shows it: 6 significant digits, as gcvt's %g gives them,
// in exponent form below 1e-4 or from 1e6 up
export function formatNumber(v) {
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v === 0 ? 0 : v); // no -0
  const [mantissa, e] = v.toExponential(DIGITS - 1).split('e');
  const exp = parseInt(e, 10);
  if (exp < -4 || exp >= DIGITS) {
    const m = mantissa.replace(/\.?0+$/, '');
    return `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(Number(v.toPrecision(DIGITS)));
}

// A value as text on the terminal: numbers through formatNumber, the rest as
// they are
export function formatValue(v) {
  return typeof v === 'number' ? formatNumber(v) : String(v);
}

// A number with all its digits and no exponent, for Save
export function plainNumber(v) {
  const s = String(v);
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/);
  if (!m) return s;
  const [, sign, int, frac = '', e] = m;
  const digits = int + frac;
  const point = int.length + parseInt(e, 10);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
