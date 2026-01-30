//! Application state and logic

use anyhow::Result;
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel, Weak};
use std::cell::RefCell;
use std::rc::Rc;
use crate::{MainWindow, BucketItem, FileItem, Explorer, FileList};
use crate::s3::credentials::ProfileManager;
use crate::s3::client::S3Client;
use crate::s3::types::S3Object;

/// Shared application state that can be accessed from callbacks
struct AppState {
    profile_manager: ProfileManager,
    s3_client: Option<S3Client>,
    current_profile: Option<String>,
    current_bucket: Option<String>,
    current_prefix: String,
    continuation_token: Option<String>,
    all_objects: Vec<S3Object>,
}

/// Main application state
pub struct App {
    window: MainWindow,
    state: Rc<RefCell<AppState>>,
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
        window.set_profiles(ModelRc::from(profile_model.clone()));

        // Initialize state
        let state = Rc::new(RefCell::new(AppState {
            profile_manager,
            s3_client: None,
            current_profile: None,
            current_bucket: None,
            current_prefix: String::new(),
            continuation_token: None,
            all_objects: Vec::new(),
        }));

        // Set initial empty bucket list - will be populated when profile selected
        let explorer = window.global::<Explorer>();
        explorer.set_buckets(ModelRc::from(Rc::new(VecModel::<BucketItem>::default())));
        explorer.set_selected_bucket_index(-1);

        // Set initial empty file list
        let file_list = window.global::<FileList>();
        file_list.set_files(ModelRc::from(Rc::new(VecModel::<FileItem>::default())));
        file_list.set_current_path("".into());

