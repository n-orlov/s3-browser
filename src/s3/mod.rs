//! S3 client wrapper module
//!
//! This module provides AWS S3 functionality including:
//! - [`client::S3Client`] - High-level S3 operations wrapper
//! - [`credentials::ProfileManager`] - AWS profile management
//! - [`types`] - S3 data types (Bucket, S3Object, S3Url)

pub mod client;
pub mod credentials;
pub mod types;

// Re-export commonly used types
pub use client::{ListObjectsResult, S3Client};
pub use credentials::{AwsProfile, ProfileManager, ProfileType};
pub use types::{Bucket, S3Object, S3Url};
