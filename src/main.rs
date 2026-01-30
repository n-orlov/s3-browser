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

    // Create and run the application
    let app = app::App::new().await?;
    app.run()?;

    Ok(())
}
