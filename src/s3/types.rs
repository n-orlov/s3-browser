//! S3 data types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents an S3 bucket
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    pub name: String,
    pub creation_date: Option<DateTime<Utc>>,
    pub region: Option<String>,
}

/// Represents an S3 object (file or folder)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Object {
    pub key: String,
    pub size: u64,
    pub last_modified: Option<DateTime<Utc>>,
    pub is_folder: bool,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

impl S3Object {
    /// Get the display name (last component of the key)
    pub fn display_name(&self) -> &str {
        self.key
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(&self.key)
    }

    /// Get a human-readable size string
    pub fn size_string(&self) -> String {
        if self.is_folder {
            return String::from("-");
        }

        const KB: u64 = 1024;
        const MB: u64 = KB * 1024;
        const GB: u64 = MB * 1024;
        const TB: u64 = GB * 1024;

        if self.size >= TB {
            format!("{:.2} TB", self.size as f64 / TB as f64)
        } else if self.size >= GB {
            format!("{:.2} GB", self.size as f64 / GB as f64)
        } else if self.size >= MB {
            format!("{:.2} MB", self.size as f64 / MB as f64)
        } else if self.size >= KB {
            format!("{:.2} KB", self.size as f64 / KB as f64)
        } else {
            format!("{} B", self.size)
        }
    }
}

/// S3 URL parsed components
#[derive(Debug, Clone)]
pub struct S3Url {
    pub bucket: String,
    pub key: String,
}

impl S3Url {
    /// Parse an S3 URL (supports s3:// and https:// formats)
    pub fn parse(url: &str) -> Option<Self> {
        // s3://bucket/key format
        if let Some(rest) = url.strip_prefix("s3://") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            return Some(S3Url {
                bucket: parts[0].to_string(),
                key: parts.get(1).unwrap_or(&"").to_string(),
            });
        }

        // https://bucket.s3.region.amazonaws.com/key format
        if url.starts_with("https://") || url.starts_with("http://") {
            if let Ok(parsed) = url::Url::parse(url) {
                if let Some(host) = parsed.host_str() {
                    // Virtual-hosted style: bucket.s3.region.amazonaws.com
                    if host.contains(".s3.") && host.ends_with(".amazonaws.com") {
                        let bucket = host.split(".s3.").next()?;
                        let key = parsed.path().trim_start_matches('/');
                        return Some(S3Url {
                            bucket: bucket.to_string(),
                            key: key.to_string(),
                        });
                    }
                    // Path style: s3.region.amazonaws.com/bucket/key
                    if host.starts_with("s3.") && host.ends_with(".amazonaws.com") {
                        let path = parsed.path().trim_start_matches('/');
                        let parts: Vec<&str> = path.splitn(2, '/').collect();
                        return Some(S3Url {
                            bucket: parts[0].to_string(),
                            key: parts.get(1).unwrap_or(&"").to_string(),
                        });
                    }
                }
            }
        }

