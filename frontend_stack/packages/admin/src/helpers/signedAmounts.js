export const MAX_GROWTH_PERCENT = 1000;

const SCALE = 2;

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u;

const problem = (message) => ({ ok: false, problem: message });
const value = (parsed) => ({ ok: true, value: parsed });

function scaledUnits(text, scale) {
  const match = DECIMAL.exec(text);
  if (match === null) return null;
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  if (whole === '' && fraction === '') return null;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) return null;
  const places = fraction.length - exponent;
  if (places > scale) return 'imprecise';
  const digits = `${whole}${fraction}`.padEnd(1, '0');
  const magnitude = BigInt(digits + '0'.repeat(scale - places));
  return match[1] === '-' ? -magnitude : magnitude;
}

function parseDecimal(input, { scale = SCALE, unit = 'paise' } = {}) {
  if (input === null || input === undefined) return problem('Enter a value.');
  const text = String(input).trim();
  if (text === '') return problem('Enter a value.');
  const units = scaledUnits(text, scale);
  if (units === null) return problem('Enter a plain number, for example 1250000.50.');
  if (units === 'imprecise') {
    return problem(
      unit === 'paise'
        ? 'Use at most two decimal places — amounts are stored to the paise.'
        : 'Use at most two decimal places — rates are stored to the basis point.',
    );
  }
  return value(units);
}

export function parseAbsolutePaise(input) {
  const parsed = parseDecimal(input);
  if (!parsed.ok) return parsed;
  if (parsed.value < 0n) return problem('This figure cannot be negative.');
  return value(parsed.value.toString());
}

export function parseSignedPaise(direction, input) {
  const parsed = parseDecimal(input);
  if (!parsed.ok) return parsed;
  if (parsed.value <= 0n) return problem('Enter an amount above zero.');
  const signed = direction === 'decrease' ? -parsed.value : parsed.value;
  return value(signed.toString());
}

export function parseSignedBasisPoints(direction, input) {
  const parsed = parseDecimal(input, { unit: 'basis points' });
  if (!parsed.ok) return parsed;
  if (parsed.value <= 0n) return problem('Enter a percentage above zero.');
  const maximum = BigInt(MAX_GROWTH_PERCENT) * 100n;
  if (parsed.value > maximum) return problem(`Enter no more than ${MAX_GROWTH_PERCENT}%.`);
  const signed = direction === 'decrease' ? -parsed.value : parsed.value;
  return value(Number(signed));
}

export function parseSignedGrowth(mode, direction, input) {
  const signedDirection = direction === 'loss' || direction === 'decrease'
    ? 'decrease'
    : 'increase';
  return mode === 'amount'
    ? parseSignedPaise(signedDirection, input)
    : parseSignedBasisPoints(signedDirection, input);
}

export function parseSignedPaiseFromInput(input) {
  const parsed = parseDecimal(input);
  if (!parsed.ok) return parsed;
  if (parsed.value === 0n) return problem('Enter a non-zero amount, negative for a decrease.');
  return value(parsed.value.toString());
}

export function paiseToRupeeInput(paise) {
  if (paise === null || paise === undefined || paise === '') return '';
  const text = String(paise).trim();
  if (!/^-?\d+$/u.test(text)) return '';
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
