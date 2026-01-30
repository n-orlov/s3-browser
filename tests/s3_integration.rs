//! Integration tests for S3 client using MinIO via testcontainers
//!
//! These tests require Docker to be running and use the testcontainers crate
//! to spin up a MinIO instance for realistic S3 testing.
//!
//! Run with: cargo test --test s3_integration
//!
//! Note: Tests are conditionally skipped if Docker is not available.

use s3_browser::s3::{S3Client, S3ClientConfig, S3Object, S3Url};
use std::time::Duration;
use testcontainers::{runners::AsyncRunner, ContainerAsync, ImageExt};
use testcontainers_modules::minio::MinIO;

/// Helper to get MinIO endpoint URL from container
async fn get_minio_endpoint(container: &ContainerAsync<MinIO>) -> String {
    let host = container.get_host().await.expect("Failed to get container host");
    let port = container.get_host_port_ipv4(9000).await.expect("Failed to get MinIO port");
    format!("http://{}:{}", host, port)
}

/// MinIO default credentials
const MINIO_ACCESS_KEY: &str = "minioadmin";
const MINIO_SECRET_KEY: &str = "minioadmin";

/// Test helper to check if Docker is available
fn docker_available() -> bool {
    std::process::Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Helper to create S3 client configured for MinIO
async fn create_minio_client(endpoint: &str) -> S3Client {
    let config = S3ClientConfig {
        endpoint_url: Some(endpoint.to_string()),
        force_path_style: true,
        region: Some("us-east-1".to_string()),
        access_key_id: Some(MINIO_ACCESS_KEY.to_string()),
        secret_access_key: Some(MINIO_SECRET_KEY.to_string()),
    };
    S3Client::with_config(config).await.expect("Failed to create MinIO client")
}

/// Test bucket operations: create bucket and list buckets
#[tokio::test]
async fn test_create_and_list_buckets() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    // Wait for MinIO to be ready
    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create test buckets
    client.create_bucket("test-bucket-1").await.expect("Failed to create bucket 1");
    client.create_bucket("test-bucket-2").await.expect("Failed to create bucket 2");

    // List buckets
    let buckets = client.list_buckets().await.expect("Failed to list buckets");

    assert!(buckets.len() >= 2);
    let bucket_names: Vec<&str> = buckets.iter().map(|b| b.name.as_str()).collect();
    assert!(bucket_names.contains(&"test-bucket-1"));
    assert!(bucket_names.contains(&"test-bucket-2"));
}

/// Test object upload and download
#[tokio::test]
async fn test_put_and_get_object() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("data-bucket").await.expect("Failed to create bucket");

    // Upload object
    let test_data = b"Hello, MinIO! This is test data.";
    client
        .put_object("data-bucket", "test-file.txt", test_data.to_vec())
        .await
        .expect("Failed to put object");

    // Download and verify
    let downloaded = client
        .get_object("data-bucket", "test-file.txt")
        .await
        .expect("Failed to get object");

    assert_eq!(downloaded, test_data.to_vec());
}

/// Test listing objects with prefix
#[tokio::test]
async fn test_list_objects_with_prefix() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("files-bucket").await.expect("Failed to create bucket");

    // Upload files with different prefixes
    client.put_object("files-bucket", "docs/readme.md", b"# Readme".to_vec()).await.unwrap();
    client.put_object("files-bucket", "docs/guide.md", b"# Guide".to_vec()).await.unwrap();
    client.put_object("files-bucket", "src/main.rs", b"fn main() {}".to_vec()).await.unwrap();
    client.put_object("files-bucket", "root.txt", b"root file".to_vec()).await.unwrap();

    // List all objects
    let result = client
        .list_objects("files-bucket", None, None, 1000)
        .await
        .expect("Failed to list objects");

    // Should see folders (docs/, src/) and root.txt
    let keys: Vec<&str> = result.objects.iter().map(|o| o.key.as_str()).collect();
    assert!(keys.contains(&"docs/"));
    assert!(keys.contains(&"src/"));
    assert!(keys.contains(&"root.txt"));

    // List objects in docs/ prefix
    let docs_result = client
        .list_objects("files-bucket", Some("docs/"), None, 1000)
        .await
        .expect("Failed to list docs objects");

    let doc_keys: Vec<&str> = docs_result.objects.iter().map(|o| o.key.as_str()).collect();
    assert!(doc_keys.contains(&"docs/readme.md"));
    assert!(doc_keys.contains(&"docs/guide.md"));
    assert!(!doc_keys.contains(&"src/main.rs"));
    assert!(!doc_keys.contains(&"root.txt"));
}

