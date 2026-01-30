//! AWS credential and profile management
//!
//! This module handles AWS profile loading from ~/.aws/config and ~/.aws/credentials.
//! It supports all standard AWS credential mechanisms:
//! - Static credentials (access_key_id, secret_access_key)
//! - Assume-role profiles with source_profile
//! - SSO profiles
//! - Environment variables (handled by AWS SDK)
//! - EC2/ECS instance roles (handled by AWS SDK)

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Type of AWS profile based on its configuration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProfileType {
    /// Profile with static credentials (access_key_id, secret_access_key)
    StaticCredentials,
    /// Profile that assumes a role from another profile
    AssumeRole,
    /// Profile using AWS SSO/IAM Identity Center
    Sso,
    /// Profile relying on environment variables
    Environment,
    /// Default profile (may use any credential source)
    Default,
    /// Unknown or incomplete configuration
    Unknown,
}

impl ProfileType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProfileType::StaticCredentials => "Static Credentials",
            ProfileType::AssumeRole => "Assume Role",
            ProfileType::Sso => "SSO",
            ProfileType::Environment => "Environment",
            ProfileType::Default => "Default",
            ProfileType::Unknown => "Unknown",
        }
    }
}

/// Represents an AWS profile configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsProfile {
    pub name: String,
    pub profile_type: ProfileType,
    pub region: Option<String>,
    pub source_profile: Option<String>,
    pub role_arn: Option<String>,
    pub sso_start_url: Option<String>,
    pub sso_region: Option<String>,
    pub sso_account_id: Option<String>,
    pub sso_role_name: Option<String>,
    pub sso_session: Option<String>,
    pub external_id: Option<String>,
    pub mfa_serial: Option<String>,
    pub role_session_name: Option<String>,
    pub credential_source: Option<String>,
    pub has_static_credentials: bool,
    pub is_valid: bool,
    pub error_message: Option<String>,
}

impl Default for AwsProfile {
    fn default() -> Self {
        Self {
            name: String::new(),
            profile_type: ProfileType::Unknown,
            region: None,
            source_profile: None,
            role_arn: None,
            sso_start_url: None,
            sso_region: None,
            sso_account_id: None,
            sso_role_name: None,
            sso_session: None,
            external_id: None,
            mfa_serial: None,
            role_session_name: None,
            credential_source: None,
            has_static_credentials: false,
            is_valid: true,
            error_message: None,
        }
    }
}

/// Manages AWS profiles from ~/.aws/config and ~/.aws/credentials
pub struct ProfileManager {
    profiles: HashMap<String, AwsProfile>,
    current_profile: Option<String>,
}

impl ProfileManager {
    /// Create a new ProfileManager and load profiles
    pub fn new() -> Result<Self> {
        let mut manager = Self {
            profiles: HashMap::new(),
            current_profile: None,
        };
        manager.load_profiles()?;
        manager.validate_all_profiles();
        Ok(manager)
    }

    /// Get the AWS config directory path
    fn aws_config_dir() -> PathBuf {
        dirs::home_dir()
            .map(|h| h.join(".aws"))
            .unwrap_or_else(|| PathBuf::from(".aws"))
    }

    /// Load profiles from AWS config files
    pub fn load_profiles(&mut self) -> Result<()> {
        let config_path = Self::aws_config_dir().join("config");
        let credentials_path = Self::aws_config_dir().join("credentials");

        // Always add default profile
        self.profiles.insert(
            "default".to_string(),
            AwsProfile {
                name: "default".to_string(),
                profile_type: ProfileType::Default,
                ..Default::default()
            },
        );

        // Parse credentials file first (to track which profiles have static creds)
        if credentials_path.exists() {
            self.parse_credentials_file(&credentials_path)
                .context("Failed to parse AWS credentials file")?;
        }

        // Parse config file if it exists
        if config_path.exists() {
            self.parse_config_file(&config_path)
                .context("Failed to parse AWS config file")?;
        }

        Ok(())
    }

