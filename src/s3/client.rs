//! AWS S3 client wrapper
//!
//! This module provides a high-level wrapper around the AWS S3 SDK client,
//! handling common operations like listing buckets, objects, and managing files.

use anyhow::{Context, Result};
use aws_sdk_s3::Client;
use crate::s3::types::{Bucket, S3Object};

/// Result of a list objects operation with pagination info
#[derive(Debug, Clone)]
pub struct ListObjectsResult {
    /// Objects found (files and folders)
    pub objects: Vec<S3Object>,
    /// Continuation token for next page (None if no more pages)
    pub next_token: Option<String>,
    /// Whether there are more results available
    pub is_truncated: bool,
}

/// S3 client wrapper with high-level operations
pub struct S3Client {
    client: Client,
    current_region: String,
}

impl S3Client {
    /// Create a new S3 client for the given profile
    pub async fn new(profile_name: Option<&str>) -> Result<Self> {
        let config = if let Some(profile) = profile_name {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .profile_name(profile)
                .load()
                .await
        } else {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .load()
                .await
        };

        let client = Client::new(&config);
        let current_region = config
            .region()
            .map(|r| r.to_string())
            .unwrap_or_else(|| "us-east-1".to_string());

        Ok(Self {
            client,
            current_region,
        })
    }

    /// List all accessible buckets
    pub async fn list_buckets(&self) -> Result<Vec<Bucket>> {
        let response = self
            .client
            .list_buckets()
            .send()
            .await
            .context("Failed to list S3 buckets")?;

        let buckets = response
            .buckets()
            .iter()
            .map(|b| Bucket {
                name: b.name().unwrap_or_default().to_string(),
                creation_date: b.creation_date().map(|d| {
                    chrono::DateTime::from_timestamp(d.secs(), d.subsec_nanos())
                        .unwrap_or_default()
                }),
                region: None,
            })
            .collect();

        Ok(buckets)
    }

