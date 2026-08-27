import { DEFAULT_PROFILE_ID } from '@/store/profilesStore';

/**
 * Returns the signing message to use for key derivation for a given profile.
 *
 * CRITICAL correctness rule:
 *   - The default profile (id === 'default') MUST return the base message UNCHANGED
 *     so existing users' keys, meta-addresses, and on-chain announcements remain valid.
 *   - Every non-default profile gets a deterministic suffix that makes the resulting
 *     signature — and therefore the derived stealth keys — cryptographically distinct
 *     from the default and from every other profile.
 *
 * The suffix format is: "\n\nProfile: <profileId>"
 * The double-newline acts as a clear delimiter between the original message and the
 * profile-specific extension. The profileId is a UUID, which is unique per profile.
 *
 * @param baseMessage  The chain's canonical STEALTH_SIGNING_MESSAGE constant.
 * @param profileId    The id of the profile being derived.
 * @returns            The signing message to pass to signMessage / signMessageAsync.
 */
export function profileSigningMessage(baseMessage: string, profileId: string): string {
  if (profileId === DEFAULT_PROFILE_ID) {
    // Byte-for-byte identical to the original message — no change for existing users.
    return baseMessage;
  }
  return `${baseMessage}\n\nProfile: ${profileId}`;
}
