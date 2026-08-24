import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl } from '@/lib/explorer';
import {
  checkAvailability,
  buildRegisterTransaction,
  buildTransferTransaction,
  buildRenewTransaction,
  buildSetMetadataTransaction,
  submitTransaction,
  getOwnedNames,
  getNameRecord,
  type NameMetadata,
} from '@/lib/stellar/names';
import { CopyButton } from '@/components/CopyButton';
import { useNameWatchlistStore } from '@/store/nameWatchlistStore';

const DEFAULT_REGISTRATION_DURATION = 365 * 24 * 60 * 60; // 1 year in seconds

type Tab = 'list' | 'register' | 'transfer' | 'metadata';

interface OwnedName {
  name: string;
  expiresAt: number;
  metadata: NameMetadata;
}

export default function Names() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [ownedNames, setOwnedNames] = useState<OwnedName[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const watchedAuctions = useNameWatchlistStore((state) => state.watchedAuctions);
  const now = Math.floor(Date.now() / 1000);
  const endingSoonAuctions = watchedAuctions.filter(
    (auction) => auction.endsAt > now && auction.endsAt - now < 24 * 60 * 60,
  );

  // Register form
  const [registerName, setRegisterName] = useState('');
  const [registerDuration, setRegisterDuration] = useState(DEFAULT_REGISTRATION_DURATION);
  const [availabilityStatus, setAvailabilityStatus] = useState<
    'checking' | 'available' | 'taken' | null
  >(null);

  // Transfer form
  const [transferName, setTransferName] = useState('');
  const [transferTo, setTransferTo] = useState('');

  // Renew form
  const [renewName, setRenewName] = useState('');
  const [renewDuration, setRenewDuration] = useState(DEFAULT_REGISTRATION_DURATION);

  // Metadata form
  const [metadataName, setMetadataName] = useState('');
  const [metadata, setMetadata] = useState<NameMetadata>({});

  // Fetch owned names on load
  useEffect(() => {
    if (isConnected && address) {
      fetchOwnedNames();
    }
  }, [isConnected, address]);

  const fetchOwnedNames = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const names = await getOwnedNames(address);
      const records = await Promise.all(
        names.map(async (name) => {
          const record = await getNameRecord(name);
          return {
            name,
            expiresAt: record?.expires_at || 0,
            metadata: record?.metadata || {},
          };
        }),
      );
      setOwnedNames(records);
    } catch (err) {
      console.error('Failed to fetch names:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const checkNameAvailability = useCallback(async (name: string) => {
    if (!name || name.length < 3) {
      setAvailabilityStatus(null);
      return;
    }

    setAvailabilityStatus('checking');
    const startTime = performance.now();

    try {
      const available = await checkAvailability(name);
      const elapsed = performance.now() - startTime;
      console.log(`Availability check took ${elapsed.toFixed(2)}ms`);
      setAvailabilityStatus(available ? 'available' : 'taken');
    } catch {
      setAvailabilityStatus(null);
    }
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (activeTab === 'register') {
        checkNameAvailability(registerName);
      }
    }, 300);
    return () => clearTimeout(debounce);
  }, [registerName, activeTab, checkNameAvailability]);

  const handleRegister = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const xdr = await buildRegisterTransaction(address, {
        name: registerName,
        duration: registerDuration,
      });
      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr);
      setTxHash(hash);
      setIsSuccess(true);
      await fetchOwnedNames();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsPending(false);
    }
  };

  const handleTransfer = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const xdr = await buildTransferTransaction(address, { name: transferName, to: transferTo });
      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr);
      setTxHash(hash);
      setIsSuccess(true);
      await fetchOwnedNames();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setIsPending(false);
    }
  };

  const handleRenew = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const xdr = await buildRenewTransaction(address, {
        name: renewName,
        duration: renewDuration,
      });
      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr);
      setTxHash(hash);
      setIsSuccess(true);
      await fetchOwnedNames();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Renewal failed');
    } finally {
      setIsPending(false);
    }
  };

  const handleSetMetadata = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const xdr = await buildSetMetadataTransaction(address, { name: metadataName, metadata });
      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr);
      setTxHash(hash);
      setIsSuccess(true);
      await fetchOwnedNames();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Metadata update failed');
    } finally {
      setIsPending(false);
    }
  };

  const resetForm = () => {
    setRegisterName('');
    setTransferName('');
    setTransferTo('');
    setRenewName('');
    setMetadataName('');
    setMetadata({});
    setTxHash(null);
    setIsSuccess(false);
    setError('');
  };

  const isExpiringSoon = (expiresAt: number) => {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDays = 30 * 24 * 60 * 60;
    return expiresAt - now < thirtyDays && expiresAt > now;
  };

  const isExpired = (expiresAt: number) => {
    const now = Math.floor(Date.now() / 1000);
    return expiresAt <= now;
  };

  const formatExpiry = (timestamp: number) => {
    if (timestamp === 0) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  };

  const [isPending, setIsPending] = useState(false);

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / Names
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Wraith Names
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to manage Wraith Names on Stellar.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / Names
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Wraith Names
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Register, transfer, and manage your Wraith Names. Set metadata to customize your identity.
        </p>
        <Link
          to="/names/auctions"
          className="mt-2 w-fit font-heading text-[10px] font-semibold uppercase tracking-widest text-primary underline"
        >
          Browse name auctions
        </Link>
      </div>

      {endingSoonAuctions.length > 0 && (
        <div className="border border-tertiary bg-surface-container p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
                Watched auctions ending soon
              </span>
              <p className="mt-2 font-body text-sm text-on-surface-variant">
                {endingSoonAuctions.map((auction) => `${auction.name}.wraith`).join(', ')}{' '}
                {endingSoonAuctions.length === 1 ? 'ends' : 'end'} in under 24 hours.
              </p>
            </div>
            <Link
              to="/names/auctions"
              className="shrink-0 font-heading text-[10px] uppercase tracking-widest text-primary underline"
            >
              View
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-outline-variant">
        {(['list', 'register', 'transfer', 'metadata'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              resetForm();
            }}
            className={`px-4 py-2.5 font-heading text-[10px] uppercase tracking-widest transition-colors ${
              activeTab === tab
                ? 'border-b-[1.5px] border-tertiary text-on-surface'
                : 'border-b-[1.5px] border-transparent text-outline hover:text-on-surface-variant'
            }`}
          >
            {tab === 'list' ? 'My Names' : tab}
          </button>
        ))}
      </div>

      {/* Expiring names warning */}
      {ownedNames.some((n) => isExpiringSoon(n.expiresAt)) &&
        !isExpired(ownedNames.find((n) => isExpiringSoon(n.expiresAt))!.expiresAt) && (
          <div className="border border-tertiary bg-surface-container p-4">
            <div className="flex items-center gap-2">
              <span className="text-tertiary">⚠</span>
              <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
                Names Expiring Soon
              </span>
            </div>
            <p className="mt-2 font-body text-sm text-on-surface-variant">
              {ownedNames.filter((n) => isExpiringSoon(n.expiresAt)).length} name(s) will expire
              within 30 days. Renew them to keep ownership.
            </p>
          </div>
        )}

      {/* List Tab */}
      {activeTab === 'list' && (
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <p className="font-mono text-xs text-outline">Loading names...</p>
          ) : ownedNames.length === 0 ? (
            <div className="border border-outline-variant bg-surface-container p-6 text-center">
              <p className="font-body text-sm text-on-surface-variant">No names registered yet.</p>
              <button
                onClick={() => setActiveTab('register')}
                className="mt-4 font-heading text-[10px] uppercase tracking-widest text-primary underline"
              >
                Register your first name
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {ownedNames.map((nameRecord) => (
                <div
                  key={nameRecord.name}
                  className="border border-outline-variant bg-surface-container p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="font-heading text-lg font-semibold text-on-surface">
                        {nameRecord.name}
                      </span>
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-mono text-[10px] uppercase tracking-widest ${
                            isExpired(nameRecord.expiresAt)
                              ? 'text-error'
                              : isExpiringSoon(nameRecord.expiresAt)
                                ? 'text-tertiary'
                                : 'text-outline'
                          }`}
                        >
                          {isExpired(nameRecord.expiresAt)
                            ? 'Expired'
                            : isExpiringSoon(nameRecord.expiresAt)
                              ? 'Expiring Soon'
                              : 'Active'}
                        </span>
                        <span className="font-mono text-[10px] text-outline">
                          Expires: {formatExpiry(nameRecord.expiresAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {isExpiringSoon(nameRecord.expiresAt) && !isExpired(nameRecord.expiresAt) && (
                        <button
                          onClick={() => {
                            setActiveTab('transfer');
                            setRenewName(nameRecord.name);
                          }}
                          className="h-8 border border-outline-variant px-3 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
                        >
                          Renew
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setActiveTab('transfer');
                          setTransferName(nameRecord.name);
                        }}
                        className="h-8 border border-outline-variant px-3 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
                      >
                        Transfer
                      </button>
                      <button
                        onClick={() => {
                          setActiveTab('metadata');
                          setMetadataName(nameRecord.name);
                          setMetadata(nameRecord.metadata);
                        }}
                        className="h-8 border border-outline-variant px-3 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  {nameRecord.metadata.avatar_url && (
                    <div className="mt-3 flex items-center gap-2">
                      <img
                        src={nameRecord.metadata.avatar_url}
                        alt="Avatar"
                        className="h-8 w-8 border border-outline-variant"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Register Tab */}
      {activeTab === 'register' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Name
            </label>
            <input
              type="text"
              value={registerName}
              onChange={(e) =>
                setRegisterName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }
              placeholder="my-name"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
            {availabilityStatus === 'checking' && (
              <p className="font-mono text-[10px] text-outline">Checking availability...</p>
            )}
            {availabilityStatus === 'available' && (
              <p className="font-mono text-[10px] text-tertiary">✓ Available</p>
            )}
            {availabilityStatus === 'taken' && (
              <p className="font-mono text-[10px] text-error">✗ Already registered</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Duration
            </label>
            <select
              value={registerDuration}
              onChange={(e) => setRegisterDuration(Number(e.target.value))}
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary focus:border-primary"
            >
              <option value={365 * 24 * 60 * 60}>1 Year</option>
              <option value={2 * 365 * 24 * 60 * 60}>2 Years</option>
              <option value={5 * 365 * 24 * 60 * 60}>5 Years</option>
            </select>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleRegister}
            disabled={!registerName || availabilityStatus !== 'available' || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Register Name'}
          </button>
        </div>
      )}

      {/* Transfer Tab */}
      {activeTab === 'transfer' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Name to Transfer
            </label>
            <input
              type="text"
              value={transferName}
              onChange={(e) => setTransferName(e.target.value)}
              placeholder="my-name"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Recipient Address
            </label>
            <input
              type="text"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              placeholder="G..."
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleTransfer}
            disabled={!transferName || !transferTo || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Transfer Name'}
          </button>
        </div>
      )}

      {/* Renew Tab (embedded in transfer for now, accessed via button) */}
      {activeTab === 'transfer' && renewName && (
        <div className="mt-4 border-t border-outline-variant/30 pt-4">
          <div className="flex flex-col gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Quick Renew: {renewName}
            </span>
            <select
              value={renewDuration}
              onChange={(e) => setRenewDuration(Number(e.target.value))}
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary focus:border-primary"
            >
              <option value={365 * 24 * 60 * 60}>+1 Year</option>
              <option value={2 * 365 * 24 * 60 * 60}>+2 Years</option>
              <option value={5 * 365 * 24 * 60 * 60}>+5 Years</option>
            </select>
            <button
              onClick={handleRenew}
              disabled={isPending}
              className="h-12 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
            >
              {isPending ? 'Confirm in wallet...' : 'Renew Now'}
            </button>
          </div>
        </div>
      )}

      {/* Metadata Tab */}
      {activeTab === 'metadata' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Name
            </label>
            <input
              type="text"
              value={metadataName}
              onChange={(e) => setMetadataName(e.target.value)}
              placeholder="my-name"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Avatar URL
            </label>
            <input
              type="text"
              value={metadata.avatar_url || ''}
              onChange={(e) => setMetadata({ ...metadata, avatar_url: e.target.value })}
              placeholder="https://..."
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Twitter Handle
            </label>
            <input
              type="text"
              value={metadata.twitter_handle || ''}
              onChange={(e) => setMetadata({ ...metadata, twitter_handle: e.target.value })}
              placeholder="@username"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Description
            </label>
            <textarea
              value={metadata.description || ''}
              onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
              placeholder="A short bio..."
              rows={3}
              className="w-full border border-outline-variant bg-surface px-4 py-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSetMetadata}
            disabled={!metadataName || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Update Metadata'}
          </button>
        </div>
      )}

      {/* Success Result */}
      {txHash && isSuccess && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              Transaction Complete
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Transaction Hash
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={stellarTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {txHash}
                </a>
                <CopyButton text={txHash} />
              </div>
            </div>
          </div>

          <button
            onClick={resetForm}
            className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            Done
          </button>
        </div>
      )}
    </section>
  );
}
