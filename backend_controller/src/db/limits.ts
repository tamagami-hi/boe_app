/**
 * Hard bounds shared by the project repository interfaces (spec 03 §7). Query
 * pages and batch claims are validated against these ceilings before a
 * repository call; they are defined once here so the Zod validators, command
 * services, and repository implementations cannot drift apart.
 */
export const MAX_QUERY_LIMIT = 100
export const MAX_APPLICATION_CONSENTS = 2
export const MAX_APPLICATION_REVIEWS = 1
export const MAX_EMAIL_DELIVERIES_PER_APPLICATION = 100
export const MAX_PROVIDER_EVENT_CLAIM = 100
export const MAX_OUTBOX_CLAIM = 100
