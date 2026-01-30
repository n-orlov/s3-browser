//! Image viewer module for PNG, JPG, GIF preview

use anyhow::{anyhow, Result};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

/// Supported image formats
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageType {
    Png,
    Jpeg,
    Gif,
}

impl ImageType {
    /// Detect image type from file extension
    pub fn from_extension(filename: &str) -> Option<Self> {
        let lower = filename.to_lowercase();
        if lower.ends_with(".png") {
            Some(ImageType::Png)
        } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            Some(ImageType::Jpeg)
        } else if lower.ends_with(".gif") {
            Some(ImageType::Gif)
        } else {
            None
        }
    }

    /// Get the ImageFormat for this type
    fn to_image_format(self) -> ImageFormat {
        match self {
            ImageType::Png => ImageFormat::Png,
            ImageType::Jpeg => ImageFormat::Jpeg,
            ImageType::Gif => ImageFormat::Gif,
        }
    }
}

/// Image data for display in UI
#[derive(Debug, Clone)]
pub struct ImageData {
    /// Image width in pixels
    pub width: u32,
    /// Image height in pixels
    pub height: u32,
    /// RGBA pixel data (4 bytes per pixel)
    pub rgba_data: Vec<u8>,
    /// Original file size in bytes
    pub file_size: usize,
    /// Detected image format
    pub format: ImageType,
}

/// Image viewer for loading and processing images
pub struct ImageViewer;

impl ImageViewer {
    /// Create a new image viewer
    pub fn new() -> Self {
        Self
    }

    /// Load image from raw bytes with format hint from filename
    pub fn load_bytes(&self, data: &[u8], filename: &str) -> Result<ImageData> {
        let format = ImageType::from_extension(filename)
            .ok_or_else(|| anyhow!("Unsupported image format for file: {}", filename))?;

        self.load_bytes_with_format(data, format)
    }

    /// Load image from raw bytes with explicit format
    pub fn load_bytes_with_format(&self, data: &[u8], format: ImageType) -> Result<ImageData> {
        let file_size = data.len();
        let cursor = Cursor::new(data);

        // Load the image using the image crate
        let img = image::load(cursor, format.to_image_format())
            .map_err(|e| anyhow!("Failed to decode image: {}", e))?;

        // Convert to RGBA8
        let rgba = img.to_rgba8();
        let width = rgba.width();
        let height = rgba.height();
        let rgba_data = rgba.into_raw();

        Ok(ImageData {
            width,
            height,
            rgba_data,
            file_size,
            format,
        })
    }

    /// Load image with automatic format detection
    pub fn load_bytes_auto(&self, data: &[u8]) -> Result<ImageData> {
        let file_size = data.len();
        let cursor = Cursor::new(data);

        // Try to guess the format from the data
        let format = image::guess_format(data)
            .map_err(|e| anyhow!("Failed to detect image format: {}", e))?;

        let img_type = match format {
            ImageFormat::Png => ImageType::Png,
            ImageFormat::Jpeg => ImageType::Jpeg,
            ImageFormat::Gif => ImageType::Gif,
            _ => return Err(anyhow!("Unsupported image format: {:?}", format)),
        };

        // Load the image
        let img = image::load(cursor, format)
            .map_err(|e| anyhow!("Failed to decode image: {}", e))?;

        // Convert to RGBA8
        let rgba = img.to_rgba8();
        let width = rgba.width();
        let height = rgba.height();
        let rgba_data = rgba.into_raw();

        Ok(ImageData {
            width,
            height,
            rgba_data,
            file_size,
            format: img_type,
        })
    }

    /// Scale image to fit within max dimensions while preserving aspect ratio
    pub fn scale_to_fit(img: &DynamicImage, max_width: u32, max_height: u32) -> DynamicImage {
        let (orig_width, orig_height) = (img.width(), img.height());

        // Check if scaling is needed
        if orig_width <= max_width && orig_height <= max_height {
            return img.clone();
        }

        // Calculate scale factor
        let width_ratio = max_width as f64 / orig_width as f64;
        let height_ratio = max_height as f64 / orig_height as f64;
        let scale = width_ratio.min(height_ratio);

        let new_width = (orig_width as f64 * scale) as u32;
        let new_height = (orig_height as f64 * scale) as u32;

        img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
    }
}

impl Default for ImageViewer {
    fn default() -> Self {
        Self::new()
    }
}

/// Format file size for display
pub fn format_file_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_type_from_extension() {
        assert_eq!(ImageType::from_extension("test.png"), Some(ImageType::Png));
        assert_eq!(ImageType::from_extension("test.PNG"), Some(ImageType::Png));
        assert_eq!(ImageType::from_extension("test.jpg"), Some(ImageType::Jpeg));
        assert_eq!(ImageType::from_extension("test.jpeg"), Some(ImageType::Jpeg));
        assert_eq!(ImageType::from_extension("test.JPEG"), Some(ImageType::Jpeg));
        assert_eq!(ImageType::from_extension("test.gif"), Some(ImageType::Gif));
        assert_eq!(ImageType::from_extension("test.GIF"), Some(ImageType::Gif));
        assert_eq!(ImageType::from_extension("test.txt"), None);
        assert_eq!(ImageType::from_extension("test.bmp"), None);
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(500), "500 B");
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(2048), "2.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_file_size(1024 * 1024 * 2), "2.0 MB");
    }

    #[test]
    fn test_load_png_image() {
        // Create a minimal valid PNG using the image crate
        use image::{RgbImage, ImageBuffer};
        use std::io::Cursor;

        // Create a 2x2 red image
        let img: RgbImage = ImageBuffer::from_fn(2, 2, |_x, _y| {
            image::Rgb([255u8, 0u8, 0u8])
        });

        // Encode to PNG
        let mut png_data: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut png_data);
        img.write_to(&mut cursor, ImageFormat::Png).unwrap();

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&png_data, "test.png");
        assert!(result.is_ok(), "Failed to load PNG: {:?}", result.err());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 2);
        assert_eq!(img_data.height, 2);
        assert_eq!(img_data.format, ImageType::Png);
        // RGBA has 4 bytes per pixel
        assert_eq!(img_data.rgba_data.len(), 2 * 2 * 4);
    }

    #[test]
    fn test_load_invalid_image() {
        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(b"not an image", "test.png");
        assert!(result.is_err());
    }

    #[test]
    fn test_load_unsupported_extension() {
        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(b"some data", "test.bmp");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unsupported image format"));
    }

    #[test]
    fn test_image_viewer_default() {
        let viewer = ImageViewer::default();
        // Just verify it can be created
        assert!(viewer.load_bytes(b"", "test.txt").is_err());
    }
}
