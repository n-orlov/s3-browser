import { contextBridge, ipcRenderer } from 'electron';

// Types for AWS credentials API
export interface ProfileInfo {
  name: string;
  region?: string;
  hasCredentials: boolean;
  isValid: boolean;
  validationMessage?: string;
}

export interface CredentialsState {
  profiles: ProfileInfo[];
  currentProfile: string | null;
  defaultRegion?: string;
}

export interface ProfileDetails {
  name: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  output?: string;
  sourceProfile?: string;
  roleArn?: string;
  hasCredentials: boolean;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Platform info
  platform: process.platform,

  // AWS Credentials API
  aws: {
    getProfiles: (): Promise<CredentialsState> => ipcRenderer.invoke('aws:get-profiles'),
    setProfile: (profileName: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('aws:set-profile', profileName),
    getCurrentProfile: (): Promise<string | null> => ipcRenderer.invoke('aws:get-current-profile'),
    getProfileDetails: (profileName: string): Promise<ProfileDetails | null> =>
      ipcRenderer.invoke('aws:get-profile-details', profileName),
    refreshProfiles: (): Promise<CredentialsState> => ipcRenderer.invoke('aws:refresh-profiles'),
  },
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      platform: NodeJS.Platform;
      aws: {
        getProfiles: () => Promise<CredentialsState>;
        setProfile: (profileName: string) => Promise<{ success: boolean; error?: string }>;
        getCurrentProfile: () => Promise<string | null>;
        getProfileDetails: (profileName: string) => Promise<ProfileDetails | null>;
        refreshProfiles: () => Promise<CredentialsState>;
      };
    };
  }
}
