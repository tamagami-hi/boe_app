import { describe, expect, test } from 'vitest';
import { hasRole } from './roles.js';

describe('hasRole', () => {
  test('matches the primary role case-insensitively', () => {
    expect(hasRole({ role: 'ADMIN' }, 'admin')).toBe(true);
  });

  test('matches account type and role collections', () => {
    expect(hasRole({ accountType: 'Admin' }, 'admin')).toBe(true);
    expect(hasRole({ roles: ['client', 'Operations'] }, 'operations')).toBe(true);
  });

  test('rejects empty or absent roles', () => {
    expect(hasRole({ role: 'admin' }, '')).toBe(false);
    expect(hasRole(undefined, 'admin')).toBe(false);
  });
});
