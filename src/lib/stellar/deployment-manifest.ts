/**
 * Canonical record of the deployed Wraith Soroban contracts, keyed by Stellar
 * network.
 *
 * The values here mirror the deploy output of `wraith-protocol/contracts`
 * (`stellar/stealth-announcer`, `stellar/stealth-registry`,
 * `stellar/wraith-names`). This is the only place a deployed contract ID is
 * written down: the send page, the receive page, the simulation helper, the
 * scanner worker and the service worker all resolve it through
 * `./deployments.ts`, which validates the value and fails closed when the
 * selected network has no deployment for a required contract. Redeploying a
 * contract means editing this table and nothing else.
 *
 * A contract with no deployment on a network is left out rather than given a
 * placeholder, so callers fail loudly instead of pointing at a contract that
 * does not exist. `deployments.test.ts` cross-checks these IDs against the
 * Stellar SDK's own address validation. The names contract has no verified
 * testnet deployment yet, so it is configured through
 * `VITE_WRAITH_NAMES_CONTRACT_ID`.
 */

/** Stellar networks this app knows how to talk to. */
export type StellarNetworkName = 'testnet' | 'futurenet' | 'public';

/** Wraith contracts the demo app calls. */
export type StellarContractName = 'announcer' | 'registry' | 'names';

export type StellarContractDeployments = Readonly<Partial<Record<StellarContractName, string>>>;

export const STELLAR_DEPLOYMENT_MANIFEST: Readonly<
  Record<StellarNetworkName, StellarContractDeployments>
> = {
  testnet: {
    announcer: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
    registry: 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5',
  },
  futurenet: {},
  public: {},
};