    /// Parse the AWS config file
    fn parse_config_file(&mut self, path: &PathBuf) -> Result<()> {
        let content = std::fs::read_to_string(path)?;
        let mut current_profile: Option<String> = None;

        for line in content.lines() {
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            // Check for profile header
            if line.starts_with('[') && line.ends_with(']') {
                let section = &line[1..line.len() - 1];
                current_profile = if section == "default" {
                    Some("default".to_string())
                } else if let Some(name) = section.strip_prefix("profile ") {
                    Some(name.trim().to_string())
                } else if section.starts_with("sso-session ") {
                    // Skip sso-session sections for now (handled separately)
                    None
                } else {
                    None
                };

                if let Some(ref name) = current_profile {
                    self.profiles.entry(name.clone()).or_insert_with(|| AwsProfile {
                        name: name.clone(),
                        ..Default::default()
                    });
                }
                continue;
            }

            // Parse key-value pairs
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();

                if let Some(ref profile_name) = current_profile {
                    if let Some(profile) = self.profiles.get_mut(profile_name) {
                        match key {
                            "region" => profile.region = Some(value.to_string()),
                            "source_profile" => profile.source_profile = Some(value.to_string()),
                            "role_arn" => profile.role_arn = Some(value.to_string()),
                            "sso_start_url" => profile.sso_start_url = Some(value.to_string()),
                            "sso_region" => profile.sso_region = Some(value.to_string()),
                            "sso_account_id" => profile.sso_account_id = Some(value.to_string()),
                            "sso_role_name" => profile.sso_role_name = Some(value.to_string()),
                            "sso_session" => profile.sso_session = Some(value.to_string()),
                            "external_id" => profile.external_id = Some(value.to_string()),
                            "mfa_serial" => profile.mfa_serial = Some(value.to_string()),
                            "role_session_name" => profile.role_session_name = Some(value.to_string()),
                            "credential_source" => profile.credential_source = Some(value.to_string()),
                            _ => {}
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Parse the AWS credentials file
    fn parse_credentials_file(&mut self, path: &PathBuf) -> Result<()> {
        let content = std::fs::read_to_string(path)?;
        let mut current_profile: Option<String> = None;
        let mut has_access_key = false;
        let mut has_secret_key = false;

        for line in content.lines() {
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            if line.starts_with('[') && line.ends_with(']') {
                // Finalize previous profile
                if let Some(ref name) = current_profile {
                    if has_access_key && has_secret_key {
                        if let Some(profile) = self.profiles.get_mut(name) {
                            profile.has_static_credentials = true;
                        }
                    }
                }

                let name = &line[1..line.len() - 1];
                current_profile = Some(name.trim().to_string());
                has_access_key = false;
                has_secret_key = false;

                self.profiles.entry(name.to_string()).or_insert_with(|| AwsProfile {
                    name: name.to_string(),
                    ..Default::default()
                });
            } else if let Some((key, _value)) = line.split_once('=') {
                let key = key.trim();
                match key {
                    "aws_access_key_id" => has_access_key = true,
                    "aws_secret_access_key" => has_secret_key = true,
                    _ => {}
                }
            }
        }

        // Finalize last profile
        if let Some(ref name) = current_profile {
            if has_access_key && has_secret_key {
                if let Some(profile) = self.profiles.get_mut(name) {
                    profile.has_static_credentials = true;
                }
            }
        }

        Ok(())
    }

    /// Get all profile names
    pub fn profile_names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.profiles.keys().cloned().collect();
        names.sort();
        // Move "default" to the front if it exists
        if let Some(pos) = names.iter().position(|n| n == "default") {
            names.remove(pos);
            names.insert(0, "default".to_string());
        }
        names
    }

    /// Get a profile by name
    pub fn get_profile(&self, name: &str) -> Option<&AwsProfile> {
        self.profiles.get(name)
    }

    /// Set the current active profile
    pub fn set_current_profile(&mut self, name: &str) -> Result<()> {
        if self.profiles.contains_key(name) {
            self.current_profile = Some(name.to_string());
            Ok(())
        } else {
            anyhow::bail!("Profile '{}' not found", name)
        }
    }

    /// Get the current active profile name
    pub fn current_profile(&self) -> Option<&str> {
        self.current_profile.as_deref()
    }

    /// Get the current active profile
    pub fn current_profile_data(&self) -> Option<&AwsProfile> {
        self.current_profile.as_ref().and_then(|name| self.profiles.get(name))
    }

    /// Get all profiles
    pub fn profiles(&self) -> &HashMap<String, AwsProfile> {
        &self.profiles
    }

    /// Validate all profiles and determine their types
    fn validate_all_profiles(&mut self) {
        // First pass: determine profile types
        let profile_names: Vec<String> = self.profiles.keys().cloned().collect();
        for name in profile_names {
            let profile_type = self.determine_profile_type(&name);
            if let Some(profile) = self.profiles.get_mut(&name) {
                profile.profile_type = profile_type;
            }
        }

        // Second pass: validate each profile
        let profile_names: Vec<String> = self.profiles.keys().cloned().collect();
        for name in profile_names {
            let validation = self.validate_profile(&name);
            if let Some(profile) = self.profiles.get_mut(&name) {
                profile.is_valid = validation.0;
                profile.error_message = validation.1;
            }
        }
    }

    /// Determine the type of profile based on its configuration
    fn determine_profile_type(&self, name: &str) -> ProfileType {
        let profile = match self.profiles.get(name) {
            Some(p) => p,
            None => return ProfileType::Unknown,
        };

        // Check for SSO profile
        if profile.sso_start_url.is_some()
            || profile.sso_session.is_some()
            || (profile.sso_account_id.is_some() && profile.sso_role_name.is_some())
        {
            return ProfileType::Sso;
        }

        // Check for assume-role profile
        if profile.role_arn.is_some() {
            return ProfileType::AssumeRole;
        }

        // Check for static credentials
        if profile.has_static_credentials {
            return ProfileType::StaticCredentials;
        }

        // Check for credential_source (EC2/ECS roles)
        if profile.credential_source.is_some() {
            return ProfileType::Environment;
        }

        // Default profile is special
        if name == "default" {
            return ProfileType::Default;
        }

        ProfileType::Unknown
    }

    /// Validate a profile and return (is_valid, error_message)
    fn validate_profile(&self, name: &str) -> (bool, Option<String>) {
        let profile = match self.profiles.get(name) {
            Some(p) => p,
            None => return (false, Some("Profile not found".to_string())),
        };

        match profile.profile_type {
            ProfileType::Sso => self.validate_sso_profile(profile),
            ProfileType::AssumeRole => self.validate_assume_role_profile(profile),
            ProfileType::StaticCredentials => (true, None),
            ProfileType::Environment => (true, None),
            ProfileType::Default => (true, None),
            ProfileType::Unknown => {
                // Unknown profiles might still work via environment or instance roles
                (true, Some("Profile type could not be determined - may use environment or instance credentials".to_string()))
            }
        }
    }

    /// Validate SSO profile has all required fields
    fn validate_sso_profile(&self, profile: &AwsProfile) -> (bool, Option<String>) {
        // Modern SSO can use either sso_session or direct SSO fields
        if profile.sso_session.is_some() {
            // Using sso-session reference - account_id and role_name required
            if profile.sso_account_id.is_none() {
                return (false, Some("SSO profile missing sso_account_id".to_string()));
            }
            if profile.sso_role_name.is_none() {
                return (false, Some("SSO profile missing sso_role_name".to_string()));
            }
            return (true, None);
        }

        // Legacy SSO without sso-session
        let mut missing = Vec::new();

        if profile.sso_start_url.is_none() {
            missing.push("sso_start_url");
        }
        if profile.sso_region.is_none() {
            missing.push("sso_region");
        }
        if profile.sso_account_id.is_none() {
            missing.push("sso_account_id");
        }
        if profile.sso_role_name.is_none() {
            missing.push("sso_role_name");
        }

        if missing.is_empty() {
            (true, None)
        } else {
            (false, Some(format!("SSO profile missing: {}", missing.join(", "))))
        }
    }

    /// Validate assume-role profile has source credentials
    fn validate_assume_role_profile(&self, profile: &AwsProfile) -> (bool, Option<String>) {
        // Must have role_arn (already checked in type determination)
        if profile.role_arn.is_none() {
            return (false, Some("Assume-role profile missing role_arn".to_string()));
        }

        // Must have source_profile OR credential_source
        if profile.source_profile.is_none() && profile.credential_source.is_none() {
            return (false, Some("Assume-role profile needs source_profile or credential_source".to_string()));
        }

        // If using source_profile, validate the chain
        if let Some(ref source) = profile.source_profile {
            match self.validate_assume_role_chain(&profile.name, source) {
                Ok(_) => (true, None),
                Err(e) => (false, Some(e)),
            }
        } else {
            // Using credential_source, which is valid
            (true, None)
        }
    }

    /// Validate the assume-role chain doesn't have cycles and ends at valid credentials
    fn validate_assume_role_chain(&self, start: &str, source: &str) -> std::result::Result<(), String> {
        let mut visited = vec![start.to_string()];
        let mut current = source.to_string();

        loop {
            // Check for cycle
            if visited.contains(&current) {
                return Err(format!(
                    "Circular dependency in assume-role chain: {} -> {}",
                    visited.join(" -> "),
                    current
                ));
            }

            // Check if source profile exists
            let profile = match self.profiles.get(&current) {
                Some(p) => p,
                None => return Err(format!("Source profile '{}' not found", current)),
            };

            // If this profile has static credentials, chain is valid
            if profile.has_static_credentials {
                return Ok(());
            }

            // If this is an SSO profile, chain is valid
            if profile.profile_type == ProfileType::Sso {
                return Ok(());
            }

            // If this profile has credential_source, chain is valid
            if profile.credential_source.is_some() {
                return Ok(());
            }

            // If this is default profile, chain is valid (may use env vars)
            if current == "default" {
                return Ok(());
            }

            // If this is another assume-role profile, continue chain
            if let Some(ref next_source) = profile.source_profile {
                visited.push(current.clone());
                current = next_source.clone();
            } else {
                // Profile has no credentials and no source - might use env vars
                return Ok(());
            }
        }
    }

    /// Reload profiles from disk
    pub fn reload(&mut self) -> Result<()> {
        self.profiles.clear();
        self.load_profiles()?;
        self.validate_all_profiles();
        Ok(())
    }

    /// Check if any profiles are available
    pub fn has_profiles(&self) -> bool {
        !self.profiles.is_empty()
    }

    /// Get the number of valid profiles
    pub fn valid_profile_count(&self) -> usize {
        self.profiles.values().filter(|p| p.is_valid).count()
    }

    /// Get only valid profiles
    pub fn valid_profiles(&self) -> Vec<&AwsProfile> {
        self.profiles.values().filter(|p| p.is_valid).collect()
    }

    /// Get only invalid profiles (useful for UI display)
    pub fn invalid_profiles(&self) -> Vec<&AwsProfile> {
        self.profiles.values().filter(|p| !p.is_valid).collect()
    }
}

// Use dirs crate for cross-platform home directory
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_manager() -> ProfileManager {
        ProfileManager {
            profiles: HashMap::new(),
            current_profile: None,
        }
    }

    fn create_profile(name: &str) -> AwsProfile {
        AwsProfile {
            name: name.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_profile_manager_new() {
        // This will try to load from real config files, but shouldn't fail
        let manager = ProfileManager::new();
        assert!(manager.is_ok());
    }

    #[test]
    fn test_profile_names_default_first() {
        let mut manager = create_test_manager();
        manager.profiles.insert("zebra".to_string(), create_profile("zebra"));
        manager.profiles.insert("default".to_string(), create_profile("default"));
        manager.profiles.insert("alpha".to_string(), create_profile("alpha"));

        let names = manager.profile_names();
        assert_eq!(names[0], "default");
        // Remaining should be sorted
        assert!(names[1..].windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn test_profile_type_detection_static_creds() {
        let mut manager = create_test_manager();
        let mut profile = create_profile("test-static");
        profile.has_static_credentials = true;
        manager.profiles.insert("test-static".to_string(), profile);

        let profile_type = manager.determine_profile_type("test-static");
        assert_eq!(profile_type, ProfileType::StaticCredentials);
    }

    #[test]
    fn test_profile_type_detection_sso() {
        let mut manager = create_test_manager();
        let mut profile = create_profile("test-sso");
        profile.sso_start_url = Some("https://my-sso.awsapps.com/start".to_string());
        profile.sso_region = Some("us-east-1".to_string());
        profile.sso_account_id = Some("123456789012".to_string());
        profile.sso_role_name = Some("ReadOnly".to_string());
        manager.profiles.insert("test-sso".to_string(), profile);

        let profile_type = manager.determine_profile_type("test-sso");
        assert_eq!(profile_type, ProfileType::Sso);
    }

    #[test]
    fn test_profile_type_detection_assume_role() {
        let mut manager = create_test_manager();
        let mut profile = create_profile("test-assume");
        profile.role_arn = Some("arn:aws:iam::123456789012:role/MyRole".to_string());
        profile.source_profile = Some("default".to_string());
        manager.profiles.insert("test-assume".to_string(), profile);

        let profile_type = manager.determine_profile_type("test-assume");
        assert_eq!(profile_type, ProfileType::AssumeRole);
    }

    #[test]
    fn test_sso_profile_validation_complete() {
        let mut profile = create_profile("valid-sso");
        profile.profile_type = ProfileType::Sso;
        profile.sso_start_url = Some("https://my-sso.awsapps.com/start".to_string());
        profile.sso_region = Some("us-east-1".to_string());
        profile.sso_account_id = Some("123456789012".to_string());
        profile.sso_role_name = Some("ReadOnly".to_string());

        let mut manager = create_test_manager();
        manager.profiles.insert("valid-sso".to_string(), profile);

        let (is_valid, error) = manager.validate_sso_profile(manager.profiles.get("valid-sso").unwrap());
        assert!(is_valid, "Expected valid SSO profile, got error: {:?}", error);
    }

    #[test]
    fn test_sso_profile_validation_missing_fields() {
        let mut profile = create_profile("incomplete-sso");
        profile.profile_type = ProfileType::Sso;
        profile.sso_start_url = Some("https://my-sso.awsapps.com/start".to_string());
        // Missing sso_region, sso_account_id, sso_role_name

        let mut manager = create_test_manager();
        manager.profiles.insert("incomplete-sso".to_string(), profile);

        let (is_valid, error) = manager.validate_sso_profile(manager.profiles.get("incomplete-sso").unwrap());
        assert!(!is_valid, "Expected invalid SSO profile");
        assert!(error.is_some());
        let error_msg = error.unwrap();
        assert!(error_msg.contains("sso_region"));
        assert!(error_msg.contains("sso_account_id"));
        assert!(error_msg.contains("sso_role_name"));
    }

    #[test]
    fn test_sso_profile_validation_with_session() {
        let mut profile = create_profile("session-sso");
        profile.profile_type = ProfileType::Sso;
        profile.sso_session = Some("my-sso-session".to_string());
        profile.sso_account_id = Some("123456789012".to_string());
        profile.sso_role_name = Some("ReadOnly".to_string());

        let mut manager = create_test_manager();
        manager.profiles.insert("session-sso".to_string(), profile);

        let (is_valid, error) = manager.validate_sso_profile(manager.profiles.get("session-sso").unwrap());
        assert!(is_valid, "Expected valid SSO profile with session, got error: {:?}", error);
    }

    #[test]
    fn test_assume_role_chain_valid() {
        let mut manager = create_test_manager();

        // Add source profile with static credentials
        let mut source = create_profile("source-creds");
        source.has_static_credentials = true;
        manager.profiles.insert("source-creds".to_string(), source);

        // Add assume-role profile
        let mut assume = create_profile("assume-role");
        assume.role_arn = Some("arn:aws:iam::123456789012:role/MyRole".to_string());
        assume.source_profile = Some("source-creds".to_string());
        manager.profiles.insert("assume-role".to_string(), assume);

        let result = manager.validate_assume_role_chain("assume-role", "source-creds");
        assert!(result.is_ok(), "Expected valid chain, got: {:?}", result);
    }

    #[test]
    fn test_assume_role_chain_missing_source() {
        let mut manager = create_test_manager();

        let mut assume = create_profile("assume-role");
        assume.role_arn = Some("arn:aws:iam::123456789012:role/MyRole".to_string());
        assume.source_profile = Some("nonexistent".to_string());
        manager.profiles.insert("assume-role".to_string(), assume);

        let result = manager.validate_assume_role_chain("assume-role", "nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_assume_role_chain_circular() {
        let mut manager = create_test_manager();

        // Create circular chain: A -> B -> C -> A
        let mut profile_a = create_profile("profile-a");
        profile_a.role_arn = Some("arn:aws:iam::111:role/A".to_string());
        profile_a.source_profile = Some("profile-b".to_string());
        manager.profiles.insert("profile-a".to_string(), profile_a);

        let mut profile_b = create_profile("profile-b");
        profile_b.role_arn = Some("arn:aws:iam::222:role/B".to_string());
        profile_b.source_profile = Some("profile-c".to_string());
        manager.profiles.insert("profile-b".to_string(), profile_b);

        let mut profile_c = create_profile("profile-c");
        profile_c.role_arn = Some("arn:aws:iam::333:role/C".to_string());
        profile_c.source_profile = Some("profile-a".to_string());
        manager.profiles.insert("profile-c".to_string(), profile_c);

        let result = manager.validate_assume_role_chain("profile-a", "profile-b");
        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.contains("Circular"), "Expected circular dependency error, got: {}", error);
    }

    #[test]
    fn test_assume_role_chain_multi_level() {
        let mut manager = create_test_manager();

        // Chain: assume3 -> assume2 -> assume1 -> source
        let mut source = create_profile("source");
        source.has_static_credentials = true;
        manager.profiles.insert("source".to_string(), source);

        let mut assume1 = create_profile("assume1");
        assume1.role_arn = Some("arn:aws:iam::111:role/R1".to_string());
        assume1.source_profile = Some("source".to_string());
        manager.profiles.insert("assume1".to_string(), assume1);

        let mut assume2 = create_profile("assume2");
        assume2.role_arn = Some("arn:aws:iam::222:role/R2".to_string());
        assume2.source_profile = Some("assume1".to_string());
        manager.profiles.insert("assume2".to_string(), assume2);

        let mut assume3 = create_profile("assume3");
        assume3.role_arn = Some("arn:aws:iam::333:role/R3".to_string());
        assume3.source_profile = Some("assume2".to_string());
        manager.profiles.insert("assume3".to_string(), assume3);

        let result = manager.validate_assume_role_chain("assume3", "assume2");
        assert!(result.is_ok(), "Expected valid multi-level chain, got: {:?}", result);
    }

    #[test]
    fn test_profile_type_as_str() {
        assert_eq!(ProfileType::StaticCredentials.as_str(), "Static Credentials");
        assert_eq!(ProfileType::AssumeRole.as_str(), "Assume Role");
        assert_eq!(ProfileType::Sso.as_str(), "SSO");
        assert_eq!(ProfileType::Environment.as_str(), "Environment");
        assert_eq!(ProfileType::Default.as_str(), "Default");
        assert_eq!(ProfileType::Unknown.as_str(), "Unknown");
    }

    #[test]
    fn test_valid_and_invalid_profiles() {
        let mut manager = create_test_manager();

        // Add valid profile
        let mut valid = create_profile("valid");
        valid.has_static_credentials = true;
        valid.is_valid = true;
        manager.profiles.insert("valid".to_string(), valid);

        // Add invalid profile
        let mut invalid = create_profile("invalid");
        invalid.is_valid = false;
        invalid.error_message = Some("Missing credentials".to_string());
        manager.profiles.insert("invalid".to_string(), invalid);

        assert_eq!(manager.valid_profile_count(), 1);
        assert_eq!(manager.valid_profiles().len(), 1);
        assert_eq!(manager.invalid_profiles().len(), 1);
    }

    #[test]
    fn test_set_current_profile() {
        let mut manager = create_test_manager();
        manager.profiles.insert("test".to_string(), create_profile("test"));

        assert!(manager.current_profile().is_none());

        let result = manager.set_current_profile("test");
        assert!(result.is_ok());
        assert_eq!(manager.current_profile(), Some("test"));

        let result = manager.set_current_profile("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_credential_source_profile() {
        let mut manager = create_test_manager();

        let mut profile = create_profile("ec2-role");
        profile.role_arn = Some("arn:aws:iam::123456789012:role/EC2Role".to_string());
        profile.credential_source = Some("Ec2InstanceMetadata".to_string());
        manager.profiles.insert("ec2-role".to_string(), profile);

        let profile_type = manager.determine_profile_type("ec2-role");
        // Should be AssumeRole because it has role_arn
        assert_eq!(profile_type, ProfileType::AssumeRole);

        // Validation should pass because it has credential_source
        let (is_valid, error) = manager.validate_assume_role_profile(manager.profiles.get("ec2-role").unwrap());
        assert!(is_valid, "Expected valid profile with credential_source, got: {:?}", error);
    }
}
