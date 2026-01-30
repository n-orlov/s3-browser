//! Application state and logic

use anyhow::Result;
use copypasta::{ClipboardContext, ClipboardProvider};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel, Weak};
use std::cell::RefCell;
use std::collections::HashSet;
use std::path::PathBuf;
use std::rc::Rc;
use crate::{MainWindow, BucketItem, FileItem, Explorer, FileList, ParquetViewer, ParquetColumn, ParquetRow, ParquetCell};
use crate::s3::credentials::ProfileManager;
use crate::s3::client::S3Client;
use crate::s3::types::S3Object;
use crate::settings::Settings;
use crate::viewers::parquet::ParquetViewer as ParquetViewerLogic;

/// Shared application state that can be accessed from callbacks
struct AppState {
    profile_manager: ProfileManager,
    s3_client: Option<S3Client>,
    current_profile: Option<String>,
    current_bucket: Option<String>,
    current_prefix: String,
    continuation_token: Option<String>,
    all_objects: Vec<S3Object>,
    /// Selected file indices
    selected_indices: HashSet<usize>,
    /// Persistent settings
    settings: Settings,
    /// Current parquet file data for lazy loading
    parquet_data: Option<Vec<u8>>,
    /// Current parquet file name
    parquet_file_name: Option<String>,
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

        // Load persistent settings
        let settings = Settings::load().unwrap_or_else(|e| {
            tracing::warn!("Failed to load settings, using defaults: {}", e);
            Settings::default()
        });

        // Initialize state
        let state = Rc::new(RefCell::new(AppState {
            profile_manager,
            s3_client: None,
            current_profile: None,
            current_bucket: None,
            current_prefix: String::new(),
            continuation_token: None,
            all_objects: Vec::new(),
            selected_indices: HashSet::new(),
            settings,
            parquet_data: None,
            parquet_file_name: None,
        }));

        // Set initial empty bucket list - will be populated when profile selected
        let explorer = window.global::<Explorer>();
        explorer.set_buckets(ModelRc::from(Rc::new(VecModel::<BucketItem>::default())));
        explorer.set_selected_bucket_index(-1);

        // Set initial empty file list
        let file_list = window.global::<FileList>();
        file_list.set_files(ModelRc::from(Rc::new(VecModel::<FileItem>::default())));
        file_list.set_current_path("".into());
        file_list.set_selection_count(0);

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

        // Set up file double-click callback (navigate into folder or open file)
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
                        // Check if it's a parquet file
                        let file_name = file.name.to_string();
                        let file_key = file.key.to_string();

                        if file_name.ends_with(".parquet") || file_name.ends_with(".pq") {
                            tracing::info!("Opening parquet file: {}", file_key);

                            let state_ref = state.borrow();
                            if let Some(bucket) = &state_ref.current_bucket {
                                let bucket = bucket.clone();
                                drop(state_ref);

                                win.set_status_message(format!("Loading parquet file: {}...", file_name).into());
                                win.set_is_loading(true);

                                let state = state.clone();
                                let window_weak = window_weak.clone();
                                slint::spawn_local(async move {
                                    Self::open_parquet_file(state, window_weak, &bucket, &file_key, &file_name).await;
                                }).unwrap();
                            }
                        } else {
                            // Other file types - show message
                            tracing::info!("File selected: {}", file_key);
                            win.set_status_message(format!("Selected: {} (viewer not implemented for this file type)", file_name).into());
                        }
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

        // Set up file selection callback (single click without modifier)
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_file_selected(move |index| {
            Self::handle_file_selection(state_clone.clone(), window_weak.clone(), index as usize, false);
        });

        // Set up file selection with Ctrl callback (multi-select)
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_file_selected_with_ctrl(move |index, ctrl_held| {
            Self::handle_file_selection(state_clone.clone(), window_weak.clone(), index as usize, ctrl_held);
        });

