//! S3 Browser Desktop Application Library
//!
//! This crate provides the core functionality for the S3 Browser desktop application.
//! The public modules can be used for testing and extension.

pub mod s3;
pub mod settings;
pub mod viewers;

// Note: app and ui modules are not exported as they depend on Slint
// which requires the build.rs to generate code
