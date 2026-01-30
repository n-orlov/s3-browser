//! Text file viewer/editor
//!
//! Provides editing capability for text files (JSON, YAML, TXT, etc.) with
//! syntax detection and save-back-to-S3 support.

use anyhow::{Context, Result};

/// Supported syntax types for text files
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyntaxType {
    /// Plain text (no syntax highlighting)
    PlainText,
    /// JSON syntax
    Json,
    /// YAML syntax
    Yaml,
    /// Markdown
    Markdown,
    /// Configuration files (ini, toml, etc.)
    Config,
    /// XML/HTML
    Xml,
    /// Shell script
    Shell,
    /// Python
    Python,
    /// Rust
    Rust,
    /// JavaScript/TypeScript
    JavaScript,
    /// SQL
    Sql,
}

impl SyntaxType {
    /// Detect syntax type from file extension
    pub fn from_extension(filename: &str) -> Self {
        let lower = filename.to_lowercase();

        // Extract extension
        let ext = lower.rsplit('.').next().unwrap_or("");

        match ext {
            // JSON
            "json" | "jsonl" | "ndjson" | "geojson" => SyntaxType::Json,

            // YAML
            "yaml" | "yml" => SyntaxType::Yaml,

            // Markdown
            "md" | "markdown" | "mdown" | "mkd" => SyntaxType::Markdown,

            // Config files
            "ini" | "toml" | "conf" | "cfg" | "properties" | "env" => SyntaxType::Config,

            // XML/HTML
            "xml" | "html" | "htm" | "xhtml" | "svg" | "plist" => SyntaxType::Xml,

            // Shell
            "sh" | "bash" | "zsh" | "fish" | "ksh" => SyntaxType::Shell,

            // Python
            "py" | "pyw" | "pyi" => SyntaxType::Python,

            // Rust
            "rs" => SyntaxType::Rust,

            // JavaScript/TypeScript
            "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" => SyntaxType::JavaScript,

            // SQL
            "sql" | "pgsql" | "mysql" => SyntaxType::Sql,

            // Log files
            "log" => SyntaxType::PlainText,

            // Plain text and everything else
            "txt" | "text" | "readme" | "license" | "changelog" | _ => SyntaxType::PlainText,
        }
    }

    /// Get a display name for the syntax type
    pub fn display_name(&self) -> &'static str {
        match self {
            SyntaxType::PlainText => "Plain Text",
            SyntaxType::Json => "JSON",
            SyntaxType::Yaml => "YAML",
            SyntaxType::Markdown => "Markdown",
            SyntaxType::Config => "Config",
            SyntaxType::Xml => "XML",
            SyntaxType::Shell => "Shell",
            SyntaxType::Python => "Python",
            SyntaxType::Rust => "Rust",
            SyntaxType::JavaScript => "JavaScript",
            SyntaxType::Sql => "SQL",
        }
    }

    /// Check if this file type is typically editable text
    pub fn is_editable(&self) -> bool {
        // All syntax types we detect are editable
        true
    }
}

/// Result of loading a text file
#[derive(Debug, Clone)]
pub struct TextData {
    /// The text content
    pub content: String,
    /// Detected syntax type
    pub syntax: SyntaxType,
    /// Original file size in bytes
    pub file_size: usize,
    /// Line count
    pub line_count: usize,
    /// Whether the file is read-only (e.g., too large)
    pub read_only: bool,
}

/// Maximum file size for editing (10 MB)
const MAX_EDITABLE_SIZE: usize = 10 * 1024 * 1024;

/// Maximum file size for viewing (50 MB)
const MAX_VIEWABLE_SIZE: usize = 50 * 1024 * 1024;

/// Text editor for viewing and editing text files
pub struct TextEditor {
    /// Maximum size for editable files
    max_edit_size: usize,
    /// Maximum size for viewable files
    max_view_size: usize,
}

