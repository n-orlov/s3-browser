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
    use image::{RgbImage, ImageBuffer, RgbaImage};

    /// Helper to create a test PNG
    fn create_test_png(width: u32, height: u32) -> Vec<u8> {
        let img: RgbImage = ImageBuffer::from_fn(width, height, |x, y| {
            image::Rgb([(x * 10) as u8, (y * 10) as u8, 128u8])
        });

        let mut data: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut data);
        img.write_to(&mut cursor, ImageFormat::Png).unwrap();
        data
    }

    /// Helper to create a test JPEG
    fn create_test_jpeg(width: u32, height: u32) -> Vec<u8> {
        let img: RgbImage = ImageBuffer::from_fn(width, height, |_, _| {
            image::Rgb([100u8, 150u8, 200u8])
        });

        let mut data: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut data);
        img.write_to(&mut cursor, ImageFormat::Jpeg).unwrap();
        data
    }

    /// Helper to create a test GIF
    fn create_test_gif(width: u32, height: u32) -> Vec<u8> {
        let img: RgbaImage = ImageBuffer::from_fn(width, height, |_, _| {
            image::Rgba([200u8, 100u8, 50u8, 255u8])
        });

        let mut data: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut data);
        img.write_to(&mut cursor, ImageFormat::Gif).unwrap();
        data
    }

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
    fn test_image_type_from_extension_edge_cases() {
        // No extension
        assert_eq!(ImageType::from_extension("noextension"), None);
        // Empty string
        assert_eq!(ImageType::from_extension(""), None);
        // Just extension
        assert_eq!(ImageType::from_extension(".png"), Some(ImageType::Png));
        // Multiple dots
        assert_eq!(ImageType::from_extension("file.backup.png"), Some(ImageType::Png));
        // Mixed case
        assert_eq!(ImageType::from_extension("FILE.JpG"), Some(ImageType::Jpeg));
    }

    #[test]
    fn test_image_type_to_image_format() {
        assert_eq!(ImageType::Png.to_image_format(), ImageFormat::Png);
        assert_eq!(ImageType::Jpeg.to_image_format(), ImageFormat::Jpeg);
        assert_eq!(ImageType::Gif.to_image_format(), ImageFormat::Gif);
    }

    #[test]
    fn test_image_type_debug_clone_copy() {
        let img_type = ImageType::Png;
        let cloned = img_type.clone();
        let copied = img_type;

        assert_eq!(img_type, cloned);
        assert_eq!(img_type, copied);
        assert_eq!(format!("{:?}", img_type), "Png");
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(500), "500 B");
        assert_eq!(format_file_size(1023), "1023 B");
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(2048), "2.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(1024 * 1024 - 1), "1024.0 KB");
        assert_eq!(format_file_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_file_size(1024 * 1024 * 2), "2.0 MB");
        assert_eq!(format_file_size(1024 * 1024 * 1024), "1024.0 MB");
    }

    #[test]
    fn test_load_png_image() {
        let png_data = create_test_png(2, 2);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&png_data, "test.png");
        assert!(result.is_ok(), "Failed to load PNG: {:?}", result.err());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 2);
        assert_eq!(img_data.height, 2);
        assert_eq!(img_data.format, ImageType::Png);
        // RGBA has 4 bytes per pixel
        assert_eq!(img_data.rgba_data.len(), 2 * 2 * 4);
        assert!(img_data.file_size > 0);
    }

    #[test]
    fn test_load_jpeg_image() {
        let jpeg_data = create_test_jpeg(10, 10);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&jpeg_data, "photo.jpg");
        assert!(result.is_ok(), "Failed to load JPEG: {:?}", result.err());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 10);
        assert_eq!(img_data.height, 10);
        assert_eq!(img_data.format, ImageType::Jpeg);
        assert_eq!(img_data.rgba_data.len(), 10 * 10 * 4);
    }

    #[test]
    fn test_load_gif_image() {
        let gif_data = create_test_gif(5, 5);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&gif_data, "animation.gif");
        assert!(result.is_ok(), "Failed to load GIF: {:?}", result.err());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 5);
        assert_eq!(img_data.height, 5);
        assert_eq!(img_data.format, ImageType::Gif);
        assert_eq!(img_data.rgba_data.len(), 5 * 5 * 4);
    }

    #[test]
    fn test_load_bytes_with_format() {
        let png_data = create_test_png(3, 3);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes_with_format(&png_data, ImageType::Png);
        assert!(result.is_ok());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 3);
        assert_eq!(img_data.format, ImageType::Png);
    }

    #[test]
    fn test_load_bytes_auto() {
        let png_data = create_test_png(4, 4);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes_auto(&png_data);
        assert!(result.is_ok(), "Failed auto-detect: {:?}", result.err());
        let img_data = result.unwrap();
        assert_eq!(img_data.format, ImageType::Png);
    }

    #[test]
    fn test_load_bytes_auto_jpeg() {
        let jpeg_data = create_test_jpeg(8, 8);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes_auto(&jpeg_data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().format, ImageType::Jpeg);
    }

    #[test]
    fn test_load_bytes_auto_invalid() {
        let viewer = ImageViewer::new();
        let result = viewer.load_bytes_auto(b"not an image at all");
        assert!(result.is_err());
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
    fn test_load_empty_data() {
        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&[], "test.png");
        assert!(result.is_err());
    }

    #[test]
    fn test_image_viewer_default() {
        let viewer = ImageViewer::default();
        // Just verify it can be created
        assert!(viewer.load_bytes(b"", "test.txt").is_err());
    }

    #[test]
    fn test_scale_to_fit_no_scaling_needed() {
        let img: RgbImage = ImageBuffer::new(100, 100);
        let dynamic_img = DynamicImage::ImageRgb8(img);

        let scaled = ImageViewer::scale_to_fit(&dynamic_img, 200, 200);
        assert_eq!(scaled.width(), 100);
        assert_eq!(scaled.height(), 100);
    }

    #[test]
    fn test_scale_to_fit_width_constrained() {
        let img: RgbImage = ImageBuffer::new(400, 200);  // 2:1 aspect
        let dynamic_img = DynamicImage::ImageRgb8(img);

        let scaled = ImageViewer::scale_to_fit(&dynamic_img, 200, 200);
        // Width constrained: 400 -> 200, so height: 200 * 0.5 = 100
        assert_eq!(scaled.width(), 200);
        assert_eq!(scaled.height(), 100);
    }

    #[test]
    fn test_scale_to_fit_height_constrained() {
        let img: RgbImage = ImageBuffer::new(200, 400);  // 1:2 aspect
        let dynamic_img = DynamicImage::ImageRgb8(img);

        let scaled = ImageViewer::scale_to_fit(&dynamic_img, 200, 200);
        // Height constrained: 400 -> 200, so width: 200 * 0.5 = 100
        assert_eq!(scaled.width(), 100);
        assert_eq!(scaled.height(), 200);
    }

    #[test]
    fn test_image_data_clone_debug() {
        let img_data = ImageData {
            width: 10,
            height: 20,
            rgba_data: vec![0u8; 10 * 20 * 4],
            file_size: 1000,
            format: ImageType::Png,
        };

        let cloned = img_data.clone();
        assert_eq!(cloned.width, img_data.width);
        assert_eq!(cloned.height, img_data.height);
        assert_eq!(cloned.file_size, img_data.file_size);
        assert_eq!(cloned.format, img_data.format);

        let debug_str = format!("{:?}", img_data);
        assert!(debug_str.contains("ImageData"));
    }

    #[test]
    fn test_large_image() {
        // Test with a larger image
        let png_data = create_test_png(500, 500);

        let viewer = ImageViewer::new();
        let result = viewer.load_bytes(&png_data, "large.png");
        assert!(result.is_ok());
        let img_data = result.unwrap();
        assert_eq!(img_data.width, 500);
        assert_eq!(img_data.height, 500);
        assert_eq!(img_data.rgba_data.len(), 500 * 500 * 4);
    }
}
