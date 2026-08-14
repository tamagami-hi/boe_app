import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest runs with globals disabled, so @testing-library/react's auto-cleanup
// (which hooks a global afterEach) never registers — unmount explicitly.
afterEach(cleanup);
