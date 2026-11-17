import type { WhatsNewNotes } from "./whatsNewEntry"

export const ADMIN_NOTES: WhatsNewNotes = [
  {
    id: "0.18.1",
    sections: [
      {
        heading: "New",
        items: [
          {
            text: "Client page. Invite status, summary and actions in one place, with tabs for ledger, maturity, emails, sign-ins, support, reviews and activity.",
          },
          {
            text: "Recording categories. Record an investment as Earlier, Monthly or Correction. The ledger shows Recorded beside Effective.",
          },
          { text: "Value sheet. Enter each client's gain for a fund, preview it, then commit once." },
          { text: "Returns. Simple return first, XIRR second, with totals and sorting." },
          {
            text: "SIP schedules and Monthly payments. Track SIPs the team runs and record each month from one sheet, or paste CSV.",
          },
          {
            text: "Maturities. Dates per client and fund, a dashboard, three resolutions, and options you can send to the client.",
          },
          {
            text: "SIP early exit. Closes a SIP and books its current value as a pending payout. It cannot be undone.",
          },
          { text: "Nominee requests. A queue with accept or decline and an optional reason." },
          { text: "Support and Reviews inboxes." },
          { text: "Exports. Balances as of a date, and contributions by month." },
          { text: "Contact correction for invitees, and releasing contacts on closed accounts." },
          { text: "Client erasure, for superadmins." },
        ],
      },
      {
        heading: "Improved",
        items: [
          {
            text: "Saves wait for a definite answer. If the outcome is unknown, the form shows Not confirmed with Check again, and nothing is applied twice.",
          },
          { text: "Fund amounts are entered in rupees." },
          { text: "Overview tiles open filtered lists." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "You can no longer suspend or close your own account." },
          { text: "A payout's transfer reference is optional." },
          { text: "Opening a second tab no longer stops the first tab from saving." },
          { text: "A brief server outage no longer signs you out." },
        ],
      },
    ],
  },
]