/// Test object deletion
#[tokio::test]
async fn test_delete_object() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket and upload file
    client.create_bucket("delete-test").await.expect("Failed to create bucket");
    client.put_object("delete-test", "to-delete.txt", b"Delete me".to_vec()).await.unwrap();

    // Verify it exists
    let exists = client.object_exists("delete-test", "to-delete.txt").await.unwrap();
    assert!(exists);

    // Delete the object
    client.delete_object("delete-test", "to-delete.txt").await.expect("Failed to delete");

    // Verify it's gone
    let exists_after = client.object_exists("delete-test", "to-delete.txt").await.unwrap();
    assert!(!exists_after);
}

/// Test multiple deletes (uses individual delete_object due to MinIO Content-MD5 limitation)
/// Note: delete_objects() bulk API works with real AWS S3 but MinIO requires Content-MD5
/// which is not automatically added by AWS SDK v2. For testing, we verify deletes work.
#[tokio::test]
async fn test_delete_multiple_objects() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket and upload multiple files
    client.create_bucket("bulk-delete").await.expect("Failed to create bucket");
    client.put_object("bulk-delete", "file1.txt", b"File 1".to_vec()).await.unwrap();
    client.put_object("bulk-delete", "file2.txt", b"File 2".to_vec()).await.unwrap();
    client.put_object("bulk-delete", "file3.txt", b"File 3".to_vec()).await.unwrap();
    client.put_object("bulk-delete", "keep.txt", b"Keep me".to_vec()).await.unwrap();

    // Delete files individually (MinIO bulk delete requires Content-MD5 not provided by AWS SDK)
    client.delete_object("bulk-delete", "file1.txt").await.expect("Failed to delete file1");
    client.delete_object("bulk-delete", "file2.txt").await.expect("Failed to delete file2");
    client.delete_object("bulk-delete", "file3.txt").await.expect("Failed to delete file3");

    // Verify deleted files are gone
    assert!(!client.object_exists("bulk-delete", "file1.txt").await.unwrap());
    assert!(!client.object_exists("bulk-delete", "file2.txt").await.unwrap());
    assert!(!client.object_exists("bulk-delete", "file3.txt").await.unwrap());

    // Verify kept file still exists
    assert!(client.object_exists("bulk-delete", "keep.txt").await.unwrap());
}

/// Test copy and rename operations
#[tokio::test]
async fn test_copy_and_rename_object() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket and upload file
    client.create_bucket("copy-test").await.expect("Failed to create bucket");
    let original_data = b"Original content for copy test";
    client.put_object("copy-test", "original.txt", original_data.to_vec()).await.unwrap();

    // Copy to new key
    client.copy_object("copy-test", "original.txt", "copy-test", "copied.txt").await.unwrap();

    // Verify both exist with same content
    let original_content = client.get_object("copy-test", "original.txt").await.unwrap();
    let copied_content = client.get_object("copy-test", "copied.txt").await.unwrap();
    assert_eq!(original_content, copied_content);
    assert_eq!(original_content, original_data.to_vec());

    // Test rename (copy + delete)
    client.rename_object("copy-test", "original.txt", "renamed.txt").await.unwrap();

    // Original should be gone, renamed should exist
    assert!(!client.object_exists("copy-test", "original.txt").await.unwrap());
    assert!(client.object_exists("copy-test", "renamed.txt").await.unwrap());

    let renamed_content = client.get_object("copy-test", "renamed.txt").await.unwrap();
    assert_eq!(renamed_content, original_data.to_vec());
}

