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

const AwsProfileContext = createContext<AwsProfileContextValue | null>(null);

export function AwsProfileProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [defaultRegion, setDefaultRegion] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileRestored, setProfileRestored] = useState(false);
  const restorationAttempted = useRef(false);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const state = await window.electronAPI.aws.getProfiles();
      setProfiles(state.profiles);
      setCurrentProfile(state.currentProfile);
      setDefaultRegion(state.defaultRegion);

      // On first load, try to restore last used profile
      if (!restorationAttempted.current) {
        restorationAttempted.current = true;
        try {
          const savedState = await window.electronAPI.appState.load();
          if (savedState.lastProfile) {
            // Check if the saved profile exists and is valid
            const savedProfileExists = state.profiles.find(
              p => p.name === savedState.lastProfile && p.isValid
            );
            if (savedProfileExists) {
              // Clear S3 client and select the saved profile
              await window.electronAPI.s3.clearClient();
              const result = await window.electronAPI.aws.setProfile(savedState.lastProfile);
              if (result.success) {
                setCurrentProfile(savedState.lastProfile);
              }
            }
          }
        } catch (restoreErr) {
          console.warn('Failed to restore saved profile:', restoreErr);
        }
        setProfileRestored(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
      setProfileRestored(true);
    } finally {
      setLoading(false);
    }
  }, []);

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
    loadProfiles();
  }, [loadProfiles]);

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
