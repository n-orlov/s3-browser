//! Application settings persistence
//!
//! Stores user preferences in the platform-specific app data folder:
//! - Linux: ~/.config/s3-browser/settings.json
//! - Windows: %APPDATA%/s3-browser/settings.json
//! - macOS: ~/Library/Application Support/s3-browser/settings.json

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Application settings that persist between sessions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    /// Last selected AWS profile name
    #[serde(default)]
    pub last_profile: Option<String>,

    /// Last viewed bucket name
    #[serde(default)]
    pub last_bucket: Option<String>,

    /// Last viewed prefix (folder path) within the bucket
    #[serde(default)]
    pub last_prefix: Option<String>,
}

impl Settings {
    /// Load settings from disk, returning defaults if file doesn't exist
    pub fn load() -> Result<Self> {
        let path = Self::settings_path()?;

        if !path.exists() {
            tracing::debug!("Settings file not found, using defaults");
            return Ok(Self::default());
        }

        let contents = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read settings from {:?}", path))?;

        let settings: Settings = serde_json::from_str(&contents)
            .with_context(|| format!("Failed to parse settings from {:?}", path))?;

        tracing::info!(
            "Loaded settings: profile={:?}, bucket={:?}, prefix={:?}",
            settings.last_profile,
            settings.last_bucket,
            settings.last_prefix
        );

        Ok(settings)
    }

    /// Save settings to disk
    pub fn save(&self) -> Result<()> {
        let path = Self::settings_path()?;

        // Create parent directories if they don't exist
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create settings directory {:?}", parent))?;
        }

        let contents = serde_json::to_string_pretty(self)
            .context("Failed to serialize settings")?;

        fs::write(&path, contents)
            .with_context(|| format!("Failed to write settings to {:?}", path))?;

        tracing::debug!("Saved settings to {:?}", path);

        Ok(())
    }

    /// Get the path to the settings file
    fn settings_path() -> Result<PathBuf> {
        let proj_dirs = ProjectDirs::from("org", "github.n-orlov", "s3-browser")
            .context("Failed to determine settings directory")?;

        Ok(proj_dirs.config_dir().join("settings.json"))
    }

    /// Update the last viewed location
    pub fn set_location(&mut self, bucket: Option<&str>, prefix: Option<&str>) {
        self.last_bucket = bucket.map(|s| s.to_string());
        self.last_prefix = prefix.map(|s| s.to_string());
    }

    /// Update the last selected profile
    pub fn set_profile(&mut self, profile: Option<&str>) {
        self.last_profile = profile.map(|s| s.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    // Helper to set up a temp home directory for tests
    fn with_temp_home<F>(test: F)
    where
        F: FnOnce(),
    {
        let temp_dir = TempDir::new().unwrap();
        let old_home = env::var("HOME").ok();
        env::set_var("HOME", temp_dir.path());

        test();

        // Restore original HOME
        if let Some(home) = old_home {
            env::set_var("HOME", home);
        }
    }

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();
        assert!(settings.last_profile.is_none());
        assert!(settings.last_bucket.is_none());
        assert!(settings.last_prefix.is_none());
    }

    #[test]
    fn test_settings_set_profile() {
        let mut settings = Settings::default();
        settings.set_profile(Some("my-profile"));
        assert_eq!(settings.last_profile, Some("my-profile".to_string()));

        settings.set_profile(None);
        assert!(settings.last_profile.is_none());
    }

    #[test]
    fn test_settings_set_location() {
        let mut settings = Settings::default();
        settings.set_location(Some("my-bucket"), Some("folder/subfolder/"));

        assert_eq!(settings.last_bucket, Some("my-bucket".to_string()));
        assert_eq!(settings.last_prefix, Some("folder/subfolder/".to_string()));
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings {
            last_profile: Some("production".to_string()),
            last_bucket: Some("data-bucket".to_string()),
            last_prefix: Some("exports/2024/".to_string()),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.last_profile, settings.last_profile);
        assert_eq!(parsed.last_bucket, settings.last_bucket);
        assert_eq!(parsed.last_prefix, settings.last_prefix);
    }

    #[test]
    fn test_settings_partial_deserialization() {
        // Should handle missing fields gracefully
        let json = r#"{"last_profile": "test"}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();

        assert_eq!(settings.last_profile, Some("test".to_string()));
        assert!(settings.last_bucket.is_none());
        assert!(settings.last_prefix.is_none());
    }

    #[test]
    fn test_settings_empty_json() {
        let json = "{}";
        let settings: Settings = serde_json::from_str(json).unwrap();

        assert!(settings.last_profile.is_none());
        assert!(settings.last_bucket.is_none());
        assert!(settings.last_prefix.is_none());
    }
}
