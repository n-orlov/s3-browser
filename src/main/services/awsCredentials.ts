import fs from 'fs';
import path from 'path';
import os from 'os';

// Profile type detection for UI display
export type ProfileType =
  | 'static'       // Direct access_key_id + secret_access_key
  | 'role'         // Assumes a role (role_arn with source_profile or credential_source)
  | 'sso'          // SSO-based authentication
  | 'process'      // External credential process
  | 'web-identity' // Web identity token (EKS, etc.)
  | 'config-only'; // Has region/output but no credentials

export interface AwsProfile {
  name: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  output?: string;
  sourceProfile?: string;
  roleArn?: string;
  // SSO fields
  ssoStartUrl?: string;
  ssoRegion?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
  ssoSession?: string;
  // Process credentials
  credentialProcess?: string;
  // Web identity
  webIdentityTokenFile?: string;
  // Credential source (for role assumption in EC2/ECS)
  credentialSource?: string;
  // Detected profile type for UI
  profileType: ProfileType;
  // Whether this profile can potentially provide credentials (via SDK)
  hasCredentials: boolean;
}

export interface ParsedCredentials {
  profiles: AwsProfile[];
  defaultRegion?: string;
}

/**
 * Parses an INI-style config file (like ~/.aws/credentials or ~/.aws/config)
 * Returns a map of section names to key-value pairs
 */
export function parseIniFile(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = '';

  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    // Check for section header [section-name]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map());
      }
      continue;
    }

    // Parse key = value pairs
    const keyValueMatch = line.match(/^([^=]+)=(.*)$/);
    if (keyValueMatch && currentSection) {
      const key = keyValueMatch[1].trim();
      const value = keyValueMatch[2].trim();
      sections.get(currentSection)?.set(key, value);
    }
  }

  return sections;
}

/**
 * Gets the path to the AWS credentials file
 */
export function getCredentialsPath(): string {
  const envPath = process.env.AWS_SHARED_CREDENTIALS_FILE;
  if (envPath) {
    return envPath;
  }
  return path.join(os.homedir(), '.aws', 'credentials');
}

/**
 * Gets the path to the AWS config file
 */
export function getConfigPath(): string {
  const envPath = process.env.AWS_CONFIG_FILE;
  if (envPath) {
    return envPath;
  }
  return path.join(os.homedir(), '.aws', 'config');
}

/**
 * Reads and parses the AWS credentials file
 */
export function readCredentialsFile(filePath?: string): Map<string, Map<string, string>> {
  const credPath = filePath ?? getCredentialsPath();

  try {
    const content = fs.readFileSync(credPath, 'utf-8');
    return parseIniFile(content);
  } catch (error) {
    // File doesn't exist or can't be read - return empty map
    return new Map();
  }
}

/**
 * Reads and parses the AWS config file
 * Note: Config file uses [profile name] format except for [default]
 */
export function readConfigFile(filePath?: string): Map<string, Map<string, string>> {
  const configPath = filePath ?? getConfigPath();

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const rawSections = parseIniFile(content);

    // Normalize section names - config file uses "profile xyz" format
    const normalizedSections = new Map<string, Map<string, string>>();

    for (const [sectionName, values] of rawSections) {
      // Config file uses [profile foo] for non-default profiles
      const normalizedName = sectionName.startsWith('profile ')
        ? sectionName.substring(8)
        : sectionName;
      normalizedSections.set(normalizedName, values);
    }

    return normalizedSections;
  } catch (error) {
    // File doesn't exist or can't be read - return empty map
    return new Map();
  }
}

/**
 * Helper to get a value from either credentials or config data
 * AWS CLI allows many settings in either file, so we check both
 */
function getFromEither(
  credData: Map<string, string> | undefined,
  configData: Map<string, string> | undefined,
  key: string
): string | undefined {
  // Config takes precedence over credentials for non-credential settings
  return configData?.get(key) ?? credData?.get(key);
}

/**
 * Detects the profile type based on configuration
 * Note: AWS CLI allows role_arn, source_profile, etc. in either credentials or config file
 */
