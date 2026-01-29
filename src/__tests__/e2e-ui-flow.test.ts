/**
 * End-to-End Test simulating exact UI flow
 *
 * This test simulates the exact sequence of calls that happens when:
 * 1. App loads and gets profiles
 * 2. User selects a profile
 * 3. BucketTree component tries to load buckets
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadAwsProfiles,
  getProfile,
  validateProfile,
} from '../main/services/awsCredentials';
import {
  listBuckets,
  clearS3Client,
} from '../main/services/s3Service';

const AWS_CREDENTIALS_AVAILABLE = (await import('fs')).existsSync(
  `${(await import('os')).homedir()}/.aws/credentials`
);

describe.skipIf(!AWS_CREDENTIALS_AVAILABLE)('UI Flow Simulation', () => {
  // Simulate the state that credentials IPC handler maintains
  let currentProfile: string | null = null;

  // Helper function that simulates IPC: aws:get-profiles
  async function simulateGetProfiles() {
    console.log('IPC: aws:get-profiles called');
    const { profiles, defaultRegion } = loadAwsProfiles();

    const profileInfos = profiles.map(profile => {
      const validation = validateProfile(profile);
      return {
        name: profile.name,
        region: profile.region,
        hasCredentials: profile.hasCredentials,
        isValid: validation.valid,
        validationMessage: validation.reason,
        profileType: profile.profileType,
      };
    });

    console.log(`Returning ${profileInfos.length} profiles, currentProfile: ${currentProfile}`);
    return {
      profiles: profileInfos,
      currentProfile,
      defaultRegion,
    };
  }

  // Helper function that simulates IPC: aws:set-profile
  async function simulateSetProfile(profileName: string) {
    console.log(`IPC: aws:set-profile called with: ${profileName}`);
    const profile = getProfile(profileName);

    if (!profile) {
      console.log(`Profile ${profileName} not found`);
      return { success: false, error: `Profile '${profileName}' not found` };
    }

    const validation = validateProfile(profile);
    if (!validation.valid) {
      console.log(`Profile ${profileName} invalid: ${validation.reason}`);
      return { success: false, error: validation.reason };
    }

    currentProfile = profileName;
    console.log(`currentProfile is now: ${currentProfile}`);
    return { success: true };
  }

  // Helper function that simulates IPC: s3:clear-client
  async function simulateClearClient() {
    console.log('IPC: s3:clear-client called');
    clearS3Client();
  }

  // Helper function that simulates IPC: s3:list-buckets
  async function simulateListBuckets() {
    console.log('IPC: s3:list-buckets called');
    console.log(`currentProfile at time of call: ${currentProfile}`);

    if (!currentProfile) {
      console.log('ERROR: No AWS profile selected');
      return { success: false, error: 'No AWS profile selected. Please select a profile first.' };
    }

    try {
      const buckets = await listBuckets(currentProfile);
      console.log(`SUCCESS: Found ${buckets.length} buckets`);
      return { success: true, buckets };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(`ERROR: ${message}`);
      return { success: false, error: message };
    }
  }

  beforeEach(() => {
    currentProfile = null;
    clearS3Client();
  });

  afterEach(() => {
    clearS3Client();
  });

  it('should simulate complete profile selection and bucket listing flow', async () => {
    console.log('\n=== Starting UI Flow Simulation ===\n');

    // Step 1: App loads - AwsProfileProvider calls getProfiles
    console.log('Step 1: AwsProfileProvider.loadProfiles()');
    const initialState = await simulateGetProfiles();
    console.log(`  Profiles loaded: ${initialState.profiles.length}`);
    console.log(`  Current profile: ${initialState.currentProfile}`);

    // Step 2: BucketTree tries to load buckets (but no profile selected yet)
    console.log('\nStep 2: BucketTree.loadBuckets() - no profile yet');
    // In the UI, BucketTree would show "Select a profile to view buckets"
    // because currentProfile is null
    expect(initialState.currentProfile).toBeNull();

    // Step 3: User selects 'dev' profile in dropdown
    // This triggers selectProfile() in AwsProfileContext
    console.log('\nStep 3: User selects "dev" profile');

    // First, clear the S3 client (as done in AwsProfileContext.selectProfile)
    console.log('  3a: Clearing S3 client cache');
    await simulateClearClient();

    // Then set the profile (as done in AwsProfileContext.selectProfile)
    console.log('  3b: Setting profile');
    const setResult = await simulateSetProfile('dev');
    console.log(`  Set profile result: ${JSON.stringify(setResult)}`);
    expect(setResult.success).toBe(true);

    // Step 4: Profile change triggers useEffect in App.tsx which resets navigation
    // This also triggers useEffect in BucketTree because currentProfile changed
    console.log('\nStep 4: Profile changed, BucketTree.loadBuckets() called');

    // In BucketTree.loadBuckets(), it checks if currentProfile is set
    // and calls window.electronAPI.s3.listBuckets()
    const bucketsResult = await simulateListBuckets();

    console.log(`\n=== Results ===`);
    console.log(`Success: ${bucketsResult.success}`);
    if (bucketsResult.success) {
      console.log(`Buckets found: ${bucketsResult.buckets?.length}`);
      if (bucketsResult.buckets && bucketsResult.buckets.length > 0) {
        console.log(`First 5 buckets: ${bucketsResult.buckets.slice(0, 5).map(b => b.name).join(', ')}`);
      }
    } else {
      console.log(`Error: ${bucketsResult.error}`);
    }

    expect(bucketsResult.success).toBe(true);
    expect(bucketsResult.buckets).toBeDefined();
    expect(bucketsResult.buckets!.length).toBeGreaterThan(0);

    console.log('\n=== UI Flow Simulation Complete ===\n');
  });

  it('should handle profile switching correctly', async () => {
    console.log('\n=== Testing Profile Switching ===\n');

    // Select first profile
    console.log('Selecting "dev" profile...');
    await simulateClearClient();
    await simulateSetProfile('dev');
    const buckets1 = await simulateListBuckets();
    console.log(`dev: ${buckets1.success ? buckets1.buckets?.length + ' buckets' : 'ERROR: ' + buckets1.error}`);

    // Switch to second profile
    console.log('\nSwitching to "prod" profile...');
    await simulateClearClient();
    await simulateSetProfile('prod');
    const buckets2 = await simulateListBuckets();
    console.log(`prod: ${buckets2.success ? buckets2.buckets?.length + ' buckets' : 'ERROR: ' + buckets2.error}`);

    // Switch back
    console.log('\nSwitching back to "dev" profile...');
    await simulateClearClient();
    await simulateSetProfile('dev');
    const buckets3 = await simulateListBuckets();
    console.log(`dev again: ${buckets3.success ? buckets3.buckets?.length + ' buckets' : 'ERROR: ' + buckets3.error}`);

    expect(buckets1.success || buckets1.error?.includes('AccessDenied')).toBe(true);
    expect(buckets2.success || buckets2.error?.includes('AccessDenied')).toBe(true);
    expect(buckets3.success || buckets3.error?.includes('AccessDenied')).toBe(true);
  });

  it('should fail if listBuckets is called before setProfile', async () => {
    console.log('\n=== Testing listBuckets without setProfile ===\n');

    // Don't set profile, try to list buckets
    const result = await simulateListBuckets();

    console.log(`Result: success=${result.success}, error=${result.error}`);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No AWS profile selected');
  });
});
