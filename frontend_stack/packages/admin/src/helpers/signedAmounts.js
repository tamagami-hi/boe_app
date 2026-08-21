export const MAX_GROWTH_PERCENT = 1000;

export function toAbsolutePaise(value) {
  const amount = Number(value);
  if (value === '' || value === null || value === undefined) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return String(Math.round(amount * 100));
}

export function toSignedPaise(direction, value) {
  const amount = Number(value);
  if (value === '' || value === null || value === undefined) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const magnitude = Math.round(amount * 100);
  if (magnitude === 0) return null;
  return String(direction === 'decrease' ? -magnitude : magnitude);
}

export function toSignedBasisPoints(direction, value) {
  const percent = Number(value);
  if (value === '' || value === null || value === undefined) return null;
  if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_GROWTH_PERCENT) return null;
  const points = Math.round(percent * 100);
  if (points === 0) return null;
  return direction === 'decrease' ? -points : points;
}

export function signedPaiseFromInput(value) {
  const amount = Number(value);
  if (value === '' || value === null || value === undefined) return null;
  if (!Number.isFinite(amount)) return null;
  const paise = Math.round(amount * 100);
  if (paise === 0) return null;
  return String(paise);
}