function detectProfileType(
  credData: Map<string, string> | undefined,
  configData: Map<string, string> | undefined
): ProfileType {
  // Check for static credentials first
  if (credData?.get('aws_access_key_id') && credData?.get('aws_secret_access_key')) {
    return 'static';
  }

  // SSO profile detection (check both files)
  const ssoStartUrl = getFromEither(credData, configData, 'sso_start_url');
  const ssoSession = getFromEither(credData, configData, 'sso_session');
  const ssoAccountId = getFromEither(credData, configData, 'sso_account_id');
  const ssoRoleName = getFromEither(credData, configData, 'sso_role_name');
  if (ssoStartUrl || ssoSession || ssoAccountId || ssoRoleName) {
    return 'sso';
  }

  // Web identity (check both files)
  if (getFromEither(credData, configData, 'web_identity_token_file')) {
    return 'web-identity';
  }

  // Process credentials (check both files)
  if (getFromEither(credData, configData, 'credential_process')) {
    return 'process';
  }

  // Role assumption (check both files - AWS CLI allows role_arn in credentials file)
  if (getFromEither(credData, configData, 'role_arn')) {
    return 'role';
  }

  return 'config-only';
}

/**
 * Determines if a profile can potentially provide credentials
 * This uses heuristics - actual validation happens when credentials are used
 * Note: AWS CLI allows many settings in either credentials or config file
 */
function canProvideCredentials(
  profileType: ProfileType,
  credData: Map<string, string> | undefined,
  configData: Map<string, string> | undefined,
  credentials: Map<string, Map<string, string>>
): boolean {
  switch (profileType) {
    case 'static':
      return true;

    case 'sso':
      // SSO profiles are valid if they have the required SSO fields
      // AWS SDK will handle the SSO login flow
      const ssoStartUrl = getFromEither(credData, configData, 'sso_start_url');
      const ssoSession = getFromEither(credData, configData, 'sso_session');
      const ssoAccountId = getFromEither(credData, configData, 'sso_account_id');
      const ssoRoleName = getFromEither(credData, configData, 'sso_role_name');
      return !!(ssoStartUrl || ssoSession) && !!(ssoAccountId && ssoRoleName);

    case 'web-identity':
      // Web identity needs token file and role (check both files)
      const tokenFile = getFromEither(credData, configData, 'web_identity_token_file');
      const roleArnWeb = getFromEither(credData, configData, 'role_arn');
      return !!(tokenFile && roleArnWeb);

    case 'process':
      // Process credentials just need the command (check both files)
      return !!getFromEither(credData, configData, 'credential_process');

    case 'role':
      // Role assumption needs either source_profile with creds, or credential_source for EC2/ECS
      // AWS CLI allows these settings in either credentials or config file
      const sourceProfile = getFromEither(credData, configData, 'source_profile');
      const credentialSource = getFromEither(credData, configData, 'credential_source');

      if (credentialSource) {
        // EC2InstanceMetadata, Environment, EcsContainer are valid sources
        return ['Environment', 'Ec2InstanceMetadata', 'EcsContainer'].includes(credentialSource);
      }

      if (sourceProfile) {
        // Check if source profile has credentials
        const sourceCreds = credentials.get(sourceProfile);
        return !!(sourceCreds?.get('aws_access_key_id') && sourceCreds?.get('aws_secret_access_key'));
      }

      return false;

    case 'config-only':
      return false;
  }
}

// Test mode flag - when using custom endpoint (LocalStack), adds a mock "test" profile
// Only trigger on AWS_ENDPOINT_URL, not NODE_ENV, to avoid affecting unit tests
const isTestMode = !!process.env.AWS_ENDPOINT_URL;

/**
 * Creates a mock test profile for LocalStack/testing
 */
function createTestProfile(): AwsProfile {
  return {
    name: 'test',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    profileType: 'static',
    hasCredentials: true,
  };
}

/**
 * Merges credentials and config to build a complete list of profiles
 */
