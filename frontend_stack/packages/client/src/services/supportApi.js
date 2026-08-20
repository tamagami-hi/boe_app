import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

const faqs = [
  { q: 'How does a BeOnEdge SIP work?', a: 'A SIP is a monthly schedule. Each due installment is paid by you through a fresh secure checkout — no automatic debit is set up.' },
  { q: 'What if an installment payment fails?', a: 'BeOnEdge does not double-charge. The installment moves to Transactions where you can track its latest payment status.' },
  { q: 'Can I pause or cancel a SIP?', a: 'Yes. Open a support ticket and BeOnEdge support will help with the request.' },
  { q: 'When are statements generated?', a: 'Monthly statements are generated on the first of the following month. FY and capital-gains statements are generated after the financial year closes.' },
  { q: 'Is BeOnEdge licensed?', a: 'Yes. BeOnEdge is licensed to operate this strategy. See Legal & disclosures for details.' },
];

let tickets = [];
let nextTkt = 1;

export async function listFaqs() {
  if (useHttpApi()) return listFromPayload(await apiRequest('/v1/client/support/faqs'));

  await delay();
  return clone(faqs);
}

export async function listTickets() {
  if (useHttpApi()) return listFromPayload(await apiRequest('/v1/client/support/tickets'));

  await delay();
  return clone(tickets);
}

export async function createTicket({ subject, body, category }) {
  if (useHttpApi()) {
    return apiRequest('/v1/client/support/tickets', {
      method: 'POST',
      body: { subject, body, category },
    });
  }

  await delay(220);
  const id = `tkt_${String(nextTkt++).padStart(3, '0')}`;
  // Shape matches the real endpoint, reference included — the UI shows it, so the
  // fixture must not be the one path where it is missing.
  const t = {
    id,
    reference: `BOE-${id.slice(-3).padStart(8, '0').toUpperCase()}`,
    category,
    subject,
    status: 'open',
    updatedAt: new Date().toISOString(),
  };
  tickets = [t, ...tickets];
  return clone(t);
}