        None
    }

    /// Convert to s3:// URL format
    pub fn to_s3_url(&self) -> String {
        if self.key.is_empty() {
            format!("s3://{}", self.bucket)
        } else {
            format!("s3://{}/{}", self.bucket, self.key)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // S3Url parsing tests

    #[test]
    fn test_s3_url_parse_s3_scheme() {
        let url = S3Url::parse("s3://my-bucket/path/to/file.txt").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "path/to/file.txt");
    }

    #[test]
    fn test_s3_url_parse_s3_bucket_only() {
        let url = S3Url::parse("s3://my-bucket").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "");
    }

    #[test]
    fn test_s3_url_parse_s3_with_trailing_slash() {
        let url = S3Url::parse("s3://my-bucket/").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "");
    }

    #[test]
    fn test_s3_url_parse_s3_deep_path() {
        let url = S3Url::parse("s3://bucket/a/b/c/d/e/f.txt").unwrap();
        assert_eq!(url.bucket, "bucket");
        assert_eq!(url.key, "a/b/c/d/e/f.txt");
    }

    #[test]
    fn test_s3_url_parse_https_virtual_hosted() {
        let url = S3Url::parse("https://my-bucket.s3.eu-west-1.amazonaws.com/path/to/file.txt").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "path/to/file.txt");
    }

    #[test]
    fn test_s3_url_parse_https_virtual_hosted_us_east_1() {
        let url = S3Url::parse("https://my-bucket.s3.us-east-1.amazonaws.com/file.txt").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "file.txt");
    }

    #[test]
    fn test_s3_url_parse_https_path_style() {
        let url = S3Url::parse("https://s3.eu-west-1.amazonaws.com/my-bucket/path/to/file.txt").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "path/to/file.txt");
    }

    #[test]
    fn test_s3_url_parse_http() {
        let url = S3Url::parse("http://my-bucket.s3.us-east-1.amazonaws.com/file.txt").unwrap();
        assert_eq!(url.bucket, "my-bucket");
        assert_eq!(url.key, "file.txt");
    }

    #[test]
    fn test_s3_url_parse_invalid() {
        assert!(S3Url::parse("https://example.com/file.txt").is_none());
        assert!(S3Url::parse("ftp://bucket/key").is_none());
        assert!(S3Url::parse("not-a-url").is_none());
        assert!(S3Url::parse("").is_none());
    }

    #[test]
    fn test_s3_url_to_s3_url() {
        let url = S3Url {
            bucket: "test-bucket".to_string(),
            key: "folder/file.txt".to_string(),
        };
        assert_eq!(url.to_s3_url(), "s3://test-bucket/folder/file.txt");
    }

    #[test]
    fn test_s3_url_to_s3_url_bucket_only() {
        let url = S3Url {
            bucket: "test-bucket".to_string(),
            key: String::new(),
        };
        assert_eq!(url.to_s3_url(), "s3://test-bucket");
    }

    // S3Object tests

    #[test]
    fn test_s3_object_display_name() {
        let obj = S3Object {
            key: "path/to/myfile.txt".to_string(),
            size: 1024,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.display_name(), "myfile.txt");
    }

    #[test]
    fn test_s3_object_display_name_root() {
        let obj = S3Object {
            key: "myfile.txt".to_string(),
            size: 1024,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.display_name(), "myfile.txt");
    }

    #[test]
    fn test_s3_object_display_name_folder() {
        let obj = S3Object {
            key: "path/to/folder/".to_string(),
            size: 0,
            last_modified: None,
            is_folder: true,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.display_name(), "folder");
    }

    #[test]
    fn test_s3_object_size_string() {
        let obj = S3Object {
            key: "file.txt".to_string(),
            size: 1536,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "1.50 KB");
    }

    #[test]
    fn test_s3_object_size_string_bytes() {
        let obj = S3Object {
            key: "file.txt".to_string(),
            size: 100,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "100 B");
    }

    #[test]
    fn test_s3_object_size_string_mb() {
        let obj = S3Object {
            key: "file.txt".to_string(),
            size: 5 * 1024 * 1024,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "5.00 MB");
    }

    #[test]
    fn test_s3_object_size_string_gb() {
        let obj = S3Object {
            key: "file.txt".to_string(),
            size: 2 * 1024 * 1024 * 1024,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "2.00 GB");
    }

    #[test]
    fn test_s3_object_size_string_tb() {
        let obj = S3Object {
            key: "file.txt".to_string(),
            size: 3 * 1024 * 1024 * 1024 * 1024,
            last_modified: None,
            is_folder: false,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "3.00 TB");
    }

    #[test]
    fn test_s3_object_size_string_folder() {
        let obj = S3Object {
            key: "folder/".to_string(),
            size: 0,
            last_modified: None,
            is_folder: true,
            etag: None,
            storage_class: None,
        };
        assert_eq!(obj.size_string(), "-");
    }

    // Bucket tests

    #[test]
    fn test_bucket_default() {
        let bucket = Bucket {
            name: "test-bucket".to_string(),
            creation_date: None,
            region: None,
        };
        assert_eq!(bucket.name, "test-bucket");
        assert!(bucket.creation_date.is_none());
        assert!(bucket.region.is_none());
    }

    #[test]
    fn test_bucket_with_region() {
        let bucket = Bucket {
            name: "test-bucket".to_string(),
            creation_date: None,
            region: Some("eu-west-1".to_string()),
        };
        assert_eq!(bucket.region, Some("eu-west-1".to_string()));
    }
}
