import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseIniFile,
  validateProfile,
  loadAwsProfiles,
  getCredentialsPath,
  getConfigPath,
  type AwsProfile,
} from '../main/services/awsCredentials';
import * as os from 'os';

// Mock os module for path tests
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/home/testuser'),
  },
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('awsCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (os.homedir as Mock).mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.AWS_SHARED_CREDENTIALS_FILE;
    delete process.env.AWS_CONFIG_FILE;
  });

  describe('parseIniFile', () => {
    it('should parse a simple INI file with one section', () => {
      const content = `[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`;

      const result = parseIniFile(content);

      expect(result.size).toBe(1);
      expect(result.has('default')).toBe(true);
      expect(result.get('default')?.get('aws_access_key_id')).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.get('default')?.get('aws_secret_access_key')).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('should parse multiple sections', () => {
      const content = `[default]
aws_access_key_id = KEY1
aws_secret_access_key = SECRET1

[production]
aws_access_key_id = KEY2
aws_secret_access_key = SECRET2`;

      const result = parseIniFile(content);

      expect(result.size).toBe(2);
      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY1');
      expect(result.get('production')?.get('aws_access_key_id')).toBe('KEY2');
    });

    it('should ignore comments starting with #', () => {
      const content = `# This is a comment
[default]
# Another comment
aws_access_key_id = KEY1`;

      const result = parseIniFile(content);

      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY1');
      expect(result.get('default')?.size).toBe(1);
    });

    it('should ignore comments starting with ;', () => {
      const content = `; This is a comment
[default]
aws_access_key_id = KEY1`;

      const result = parseIniFile(content);

      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY1');
    });

    it('should handle empty lines', () => {
      const content = `[default]

aws_access_key_id = KEY1

aws_secret_access_key = SECRET1`;

      const result = parseIniFile(content);

      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY1');
      expect(result.get('default')?.get('aws_secret_access_key')).toBe('SECRET1');
    });

    it('should handle values with equals signs', () => {
      const content = `[default]
aws_access_key_id = KEY=WITH=EQUALS`;

      const result = parseIniFile(content);

      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY=WITH=EQUALS');
    });

    it('should trim whitespace from keys and values', () => {
      const content = `[default]
  aws_access_key_id   =   KEY1  `;

      const result = parseIniFile(content);

      expect(result.get('default')?.get('aws_access_key_id')).toBe('KEY1');
    });

    it('should return empty map for empty content', () => {
      const result = parseIniFile('');
      expect(result.size).toBe(0);
    });

    it('should handle profile sections with spaces', () => {
      const content = `[profile dev-team]
region = us-west-2`;

      const result = parseIniFile(content);

      expect(result.has('profile dev-team')).toBe(true);
      expect(result.get('profile dev-team')?.get('region')).toBe('us-west-2');
    });

    it('should parse session tokens', () => {
      const content = `[temp]
aws_access_key_id = ASIATEMP
aws_secret_access_key = SECRET
aws_session_token = TOKEN123`;

      const result = parseIniFile(content);

      expect(result.get('temp')?.get('aws_session_token')).toBe('TOKEN123');
    });

    it('should parse region and role_arn config', () => {
      const content = `[profile assume-role]
role_arn = arn:aws:iam::123456789012:role/MyRole
source_profile = base
region = us-east-1`;

      const result = parseIniFile(content);

      const section = result.get('profile assume-role');
      expect(section?.get('role_arn')).toBe('arn:aws:iam::123456789012:role/MyRole');
      expect(section?.get('source_profile')).toBe('base');
      expect(section?.get('region')).toBe('us-east-1');
    });
  });

  describe('getCredentialsPath', () => {
    it('should return default path when env var not set', () => {
      const result = getCredentialsPath();
      expect(result).toBe('/home/testuser/.aws/credentials');
    });

    it('should return env var path when set', () => {
      process.env.AWS_SHARED_CREDENTIALS_FILE = '/custom/path/credentials';
      const result = getCredentialsPath();
      expect(result).toBe('/custom/path/credentials');
    });
  });

  describe('getConfigPath', () => {
    it('should return default path when env var not set', () => {
      const result = getConfigPath();
      expect(result).toBe('/home/testuser/.aws/config');
    });

    it('should return env var path when set', () => {
      process.env.AWS_CONFIG_FILE = '/custom/path/config';
      const result = getConfigPath();
      expect(result).toBe('/custom/path/config');
    });
  });

  describe('validateProfile', () => {
    it('should return valid for profile with credentials', () => {
      const profile: AwsProfile = {
        name: 'test',
        accessKeyId: 'KEY',
        secretAccessKey: 'SECRET',
        hasCredentials: true,
        profileType: 'static',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return invalid for profile without credentials', () => {
      const profile: AwsProfile = {
        name: 'test',
        hasCredentials: false,
        profileType: 'config-only',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Profile has no credentials configured');
    });

    it('should return invalid for role assumption without source profile', () => {
      const profile: AwsProfile = {
        name: 'test',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        hasCredentials: false,
        profileType: 'role',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Role profile requires source_profile or credential_source');
    });

    it('should return valid for profile with session token', () => {
      const profile: AwsProfile = {
        name: 'temp',
        accessKeyId: 'ASIA...',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
        hasCredentials: true,
        profileType: 'static',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(true);
    });

    it('should return valid for role assumption with source profile', () => {
      const profile: AwsProfile = {
        name: 'assume-role',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        sourceProfile: 'base',
        hasCredentials: true,
        profileType: 'role',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(true);
    });

    it('should return invalid for SSO profile missing required fields', () => {
      const profile: AwsProfile = {
        name: 'sso-partial',
        ssoStartUrl: 'https://my-sso.awsapps.com/start',
        hasCredentials: false,
        profileType: 'sso',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('SSO profile requires sso_account_id and sso_role_name');
    });

    it('should return valid for SSO profile with required fields', () => {
      const profile: AwsProfile = {
        name: 'sso-complete',
        ssoStartUrl: 'https://my-sso.awsapps.com/start',
        ssoAccountId: '123456789012',
        ssoRoleName: 'AdminRole',
        hasCredentials: true,
        profileType: 'sso',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(true);
    });

    it('should return valid for role with credential_source', () => {
      const profile: AwsProfile = {
        name: 'ec2-role',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        credentialSource: 'Ec2InstanceMetadata',
        hasCredentials: true,
        profileType: 'role',
      };

      const result = validateProfile(profile);

      expect(result.valid).toBe(true);
    });
  });

  describe('loadAwsProfiles - credentials file role profiles', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = '/tmp/aws-test-' + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should detect role profile with source_profile in credentials file', () => {
      // User scenario: role_arn and source_profile in credentials file
      const credentials = `[dev-usr]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[dev]
source_profile = dev-usr
role_arn = arn:aws:iam::123456789012:role/MyRole
`;
      fs.writeFileSync(path.join(tmpDir, 'credentials'), credentials);
      fs.writeFileSync(path.join(tmpDir, 'config'), '');

      const result = loadAwsProfiles(
        path.join(tmpDir, 'credentials'),
        path.join(tmpDir, 'config')
      );

      const devProfile = result.profiles.find(p => p.name === 'dev');
      expect(devProfile).toBeDefined();
      expect(devProfile?.profileType).toBe('role');
      expect(devProfile?.hasCredentials).toBe(true);
      expect(devProfile?.sourceProfile).toBe('dev-usr');
      expect(devProfile?.roleArn).toBe('arn:aws:iam::123456789012:role/MyRole');

      const validation = validateProfile(devProfile!);
      expect(validation.valid).toBe(true);
    });

    it('should merge role_arn from credentials file with region from config file', () => {
      const credentials = `[dev-usr]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[dev]
source_profile = dev-usr
role_arn = arn:aws:iam::123456789012:role/MyRole
`;
      const config = `[profile dev]
region = eu-west-1
`;
      fs.writeFileSync(path.join(tmpDir, 'credentials'), credentials);
      fs.writeFileSync(path.join(tmpDir, 'config'), config);

      const result = loadAwsProfiles(
        path.join(tmpDir, 'credentials'),
        path.join(tmpDir, 'config')
      );

      const devProfile = result.profiles.find(p => p.name === 'dev');
      expect(devProfile?.profileType).toBe('role');
      expect(devProfile?.hasCredentials).toBe(true);
      expect(devProfile?.region).toBe('eu-west-1');
      expect(devProfile?.roleArn).toBe('arn:aws:iam::123456789012:role/MyRole');
    });

    it('should mark role profile as invalid when source_profile has no credentials', () => {
      const credentials = `[dev]
source_profile = nonexistent
role_arn = arn:aws:iam::123456789012:role/MyRole
`;
      fs.writeFileSync(path.join(tmpDir, 'credentials'), credentials);
      fs.writeFileSync(path.join(tmpDir, 'config'), '');

      const result = loadAwsProfiles(
        path.join(tmpDir, 'credentials'),
        path.join(tmpDir, 'config')
      );

      const devProfile = result.profiles.find(p => p.name === 'dev');
      expect(devProfile?.profileType).toBe('role');
      expect(devProfile?.hasCredentials).toBe(false);

      const validation = validateProfile(devProfile!);
      expect(validation.valid).toBe(false);
    });

    it('should detect role profile with credential_source in credentials file', () => {
      const credentials = `[ec2-role]
role_arn = arn:aws:iam::123456789012:role/MyRole
credential_source = Ec2InstanceMetadata
`;
      fs.writeFileSync(path.join(tmpDir, 'credentials'), credentials);
      fs.writeFileSync(path.join(tmpDir, 'config'), '');

      const result = loadAwsProfiles(
        path.join(tmpDir, 'credentials'),
        path.join(tmpDir, 'config')
      );

      const ec2Profile = result.profiles.find(p => p.name === 'ec2-role');
      expect(ec2Profile?.profileType).toBe('role');
      expect(ec2Profile?.hasCredentials).toBe(true);
      expect(ec2Profile?.credentialSource).toBe('Ec2InstanceMetadata');
    });

    it('should prefer config file values over credentials file for same key', () => {
      const credentials = `[dev]
role_arn = arn:aws:iam::123456789012:role/OldRole
source_profile = old-source
`;
      const config = `[profile dev]
role_arn = arn:aws:iam::123456789012:role/NewRole
source_profile = new-source
`;
      fs.writeFileSync(path.join(tmpDir, 'credentials'), credentials);
      fs.writeFileSync(path.join(tmpDir, 'config'), config);

      const result = loadAwsProfiles(
        path.join(tmpDir, 'credentials'),
        path.join(tmpDir, 'config')
      );

      const devProfile = result.profiles.find(p => p.name === 'dev');
      // Config file takes precedence
      expect(devProfile?.roleArn).toBe('arn:aws:iam::123456789012:role/NewRole');
      expect(devProfile?.sourceProfile).toBe('new-source');
    });
  });
});
