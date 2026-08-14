// Disclosure destination tests.
//
// Task 2 fixed the fallback paths (`/investor-charter` -> `/app/investor-charter`,
// which had been navigating outside the client router's `/app/*` mount and falling
// through the wildcard). Task 5 turned both fields into typed, validated
// destinations so a remotely-authored document can no longer supply an arbitrary
// target — the defaults are only one of the two ways these values arrive.
import { describe, expect, test } from 'vitest';
import { DESTINATION_KIND } from '../navigation/routes.js';
import { getDisclosures, getGrievanceContent } from './disclosureApi.js';

describe('disclosure defaults', () => {
  // Test env runs in fixture mode (no VITE_BEO_API_MODE), so these resolve to the
  // built-in defaults without any network access.
  test('resolve to real internal routes carrying the /app prefix', async () => {
    const disclosures = await getDisclosures();

    expect(disclosures.investorCharter).toMatchObject({
      kind: DESTINATION_KIND.INTERNAL,
      path: '/app/investor-charter',
    });
    expect(disclosures.grievance).toMatchObject({
      kind: DESTINATION_KIND.INTERNAL,
      path: '/app/grievance',
    });
  });

  test('no longer expose raw URL strings that could bypass validation', async () => {
    const disclosures = await getDisclosures();

    expect(disclosures.investorCharterUrl).toBeUndefined();
    expect(disclosures.grievanceUrl).toBeUndefined();
  });

  test('keep the rest of the disclosure payload intact', async () => {
    const disclosures = await getDisclosures();

    expect(disclosures.expenseRatio).toBe('1.25%');
    expect(disclosures.riskometer?.level).toBe('moderate');
    expect(typeof disclosures.sebiDisclosure).toBe('string');
  });
});

describe('grievance escalation steps', () => {
  test('each step exposes one classified destination', async () => {
    const content = await getGrievanceContent();
    const [level1, level2, level3] = content.steps;

    // Level 1 is an in-app support route.
    expect(level1.destination).toMatchObject({
      kind: DESTINATION_KIND.INTERNAL,
      path: '/app/profile/support',
    });
    // Level 2 escalates by email.
    expect(level2.destination).toMatchObject({ kind: DESTINATION_KIND.EMAIL });
    // Level 3 is the SEBI portal — a legitimate external HTTPS target.
    expect(level3.destination).toMatchObject({
      kind: DESTINATION_KIND.EXTERNAL,
      host: 'scores.sebi.gov.in',
    });
  });

  test('raw route/url fields are removed from steps', async () => {
    const content = await getGrievanceContent();

    for (const step of content.steps) {
      expect(step.actionRoute).toBeUndefined();
      expect(step.externalUrl).toBeUndefined();
    }
  });

  test('contactEmail stays readable even where it is also an action', async () => {
    const content = await getGrievanceContent();
    const level2 = content.steps[1];

    expect(level2.contactEmail).toBe('grievance@beonedge.example');
  });

  test('step copy and timelines are untouched', async () => {
    const content = await getGrievanceContent();

    expect(content.steps[0].title).toContain('Level 1');
    expect(content.timelines.length).toBeGreaterThan(0);
  });
});
