//! Application state and logic

use anyhow::Result;
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
use std::rc::Rc;
use crate::{MainWindow, BucketItem, FileItem};
use crate::s3::credentials::ProfileManager;
use crate::s3::client::S3Client;

/// Main application state
pub struct App {
    window: MainWindow,
    #[allow(dead_code)]
    profile_manager: ProfileManager,
    #[allow(dead_code)]
    s3_client: Option<S3Client>,
}

impl App {
    /// Create a new application instance
    pub async fn new() -> Result<Self> {
        let window = MainWindow::new()?;
        let profile_manager = ProfileManager::new()?;

        // Populate profile list from ProfileManager
        let profile_names: Vec<SharedString> = profile_manager
            .profile_names()
            .into_iter()
            .map(|s| s.into())
            .collect();

        let profile_model = Rc::new(VecModel::from(profile_names));
        window.set_profiles(ModelRc::from(profile_model));

        // Set up mock data for bucket tree (for visual verification)
        let mock_buckets = vec![
            BucketItem {
                name: "my-data-bucket".into(),
                is_expanded: false,
                is_selected: true,
            },
            BucketItem {
                name: "logs-archive-2024".into(),
                is_expanded: false,
                is_selected: false,
            },
            BucketItem {
                name: "website-assets".into(),
                is_expanded: false,
                is_selected: false,
            },
            BucketItem {
                name: "backup-eu-west-1".into(),
                is_expanded: false,
                is_selected: false,
            },
        ];

        // Set up mock file list data
        let mock_files = vec![
            FileItem {
                key: "data/".into(),
                name: "data/".into(),
                size: "-".into(),
                last_modified: "-".into(),
                is_folder: true,
                is_selected: false,
            },
            FileItem {
                key: "config/".into(),
                name: "config/".into(),
                size: "-".into(),
                last_modified: "-".into(),
                is_folder: true,
                is_selected: false,
            },
            FileItem {
                key: "report.parquet".into(),
                name: "report.parquet".into(),
                size: "2.5 MB".into(),
                last_modified: "2024-01-15 14:32".into(),
                is_folder: false,
                is_selected: false,
            },
            FileItem {
                key: "users.csv".into(),
                name: "users.csv".into(),
                size: "156 KB".into(),
                last_modified: "2024-01-14 09:15".into(),
                is_folder: false,
                is_selected: false,
            },
            FileItem {
                key: "config.json".into(),
                name: "config.json".into(),
                size: "4.2 KB".into(),
                last_modified: "2024-01-13 16:45".into(),
                is_folder: false,
                is_selected: false,
            },
            FileItem {
                key: "settings.yaml".into(),
                name: "settings.yaml".into(),
                size: "1.8 KB".into(),
                last_modified: "2024-01-12 11:20".into(),
                is_folder: false,
                is_selected: false,
            },
            FileItem {
                key: "logo.png".into(),
                name: "logo.png".into(),
                size: "48 KB".into(),
                last_modified: "2024-01-10 08:00".into(),
                is_folder: false,
                is_selected: false,
            },
        ];

        // Get the explorer component and set data
        let explorer = window.global::<crate::Explorer>();
        let bucket_model = Rc::new(VecModel::from(mock_buckets));
        explorer.set_buckets(ModelRc::from(bucket_model));
        explorer.set_selected_bucket_index(0);

        // Get the file list component and set data
        let file_list = window.global::<crate::FileList>();
        let file_model = Rc::new(VecModel::from(mock_files));
        file_list.set_files(ModelRc::from(file_model));
        file_list.set_current_path("s3://my-data-bucket/".into());

        // Set up callback handlers (log for now)
        let window_weak = window.as_weak();
        window.on_profile_changed(move |index| {
            tracing::info!("Profile changed to index: {}", index);
            if let Some(win) = window_weak.upgrade() {
                win.set_status_message(format!("Switched to profile index {}", index).into());
            }
        });

        let window_weak = window.as_weak();
        window.on_navigate_to_url(move |url| {
            tracing::info!("Navigate to URL: {}", url);
            if let Some(win) = window_weak.upgrade() {
                win.set_status_message(format!("Navigating to {}...", url).into());
            }
        });

        let window_weak = window.as_weak();
        window.on_refresh_requested(move || {
            tracing::info!("Refresh requested");
            if let Some(win) = window_weak.upgrade() {
                win.set_status_message("Refreshing...".into());
            }
        });

        window.set_status_message("Ready - displaying mock data".into());

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
