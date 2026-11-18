import type { WhatsNewNotes } from "./whatsNewEntry"

export const ADMIN_NOTES: WhatsNewNotes = [
  {
    id: "0.18.3",
    month: "November 2026",
    sections: [
      {
        heading: "Improved",
        items: [
          {
            text: "Growth emails the client. A one-investor adjustment, a collective update or the value sheet sends each client one email per fund.",
          },
          { text: "The field you are typing in stays above the on-screen keyboard." },
          { text: "Sections and groups in the All sections menu and the sidebar are spaced clearly apart." },
          { text: "On inner pages, such as a client's page, the bottom bar highlights the section you are in." },
          { text: "Sign out is on the Account screen only, so page titles have room in the top bar." },
          { text: "Plainer wording on Overview, the client pages, Client values and App config." },
          { text: "Roles, statuses and email templates show their names." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "App config shows the address the app actually calls." },
          { text: "The offline notice clears when the connection returns, and the screen reloads." },
          { text: "Try again reloads everything on the screen that failed." },
          { text: "FAQ keys no longer break letter by letter on a phone." },
          { text: "The bottom bar no longer sits under the phone's gesture bar.", platform: "android" },
        ],
      },
    ],
  },
  {
    id: "0.18.1",
    month: "November 2026",
    sections: [
      {
        heading: "New",
        items: [{ text: "Account. Your name, role and app version, with these notes, from the top bar." }],
      },
      {
        heading: "Improved",
        items: [
          { text: "Payout cards show the paid date." },
          { text: "Leaving a page with an unconfirmed save asks first." },
          {
            text: "Publishing terms, or pausing, resuming or archiving a fund, is refused if another admin changed it first.",
          },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "You can no longer suspend or close your own account." },
          { text: "Payouts no longer ask for a transfer reference." },
          { text: "Opening a second tab no longer stops the first tab from saving." },
          { text: "Too-many-requests messages say how long to wait." },
          { text: "Screens say plainly what your role cannot do." },
        ],
      },
    ],
  },
  {
    id: "0.18.0",
    month: "November 2026",
    sections: [
      {
        heading: "Improved",
        items: [
          {
            text: "Saves wait for a definite answer. If the outcome is unknown, the form shows Not confirmed with Check again, and nothing is applied twice.",
          },
          { text: "An unconfirmed money save is kept across a reload, so you can still check it." },
          { text: "Money saves show their figures for you to confirm first." },
          { text: "Archiving or pausing a fund asks first, as do publishing and unpublishing an FAQ." },
          { text: "New fund terms start from the current terms." },
          { text: "Date fields start at today's date in India." },
          { text: "Text is darker and easier to read." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "A brief server outage no longer signs you out." },
          { text: "When more rows fail to load, the list says so and offers Try again." },
          { text: "Screens no longer show a fund's ID when its name cannot load." },
          { text: "The admin sign-in no longer shows a client password reset link." },
          { text: "Details in narrow tiles no longer break letter by letter." },
        ],
      },
    ],
  },
  {
    id: "0.17.0",
    month: "November 2026",
    sections: [
      {
        heading: "New",
        items: [
          {
            text: "Nominee requests. A queue with accept or decline and an optional reason. Overview counts the requests waiting.",
          },
          {
            text: "SIP early exit. Closes a SIP and books its current value as a pending payout. It cannot be undone.",
          },
        ],
      },
    ],
  },
  {
    id: "0.16.0",
    month: "November 2026",
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
          { text: "Nominee. Set or change a client's nominee from the client page." },
          { text: "Support and Reviews inboxes." },
          { text: "Exports. Balances as of a date, and contributions by month." },
          { text: "Contact correction for invitees, and releasing contacts on closed accounts." },
          { text: "Client erasure, for superadmins." },
        ],
      },
      {
        heading: "Improved",
        items: [
          { text: "Creating a client shows a review step before the invite goes out, and names any duplicate field." },
          { text: "Send a new invite link is one action, and works after the old link expired." },
          {
            text: "Overview shows open tickets, invites not accepted, failed emails and the last value update per fund. Each tile opens a filtered list.",
          },
          { text: "The sidebar is grouped by section, with Monthly payments in it." },
          { text: "Fund amounts are entered in rupees." },
          { text: "The investor record opens from a client and pages through the whole ledger." },
          { text: "The audit log has money filters, a date range and client links." },
          { text: "Publishing app config is refused if someone published a newer version first." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "Screens that fail to load say so, instead of looking empty." },
          { text: "Retrying a growth entry never applies it twice." },
          { text: "Recordings and maturities use today's date in India." },
          { text: "Client names link to the client page only for roles that can open it." },
        ],
      },
    ],
  },
]
