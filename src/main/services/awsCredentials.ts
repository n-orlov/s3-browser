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
 * Detects the profile type based on configuration
 */
function detectProfileType(
  credData: Map<string, string> | undefined,
  configData: Map<string, string> | undefined
): ProfileType {
  // Check for static credentials first
  if (credData?.get('aws_access_key_id') && credData?.get('aws_secret_access_key')) {
    return 'static';
  }

  if (configData) {
    // SSO profile detection
    if (configData.get('sso_start_url') || configData.get('sso_session') ||
        configData.get('sso_account_id') || configData.get('sso_role_name')) {
      return 'sso';
    }

    // Web identity
    if (configData.get('web_identity_token_file')) {
      return 'web-identity';
    }

    // Process credentials
    if (configData.get('credential_process')) {
      return 'process';
    }

    // Role assumption (with various credential sources)
    if (configData.get('role_arn')) {
      return 'role';
    }
  }

  return 'config-only';
}

/**
 * Determines if a profile can potentially provide credentials
 * This uses heuristics - actual validation happens when credentials are used
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
      return !!(
        configData?.get('sso_start_url') || configData?.get('sso_session')
      ) && !!(
        configData?.get('sso_account_id') && configData?.get('sso_role_name')
      );

    case 'web-identity':
      // Web identity needs token file and role
      return !!(configData?.get('web_identity_token_file') && configData?.get('role_arn'));

    case 'process':
      // Process credentials just need the command
      return !!configData?.get('credential_process');

    case 'role':
      // Role assumption needs either source_profile with creds, or credential_source for EC2/ECS
      const sourceProfile = configData?.get('source_profile');
      const credentialSource = configData?.get('credential_source');

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

    // Get config settings
    if (configData) {
      profile.region = configData.get('region');
      profile.output = configData.get('output');
      profile.sourceProfile = configData.get('source_profile');
      profile.roleArn = configData.get('role_arn');
      profile.credentialSource = configData.get('credential_source');

      // SSO fields
      profile.ssoStartUrl = configData.get('sso_start_url');
      profile.ssoRegion = configData.get('sso_region');
      profile.ssoAccountId = configData.get('sso_account_id');
      profile.ssoRoleName = configData.get('sso_role_name');
      profile.ssoSession = configData.get('sso_session');

      // Process credentials
      profile.credentialProcess = configData.get('credential_process');

      // Web identity
      profile.webIdentityTokenFile = configData.get('web_identity_token_file');
    }

    profiles.push(profile);
  }

  // Sort profiles: 'default' first, then alphabetically
  profiles.sort((a, b) => {
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
