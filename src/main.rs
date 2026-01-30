// Windows: Hide console window when running as GUI application
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! S3 Browser Desktop Application
//!
//! A lightweight, cross-platform desktop application for viewing and managing
//! files in AWS S3 buckets.

mod app;
mod s3;
mod settings;
mod viewers;
mod ui;

use anyhow::Result;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

slint::include_modules!();

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tracing::info!("Starting S3 Browser v{}", env!("CARGO_PKG_VERSION"));

    // Create the application (async initialization)
    let app = app::App::new().await?;

    // Run the Slint event loop in block_in_place to properly integrate with tokio.
    // This is required because Slint's event loop and tokio's runtime can conflict.
    // See: https://slint.dev/docs/rust/slint/fn.spawn_local.html#compatibility-with-tokio-and-other-runtimes
    tokio::task::block_in_place(|| {
        app.run()
    })?;

    Ok(())
}