impl TextEditor {
    /// Create a new text editor with default limits
    pub fn new() -> Self {
        Self {
            max_edit_size: MAX_EDITABLE_SIZE,
            max_view_size: MAX_VIEWABLE_SIZE,
        }
    }

    /// Create a text editor with custom limits
    pub fn with_limits(max_edit_size: usize, max_view_size: usize) -> Self {
        Self {
            max_edit_size,
            max_view_size,
        }
    }

    /// Load text content from bytes
    pub fn load_bytes(&self, data: &[u8], filename: &str) -> Result<TextData> {
        let file_size = data.len();

        // Check if file is too large
        if file_size > self.max_view_size {
            anyhow::bail!(
                "File too large to view ({} bytes, max {} bytes)",
                file_size,
                self.max_view_size
            );
        }

        // Determine if file is editable (not too large)
        let read_only = file_size > self.max_edit_size;

        // Try to decode as UTF-8
        let content = String::from_utf8(data.to_vec())
            .context("File is not valid UTF-8 text")?;

        // Count lines
        let line_count = content.lines().count().max(1);

        // Detect syntax
        let syntax = SyntaxType::from_extension(filename);

        Ok(TextData {
            content,
            syntax,
            file_size,
            line_count,
            read_only,
        })
    }

    /// Validate text content for saving
    pub fn validate_content(&self, content: &str) -> Result<()> {
        // Check size
        if content.len() > self.max_edit_size {
            anyhow::bail!(
                "Content too large to save ({} bytes, max {} bytes)",
                content.len(),
                self.max_edit_size
            );
        }

        Ok(())
    }

    /// Prepare content for saving (normalize line endings, etc.)
    pub fn prepare_for_save(&self, content: &str) -> Vec<u8> {
        // Normalize line endings to Unix style (LF)
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        normalized.into_bytes()
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
}

impl Default for TextEditor {
    fn default() -> Self {
        Self::new()
    }
}

/// Check if a file extension indicates a text file
pub fn is_text_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");

