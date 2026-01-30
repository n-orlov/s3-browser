//! Integration tests for S3 client using MinIO via testcontainers
//!
//! These tests require Docker to be running and use the testcontainers crate
//! to spin up a MinIO instance for realistic S3 testing.
//!
//! Run with: cargo test --test s3_integration -- --ignored
//!
//! Note: These tests are ignored by default because they require Docker.


/// Test helper to check if Docker is available
fn docker_available() -> bool {
    std::process::Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Placeholder for MinIO testcontainer integration
/// TODO: Implement when testcontainers-modules is added to dependencies
#[test]
#[ignore = "Requires Docker and testcontainers setup"]
fn test_minio_container_placeholder() {
    if !docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    // This is a placeholder for future MinIO integration testing
    // When testcontainers-modules is added, implement as follows:
    //
    // use testcontainers::{clients::Cli, core::WaitFor};
    // use testcontainers_modules::minio::MinIO;
    //
    // let docker = Cli::default();
    // let minio = docker.run(MinIO::default());
    // let endpoint = format!("http://localhost:{}", minio.get_host_port_ipv4(9000));
    //
    // Then create S3 client pointing to MinIO endpoint
    println!("MinIO integration test placeholder");
}

/// Unit test to verify S3 URL parsing doesn't panic
#[test]
fn test_s3_url_parsing_fuzz() {
    use s3_browser::s3::types::S3Url;

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
    use s3_browser::s3::types::S3Object;

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
    use s3_browser::s3::types::S3Object;

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
    assert_eq!(make_obj(1024 * 1024 - 1).size_string().contains("KB"), true);
    assert_eq!(make_obj(1024 * 1024).size_string(), "1.00 MB");
    assert_eq!(make_obj(1024 * 1024 * 1024).size_string(), "1.00 GB");
    assert_eq!(make_obj(1024 * 1024 * 1024 * 1024).size_string(), "1.00 TB");
}
