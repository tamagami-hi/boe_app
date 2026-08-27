export function paiseToRupees(value) {
  if (value === null || value === undefined || value === '') return null;
  const paise = Number(value);
  return Number.isFinite(paise) ? paise / 100 : null;
}
