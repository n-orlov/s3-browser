//! Application state and logic

use anyhow::Result;
use slint::ComponentHandle;
use crate::MainWindow;
use crate::s3::credentials::ProfileManager;
use crate::s3::client::S3Client;

/// Main application state
pub struct App {
    window: MainWindow,
    profile_manager: ProfileManager,
    s3_client: Option<S3Client>,
}

impl App {
    /// Create a new application instance
    pub async fn new() -> Result<Self> {
        let window = MainWindow::new()?;
        let profile_manager = ProfileManager::new()?;

        Ok(Self {
            window,
            profile_manager,
            s3_client: None,
        })
    }

    /// Run the application main loop
    pub fn run(&self) -> Result<()> {
        self.window.run()?;
        Ok(())
    }
}
