import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { fetchAnnouncementEvents } from './announcementRpc';

export async function fetchAnnouncementsBestEffort(
  rpcUrl: string,
  contractId: string,
): Promise<Announcement[]> {
  try {
    const { announcements } = await fetchAnnouncementEvents({ rpcUrl, contractId });
    return announcements;
  } catch {
    return [];
  }
}
