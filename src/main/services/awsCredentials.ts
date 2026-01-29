import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AwsProfile {
  name: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  output?: string;
  sourceProfile?: string;
  roleArn?: string;
  // Indicates if this profile has credentials or is config-only
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

    const profile: AwsProfile = {
      name,
      hasCredentials: false,
    };

    // Get credentials
    if (credData) {
      const accessKeyId = credData.get('aws_access_key_id');
      const secretAccessKey = credData.get('aws_secret_access_key');

      if (accessKeyId && secretAccessKey) {
        profile.accessKeyId = accessKeyId;
        profile.secretAccessKey = secretAccessKey;
        profile.sessionToken = credData.get('aws_session_token');
        profile.hasCredentials = true;
      }
    }

    // Get config settings
    if (configData) {
      profile.region = configData.get('region');
      profile.output = configData.get('output');
      profile.sourceProfile = configData.get('source_profile');
      profile.roleArn = configData.get('role_arn');

      // If this profile assumes a role from another profile, it can have credentials
      // if the source profile has them
      if (profile.sourceProfile && !profile.hasCredentials) {
        const sourceCredData = credentials.get(profile.sourceProfile);
        if (sourceCredData?.get('aws_access_key_id') && sourceCredData?.get('aws_secret_access_key')) {
          profile.hasCredentials = true;
        }
      }
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
  if (!profile.hasCredentials) {
    if (profile.roleArn && !profile.sourceProfile) {
      return { valid: false, reason: 'Profile requires source_profile for role assumption' };
    }
    return { valid: false, reason: 'Profile has no credentials configured' };
  }
  return { valid: true };
}