export function loadAwsProfiles(
  credentialsPath?: string,
  configPath?: string
): ParsedCredentials {
  const credentials = readCredentialsFile(credentialsPath);
  const config = readConfigFile(configPath);

  // Collect all unique profile names from both files
  const allProfileNames = new Set<string>();
  for (const name of credentials.keys()) {
    allProfileNames.add(name);
  }
  for (const name of config.keys()) {
    allProfileNames.add(name);
  }

  const profiles: AwsProfile[] = [];

  for (const name of allProfileNames) {
    const credData = credentials.get(name);
    const configData = config.get(name);

    // Detect profile type
    const profileType = detectProfileType(credData, configData);

    const profile: AwsProfile = {
      name,
      profileType,
      hasCredentials: canProvideCredentials(profileType, credData, configData, credentials),
    };

    // Get credentials (for static profiles)
    if (credData) {
      const accessKeyId = credData.get('aws_access_key_id');
      const secretAccessKey = credData.get('aws_secret_access_key');

      if (accessKeyId && secretAccessKey) {
        profile.accessKeyId = accessKeyId;
        profile.secretAccessKey = secretAccessKey;
        profile.sessionToken = credData.get('aws_session_token');
      }
    }

    // Get config settings (check both files - AWS CLI allows many settings in either)
    // Config file takes precedence for non-credential settings
    profile.region = getFromEither(credData, configData, 'region');
    profile.output = getFromEither(credData, configData, 'output');
    profile.sourceProfile = getFromEither(credData, configData, 'source_profile');
    profile.roleArn = getFromEither(credData, configData, 'role_arn');
    profile.credentialSource = getFromEither(credData, configData, 'credential_source');

    // SSO fields (check both files)
    profile.ssoStartUrl = getFromEither(credData, configData, 'sso_start_url');
    profile.ssoRegion = getFromEither(credData, configData, 'sso_region');
    profile.ssoAccountId = getFromEither(credData, configData, 'sso_account_id');
    profile.ssoRoleName = getFromEither(credData, configData, 'sso_role_name');
    profile.ssoSession = getFromEither(credData, configData, 'sso_session');

    // Process credentials (check both files)
    profile.credentialProcess = getFromEither(credData, configData, 'credential_process');

    // Web identity (check both files)
    profile.webIdentityTokenFile = getFromEither(credData, configData, 'web_identity_token_file');

    profiles.push(profile);
  }

  // Add test profile in test mode (for LocalStack)
  if (isTestMode) {
    // Only add if not already present
    if (!profiles.some(p => p.name === 'test')) {
      profiles.unshift(createTestProfile());
    }
  }

  // Sort profiles: 'test' first in test mode, then 'default', then alphabetically
  profiles.sort((a, b) => {
    if (isTestMode && a.name === 'test') return -1;
    if (isTestMode && b.name === 'test') return 1;
    if (a.name === 'default') return -1;
    if (b.name === 'default') return 1;
    return a.name.localeCompare(b.name);
  });

  // Get default region from default profile or first profile with region
  let defaultRegion: string | undefined;
  const defaultProfile = profiles.find(p => p.name === 'default');
  if (defaultProfile?.region) {
    defaultRegion = defaultProfile.region;
  } else {
    const profileWithRegion = profiles.find(p => p.region);
    defaultRegion = profileWithRegion?.region;
  }

  return {
    profiles,
    defaultRegion,
  };
}

/**
 * Gets a specific profile by name
 */
export function getProfile(
  profileName: string,
  credentialsPath?: string,
  configPath?: string
): AwsProfile | undefined {
  const { profiles } = loadAwsProfiles(credentialsPath, configPath);
  return profiles.find(p => p.name === profileName);
}

/**
 * Validates that a profile has usable credentials
 */
export function validateProfile(profile: AwsProfile): { valid: boolean; reason?: string } {
  if (profile.hasCredentials) {
    return { valid: true };
  }

  // Provide specific reasons for invalid profiles
  switch (profile.profileType) {
    case 'config-only':
      return { valid: false, reason: 'Profile has no credentials configured' };

    case 'role':
      if (!profile.sourceProfile && !profile.credentialSource) {
        return { valid: false, reason: 'Role profile requires source_profile or credential_source' };
      }
      return { valid: false, reason: 'Source profile has no valid credentials' };

    case 'sso':
      if (!profile.ssoAccountId || !profile.ssoRoleName) {
        return { valid: false, reason: 'SSO profile requires sso_account_id and sso_role_name' };
      }
      return { valid: false, reason: 'SSO profile missing required configuration' };

    case 'process':
      return { valid: false, reason: 'Process credentials command not configured' };

    case 'web-identity':
      return { valid: false, reason: 'Web identity profile missing token file or role ARN' };

    default:
      return { valid: false, reason: 'Profile has no credentials configured' };
  }
}

/**
 * Gets a human-readable description of the profile type
 */
export function getProfileTypeDescription(profileType: ProfileType): string {
  switch (profileType) {
    case 'static':
      return 'Access Key';
    case 'role':
      return 'IAM Role';
    case 'sso':
      return 'AWS SSO';
    case 'process':
      return 'External Process';
    case 'web-identity':
      return 'Web Identity';
    case 'config-only':
      return 'Config Only';
  }
}