/// Test pagination with many objects
#[tokio::test]
async fn test_pagination_with_many_objects() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("pagination-test").await.expect("Failed to create bucket");

    // Upload 25 objects
    for i in 0..25 {
        let key = format!("file-{:04}.txt", i);
        let data = format!("Content for file {}", i);
        client.put_object("pagination-test", &key, data.into_bytes()).await.unwrap();
    }

    // Test pagination with max_keys = 10
    let first_page = client
        .list_objects("pagination-test", None, None, 10)
        .await
        .expect("Failed to list first page");

    assert_eq!(first_page.objects.len(), 10);
    assert!(first_page.is_truncated);
    assert!(first_page.next_token.is_some());

    // Get second page
    let second_page = client
        .list_objects("pagination-test", None, first_page.next_token.as_deref(), 10)
        .await
        .expect("Failed to list second page");

    assert_eq!(second_page.objects.len(), 10);
    assert!(second_page.is_truncated);

    // Get third page
    let third_page = client
        .list_objects("pagination-test", None, second_page.next_token.as_deref(), 10)
        .await
        .expect("Failed to list third page");

    assert_eq!(third_page.objects.len(), 5);
    assert!(!third_page.is_truncated);

    // Test list_all_objects helper
    let all_objects = client
        .list_all_objects("pagination-test", None)
        .await
        .expect("Failed to list all objects");

    assert_eq!(all_objects.len(), 25);
}

/// Test object_exists method
#[tokio::test]
async fn test_object_exists() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("exists-test").await.expect("Failed to create bucket");

    // Non-existent object
    let exists = client.object_exists("exists-test", "nonexistent.txt").await.unwrap();
    assert!(!exists);

    // Upload object
    client.put_object("exists-test", "exists.txt", b"I exist".to_vec()).await.unwrap();

    // Now it should exist
    let exists = client.object_exists("exists-test", "exists.txt").await.unwrap();
    assert!(exists);
}

/// Test handling large files
#[tokio::test]
async fn test_large_file_upload_download() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("large-file-test").await.expect("Failed to create bucket");

    // Create 1 MB of test data
    let large_data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();

    // Upload
    client.put_object("large-file-test", "large.bin", large_data.clone()).await.unwrap();

    // Download and verify
    let downloaded = client.get_object("large-file-test", "large.bin").await.unwrap();
    assert_eq!(downloaded.len(), large_data.len());
    assert_eq!(downloaded, large_data);
}

/// Test S3 URL parsing doesn't panic on various inputs
#[test]
fn test_s3_url_parsing_fuzz() {
    let test_cases = vec![
        "",
        "s3://",
        "s3:///",
        "s3://bucket",
        "s3://bucket/",
        "s3://bucket/key",
        "s3://bucket/deep/nested/key/path.txt",
        "s3://bucket-with-dashes/key_with_underscores",
        "https://",
        "https://bucket.s3.us-east-1.amazonaws.com",
        "https://bucket.s3.us-east-1.amazonaws.com/",
        "https://bucket.s3.us-east-1.amazonaws.com/key",
        "https://s3.eu-west-1.amazonaws.com/bucket/key",
        "not-a-url",
        "ftp://bucket/key",
        "file:///local/path",
    ];

    for test_url in test_cases {
        // Should not panic regardless of input
        let _ = S3Url::parse(test_url);
    }
}

/// Test S3Object display name edge cases
#[test]
fn test_s3_object_display_name_edge_cases() {
    let test_cases = vec![
        ("", ""),
        ("file.txt", "file.txt"),
        ("folder/", "folder"),
        ("folder/file.txt", "file.txt"),
        ("a/b/c/d/file.txt", "file.txt"),
        ("trailing/slash/", "slash"),
        ("//double//slashes//", "slashes"),
    ];

    for (key, expected) in test_cases {
        let obj = S3Object {
            key: key.to_string(),
            size: 0,
            last_modified: None,
            is_folder: key.ends_with('/'),
            etag: None,
            storage_class: None,
        };
        assert_eq!(
            obj.display_name(),
            expected,
            "Failed for key: '{}'",
            key
        );
    }
}

/// Test size formatting across all boundaries
#[test]
fn test_s3_object_size_boundaries() {
    fn make_obj(size: u64) -> S3Object {
        S3Object {
            key: "test".to_string(),
            size,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        }
    }

    // Test exact boundaries
    assert_eq!(make_obj(0).size_string(), "0 B");
    assert_eq!(make_obj(1).size_string(), "1 B");
    assert_eq!(make_obj(1023).size_string(), "1023 B");
    assert_eq!(make_obj(1024).size_string(), "1.00 KB");
    assert!(make_obj(1024 * 1024 - 1).size_string().contains("KB"));
    assert_eq!(make_obj(1024 * 1024).size_string(), "1.00 MB");
    assert_eq!(make_obj(1024 * 1024 * 1024).size_string(), "1.00 GB");
    assert_eq!(make_obj(1024 * 1024 * 1024 * 1024).size_string(), "1.00 TB");
}