    /// List objects in a bucket with optional prefix
    ///
    /// Returns objects and common prefixes (folders) with pagination support.
    /// Use `continuation_token` from previous result to get next page.
    pub async fn list_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
        continuation_token: Option<&str>,
        max_keys: i32,
    ) -> Result<ListObjectsResult> {
        let mut request = self
            .client
            .list_objects_v2()
            .bucket(bucket)
            .delimiter("/")
            .max_keys(max_keys);

        if let Some(p) = prefix {
            request = request.prefix(p);
        }

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request
            .send()
            .await
            .with_context(|| format!("Failed to list objects in bucket '{}'", bucket))?;

        let mut objects = Vec::new();

        // Add common prefixes (folders)
        for prefix in response.common_prefixes() {
            if let Some(p) = prefix.prefix() {
                objects.push(S3Object {
                    key: p.to_string(),
                    size: 0,
                    last_modified: None,
                    is_folder: true,
                    etag: None,
                    storage_class: None,
                });
            }
        }

        // Add objects (files)
        for obj in response.contents() {
            objects.push(S3Object {
                key: obj.key().unwrap_or_default().to_string(),
                size: obj.size().unwrap_or(0) as u64,
                last_modified: obj.last_modified().map(|d| {
                    chrono::DateTime::from_timestamp(d.secs(), d.subsec_nanos())
                        .unwrap_or_default()
                }),
                is_folder: false,
                etag: obj.e_tag().map(|s| s.to_string()),
                storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
            });
        }

        let next_token = response.next_continuation_token().map(|s| s.to_string());
        let is_truncated = response.is_truncated().unwrap_or(false);

        Ok(ListObjectsResult {
            objects,
            next_token,
            is_truncated,
        })
    }

    /// List all objects in a bucket/prefix without pagination
    ///
    /// Automatically handles pagination to retrieve all objects.
    /// Use with caution on large prefixes - consider using `list_objects` with
    /// pagination for better control over memory and cancellation.
    pub async fn list_all_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
    ) -> Result<Vec<S3Object>> {
        let mut all_objects = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let result = self
                .list_objects(bucket, prefix, continuation_token.as_deref(), 1000)
                .await?;

            all_objects.extend(result.objects);

            if result.next_token.is_none() {
                break;
            }
            continuation_token = result.next_token;
        }

        Ok(all_objects)
    }

    /// Download an object to bytes
    pub async fn get_object(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let response = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("Failed to download object '{}/{}' ", bucket, key))?;

        let data = response
            .body
            .collect()
            .await
            .with_context(|| format!("Failed to read object body for '{}/{}'", bucket, key))?;
        Ok(data.into_bytes().to_vec())
    }

    /// Upload bytes as an object
    pub async fn put_object(&self, bucket: &str, key: &str, data: Vec<u8>) -> Result<()> {
        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(data.into())
            .send()
            .await
            .with_context(|| format!("Failed to upload object '{}/{}'", bucket, key))?;

        Ok(())
    }

    /// Delete an object
    pub async fn delete_object(&self, bucket: &str, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("Failed to delete object '{}/{}'", bucket, key))?;

        Ok(())
    }

    /// Delete multiple objects at once
    pub async fn delete_objects(&self, bucket: &str, keys: &[&str]) -> Result<Vec<String>> {
        use aws_sdk_s3::types::{Delete, ObjectIdentifier};

        if keys.is_empty() {
            return Ok(Vec::new());
        }

        let objects: Vec<ObjectIdentifier> = keys
            .iter()
            .filter_map(|key| ObjectIdentifier::builder().key(*key).build().ok())
            .collect();

        let delete = Delete::builder()
            .set_objects(Some(objects))
            .build()
            .context("Failed to build delete request")?;

        let response = self
            .client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .with_context(|| format!("Failed to delete objects from bucket '{}'", bucket))?;

        // Return keys that failed to delete
        let errors: Vec<String> = response
            .errors()
            .iter()
            .filter_map(|e| e.key().map(|k| k.to_string()))
            .collect();

        Ok(errors)
    }

    /// Copy an object (used for rename)
    pub async fn copy_object(
        &self,
        source_bucket: &str,
        source_key: &str,
        dest_bucket: &str,
        dest_key: &str,
    ) -> Result<()> {
        let copy_source = format!("{}/{}", source_bucket, source_key);

        self.client
            .copy_object()
            .bucket(dest_bucket)
            .key(dest_key)
            .copy_source(&copy_source)
            .send()
            .await
            .with_context(|| {
                format!(
                    "Failed to copy object from '{}/{}' to '{}/{}'",
                    source_bucket, source_key, dest_bucket, dest_key
                )
            })?;

        Ok(())
    }

    /// Rename an object (copy + delete)
    pub async fn rename_object(
        &self,
        bucket: &str,
        old_key: &str,
        new_key: &str,
    ) -> Result<()> {
        // Copy to new location
        self.copy_object(bucket, old_key, bucket, new_key).await?;

        // Delete original
        self.delete_object(bucket, old_key).await?;

        Ok(())
    }

    /// Check if an object exists
    pub async fn object_exists(&self, bucket: &str, key: &str) -> Result<bool> {
        match self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(e) => {
                // Check if it's a NotFound error
                if let Some(service_err) = e.as_service_error() {
                    if service_err.is_not_found() {
                        return Ok(false);
                    }
                }
                Err(e).with_context(|| format!("Failed to check if object exists: '{}/{}'", bucket, key))
            }
        }
    }

    /// Get the current region
    pub fn region(&self) -> &str {
        &self.current_region
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_objects_result_default() {
        let result = ListObjectsResult {
            objects: vec![],
            next_token: None,
            is_truncated: false,
        };
        assert!(result.objects.is_empty());
        assert!(result.next_token.is_none());
        assert!(!result.is_truncated);
    }

    #[test]
    fn test_list_objects_result_with_pagination() {
        let result = ListObjectsResult {
            objects: vec![S3Object {
                key: "test.txt".to_string(),
                size: 100,
                last_modified: None,
                is_folder: false,
                etag: None,
                storage_class: None,
            }],
            next_token: Some("abc123".to_string()),
            is_truncated: true,
        };
        assert_eq!(result.objects.len(), 1);
        assert_eq!(result.next_token, Some("abc123".to_string()));
        assert!(result.is_truncated);
    }
}
