import { describe, expect, it } from 'vitest';
import { fetchAnnouncements } from './announcementFetch';

describe('fetchAnnouncements', () => {
  it('follows the cursor to the last page and reports the latest ledger', async () => {
    const bodies: { params: Record<string, any> }[] = [];
    const pages = [
      {
        result: {
          events: Array.from({ length: 1000 }, () => ({})),
          cursor: 'c1',
          latestLedger: 500,
        },
      },
      { result: { events: [{}, {}], cursor: 'c2', latestLedger: 502 } },
    ];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(pages[bodies.length - 1]));
    }) as unknown as typeof fetch;

    const result = await fetchAnnouncements('https://rpc.test', 'CCONTRACT', 42, fetchFn);

    expect(bodies).toHaveLength(2);
    expect(bodies[0].params.startLedger).toBe(42);
    expect(bodies[0].params.pagination.cursor).toBeUndefined();
    expect(bodies[1].params.pagination.cursor).toBe('c1');
    expect(bodies[1].params.startLedger).toBeUndefined();
    expect(result).toEqual({ announcements: [], latestLedger: 502 });
  });
});
