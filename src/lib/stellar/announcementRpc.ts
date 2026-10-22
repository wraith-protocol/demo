/**
 * Announcement-level view over the lossless `getEvents` pagination in
 * `rpcEvents.ts`: it decodes raw `ScVal` topics/values into SDK
 * `Announcement`s and reports progress per page so scanners can persist a
 * cursor that only ever covers events they have already seen.
 */
import { Address, xdr } from '@stellar/stellar-sdk';
import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { fetchEventPages, type StellarRpcEvent, type StellarRpcOptions } from './rpcEvents';

export interface AnnouncementPage {
  /** 1-based page index within this scan. */
  page: number;
  announcements: Announcement[];
  /** Events whose announcement payload could not be decoded. */
  undecodableEvents: number;
  /**
   * Highest ledger proven fully consumed by processed pages so far
   * (`committedLedger + 1` resumes). A ledger the RPC cursor stopped inside is
   * excluded, so its remaining announcements are re-read on resume.
   */
  committedLedger: number;
}

export interface FetchAnnouncementEventsOptions extends StellarRpcOptions {
  rpcUrl: string;
  contractId: string;
  /** Ledger to resume from. Defaults to the edge of the retention window. */
  startLedger?: number;
  /** Ledger the scan must not read past. Defaults to the tip at scan start. */
  throughLedger?: number;
  pageLimit?: number;
  lookbackLedgers?: number;
  maxPages?: number;
  /** Awaited after every page that has been decoded for the caller. */
  onPage?: (page: AnnouncementPage) => void | Promise<void>;
}

export interface FetchAnnouncementEventsResult {
  announcements: Announcement[];
  /** Ledger the next scan resumes from: one past `committedLedger`. */
  nextLedger: number;
  committedLedger: number;
  pages: number;
  /** True when the page safety stop was hit before the boundary. */
  truncated: boolean;
}

/**
 * Decodes one `getEvents` entry into an `Announcement`. Returns `null` for
 * entries that are not announcer announcements so a single malformed payload
 * cannot abort a scan, and never mutates the cursor.
 */
export function parseAnnouncementEvent(
  event: StellarRpcEvent | Record<string, unknown>,
): Announcement | null {
  const topics = event.topic as unknown;
  if (!Array.isArray(topics) || topics.length < 3) return null;
  if (typeof event.value !== 'string') return null;

  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1] as string, 'base64');
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(topics[2] as string, 'base64');
  const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

  const valueVec = xdr.ScVal.fromXDR(event.value, 'base64').vec();
  if (!valueVec || valueVec.length < 3) return null;

  const caller = Address.fromScAddress(valueVec[0].address()).toString();
  const ephemeralPubKey = bytesToHex(new Uint8Array(valueVec[1].bytes()));
  const metadata = bytesToHex(new Uint8Array(valueVec[2].bytes()));

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

/**
 * Reads every announcement the announcer contract emitted through the scan
 * boundary, streaming decoded pages to `onPage`.
 */
export async function fetchAnnouncementEvents(
  options: FetchAnnouncementEventsOptions,
): Promise<FetchAnnouncementEventsResult> {
  const announcements: Announcement[] = [];

  const result = await fetchEventPages({
    ...options,
    onPage: async (page) => {
      const pageAnnouncements: Announcement[] = [];
      let undecodableEvents = 0;

      for (const event of page.events) {
        let announcement: Announcement | null = null;
        try {
          announcement = parseAnnouncementEvent(event);
        } catch {
          // Undecodable payloads are reported, not fatal: the cursor must stay
          // lossless for the events that do decode.
          announcement = null;
        }
        if (announcement) {
          pageAnnouncements.push(announcement);
        } else {
          undecodableEvents += 1;
        }
      }

      announcements.push(...pageAnnouncements);
      await options.onPage?.({
        page: page.page,
        announcements: pageAnnouncements,
        undecodableEvents,
        committedLedger: page.committedLedger,
      });
    },
  });

  return {
    announcements,
    nextLedger: result.nextLedger,
    committedLedger: result.committedLedger,
    pages: result.pages,
    truncated: result.truncated,
  };
}
