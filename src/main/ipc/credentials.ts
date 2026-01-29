import { ipcMain } from 'electron';
import { loadAwsProfiles, getProfile, validateProfile, type AwsProfile } from '../services/awsCredentials';

// Store the currently selected profile
let currentProfile: string | null = null;

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

/**
 * Register IPC handlers for AWS credentials operations
 */
export function registerCredentialsIpc(): void {
  // Get list of available AWS profiles
  ipcMain.handle('aws:get-profiles', async (): Promise<CredentialsState> => {
    const { profiles, defaultRegion } = loadAwsProfiles();

    const profileInfos: ProfileInfo[] = profiles.map(profile => {
      const validation = validateProfile(profile);
      return {
        name: profile.name,
        region: profile.region,
        hasCredentials: profile.hasCredentials,
        isValid: validation.valid,
        validationMessage: validation.reason,
      };
    });

    return {
      profiles: profileInfos,
      currentProfile,
      defaultRegion,
    };
  });

  // Set the current profile
  ipcMain.handle('aws:set-profile', async (_event, profileName: string): Promise<{ success: boolean; error?: string }> => {
    const profile = getProfile(profileName);

    if (!profile) {
      return { success: false, error: `Profile '${profileName}' not found` };
    }

    const validation = validateProfile(profile);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    currentProfile = profileName;
    return { success: true };
  });

  // Get the currently selected profile
  ipcMain.handle('aws:get-current-profile', async (): Promise<string | null> => {
    return currentProfile;
  });

  // Get details for a specific profile
  ipcMain.handle('aws:get-profile-details', async (_event, profileName: string): Promise<AwsProfile | null> => {
    const profile = getProfile(profileName);
    if (!profile) {
      return null;
    }

    // Return profile info but mask the credentials
    return {
      name: profile.name,
      accessKeyId: profile.accessKeyId ? maskCredential(profile.accessKeyId) : undefined,
      secretAccessKey: profile.secretAccessKey ? '********' : undefined,
      sessionToken: profile.sessionToken ? '********' : undefined,
      region: profile.region,
      output: profile.output,
      sourceProfile: profile.sourceProfile,
      roleArn: profile.roleArn,
      hasCredentials: profile.hasCredentials,
    };
  });

  // Refresh profiles (re-read from disk)
  ipcMain.handle('aws:refresh-profiles', async (): Promise<CredentialsState> => {
    // Force re-read from disk by calling loadAwsProfiles again
    const { profiles, defaultRegion } = loadAwsProfiles();

    const profileInfos: ProfileInfo[] = profiles.map(profile => {
      const validation = validateProfile(profile);
      return {
        name: profile.name,
        region: profile.region,
        hasCredentials: profile.hasCredentials,
        isValid: validation.valid,
        validationMessage: validation.reason,
      };
    });

    // Check if current profile still exists
    if (currentProfile && !profiles.find(p => p.name === currentProfile)) {
      currentProfile = null;
    }

    return {
      profiles: profileInfos,
      currentProfile,
      defaultRegion,
    };
  });
}

/**
 * Masks a credential string, showing only first 4 and last 4 characters
 */
function maskCredential(credential: string): string {
  if (credential.length <= 8) {
    return '****';
  }
  return `${credential.substring(0, 4)}...${credential.substring(credential.length - 4)}`;
}

/**
 * Gets the full credentials for the current profile (for internal use only)
 * This should never be exposed directly to the renderer
 */
export function getCurrentProfileCredentials(): AwsProfile | null {
  if (!currentProfile) {
    return null;
  }
  return getProfile(currentProfile) ?? null;
}
