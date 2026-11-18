import type { WhatsNewNotes } from "./whatsNewEntry"

export const CLIENT_NOTES: WhatsNewNotes = [
  {
    id: "0.18.3",
    month: "November 2026",
    sections: [
      {
        heading: "Improved",
        items: [
          { text: "Value updates are also emailed to you, with the fund, the change and your value after it." },
          { text: "The field you are typing in stays above the on-screen keyboard." },
          { text: "On inner pages, the bottom bar highlights the section you are in." },
        ],
      },
      {
        heading: "Fixed",
        items: [
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
          {
            text: "Nominee requests. Ask for a nominee change from Profile and see when it is accepted or declined.",
          },
          { text: "Reviews. Rate BeOnEdge once a month from Profile." },
          { text: "Statements: print a statement from the web app.", platform: "web" },
          { text: "Statements: open statements in your phone's browser.", platform: "android" },
          { text: "What's new. These notes, kept in Profile." },
        ],
      },
      {
        heading: "Improved",
        items: [
          { text: "Support replies and status changes now notify you." },
          { text: "Tapping a notification opens it and marks it read." },
          { text: "Text is darker and easier to read." },
        ],
      },
      {
        heading: "Fixed",
        items: [
          { text: "A brief server outage no longer signs you out." },
          { text: "A screen that fails to load shows Try again instead of loading forever." },
          { text: "A half-filled form is kept when your account refreshes." },
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
