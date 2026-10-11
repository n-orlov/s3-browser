import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

export type ProfileType =
  | 'static'       // Direct access_key_id + secret_access_key
  | 'role'         // Assumes a role (role_arn with source_profile or credential_source)
  | 'sso'          // SSO-based authentication
  | 'process'      // External credential process
  | 'web-identity' // Web identity token (EKS, etc.)
  | 'config-only'; // Has region/output but no credentials

export interface ProfileInfo {
  name: string;
  region?: string;
  hasCredentials: boolean;
  isValid: boolean;
  validationMessage?: string;
  profileType: ProfileType;
  profileTypeDescription: string;
}

export interface AwsProfileContextValue {
  profiles: ProfileInfo[];
  currentProfile: string | null;
  defaultRegion?: string;
  loading: boolean;
  error: string | null;
  profileRestored: boolean;
  selectProfile: (profileName: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

type InitialLoad =
  | { ok: true; state: ProfileState; restoredProfile: string | null; restoreAttempted: boolean }
  | { ok: false; message: string };

type ProfileState = Awaited<ReturnType<typeof window.electronAPI.aws.getProfiles>>;

async function restoreLastProfile(state: ProfileState): Promise<string | null> {
  try {
    const savedState = await window.electronAPI.appState.load();
    const lastProfile = savedState.lastProfile;
    if (!lastProfile) return null;
    // Check if the saved profile exists and is valid
    if (!state.profiles.find(p => p.name === lastProfile && p.isValid)) return null;
    // Clear S3 client and select the saved profile
    await window.electronAPI.s3.clearClient();
    const result = await window.electronAPI.aws.setProfile(lastProfile);
    return result.success ? lastProfile : null;
  } catch (restoreErr) {
    console.warn('Failed to restore saved profile:', restoreErr);
    return null;
  }
}

// Initial load run from the mount effect. It sets no React state itself: the
// provider applies the result once it resolves.
async function loadInitialProfiles(shouldRestore: boolean): Promise<InitialLoad> {
  try {
    const state = await window.electronAPI.aws.getProfiles();
    const restoredProfile = shouldRestore ? await restoreLastProfile(state) : null;
    return { ok: true, state, restoredProfile, restoreAttempted: shouldRestore };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to load profiles' };
  }
}

const AwsProfileContext = createContext<AwsProfileContextValue | null>(null);

export function AwsProfileProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [defaultRegion, setDefaultRegion] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileRestored, setProfileRestored] = useState(false);
  const restorationAttempted = useRef(false);

  const selectProfile = useCallback(async (profileName: string) => {
    try {
      setError(null);
      // Clear the S3 client cache when switching profiles
      await window.electronAPI.s3.clearClient();

      const result = await window.electronAPI.aws.setProfile(profileName);
      if (!result.success) {
        setError(result.error ?? 'Failed to select profile');
        return;
      }
      setCurrentProfile(profileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select profile');
    }
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const state = await window.electronAPI.aws.refreshProfiles();
      setProfiles(state.profiles);
      setCurrentProfile(state.currentProfile);
      setDefaultRegion(state.defaultRegion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const shouldRestore = !restorationAttempted.current;
    restorationAttempted.current = true;
    void loadInitialProfiles(shouldRestore).then((result) => {
      if (result.ok) {
        setProfiles(result.state.profiles);
        setCurrentProfile(result.restoredProfile ?? result.state.currentProfile);
        setDefaultRegion(result.state.defaultRegion);
      } else {
        setError(result.message);
      }
      if (!result.ok || result.restoreAttempted) setProfileRestored(true);
      setLoading(false);
    });
  }, []);

  const value: AwsProfileContextValue = {
    profiles,
    currentProfile,
    defaultRegion,
    loading,
    error,
    profileRestored,
    selectProfile,
    refreshProfiles,
  };

  return (
    <AwsProfileContext.Provider value={value}>
      {children}
    </AwsProfileContext.Provider>
  );
}

export function useAwsProfiles(): AwsProfileContextValue {
  const context = useContext(AwsProfileContext);
  if (!context) {
    throw new Error('useAwsProfiles must be used within an AwsProfileProvider');
  }
  return context;
}
