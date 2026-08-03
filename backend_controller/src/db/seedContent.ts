/**
 * Seed content for the app's document surfaces (spec 04 §3.1; decision 10).
 *
 * These are the compliance and help documents the client app used to carry as
 * hard-coded copy: the disclosure block, the investor charter, the grievance
 * escalation matrix, the research context, and the support FAQs. Serving them from
 * `content_items` means the wording, contacts and timelines can change without
 * shipping a new APK — which is the point, because they are regulated text.
 *
 * The seed publishes a starting version; the admin content workflow owns them
 * afterwards. Every row is keyed by `content_key`, so a re-run is a no-op and an
 * edited row is never overwritten.
 */

export interface SeedContentDocument {
  readonly contentKey: string
  readonly kind: "faq" | "static_page" | "legal_disclosure"
  readonly title: string
  /** Plain-text summary; FAQs use this as the answer. */
  readonly body: string
  /** Structured document the app renders. */
  readonly payload: Readonly<Record<string, unknown>>
}

const SUPPORT_EMAIL = "support@beonedge.example"
const GRIEVANCE_EMAIL = "grievance@beonedge.example"

/** Risk labelling, costs and category shown beside a fund. */
const DISCLOSURES: SeedContentDocument = {
  contentKey: "disclosures",
  kind: "legal_disclosure",
  title: "Scheme disclosures",
  body: "Risk labelling, costs and category for the BeOnEdge strategy.",
  payload: {
    riskometer: {
      level: "moderate",
      color: "#eab308",
      label: "Moderate",
      description:
        "Principal at moderate risk. Suitable for investors seeking modest growth with balanced risk.",
    },
    sebiDisclosure:
      "Investments are subject to market risks. Read all strategy-related documents carefully before " +
      "investing. Past performance is not indicative of future returns.",
    expenseRatio: "1.25%",
    exitLoad: "1% if redeemed within 12 months",
    schemeCategory: "Equity - Large Cap",
    investorCharterUrl: "/investor-charter",
    grievanceUrl: "/grievance",
  },
}

const INVESTOR_CHARTER: SeedContentDocument = {
  contentKey: "investor-charter",
  kind: "static_page",
  title: "Investor Charter",
  body: "Rights, responsibilities and service standards for BeOnEdge investors.",
  payload: {
    title: "Investor Charter",
    sections: [
      {
        heading: "Rights of Investors",
        items: [
          "Right to receive information about the investment product, its risks, costs, and performance.",
          "Right to fair and transparent treatment by the investment manager and intermediaries.",
          "Right to timely grievance redressal and access to the escalation matrix.",
          "Right to privacy and protection of personal data as per applicable regulations.",
          "Right to exit the investment subject to the terms of the strategy.",
        ],
      },
      {
        heading: "Responsibilities of Investors",
        items: [
          "Read the strategy documents and disclosures before investing.",
          "Understand the risk profile of the strategy and ensure it aligns with your risk appetite.",
          "Provide accurate KYC information and update changes promptly.",
          "Monitor statements and report discrepancies within 30 days.",
          "Be cautious of unsolicited investment advice and verify the registration of intermediaries.",
        ],
      },
      {
        heading: "Do's and Don'ts",
        items: [
          "Do assess your financial goals, horizon, and risk tolerance before investing.",
          "Do keep records of transaction confirmations, statements, and KYC documents.",
          "Don't invest based solely on past performance or tips from unverified sources.",
          "Don't share your login credentials or payment PIN with anyone.",
        ],
      },
      {
        heading: "Expectations from BeOnEdge",
        items: [
          "Timely disclosure of fund size, portfolio holdings, and strategy changes.",
          "Fair and non-discriminatory treatment of all investors.",
          "Grievance resolution within the published timelines.",
          "Regular communication about material changes to the strategy or its risk factors.",
        ],
      },
    ],
    contact: {
      email: SUPPORT_EMAIL,
      phone: "+91-80-1234-5678",
      hours: "Monday - Friday, 9:00 AM - 6:00 PM IST",
      address: "BeOnEdge Financial Services Pvt. Ltd.",
    },
  },
}

