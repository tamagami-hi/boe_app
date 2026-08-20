/**
 * §10 audit-metadata flags for the two independent growth domains.
 *
 * A growth command's audit event must state, in its metadata, that it did not
 * propagate into the other accounting domain. The literal flag keys live here
 * — outside both growth modules — because the architecture guard
 * (investment-architecture.guard.test.ts) forbids the sibling domain's
 * vocabulary inside each growth module's own code.
 */
export const CLIENT_GROWTH_AUDIT_METADATA: Readonly<Record<string, unknown>> = Object.freeze({
  propagatedToAum: false,
})
