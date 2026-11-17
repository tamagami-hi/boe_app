import type { WhatsNewNotes } from "./whatsNewEntry"

export const CLIENT_NOTES: WhatsNewNotes = [
  {
    id: "0.18.1",
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
]
