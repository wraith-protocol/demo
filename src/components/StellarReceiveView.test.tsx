import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StellarReceiveView } from './StellarReceiveView';

describe('StellarReceiveView retention recovery', () => {
  it('explains the missed range and offers the oldest safe ledger', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <StellarReceiveView
          isConnected
          isDerivingKeys={false}
          keysDerived
          metaAddress="st:stellar:test"
          registered
          isRegistering={false}
          regHash={null}
          isScanning={false}
          hasScanned={false}
          matchCount={0}
          matches={null}
          error=""
          retentionGap={{ requestedLedger: 100, oldestAvailableLedger: 250 }}
          onDeriveKeys={() => undefined}
          onRegister={() => undefined}
          onScan={() => undefined}
          onRecoverRetentionGap={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('Ledgers 100 through 249');
    expect(markup).toContain('payments in that range may have been missed');
    expect(markup).toContain('Rescan from ledger 250');
  });
});
