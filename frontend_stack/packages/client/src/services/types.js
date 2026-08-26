// JSDoc typedefs — no TS, but consumed by IDE intellisense.

/** @typedef {'pending_payment'|'payment_received'|'units_pending'|'units_allotted'|'mandate_pending'|'mandate_active'|'mandate_failed'|'redemption_requested'|'redemption_paid'|'failed_refund_pending'} MoneyState */

/** @typedef {Object} User
 *  @property {string} id
 *  @property {string} name
 *  @property {string} email
 *  @property {string} phoneMasked
 *  @property {'approved'|'rejected'|'suspended'|'closed'} status
 *  @property {string} avatarInitials
 */

/** @typedef {Object} Fund
 *  @property {string} id
 *  @property {string} name
 *  @property {string} tagline
 *  @property {'open'|'coming_soon'|'closed'|'paused'} status
 *  @property {'low'|'low_moderate'|'moderate'|'moderate_high'|'high'} riskLabel
 *  @property {number} minSip
 *  @property {number} minLumpsum
 *  @property {number} minDurationMonths
 *  @property {{ name: string, pct: number, color: string }[]} allocation
 *  @property {{ symbol: string, name: string, pct: number }[]} topHoldings
 *  @property {string} disclosureVersion
 *  @property {{ label: string, value: string }[]} fees
 *  @property {string} horizon
 */

/** @typedef {Object} Holding
 *  @property {string} fundId
 *  @property {string} fundName
 *  @property {number} units
 *  @property {number} avgCost
 *  @property {number} invested
 *  @property {MoneyState} status
 *  @property {string} dataAsOf
 */

/** @typedef {Object} Portfolio
 *  @property {number} invested
 *  @property {string} asOf
 *  @property {boolean} staleFlag
 *  @property {string} dataAsOf
 *  @property {Holding[]} holdings
 */

/** @typedef {Object} Order */

/** @typedef {Object} SipCreateRequest
 *  @property {string} fundId
 *  @property {number} amount
 *  @property {number} durationMonths
 *  @property {number} debitDay
 *  @property {{ amount: number, percent: number, frequencyMonths: number, nextDate: string }|null} stepUp
 *  @property {string} consentTextVersion
 *  @property {string} consentedAt
 */

/** @typedef {Object} SipControlRequest */
/** @typedef {Object} Payment */
/** @typedef {Object} Mandate */
/** @typedef {Object} Transaction */
/** @typedef {Object} Statement */
/** @typedef {Object} Notification */
/** @typedef {Object} EmailVerificationStatus
 *  @property {'not_started'|'pending'|'verified'|'rejected'} status
 *  @property {'not_started'|'pending'|'verified'|'rejected'|null} emailVerificationState
 *  @property {'email_otp'} method
 *  @property {string|null} expiresAt
 *  @property {boolean} expired
 *  @property {string|null} submittedAt
 *  @property {string|null} verifiedAt
 */
/** @typedef {Object} MarketIndex */

export {};
