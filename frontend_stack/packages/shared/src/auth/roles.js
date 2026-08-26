export function hasRole(user, role) {
  const expected = String(role || '').trim().toLowerCase();
  if (!expected) return false;

  return (
    String(user?.role || user?.accountType || '').toLowerCase() === expected ||
    user?.roles?.some((value) => String(value).toLowerCase() === expected) === true
  );
}
