import { useState, useEffect, useCallback } from 'react';

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

export interface UseAwsProfilesResult {
  profiles: ProfileInfo[];
  currentProfile: string | null;
  defaultRegion?: string;
  loading: boolean;
  error: string | null;
  selectProfile: (profileName: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

export function useAwsProfiles(): UseAwsProfilesResult {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [defaultRegion, setDefaultRegion] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const state = await window.electronAPI.aws.getProfiles();
      setProfiles(state.profiles);
      setCurrentProfile(state.currentProfile);
      setDefaultRegion(state.defaultRegion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectProfile = useCallback(async (profileName: string) => {
    try {
      setError(null);
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

  return {
    profiles,
    currentProfile,
    defaultRegion,
    loading,
    error,
    selectProfile,
    refreshProfiles,
  };
}
