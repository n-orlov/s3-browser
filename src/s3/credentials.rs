//! AWS credential and profile management

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Represents an AWS profile configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsProfile {
    pub name: String,
    pub region: Option<String>,
    pub source_profile: Option<String>,
    pub role_arn: Option<String>,
    pub sso_start_url: Option<String>,
    pub sso_region: Option<String>,
    pub sso_account_id: Option<String>,
    pub sso_role_name: Option<String>,
    pub is_valid: bool,
    pub error_message: Option<String>,
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
                region: None,
                source_profile: None,
                role_arn: None,
                sso_start_url: None,
                sso_region: None,
                sso_account_id: None,
                sso_role_name: None,
                is_valid: true,
                error_message: None,
            },
        );

        // Parse config file if it exists
        if config_path.exists() {
            self.parse_config_file(&config_path)
                .context("Failed to parse AWS config file")?;
        }

        // Parse credentials file if it exists
        if credentials_path.exists() {
            self.parse_credentials_file(&credentials_path)
                .context("Failed to parse AWS credentials file")?;
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
                    Some(name.to_string())
                } else {
                    None
                };

                if let Some(ref name) = current_profile {
                    self.profiles.entry(name.clone()).or_insert_with(|| AwsProfile {
                        name: name.clone(),
                        region: None,
                        source_profile: None,
                        role_arn: None,
                        sso_start_url: None,
                        sso_region: None,
                        sso_account_id: None,
                        sso_role_name: None,
                        is_valid: true,
                        error_message: None,
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

        for line in content.lines() {
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            if line.starts_with('[') && line.ends_with(']') {
                let name = &line[1..line.len() - 1];
                current_profile = Some(name.to_string());

                self.profiles.entry(name.to_string()).or_insert_with(|| AwsProfile {
                    name: name.to_string(),
                    region: None,
                    source_profile: None,
                    role_arn: None,
                    sso_start_url: None,
                    sso_region: None,
                    sso_account_id: None,
                    sso_role_name: None,
                    is_valid: true,
                    error_message: None,
                });
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

    #[test]
    fn test_profile_manager_new() {
        // This will try to load from real config files, but shouldn't fail
        let manager = ProfileManager::new();
        assert!(manager.is_ok());
    }

    #[test]
    fn test_profile_names_default_first() {
        let mut manager = ProfileManager {
            profiles: HashMap::new(),
            current_profile: None,
        };
        manager.profiles.insert("zebra".to_string(), AwsProfile {
            name: "zebra".to_string(),
            region: None,
            source_profile: None,
            role_arn: None,
            sso_start_url: None,
            sso_region: None,
            sso_account_id: None,
            sso_role_name: None,
            is_valid: true,
            error_message: None,
        });
        manager.profiles.insert("default".to_string(), AwsProfile {
            name: "default".to_string(),
            region: None,
            source_profile: None,
            role_arn: None,
            sso_start_url: None,
            sso_region: None,
            sso_account_id: None,
            sso_role_name: None,
            is_valid: true,
            error_message: None,
        });
        manager.profiles.insert("alpha".to_string(), AwsProfile {
            name: "alpha".to_string(),
            region: None,
            source_profile: None,
            role_arn: None,
            sso_start_url: None,
            sso_region: None,
            sso_account_id: None,
            sso_role_name: None,
            is_valid: true,
            error_message: None,
        });

        let names = manager.profile_names();
        assert_eq!(names[0], "default");
    }
}