        // Set up profile change callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        window.on_profile_changed(move |index| {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let profile_names = {
                    let state_ref = state.borrow();
                    state_ref.profile_manager.profile_names()
                };
                if let Some(profile_name) = profile_names.get(index as usize) {
                    let profile_name = profile_name.clone();
                    tracing::info!("Profile changed to: {}", profile_name);
                    win.set_status_message(format!("Loading profile {}...", profile_name).into());
                    win.set_is_loading(true);

                    // Spawn async task to load buckets
                    let state = state.clone();
                    let window_weak = window_weak.clone();
                    slint::spawn_local(async move {
                        Self::load_profile_and_buckets(state, window_weak, &profile_name).await;
                    }).unwrap();
                }
            }
        });

        // Set up bucket selection callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        explorer.on_bucket_selected(move |index| {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                // Get bucket name from the model
                let explorer = win.global::<Explorer>();
                let buckets = explorer.get_buckets();
                if let Some(bucket) = buckets.row_data(index as usize) {
                    let bucket_name = bucket.name.to_string();
                    tracing::info!("Bucket selected: {}", bucket_name);

                    // Update selection in UI
                    explorer.set_selected_bucket_index(index);

                    win.set_status_message(format!("Loading {}...", bucket_name).into());
                    win.set_is_loading(true);

                    let state = state.clone();
                    let window_weak = window_weak.clone();
                    slint::spawn_local(async move {
                        Self::load_bucket_contents(state, window_weak, &bucket_name, "").await;
                    }).unwrap();
                }
            }
        });

        // Set up bucket filter callback
        let window_weak = window.as_weak();
        explorer.on_bucket_filter_changed(move |filter_text| {
            if let Some(win) = window_weak.upgrade() {
                let explorer = win.global::<Explorer>();
                explorer.set_bucket_filter(filter_text);
                // Note: Filtering is handled in the UI via the bucket-filter property
                tracing::debug!("Bucket filter changed: {}", explorer.get_bucket_filter());
            }
        });

        // Set up file double-click callback (navigate into folder)
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_file_double_clicked(move |index| {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let file_list_global = win.global::<FileList>();
                let files = file_list_global.get_files();
                if let Some(file) = files.row_data(index as usize) {
                    if file.is_folder {
                        let key = file.key.to_string();
                        tracing::info!("Navigating into folder: {}", key);

                        let state_ref = state.borrow();
                        if let Some(bucket) = &state_ref.current_bucket {
                            let bucket = bucket.clone();
                            drop(state_ref);

                            win.set_status_message(format!("Loading {}...", key).into());
                            win.set_is_loading(true);

                            let state = state.clone();
                            let window_weak = window_weak.clone();
                            slint::spawn_local(async move {
                                Self::load_bucket_contents(state, window_weak, &bucket, &key).await;
                            }).unwrap();
                        }
                    } else {
                        // File selected - could open viewer in future
                        tracing::info!("File selected: {}", file.key);
                        win.set_status_message(format!("Selected: {}", file.name).into());
                    }
                }
            }
        });

        // Set up navigate up callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_navigate_up(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state.borrow();
                if let Some(bucket) = &state_ref.current_bucket {
                    let current_prefix = state_ref.current_prefix.clone();
                    let bucket = bucket.clone();
                    drop(state_ref);

                    // Calculate parent prefix
                    let parent_prefix = Self::get_parent_prefix(&current_prefix);
                    tracing::info!("Navigating up from '{}' to '{}'", current_prefix, parent_prefix);

                    win.set_status_message(format!("Loading {}...", parent_prefix).into());
                    win.set_is_loading(true);

                    let state = state.clone();
                    let window_weak = window_weak.clone();
                    slint::spawn_local(async move {
                        Self::load_bucket_contents(state, window_weak, &bucket, &parent_prefix).await;
                    }).unwrap();
                }
            }
        });

        // Set up file selection callback
        let window_weak = window.as_weak();
        file_list.on_file_selected(move |index| {
            if let Some(win) = window_weak.upgrade() {
                let file_list_global = win.global::<FileList>();
                let files = file_list_global.get_files();
                // Update selection state
                // For now just log - multi-select will be added later
                if let Some(file) = files.row_data(index as usize) {
                    tracing::debug!("File selected: {} (index {})", file.name, index);
                }
            }
        });

        // Set up copy URL callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_copy_url_clicked(move || {
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state_clone.borrow();
                if let Some(bucket) = &state_ref.current_bucket {
                    let current_path = format!("s3://{}/{}", bucket, state_ref.current_prefix);
                    tracing::info!("Copy URL: {}", current_path);
                    win.set_status_message(format!("Copied: {}", current_path).into());
                    // TODO: Actually copy to clipboard using copypasta crate
                }
            }
        });

        // Set up download callback (placeholder)
        let window_weak = window.as_weak();
        file_list.on_download_clicked(move || {
            if let Some(win) = window_weak.upgrade() {
                win.set_status_message("Download: Select a file first".into());
                // TODO: Implement actual download
            }
        });

        // Set up delete callback (placeholder)
        let window_weak = window.as_weak();
        file_list.on_delete_clicked(move || {
            if let Some(win) = window_weak.upgrade() {
                win.set_status_message("Delete: Select a file first".into());
                // TODO: Implement actual delete with confirmation
            }
        });

        // Set up navigate to URL callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        window.on_navigate_to_url(move |url| {
            let url_str = url.to_string();
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                tracing::info!("Navigate to URL: {}", url_str);

                // Parse S3 URL
                if let Some(s3_url) = crate::s3::types::S3Url::parse(&url_str) {
                    win.set_status_message(format!("Navigating to {}...", url_str).into());
                    win.set_is_loading(true);

                    let state = state.clone();
                    let window_weak = window_weak.clone();
                    slint::spawn_local(async move {
                        Self::navigate_to_s3_url(state, window_weak, s3_url).await;
                    }).unwrap();
                } else {
                    win.set_status_message(format!("Invalid S3 URL: {}", url_str).into());
                }
            }
        });

        // Set up refresh callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        window.on_refresh_requested(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state.borrow();
                if let Some(bucket) = &state_ref.current_bucket {
                    let bucket = bucket.clone();
                    let prefix = state_ref.current_prefix.clone();
                    drop(state_ref);

                    tracing::info!("Refresh requested");
                    win.set_status_message("Refreshing...".into());
                    win.set_is_loading(true);

                    let state = state.clone();
                    let window_weak = window_weak.clone();
                    slint::spawn_local(async move {
                        Self::load_bucket_contents(state, window_weak, &bucket, &prefix).await;
                    }).unwrap();
                } else {
                    win.set_status_message("Select a bucket first".into());
                }
            }
        });

        window.set_status_message("Select a profile to connect to AWS".into());

        Ok(Self {
            window,
            state,
        })
    }

    /// Load profile and fetch buckets
    async fn load_profile_and_buckets(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        profile_name: &str,
    ) {
        // Create S3 client for profile
        let profile_opt = if profile_name == "default" {
            None
        } else {
            Some(profile_name)
        };

        match S3Client::new(profile_opt).await {
            Ok(client) => {
                // Fetch buckets
                match client.list_buckets().await {
                    Ok(buckets) => {
                        let bucket_items: Vec<BucketItem> = buckets
                            .iter()
                            .map(|b| BucketItem {
                                name: b.name.clone().into(),
                                is_expanded: false,
                                is_selected: false,
                            })
                            .collect();

                        let bucket_count = bucket_items.len();

                        // Update state
                        {
                            let mut state_ref = state.borrow_mut();
                            state_ref.s3_client = Some(client);
                            state_ref.current_profile = Some(profile_name.to_string());
                            state_ref.current_bucket = None;
                            state_ref.current_prefix = String::new();
                        }

                        // Update UI
                        if let Some(win) = window_weak.upgrade() {
                            let explorer = win.global::<Explorer>();
                            let bucket_model = Rc::new(VecModel::from(bucket_items));
                            explorer.set_buckets(ModelRc::from(bucket_model));
                            explorer.set_selected_bucket_index(-1);

                            // Clear file list
                            let file_list = win.global::<FileList>();
                            file_list.set_files(ModelRc::from(Rc::new(VecModel::<FileItem>::default())));
                            file_list.set_current_path("".into());

                            win.set_is_loading(false);
                            win.set_status_message(format!("Loaded {} buckets", bucket_count).into());
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to list buckets: {}", e);
                        if let Some(win) = window_weak.upgrade() {
                            win.set_is_loading(false);
                            win.set_status_message(format!("Error: {}", e).into());
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!("Failed to create S3 client: {}", e);
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Error: {}", e).into());
                }
            }
        }
    }

    /// Load bucket contents with pagination support
    async fn load_bucket_contents(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        bucket: &str,
        prefix: &str,
    ) {
        // Get the current profile name to recreate client
        // (We recreate the client since S3Client contains non-Clone types
        // and we need to use it in async context)
        let profile_name: Option<String>;
        {
            let state_ref = state.borrow();
            if state_ref.s3_client.is_none() {
                drop(state_ref);
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message("No AWS profile selected".into());
                }
                return;
            }
            profile_name = state_ref.current_profile.clone();
        }

        // Create client with the current profile
        let profile_opt = profile_name.as_deref().filter(|p| *p != "default");
        let client = match S3Client::new(profile_opt).await {
            Ok(c) => c,
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Error: {}", e).into());
                }
                return;
            }
        };

        let prefix_opt = if prefix.is_empty() { None } else { Some(prefix) };

        // Initial load with first page
        match client.list_objects(bucket, prefix_opt, None, 1000).await {
            Ok(result) => {
                let file_items: Vec<FileItem> = result.objects
                    .iter()
                    .map(|obj| Self::s3_object_to_file_item(obj))
                    .collect();

                let count = file_items.len();
                let has_more = result.is_truncated;

                // Update state
                {
                    let mut state_ref = state.borrow_mut();
                    state_ref.current_bucket = Some(bucket.to_string());
                    state_ref.current_prefix = prefix.to_string();
                    state_ref.continuation_token = result.next_token;
                    state_ref.all_objects = result.objects;
                }

                // Update UI
                if let Some(win) = window_weak.upgrade() {
                    let file_list = win.global::<FileList>();
                    let file_model = Rc::new(VecModel::from(file_items));
                    file_list.set_files(ModelRc::from(file_model));

                    let path = if prefix.is_empty() {
                        format!("s3://{}/", bucket)
                    } else {
                        format!("s3://{}/{}", bucket, prefix)
                    };
                    file_list.set_current_path(path.into());

                    win.set_is_loading(false);
                    let msg = if has_more {
                        format!("Showing {} items (more available)", count)
                    } else {
                        format!("{} items", count)
                    };
                    win.set_status_message(msg.into());
                }
            }
            Err(e) => {
                tracing::error!("Failed to list objects: {}", e);
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Error: {}", e).into());
                }
            }
        }
    }

    /// Navigate to an S3 URL
    async fn navigate_to_s3_url(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        s3_url: crate::s3::types::S3Url,
    ) {
        // First, find and select the bucket in the bucket list
        if let Some(win) = window_weak.upgrade() {
            let explorer = win.global::<Explorer>();
            let buckets = explorer.get_buckets();
            let bucket_count = buckets.row_count();

            let mut found_index = None;
            for i in 0..bucket_count {
                if let Some(bucket) = buckets.row_data(i) {
                    if bucket.name.to_string() == s3_url.bucket {
                        found_index = Some(i);
                        break;
                    }
                }
            }

            if let Some(idx) = found_index {
                explorer.set_selected_bucket_index(idx as i32);
            }
        }

        // Determine if we're navigating to a prefix (folder) or should look for a specific file
        let prefix = if s3_url.key.is_empty() {
            String::new()
        } else if s3_url.key.ends_with('/') {
            s3_url.key.clone()
        } else {
            // The key might be a file - navigate to its parent directory
            Self::get_parent_prefix(&s3_url.key)
        };

        // Load the bucket contents at the appropriate prefix
        Self::load_bucket_contents(state, window_weak, &s3_url.bucket, &prefix).await;
    }

    /// Convert S3Object to FileItem for UI
    fn s3_object_to_file_item(obj: &S3Object) -> FileItem {
        let last_modified = obj.last_modified
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| "-".to_string());

        FileItem {
            key: obj.key.clone().into(),
            name: obj.display_name().to_string().into(),
            size: obj.size_string().into(),
            last_modified: last_modified.into(),
            is_folder: obj.is_folder,
            is_selected: false,
        }
    }

    /// Get the parent prefix (navigate up one level)
    fn get_parent_prefix(prefix: &str) -> String {
        let trimmed = prefix.trim_end_matches('/');
        if trimmed.is_empty() {
            return String::new();
        }

        match trimmed.rfind('/') {
            Some(pos) => format!("{}/", &trimmed[..pos]),
            None => String::new(),
        }
    }

    /// Run the application main loop
    pub fn run(&self) -> Result<()> {
        self.window.run()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_parent_prefix_empty() {
        assert_eq!(App::get_parent_prefix(""), "");
    }

    #[test]
    fn test_get_parent_prefix_root_folder() {
        assert_eq!(App::get_parent_prefix("folder/"), "");
    }

    #[test]
    fn test_get_parent_prefix_nested() {
        assert_eq!(App::get_parent_prefix("a/b/c/"), "a/b/");
    }

    #[test]
    fn test_get_parent_prefix_deep_nested() {
        assert_eq!(App::get_parent_prefix("level1/level2/level3/level4/"), "level1/level2/level3/");
    }

    #[test]
    fn test_get_parent_prefix_file_path() {
        // If given a file path (no trailing slash), returns parent folder
        assert_eq!(App::get_parent_prefix("folder/file.txt"), "folder/");
    }

    #[test]
    fn test_get_parent_prefix_root_file() {
        // File at root level
        assert_eq!(App::get_parent_prefix("file.txt"), "");
    }
}