    matches!(ext,
        // Common text files
        "txt" | "text" | "log" |
        // Data formats
        "json" | "jsonl" | "ndjson" | "geojson" |
        "yaml" | "yml" |
        "xml" | "html" | "htm" | "xhtml" | "svg" |
        "csv" | "tsv" |  // Note: CSV/TSV have dedicated viewer but can fallback
        // Config files
        "ini" | "toml" | "conf" | "cfg" | "properties" | "env" |
        // Documentation
        "md" | "markdown" | "mdown" | "mkd" |
        "rst" | "asciidoc" | "adoc" |
        // Scripts/Code (commonly edited)
        "sh" | "bash" | "zsh" | "fish" | "ksh" |
        "py" | "pyw" | "pyi" |
        "rs" |
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" |
        "sql" | "pgsql" | "mysql" |
        // Other
        "readme" | "license" | "changelog" | "authors" |
        "dockerfile" | "makefile" | "gemfile" |
        "gitignore" | "gitattributes" | "editorconfig"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_syntax_from_extension_json() {
        assert_eq!(SyntaxType::from_extension("file.json"), SyntaxType::Json);
        assert_eq!(SyntaxType::from_extension("FILE.JSON"), SyntaxType::Json);
        assert_eq!(SyntaxType::from_extension("data.jsonl"), SyntaxType::Json);
    }

    #[test]
    fn test_syntax_from_extension_yaml() {
        assert_eq!(SyntaxType::from_extension("config.yaml"), SyntaxType::Yaml);
        assert_eq!(SyntaxType::from_extension("config.yml"), SyntaxType::Yaml);
    }

    #[test]
    fn test_syntax_from_extension_markdown() {
        assert_eq!(SyntaxType::from_extension("README.md"), SyntaxType::Markdown);
        assert_eq!(SyntaxType::from_extension("doc.markdown"), SyntaxType::Markdown);
    }

    #[test]
    fn test_syntax_from_extension_config() {
        assert_eq!(SyntaxType::from_extension("app.toml"), SyntaxType::Config);
        assert_eq!(SyntaxType::from_extension("settings.ini"), SyntaxType::Config);
        assert_eq!(SyntaxType::from_extension(".env"), SyntaxType::Config);
    }

    #[test]
    fn test_syntax_from_extension_code() {
        assert_eq!(SyntaxType::from_extension("main.rs"), SyntaxType::Rust);
        assert_eq!(SyntaxType::from_extension("app.py"), SyntaxType::Python);
        assert_eq!(SyntaxType::from_extension("index.js"), SyntaxType::JavaScript);
        assert_eq!(SyntaxType::from_extension("script.sh"), SyntaxType::Shell);
    }

    #[test]
    fn test_syntax_from_extension_plain_text() {
        assert_eq!(SyntaxType::from_extension("file.txt"), SyntaxType::PlainText);
        assert_eq!(SyntaxType::from_extension("unknown.xyz"), SyntaxType::PlainText);
        assert_eq!(SyntaxType::from_extension("no_extension"), SyntaxType::PlainText);
    }

    #[test]
    fn test_syntax_display_name() {
        assert_eq!(SyntaxType::Json.display_name(), "JSON");
        assert_eq!(SyntaxType::Yaml.display_name(), "YAML");
        assert_eq!(SyntaxType::PlainText.display_name(), "Plain Text");
    }

    #[test]
    fn test_editor_creation() {
        let editor = TextEditor::new();
        assert_eq!(editor.max_edit_size, MAX_EDITABLE_SIZE);
        assert_eq!(editor.max_view_size, MAX_VIEWABLE_SIZE);
    }

    #[test]
    fn test_editor_with_custom_limits() {
        let editor = TextEditor::with_limits(1000, 5000);
        assert_eq!(editor.max_edit_size, 1000);
        assert_eq!(editor.max_view_size, 5000);
    }

    #[test]
    fn test_editor_default() {
        let editor = TextEditor::default();
        assert_eq!(editor.max_edit_size, MAX_EDITABLE_SIZE);
    }

    #[test]
    fn test_load_bytes_simple() {
        let editor = TextEditor::new();
        let content = b"Hello, World!";
        let result = editor.load_bytes(content, "test.txt").unwrap();

        assert_eq!(result.content, "Hello, World!");
        assert_eq!(result.syntax, SyntaxType::PlainText);
        assert_eq!(result.file_size, 13);
        assert_eq!(result.line_count, 1);
        assert!(!result.read_only);
    }

    #[test]
    fn test_load_bytes_multiline() {
        let editor = TextEditor::new();
        let content = b"line1\nline2\nline3";
        let result = editor.load_bytes(content, "test.txt").unwrap();

        assert_eq!(result.line_count, 3);
    }

    #[test]
    fn test_load_bytes_json() {
        let editor = TextEditor::new();
        let content = br#"{"key": "value"}"#;
        let result = editor.load_bytes(content, "data.json").unwrap();

        assert_eq!(result.syntax, SyntaxType::Json);
    }

    #[test]
    fn test_load_bytes_yaml() {
        let editor = TextEditor::new();
        let content = b"key: value\nlist:\n  - item1\n  - item2";
        let result = editor.load_bytes(content, "config.yaml").unwrap();

        assert_eq!(result.syntax, SyntaxType::Yaml);
        assert_eq!(result.line_count, 4);
    }

    #[test]
    fn test_load_bytes_invalid_utf8() {
        let editor = TextEditor::new();
        let content = &[0xff, 0xfe, 0x00, 0x01]; // Invalid UTF-8
        let result = editor.load_bytes(content, "binary.bin");

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("UTF-8"));
    }