/// Test different file types in a bucket
#[tokio::test]
async fn test_various_file_types() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("file-types").await.expect("Failed to create bucket");

    // Upload various file types
    let json_data = r#"{"name": "test", "value": 42}"#;
    let yaml_data = "name: test\nvalue: 42";
    let csv_data = "name,value\ntest,42";

    client.put_object("file-types", "data.json", json_data.as_bytes().to_vec()).await.unwrap();
    client.put_object("file-types", "data.yaml", yaml_data.as_bytes().to_vec()).await.unwrap();
    client.put_object("file-types", "data.csv", csv_data.as_bytes().to_vec()).await.unwrap();

    // Verify downloads
    let json_downloaded = client.get_object("file-types", "data.json").await.unwrap();
    assert_eq!(String::from_utf8_lossy(&json_downloaded), json_data);

    let yaml_downloaded = client.get_object("file-types", "data.yaml").await.unwrap();
    assert_eq!(String::from_utf8_lossy(&yaml_downloaded), yaml_data);

    let csv_downloaded = client.get_object("file-types", "data.csv").await.unwrap();
    assert_eq!(String::from_utf8_lossy(&csv_downloaded), csv_data);
}

/// Test S3ClientConfig defaults
#[test]
fn test_s3_client_config_defaults() {
    let config = S3ClientConfig::default();
    assert!(config.endpoint_url.is_none());
    assert!(!config.force_path_style);
    assert!(config.region.is_none());
    assert!(config.access_key_id.is_none());
    assert!(config.secret_access_key.is_none());
}

/// Test S3ClientConfig with custom values
#[test]
fn test_s3_client_config_custom() {
    let config = S3ClientConfig {
        endpoint_url: Some("http://localhost:9000".to_string()),
        force_path_style: true,
        region: Some("eu-west-1".to_string()),
        access_key_id: Some("access_key".to_string()),
        secret_access_key: Some("secret_key".to_string()),
    };

    assert_eq!(config.endpoint_url, Some("http://localhost:9000".to_string()));
    assert!(config.force_path_style);
    assert_eq!(config.region, Some("eu-west-1".to_string()));
    assert_eq!(config.access_key_id, Some("access_key".to_string()));
    assert_eq!(config.secret_access_key, Some("secret_key".to_string()));
}

/// Test empty bucket listing
#[tokio::test]
async fn test_empty_bucket() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create empty bucket
    client.create_bucket("empty-bucket").await.expect("Failed to create bucket");

    // List objects should return empty
    let result = client.list_objects("empty-bucket", None, None, 1000).await.unwrap();
    assert!(result.objects.is_empty());
    assert!(!result.is_truncated);
    assert!(result.next_token.is_none());
}

/// Test special characters in keys
#[tokio::test]
async fn test_special_characters_in_keys() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    let client = create_minio_client(&endpoint).await;

    // Create bucket
    client.create_bucket("special-chars").await.expect("Failed to create bucket");

    // Upload files with special characters in names
    let special_keys = vec![
        "file with spaces.txt",
        "file-with-dashes.txt",
        "file_with_underscores.txt",
        "file.multiple.dots.txt",
        "UPPERCASE.TXT",
        "MixedCase.Txt",
    ];

    for key in &special_keys {
        let data = format!("Content for {}", key);
        client.put_object("special-chars", key, data.into_bytes()).await.unwrap();
    }

    // Verify all files can be retrieved
    for key in &special_keys {
        let data = client.get_object("special-chars", key).await.unwrap();
        let content = String::from_utf8_lossy(&data);
        assert!(content.contains(key), "Content mismatch for key: {}", key);
    }
}

/// Test region configuration
#[tokio::test]
async fn test_region_configuration() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let container = MinIO::default()
        .with_env_var("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env_var("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .start()
        .await
        .expect("Failed to start MinIO container");

    let endpoint = get_minio_endpoint(&container).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    // Test with different region
    let config = S3ClientConfig {
        endpoint_url: Some(endpoint.clone()),
        force_path_style: true,
        region: Some("eu-west-1".to_string()),
        access_key_id: Some(MINIO_ACCESS_KEY.to_string()),
        secret_access_key: Some(MINIO_SECRET_KEY.to_string()),
    };

    let client = S3Client::with_config(config).await.expect("Failed to create client");
    assert_eq!(client.region(), "eu-west-1");
}
