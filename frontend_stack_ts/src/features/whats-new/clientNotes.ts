import type { WhatsNewNotes } from "./whatsNewEntry"

export const CLIENT_NOTES: WhatsNewNotes = [
  {
    id: "0.18.3",
    month: "November 2026",
    sections: [
      {
        heading: "New",
        items: [
          { text: "Monthly investments recorded earlier can now count towards your SIP plan's months paid." },
          { text: "SIP payments and one-time investments each get their own email. A SIP payment says which month of your plan it covers." },
          { text: "Receipts say whether a payment was a SIP payment or a one-time investment." },
        ],
      },
      {
        heading: "Improved",
        items: [
          { text: "Value updates are also emailed to you, with the fund, the change and your value after it." },
          { text: "Statements show paise and list corrections on their own line, so each month adds up exactly." },
          { text: "On a phone, each statement month shows as rows, so no column is cut off." },
          { text: "A fund's page lists its withdrawals, such as an early exit." },
          { text: "Emails use more of the screen on a computer." },
          { text: "The field you are typing in stays above the on-screen keyboard." },
          { text: "On inner pages, the bottom bar highlights the section you are in." },
          { text: "When a newer version is available, a Reload button appears.", platform: "web" },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "Payment counts leave out recordings that were reversed." },
          { text: "A corrected recording is announced as a correction, not as a value update." },
          { text: "Payout and early exit notices open Activity, where they are explained." },
          { text: "The offline notice clears when the connection returns, and the screen reloads." },
          { text: "Try again reloads everything on the screen that failed, so fund names show again." },
          { text: "Profile and Activity no longer show a back arrow." },
          { text: "The bottom bar no longer sits under the phone's gesture bar.", platform: "android" },
          { text: "In landscape, the top bar no longer runs into the status bar.", platform: "android" },
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
        items: [{ text: "What's new. These notes, kept in Profile." }],
      },
      {
        heading: "Fixed",
        items: [
          { text: "Too-many-requests messages say how long to wait." },
          { text: "The lock screen covers any open dialog.", platform: "android" },
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
        items: [{ text: "Text is darker and easier to read." }],
      },
      {
        heading: "Fixed",
        items: [
          { text: "A brief server outage no longer signs you out." },
          { text: "A screen that fails to load shows Try again instead of loading forever." },
          { text: "A half-filled form is kept when your account refreshes." },
          { text: "When more items fail to load, the list says so and offers Try again." },
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
            text: "Nominee requests. Ask for a nominee change from Profile and see when it is accepted or declined.",
          },
          {
            text: "Early exits. A SIP the team closes early shows Closed early, and your receipts and statements list it as an early exit.",
          },
        ],
      },
    ],
  },
  {
    id: "0.16.2",
    month: "November 2026",
    sections: [
      {
        heading: "Improved",
        items: [{ text: "The sign-in help line shows the support email only." }],
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
            text: "Investment receipts. Every investment recorded for you appears in Activity as Earlier, Monthly or Correction.",
          },
          { text: "Value updates. Portfolio lists each value update and your value after it." },
          { text: "Fund pages. Each fund you hold has its own page with its receipts and updates." },
          { text: "SIP progress. Your SIP shows how many months are paid." },
          {
            text: "Maturity choices. When an investment nears maturity, see your options and pick one in the app. Nothing changes until the team confirms it.",
          },
          { text: "Nominee. Profile shows your nominee." },
          { text: "Reviews. Rate BeOnEdge once a month from Profile." },
          { text: "Statements: print a statement from the web app.", platform: "web" },
          { text: "Statements: open statements in your phone's browser.", platform: "android" },
        ],
      },
      {
        heading: "Improved",
        items: [
          { text: "Support replies and status changes now notify you." },
          { text: "Tapping a notification opens it and marks it read." },
          { text: "Money screens say when their figures were last updated." },
          { text: "Support and the legal pages show BeOnEdge's published contacts, and sign-in has a help line." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          {
            text: "When fund names, your SIP or your email status fail to load, the app says so and offers Try again instead of showing nothing.",
          },
          { text: "When your account cannot be checked, the app says so rather than showing it as locked." },
          { text: "A password link that no longer works offers Request a new link." },
        ],
      },
    ],
  },
]