const GRIEVANCE: SeedContentDocument = {
  contentKey: "grievance-redressal",
  kind: "static_page",
  title: "Grievance Redressal",
  body: "How to raise a complaint, the timelines, and how to escalate it.",
  payload: {
    title: "Grievance Redressal",
    summary:
      "BeOnEdge resolves investor grievances fairly and within published timelines. This page sets out " +
      "the process, the timelines, and the escalation channels available to you.",
    steps: [
      {
        step: 1,
        title: "Level 1 - Support request",
        description:
          "Raise a support request in the app or write to us at the address below. Most queries are " +
          "resolved at this stage.",
        timeline: "Initial response within 2 business days. Resolution within 7 business days.",
        actionLabel: "Raise a request",
        actionRoute: "/app/profile/support",
      },
      {
        step: 2,
        title: "Level 2 - Internal escalation",
        description:
          "If the Level 1 response does not resolve the matter, escalate it to the Grievance Officer.",
        timeline: "Response within 5 business days of escalation.",
        contactEmail: GRIEVANCE_EMAIL,
      },
      {
        step: 3,
        title: "Level 3 - Regulatory escalation",
        description:
          "If the grievance is still unresolved, you may take it to the relevant regulatory grievance " +
          "portal.",
        timeline: "As per the regulator's published timelines.",
      },
    ],
    timelines: [
      { label: "Acknowledgement", value: "Within 2 business days" },
      { label: "Initial response", value: "Within 5 business days" },
      { label: "Resolution target", value: "Within 21 business days" },
      { label: "Escalation review", value: "Within 10 business days" },
    ],
    contact: {
      email: GRIEVANCE_EMAIL,
      phone: "+91-80-1234-5679",
      hours: "Monday - Friday, 9:00 AM - 6:00 PM IST",
      officerName: "Grievance Officer",
      address: "BeOnEdge Financial Services Pvt. Ltd.",
    },
  },
}

/** Market/research context cards shown on the app's research screen. */
const RESEARCH_CONTEXT: SeedContentDocument = {
  contentKey: "research-context",
  kind: "static_page",
  title: "Market context",
  body: "Context BeOnEdge publishes alongside the strategy.",
  payload: {
    items: [
      {
        id: "approach",
        title: "How the strategy is run",
        body:
          "BeOnEdge runs a single pooled strategy. Your money is pooled with other investors, and the " +
          "returns credited to your account are published by BeOnEdge for each period.",
      },
      {
        id: "horizon",
        title: "Suggested horizon",
        body:
          "The strategy is built for a multi-year horizon. Redeeming early is allowed but may reduce the " +
          "return you realise.",
      },
      {
        id: "reporting",
        title: "What you can see",
        body:
          "Your total investment, current value and returns are shown in the app and update whenever " +
          "BeOnEdge publishes a period's growth or you transact.",
      },
    ],
  },
}

/**
 * Support FAQs. Deliberately written for this money model: there are no units and
 * no per-unit price, so the answers talk about amounts, published growth and
 * payouts rather than NAV allotment.
 */
const FAQS: readonly SeedContentDocument[] = [
  {
    contentKey: "faq-how-sip-works",
    kind: "faq",
    title: "How does a BeOnEdge SIP work?",
    body:
      "You choose an amount and a debit day. The first payment is collected when you start the plan, and " +
      "recurring debits run against the mandate you authorise. Each installment is added to your total " +
      "investment on the day it is collected.",
    payload: {},
  },
  {
    contentKey: "faq-returns-published",
    kind: "faq",
    title: "How are my returns calculated?",
    body:
      "BeOnEdge publishes the growth for each period and credits your share of it to your account. Your " +
      "current value is your total investment plus every return credited to you, less anything you have " +
      "withdrawn. The percentage shown is that return over your total investment.",
    payload: {},
  },
  {
    contentKey: "faq-autopay-failure",
    kind: "faq",
    title: "What if my AutoPay debit fails?",
    body:
      "You are never double-charged. The installment appears under Transactions with its latest payment " +
      "status so you can retry or wait for the next cycle.",
    payload: {},
  },
  {
    contentKey: "faq-pause-cancel",
    kind: "faq",
    title: "Can I pause or cancel a SIP?",
    body:
      "Yes. Open the plan in the app and pause, resume or cancel it. Cancelling releases the mandate when " +
      "no other plan is using it.",
    payload: {},
  },
  {
    contentKey: "faq-withdraw",
    kind: "faq",
    title: "How do withdrawals work?",
    body:
      "You can withdraw your returns only, half your value, your full value, or a custom amount. Returns " +
      "are paid out before principal, so withdrawing your returns leaves your invested amount intact. " +
      "BeOnEdge reviews the request and settles it.",
    payload: {},
  },
  {
    contentKey: "faq-statements",
    kind: "faq",
    title: "When are statements available?",
    body:
      "A statement is available for every month in which your account moved. It is produced from your own " +
      "transaction history, so it always matches what the app shows.",
    payload: {},
  },
]

export const SEED_CONTENT_DOCUMENTS: readonly SeedContentDocument[] = [
  DISCLOSURES,
  INVESTOR_CHARTER,
  GRIEVANCE,
  RESEARCH_CONTEXT,
  ...FAQS,
]