    #[test]
    fn test_load_bytes_too_large() {
        let editor = TextEditor::with_limits(100, 200);
        let content = vec![b'a'; 300];
        let result = editor.load_bytes(&content, "large.txt");

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    #[test]
    fn test_load_bytes_read_only_large() {
        let editor = TextEditor::with_limits(100, 500);
        let content = vec![b'a'; 200]; // Between edit and view limits
        let result = editor.load_bytes(&content, "medium.txt").unwrap();

        assert!(result.read_only);
    }

    #[test]
    fn test_validate_content_ok() {
        let editor = TextEditor::new();
        let result = editor.validate_content("normal content");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_content_too_large() {
        let editor = TextEditor::with_limits(10, 100);
        let content = "a".repeat(20);
        let result = editor.validate_content(&content);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    #[test]
    fn test_prepare_for_save_normalize_crlf() {
        let editor = TextEditor::new();
        let content = "line1\r\nline2\r\nline3";
        let result = editor.prepare_for_save(content);

        assert_eq!(result, b"line1\nline2\nline3");
    }

    #[test]
    fn test_prepare_for_save_normalize_cr() {
        let editor = TextEditor::new();
        let content = "line1\rline2\rline3";
        let result = editor.prepare_for_save(content);

        assert_eq!(result, b"line1\nline2\nline3");
    }

    #[test]
    fn test_prepare_for_save_already_lf() {
        let editor = TextEditor::new();
        let content = "line1\nline2\nline3";
        let result = editor.prepare_for_save(content);

        assert_eq!(result, b"line1\nline2\nline3");
    }

    #[test]
    fn test_format_file_size_bytes() {
        assert_eq!(TextEditor::format_file_size(0), "0 B");
        assert_eq!(TextEditor::format_file_size(100), "100 B");
        assert_eq!(TextEditor::format_file_size(1023), "1023 B");
    }

    #[test]
    fn test_format_file_size_kilobytes() {
        assert_eq!(TextEditor::format_file_size(1024), "1.0 KB");
        assert_eq!(TextEditor::format_file_size(1536), "1.5 KB");
        assert_eq!(TextEditor::format_file_size(102400), "100.0 KB");
    }

    #[test]
    fn test_format_file_size_megabytes() {
        assert_eq!(TextEditor::format_file_size(1024 * 1024), "1.0 MB");
        assert_eq!(TextEditor::format_file_size(10 * 1024 * 1024), "10.0 MB");
    }

    #[test]
    fn test_is_text_file_common() {
        assert!(is_text_file("readme.txt"));
        assert!(is_text_file("data.json"));
        assert!(is_text_file("config.yaml"));
        assert!(is_text_file("script.sh"));
    }

    #[test]
    fn test_is_text_file_code() {
        assert!(is_text_file("main.rs"));
        assert!(is_text_file("app.py"));
        assert!(is_text_file("index.js"));
    }

    #[test]
    fn test_is_text_file_special() {
        assert!(is_text_file("Dockerfile"));
        assert!(is_text_file("Makefile"));
        assert!(is_text_file(".gitignore"));
    }

    #[test]
    fn test_is_text_file_non_text() {
        assert!(!is_text_file("image.png"));
        assert!(!is_text_file("video.mp4"));
        assert!(!is_text_file("archive.zip"));
        assert!(!is_text_file("binary.exe"));
    }

    #[test]
    fn test_load_bytes_empty() {
        let editor = TextEditor::new();
        let result = editor.load_bytes(b"", "empty.txt").unwrap();

        assert_eq!(result.content, "");
        assert_eq!(result.line_count, 1); // Even empty file has 1 "line"
        assert_eq!(result.file_size, 0);
    }

    #[test]
    fn test_load_bytes_unicode() {
        let editor = TextEditor::new();
        let content = "Hello 🌍 World! Привет мир! 你好世界！".as_bytes();
        let result = editor.load_bytes(content, "unicode.txt").unwrap();

        assert!(result.content.contains("🌍"));
        assert!(result.content.contains("Привет"));
        assert!(result.content.contains("你好"));
    }

    #[test]
    fn test_syntax_is_editable() {
        assert!(SyntaxType::PlainText.is_editable());
        assert!(SyntaxType::Json.is_editable());
        assert!(SyntaxType::Yaml.is_editable());
        assert!(SyntaxType::Rust.is_editable());
    }
}
