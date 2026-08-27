import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Profile {
  id: string;
  label: string;
  /** Which chain this profile was primarily created for (informational only). */
  chain: string;
  createdAt: number;
  /** A color token from the fixed palette, e.g. 'violet', 'amber', 'cyan'. */
  colorTag: string;
}

/** The well-known id for the original, unsuffixed profile. Never deleted, never re-derives
 *  with a suffixed message — this preserves full backward compatibility for existing users. */
export const DEFAULT_PROFILE_ID = 'default';

/** Fixed color palette for auto-assigning tags to new profiles. */
export const PROFILE_COLORS = [
  'violet',
  'amber',
  'cyan',
  'rose',
  'emerald',
  'sky',
  'orange',
  'fuchsia',
] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

/** Tailwind classes for each color token (dot fill + border). */
export const PROFILE_COLOR_CLASSES: Record<string, { dot: string; border: string; text: string }> =
  {
    violet: { dot: 'bg-violet-400', border: 'border-violet-400/40', text: 'text-violet-300' },
    amber: { dot: 'bg-amber-400', border: 'border-amber-400/40', text: 'text-amber-300' },
    cyan: { dot: 'bg-cyan-400', border: 'border-cyan-400/40', text: 'text-cyan-300' },
    rose: { dot: 'bg-rose-400', border: 'border-rose-400/40', text: 'text-rose-300' },
    emerald: { dot: 'bg-emerald-400', border: 'border-emerald-400/40', text: 'text-emerald-300' },
    sky: { dot: 'bg-sky-400', border: 'border-sky-400/40', text: 'text-sky-300' },
    orange: { dot: 'bg-orange-400', border: 'border-orange-400/40', text: 'text-orange-300' },
    fuchsia: { dot: 'bg-fuchsia-400', border: 'border-fuchsia-400/40', text: 'text-fuchsia-300' },
  };

const DEFAULT_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  label: 'Default',
  chain: 'stellar',
  createdAt: 0,
  colorTag: 'cyan',
};

interface ProfilesState {
  profiles: Profile[];
  activeProfileId: string;
  /** Add a new profile. Returns the new profile. Does NOT derive keys. */
  addProfile: (label: string, chain: string, colorTag: string) => Profile;
  /** Delete a profile. Refuses to delete the default profile. If deleting the active
   *  profile, switches activeProfileId back to 'default' first. */
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
  getActiveProfile: () => Profile;
}

export const useProfilesStore = create<ProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [DEFAULT_PROFILE],
      activeProfileId: DEFAULT_PROFILE_ID,

      addProfile: (label, chain, colorTag) => {
        const id = crypto.randomUUID();
        const profile: Profile = {
          id,
          label: label.trim() || 'Profile',
          chain,
          createdAt: Date.now(),
          colorTag,
        };
        set((state) => ({ profiles: [...state.profiles, profile] }));
        return profile;
      },

      deleteProfile: (id) => {
        if (id === DEFAULT_PROFILE_ID) return; // never delete default
        set((state) => {
          const profiles = state.profiles.filter((p) => p.id !== id);
          // If we just deleted the active profile, revert to default
          const activeProfileId =
            state.activeProfileId === id ? DEFAULT_PROFILE_ID : state.activeProfileId;
          return { profiles, activeProfileId };
        });
      },

      setActiveProfile: (id) => {
        const { profiles } = get();
        if (!profiles.find((p) => p.id === id)) return; // guard against stale ids
        set({ activeProfileId: id });
      },

      getActiveProfile: () => {
        const { profiles, activeProfileId } = get();
        return profiles.find((p) => p.id === activeProfileId) ?? DEFAULT_PROFILE;
      },
    }),
    {
      name: 'wraith-profiles-storage',
    },
  ),
);

/** Pick the next color from the palette that hasn't been used yet (or cycle). */
export function pickNextColor(profiles: Profile[]): ProfileColor {
  const used = new Set(profiles.map((p) => p.colorTag));
  const unused = PROFILE_COLORS.filter((c) => !used.has(c));
  return unused.length > 0 ? unused[0] : PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
}
