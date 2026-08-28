import { apiRequest, listFromPayload } from './_util.js';

export async function getResearchContext() {
  try {
    return listFromPayload(await apiRequest('/v1/client/research-context'));
  } catch (error) {
    if (error?.code !== 'USER_NOT_APPROVED') throw error;
    return [];
  }
}
