import { apiRequest, listFromPayload } from './_util.js';

export async function listFaqs() {
  return listFromPayload(await apiRequest('/v1/client/support/faqs'));
}

export async function listTickets() {
  return listFromPayload(await apiRequest('/v1/client/support/tickets'));
}

export async function createTicket({ subject, body, category }) {
  return apiRequest('/v1/client/support/tickets', {
    method: 'POST',
    body: { subject, body, category },
  });
}