        // Set up copy URL callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_copy_url_clicked(move || {
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state_clone.borrow();
                if let Some(bucket) = &state_ref.current_bucket {
                    // Get selected file keys
                    let selected_keys: Vec<String> = state_ref.selected_indices
                        .iter()
                        .filter_map(|&idx| state_ref.all_objects.get(idx))
                        .map(|obj| format!("s3://{}/{}", bucket, obj.key))
                        .collect();

                    if selected_keys.is_empty() {
                        win.set_status_message("No files selected".into());
                        return;
                    }

                    let urls = selected_keys.join("\n");

                    // Copy to clipboard
                    match ClipboardContext::new() {
                        Ok(mut ctx) => {
                            if ctx.set_contents(urls.clone()).is_ok() {
                                let msg = if selected_keys.len() == 1 {
                                    format!("Copied: {}", selected_keys[0])
                                } else {
                                    format!("Copied {} URLs to clipboard", selected_keys.len())
                                };
                                win.set_status_message(msg.into());
                            } else {
                                win.set_status_message("Failed to copy to clipboard".into());
                            }
                        }
                        Err(_) => {
                            // Clipboard not available (common in headless/WSL)
                            win.set_status_message(format!("URL: {}", urls).into());
                        }
                    }
                }
            }
        });

        // Set up download callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_download_clicked(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state.borrow();
                if state_ref.selected_indices.is_empty() {
                    win.set_status_message("No files selected".into());
                    return;
                }

                let bucket = match &state_ref.current_bucket {
                    Some(b) => b.clone(),
                    None => {
                        win.set_status_message("No bucket selected".into());
                        return;
                    }
                };

                // Get selected file keys (excluding folders)
                let files_to_download: Vec<(String, String)> = state_ref.selected_indices
                    .iter()
                    .filter_map(|&idx| state_ref.all_objects.get(idx))
                    .filter(|obj| !obj.is_folder)
                    .map(|obj| (obj.key.clone(), obj.display_name().to_string()))
                    .collect();

                if files_to_download.is_empty() {
                    win.set_status_message("No files selected (only folders)".into());
                    return;
                }

                drop(state_ref);

                let count = files_to_download.len();
                win.set_status_message(format!("Downloading {} file(s)...", count).into());
                win.set_is_loading(true);

                let state = state.clone();
                let window_weak = window_weak.clone();
                slint::spawn_local(async move {
                    Self::download_files(state, window_weak, &bucket, files_to_download).await;
                }).unwrap();
            }
        });

        // Set up upload callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_upload_clicked(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state.borrow();
                let bucket = match &state_ref.current_bucket {
                    Some(b) => b.clone(),
                    None => {
                        win.set_status_message("Select a bucket first".into());
                        return;
                    }
                };
                let prefix = state_ref.current_prefix.clone();
                drop(state_ref);

                // Use native file dialog
                let state = state.clone();
                let window_weak = window_weak.clone();
                slint::spawn_local(async move {
                    Self::upload_file_dialog(state, window_weak, &bucket, &prefix).await;
                }).unwrap();
            }
        });

        // Set up delete callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_delete_clicked(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state.borrow();
                if state_ref.selected_indices.is_empty() {
                    win.set_status_message("No files selected".into());
                    return;
                }

                let bucket = match &state_ref.current_bucket {
                    Some(b) => b.clone(),
                    None => {
                        win.set_status_message("No bucket selected".into());
                        return;
                    }
                };

                // Get selected file keys
                let keys_to_delete: Vec<String> = state_ref.selected_indices
                    .iter()
                    .filter_map(|&idx| state_ref.all_objects.get(idx))
                    .filter(|obj| !obj.is_folder)  // Don't delete folders directly
                    .map(|obj| obj.key.clone())
                    .collect();

                if keys_to_delete.is_empty() {
                    win.set_status_message("No files selected (only folders)".into());
                    return;
                }

                let prefix = state_ref.current_prefix.clone();
                drop(state_ref);

                // TODO: Add confirmation dialog before delete
                // For now, proceed directly (PRD says confirmation needed)
                let count = keys_to_delete.len();
                win.set_status_message(format!("Deleting {} file(s)...", count).into());
                win.set_is_loading(true);

                let state = state.clone();
                let window_weak = window_weak.clone();
                slint::spawn_local(async move {
                    Self::delete_files(state, window_weak, &bucket, &prefix, keys_to_delete).await;
                }).unwrap();
            }
        });

        // Set up rename callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        file_list.on_rename_clicked(move || {
            if let Some(win) = window_weak.upgrade() {
                let state_ref = state_clone.borrow();
                if state_ref.selected_indices.len() != 1 {
                    win.set_status_message("Select exactly one file to rename".into());
                    return;
                }

                // Get selected file
                let idx = *state_ref.selected_indices.iter().next().unwrap();
                if let Some(obj) = state_ref.all_objects.get(idx) {
                    if obj.is_folder {
                        win.set_status_message("Cannot rename folders".into());
                        return;
                    }
                    // TODO: Show rename dialog and implement rename
                    // For now, show message that rename is selected
                    win.set_status_message(format!("Rename: {} (dialog not yet implemented)", obj.display_name()).into());
                }
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

        // Set up Parquet Viewer callbacks
        let parquet_viewer = window.global::<ParquetViewer>();

        // Close callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        parquet_viewer.on_close_requested(move || {
            if let Some(win) = window_weak.upgrade() {
                let parquet_viewer = win.global::<ParquetViewer>();
                parquet_viewer.set_dialog_visible(false);

                // Clear parquet data from state
                let mut state_ref = state_clone.borrow_mut();
                state_ref.parquet_data = None;
                state_ref.parquet_file_name = None;
            }
        });

        // Load more callback
        let state_clone = state.clone();
        let window_weak = window.as_weak();
        parquet_viewer.on_load_more_requested(move || {
            let state = state_clone.clone();
            let window_weak = window_weak.clone();
            if let Some(win) = window_weak.upgrade() {
                let parquet_viewer = win.global::<ParquetViewer>();
                parquet_viewer.set_is_loading(true);

                slint::spawn_local(async move {
                    Self::load_more_parquet_rows(state, window_weak).await;
                }).unwrap();
            }
        });

        // Restore last session if settings are available
        {
            let state_ref = state.borrow();
            let last_profile = state_ref.settings.last_profile.clone();
            let last_bucket = state_ref.settings.last_bucket.clone();
            let last_prefix = state_ref.settings.last_prefix.clone();
            drop(state_ref);

            if let Some(profile_name) = last_profile {
                // Find profile index
                let profile_names = {
                    let state_ref = state.borrow();
                    state_ref.profile_manager.profile_names()
                };

                if let Some(profile_idx) = profile_names.iter().position(|p| p == &profile_name) {
                    tracing::info!("Restoring last session: profile={}", profile_name);

                    // Set the profile selection in UI
                    window.set_current_profile_index(profile_idx as i32);
                    window.set_status_message(format!("Restoring session: {}...", profile_name).into());
                    window.set_is_loading(true);

                    // Spawn async task to restore the session
                    let state = state.clone();
                    let window_weak = window.as_weak();
                    slint::spawn_local(async move {
                        Self::restore_session(state, window_weak, profile_name, last_bucket, last_prefix).await;
                    }).unwrap();
                } else {
                    tracing::warn!("Last profile '{}' not found, starting fresh", profile_name);
                    window.set_status_message("Select a profile to connect to AWS".into());
                }
            } else {
                window.set_status_message("Select a profile to connect to AWS".into());
            }
        }

        Ok(Self {
            window,
            state,
        })
    }

    /// Handle file selection (single or multi-select)
    fn handle_file_selection(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        index: usize,
        ctrl_held: bool,
    ) {
        if let Some(win) = window_weak.upgrade() {
            let file_list = win.global::<FileList>();
            let mut state_ref = state.borrow_mut();

            if ctrl_held {
                // Toggle selection for this item
                if state_ref.selected_indices.contains(&index) {
                    state_ref.selected_indices.remove(&index);
                } else {
                    state_ref.selected_indices.insert(index);
                }
            } else {
                // Clear selection and select only this item
                state_ref.selected_indices.clear();
                state_ref.selected_indices.insert(index);
            }

            let selected_count = state_ref.selected_indices.len();
            let selected_indices = state_ref.selected_indices.clone();
            drop(state_ref);

            // Update UI to reflect selection
            Self::update_file_selection_ui(&file_list, &selected_indices);
            file_list.set_selection_count(selected_count as i32);

            tracing::debug!("Selection: {} items", selected_count);
        }
    }

    /// Update the file list UI to show selected items
    fn update_file_selection_ui(file_list: &FileList, selected_indices: &HashSet<usize>) {
        let files = file_list.get_files();
        let count = files.row_count();

        for i in 0..count {
            if let Some(mut file) = files.row_data(i) {
                let should_be_selected = selected_indices.contains(&i);
                if file.is_selected != should_be_selected {
                    file.is_selected = should_be_selected;
                    files.set_row_data(i, file);
                }
            }
        }
    }

    /// Download files to the Downloads folder
    async fn download_files(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        bucket: &str,
        files: Vec<(String, String)>,  // (key, display_name)
    ) {
        // Get Downloads directory
        let downloads_dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));

        // Get the current profile name to recreate client
        let profile_name: Option<String>;
        {
            let state_ref = state.borrow();
            profile_name = state_ref.current_profile.clone();
        }

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

        let mut success_count = 0;
        let mut last_downloaded_path = None;

        for (key, display_name) in &files {
            match client.get_object(bucket, key).await {
                Ok(data) => {
                    let file_path = downloads_dir.join(display_name);
                    match std::fs::write(&file_path, data) {
                        Ok(_) => {
                            success_count += 1;
                            last_downloaded_path = Some(file_path);
                            tracing::info!("Downloaded: {}", display_name);
                        }
                        Err(e) => {
                            tracing::error!("Failed to write {}: {}", display_name, e);
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to download {}: {}", key, e);
                }
            }
        }

        if let Some(win) = window_weak.upgrade() {
            win.set_is_loading(false);

            let msg = if success_count == files.len() {
                if let Some(path) = last_downloaded_path {
                    format!("Downloaded {} file(s) to {}", success_count, path.parent().unwrap_or(&downloads_dir).display())
                } else {
                    format!("Downloaded {} file(s)", success_count)
                }
            } else {
                format!("Downloaded {}/{} file(s)", success_count, files.len())
            };

            win.set_status_message(msg.into());

            // Show toast notification
            let file_list = win.global::<FileList>();
            file_list.set_toast_message(format!("Downloaded to {}", downloads_dir.display()).into());
            file_list.set_show_toast(true);

            // Hide toast after a delay
            let window_weak2 = window_weak.clone();
            slint::spawn_local(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                if let Some(win) = window_weak2.upgrade() {
                    let file_list = win.global::<FileList>();
                    file_list.set_show_toast(false);
                }
            }).unwrap();
        }
    }

    /// Open file dialog and upload selected file
    async fn upload_file_dialog(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        bucket: &str,
        prefix: &str,
    ) {
        // Use rfd for native file dialog
        let file_result = rfd::AsyncFileDialog::new()
            .set_title("Select file to upload")
            .pick_file()
            .await;

        let file_handle = match file_result {
            Some(f) => f,
            None => {
                // User cancelled
                return;
            }
        };

        let file_path = file_handle.path().to_path_buf();
        let file_name = file_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();

        if let Some(win) = window_weak.upgrade() {
            win.set_status_message(format!("Uploading {}...", file_name).into());
            win.set_is_loading(true);
        }

        // Read file contents
        let data = match tokio::fs::read(&file_path).await {
            Ok(d) => d,
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Failed to read file: {}", e).into());
                }
                return;
            }
        };

        // Get the current profile name to recreate client
        let profile_name: Option<String>;
        {
            let state_ref = state.borrow();
            profile_name = state_ref.current_profile.clone();
        }

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

        // Upload to S3
        let key = if prefix.is_empty() {
            file_name.clone()
        } else {
            format!("{}{}", prefix, file_name)
        };

        let bucket_owned = bucket.to_string();
        let prefix_owned = prefix.to_string();

        match client.put_object(&bucket_owned, &key, data).await {
            Ok(_) => {
                tracing::info!("Uploaded: {}", key);
                // Refresh the file list
                Self::load_bucket_contents(state, window_weak.clone(), &bucket_owned, &prefix_owned).await;

                if let Some(win) = window_weak.upgrade() {
                    win.set_status_message(format!("Uploaded: {}", file_name).into());
                }
            }
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Upload failed: {}", e).into());
                }
            }
        }
    }

    /// Delete selected files
    async fn delete_files(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        bucket: &str,
        prefix: &str,
        keys: Vec<String>,
    ) {
        // Get the current profile name to recreate client
        let profile_name: Option<String>;
        {
            let state_ref = state.borrow();
            profile_name = state_ref.current_profile.clone();
        }

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

        let key_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        let bucket_owned = bucket.to_string();
        let prefix_owned = prefix.to_string();

        match client.delete_objects(&bucket_owned, &key_refs).await {
            Ok(failed) => {
                let success_count = keys.len() - failed.len();
                tracing::info!("Deleted {} files", success_count);

                // Clear selection
                {
                    let mut state_ref = state.borrow_mut();
                    state_ref.selected_indices.clear();
                }

                // Refresh the file list
                Self::load_bucket_contents(state, window_weak.clone(), &bucket_owned, &prefix_owned).await;

                if let Some(win) = window_weak.upgrade() {
                    let msg = if failed.is_empty() {
                        format!("Deleted {} file(s)", keys.len())
                    } else {
                        format!("Deleted {}/{} file(s)", success_count, keys.len())
                    };
                    win.set_status_message(msg.into());
                }
            }
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Delete failed: {}", e).into());
                }
            }
        }
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

                        // Update state and save settings
                        {
                            let mut state_ref = state.borrow_mut();
                            state_ref.s3_client = Some(client);
                            state_ref.current_profile = Some(profile_name.to_string());
                            state_ref.current_bucket = None;
                            state_ref.current_prefix = String::new();
                            state_ref.selected_indices.clear();

                            // Save profile to settings
                            state_ref.settings.set_profile(Some(profile_name));
                            state_ref.settings.set_location(None, None);
                            if let Err(e) = state_ref.settings.save() {
                                tracing::warn!("Failed to save settings: {}", e);
                            }
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
                            file_list.set_selection_count(0);

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

    /// Restore a previous session from saved settings
    async fn restore_session(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        profile_name: String,
        last_bucket: Option<String>,
        last_prefix: Option<String>,
    ) {
        // First, load the profile and buckets
        Self::load_profile_and_buckets(state.clone(), window_weak.clone(), &profile_name).await;

        // If we have a last bucket, try to navigate to it
        if let Some(bucket) = last_bucket {
            // Find the bucket in the list and select it
            if let Some(win) = window_weak.upgrade() {
                let explorer = win.global::<Explorer>();
                let buckets = explorer.get_buckets();

                // Find bucket index
                let mut bucket_idx: Option<usize> = None;
                for i in 0..buckets.row_count() {
                    if let Some(b) = buckets.row_data(i) {
                        if b.name.to_string() == bucket {
                            bucket_idx = Some(i);
                            break;
                        }
                    }
                }

                if let Some(idx) = bucket_idx {
                    tracing::info!("Restoring bucket: {} (index {})", bucket, idx);
                    explorer.set_selected_bucket_index(idx as i32);

                    // Now load the bucket contents at the last prefix
                    let prefix = last_prefix.unwrap_or_default();
                    win.set_status_message(format!("Restoring location: s3://{}/{}...", bucket, prefix).into());
                    win.set_is_loading(true);

                    Self::load_bucket_contents(state, window_weak, &bucket, &prefix).await;
                } else {
                    tracing::warn!("Last bucket '{}' not found in bucket list", bucket);
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

                // Update state and save settings
                {
                    let mut state_ref = state.borrow_mut();
                    state_ref.current_bucket = Some(bucket.to_string());
                    state_ref.current_prefix = prefix.to_string();
                    state_ref.continuation_token = result.next_token;
                    state_ref.all_objects = result.objects;
                    state_ref.selected_indices.clear();

                    // Save location to settings
                    state_ref.settings.set_location(
                        Some(bucket),
                        if prefix.is_empty() { None } else { Some(prefix) }
                    );
                    if let Err(e) = state_ref.settings.save() {
                        tracing::warn!("Failed to save settings: {}", e);
                    }
                }

                // Update UI
                if let Some(win) = window_weak.upgrade() {
                    let file_list = win.global::<FileList>();
                    let file_model = Rc::new(VecModel::from(file_items));
                    file_list.set_files(ModelRc::from(file_model));
                    file_list.set_selection_count(0);

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

    /// Open a parquet file in the viewer
    async fn open_parquet_file(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
        bucket: &str,
        key: &str,
        file_name: &str,
    ) {
        // Get the current profile name to recreate client
        let profile_name: Option<String>;
        {
            let state_ref = state.borrow();
            profile_name = state_ref.current_profile.clone();
        }

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

        // Download the parquet file
        let data = match client.get_object(bucket, key).await {
            Ok(d) => d,
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Failed to download parquet file: {}", e).into());
                }
                return;
            }
        };

        // Parse the parquet file
        let viewer = ParquetViewerLogic::new();
        let parquet_data = match viewer.read_bytes(&data) {
            Ok(d) => d,
            Err(e) => {
                if let Some(win) = window_weak.upgrade() {
                    win.set_is_loading(false);
                    win.set_status_message(format!("Failed to parse parquet file: {}", e).into());
                }
                return;
            }
        };

        // Store the raw data for load-more functionality
        {
            let mut state_ref = state.borrow_mut();
            state_ref.parquet_data = Some(data);
            state_ref.parquet_file_name = Some(file_name.to_string());
        }

        // Convert to UI model
        let columns: Vec<ParquetColumn> = parquet_data.columns
            .iter()
            .map(|c| {
                // Calculate column width based on name length (min 80px, max 200px)
                let width = (c.name.len() as f32 * 10.0).max(80.0).min(200.0);
                ParquetColumn {
                    name: c.name.clone().into(),
                    data_type: c.data_type.clone().into(),
                    width: width,  // Slint length type maps to f32
                }
            })
            .collect();

        let rows: Vec<ParquetRow> = parquet_data.rows
            .iter()
            .map(|row| {
                let cells: Vec<ParquetCell> = row
                    .iter()
                    .map(|v| ParquetCell { value: v.clone().into() })
                    .collect();
                ParquetRow {
                    cells: ModelRc::from(Rc::new(VecModel::from(cells))),
                }
            })
            .collect();

        // Update UI
        if let Some(win) = window_weak.upgrade() {
            let parquet_viewer = win.global::<ParquetViewer>();

            parquet_viewer.set_file_name(file_name.into());
            parquet_viewer.set_columns(ModelRc::from(Rc::new(VecModel::from(columns))));
            parquet_viewer.set_rows(ModelRc::from(Rc::new(VecModel::from(rows))));
            parquet_viewer.set_total_rows(parquet_data.total_rows as i32);
            parquet_viewer.set_loaded_rows(parquet_data.loaded_rows as i32);
            parquet_viewer.set_is_loading(false);
            parquet_viewer.set_dialog_visible(true);

            win.set_is_loading(false);
            win.set_status_message(format!("Opened: {} ({} rows)", file_name, parquet_data.total_rows).into());
        }
    }

    /// Load more rows from the current parquet file
    async fn load_more_parquet_rows(
        state: Rc<RefCell<AppState>>,
        window_weak: Weak<MainWindow>,
    ) {
        // Get stored parquet data and current loaded count
        let (data, current_loaded, file_name) = {
            let state_ref = state.borrow();
            let data = state_ref.parquet_data.clone();
            let file_name = state_ref.parquet_file_name.clone();

            if let Some(win) = window_weak.upgrade() {
                let parquet_viewer = win.global::<ParquetViewer>();
                (data, parquet_viewer.get_loaded_rows() as usize, file_name)
            } else {
                return;
            }
        };

        let data = match data {
            Some(d) => d,
            None => {
                if let Some(win) = window_weak.upgrade() {
                    let parquet_viewer = win.global::<ParquetViewer>();
                    parquet_viewer.set_is_loading(false);
                }
                return;
            }
        };

        // Parse more rows
        let viewer = ParquetViewerLogic::new();
        let new_limit = current_loaded + 1000; // Load 1000 more rows

        let parquet_data = match viewer.read_bytes_with_limit(&data, new_limit) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("Failed to load more parquet rows: {}", e);
                if let Some(win) = window_weak.upgrade() {
                    let parquet_viewer = win.global::<ParquetViewer>();
                    parquet_viewer.set_is_loading(false);
                }
                return;
            }
        };

        // Convert rows to UI model
        let rows: Vec<ParquetRow> = parquet_data.rows
            .iter()
            .map(|row| {
                let cells: Vec<ParquetCell> = row
                    .iter()
                    .map(|v| ParquetCell { value: v.clone().into() })
                    .collect();
                ParquetRow {
                    cells: ModelRc::from(Rc::new(VecModel::from(cells))),
                }
            })
            .collect();

        // Update UI
        if let Some(win) = window_weak.upgrade() {
            let parquet_viewer = win.global::<ParquetViewer>();

            parquet_viewer.set_rows(ModelRc::from(Rc::new(VecModel::from(rows))));
            parquet_viewer.set_loaded_rows(parquet_data.loaded_rows as i32);
            parquet_viewer.set_is_loading(false);

            tracing::info!(
                "Loaded {} rows (total: {}) for {}",
                parquet_data.loaded_rows,
                parquet_data.total_rows,
                file_name.unwrap_or_default()
            );
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
