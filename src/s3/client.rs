//! AWS S3 client wrapper

use anyhow::Result;
use aws_sdk_s3::Client;
use crate::s3::types::{Bucket, S3Object};

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
        let response = self.client.list_buckets().send().await?;

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
    pub async fn list_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
        continuation_token: Option<&str>,
        max_keys: i32,
    ) -> Result<(Vec<S3Object>, Option<String>)> {
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

        let response = request.send().await?;

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

        Ok((objects, next_token))
    }

    /// Download an object to bytes
    pub async fn get_object(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let response = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await?;

        let data = response.body.collect().await?;
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
            .await?;

        Ok(())
    }

    /// Delete an object
    pub async fn delete_object(&self, bucket: &str, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await?;

        Ok(())
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
            .copy_source(copy_source)
            .send()
            .await?;

        Ok(())
    }

    /// Get the current region
    pub fn region(&self) -> &str {
        &self.current_region
    }
}
