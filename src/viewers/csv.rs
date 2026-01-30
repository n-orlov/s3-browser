//! CSV file viewer
//!
//! Provides tabular viewing of CSV files with lazy loading support.

use anyhow::{Context, Result};
use std::io::Cursor;

/// Represents a cell value in the table, formatted as a string
pub type CellValue = String;

/// Represents a row of data
pub type Row = Vec<CellValue>;

/// Column information
#[derive(Debug, Clone)]
pub struct ColumnInfo {
    /// Column name (from header or generated)
    pub name: String,
    /// Column index (0-based)
    pub index: usize,
}

/// Result of reading a CSV file
#[derive(Debug)]
pub struct CsvData {
    /// Column definitions
    pub columns: Vec<ColumnInfo>,
    /// Row data (each row is a vector of cell values)
    pub rows: Vec<Row>,
    /// Total number of rows in the file (estimated or exact)
    pub total_rows: usize,
    /// Number of rows loaded (for lazy loading)
    pub loaded_rows: usize,
    /// Whether there are more rows to load
    pub has_more: bool,
}

/// CSV viewer for tabular display of CSV files
pub struct CsvViewer {
    /// Batch size for lazy loading
    batch_size: usize,
    /// Whether to use the first row as headers
    has_headers: bool,
    /// CSV delimiter character
    delimiter: u8,
}

impl CsvViewer {
    /// Create a new CSV viewer with default settings
    pub fn new() -> Self {
        Self {
            batch_size: 1000,
            has_headers: true,
            delimiter: b',',
        }
    }

    /// Create a viewer with custom batch size
    pub fn with_batch_size(batch_size: usize) -> Self {
        Self {
            batch_size,
            has_headers: true,
            delimiter: b',',
        }
    }

    /// Set whether the CSV has headers
    pub fn with_headers(mut self, has_headers: bool) -> Self {
        self.has_headers = has_headers;
        self
    }

    /// Set the delimiter character
    pub fn with_delimiter(mut self, delimiter: u8) -> Self {
        self.delimiter = delimiter;
        self
    }

    /// Detect the delimiter from the first few lines of the file
    pub fn detect_delimiter(data: &[u8]) -> u8 {
        // Look at the first line
        let first_line_end = data.iter().position(|&b| b == b'\n').unwrap_or(data.len());
        let first_line = &data[..first_line_end];

        // Count occurrences of common delimiters
        let comma_count = first_line.iter().filter(|&&b| b == b',').count();
        let tab_count = first_line.iter().filter(|&&b| b == b'\t').count();
        let semicolon_count = first_line.iter().filter(|&&b| b == b';').count();
        let pipe_count = first_line.iter().filter(|&&b| b == b'|').count();

        // Pick the most common delimiter
        let max = comma_count.max(tab_count).max(semicolon_count).max(pipe_count);

        if max == 0 {
            b',' // Default to comma
        } else if max == tab_count {
            b'\t'
        } else if max == semicolon_count {
            b';'
        } else if max == pipe_count {
            b'|'
        } else {
            b','
        }
    }

    /// Read CSV data from bytes
    ///
    /// Returns column info and rows, limited by the batch size for initial load
    pub fn read_bytes(&self, data: &[u8]) -> Result<CsvData> {
        self.read_bytes_with_limit(data, self.batch_size)
    }

    /// Read CSV data with a specific row limit
    pub fn read_bytes_with_limit(&self, data: &[u8], limit: usize) -> Result<CsvData> {
        let cursor = Cursor::new(data);

        let mut reader = csv::ReaderBuilder::new()
            .has_headers(self.has_headers)
            .delimiter(self.delimiter)
            .flexible(true) // Handle rows with varying number of fields
            .from_reader(cursor);

        // Get headers (column names)
        let columns: Vec<ColumnInfo> = if self.has_headers {
            reader.headers()
                .context("Failed to read CSV headers")?
                .iter()
                .enumerate()
                .map(|(i, name)| ColumnInfo {
                    name: if name.is_empty() { format!("Column {}", i + 1) } else { name.to_string() },
                    index: i,
                })
                .collect()
        } else {
            // We need to peek at the first record to know the column count
            Vec::new() // Will be populated when we read the first row
        };

        let mut rows = Vec::new();
        let mut loaded_rows = 0;
        let mut total_counted = 0;
        let mut has_more = false;
        let mut actual_columns = columns;

        for result in reader.records() {
            match result {
                Ok(record) => {
                    total_counted += 1;

                    if loaded_rows < limit {
                        // If we don't have headers and this is the first row, create column definitions
                        if !self.has_headers && actual_columns.is_empty() {
                            actual_columns = (0..record.len())
                                .map(|i| ColumnInfo {
                                    name: format!("Column {}", i + 1),
                                    index: i,
                                })
                                .collect();
                        }

                        let row: Row = record.iter()
                            .map(|field| field.to_string())
                            .collect();

                        // Ensure row has same number of columns (pad or truncate)
                        let row = normalize_row(row, actual_columns.len());

                        rows.push(row);
                        loaded_rows += 1;
                    } else {
                        has_more = true;
                        // Continue counting for total (but limit to reasonable amount)
                        if total_counted > limit + 10000 {
                            // Stop counting and estimate
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Error reading CSV row {}: {}", total_counted + 1, e);
                    // Skip malformed rows but continue
                    total_counted += 1;
                }
            }
        }

        Ok(CsvData {
            columns: actual_columns,
            rows,
            total_rows: total_counted,
            loaded_rows,
            has_more,
        })
    }

    /// Read CSV data with auto-detected delimiter
    pub fn read_bytes_auto(&self, data: &[u8]) -> Result<CsvData> {
        let delimiter = Self::detect_delimiter(data);
        let viewer = CsvViewer {
            batch_size: self.batch_size,
            has_headers: self.has_headers,
            delimiter,
        };
        viewer.read_bytes(data)
    }

    /// Read CSV data with auto-detected delimiter and specific limit
    pub fn read_bytes_auto_with_limit(&self, data: &[u8], limit: usize) -> Result<CsvData> {
        let delimiter = Self::detect_delimiter(data);
        let viewer = CsvViewer {
            batch_size: self.batch_size,
            has_headers: self.has_headers,
            delimiter,
        };
        viewer.read_bytes_with_limit(data, limit)
    }

    /// Get the current batch size
    pub fn batch_size(&self) -> usize {
        self.batch_size
    }
}

/// Normalize a row to have exactly the expected number of columns
fn normalize_row(mut row: Row, expected_len: usize) -> Row {
    // Pad with empty strings if too short
    while row.len() < expected_len {
        row.push(String::new());
    }
    // Truncate if too long
    row.truncate(expected_len);
    row
}

impl Default for CsvViewer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_viewer_creation() {
        let viewer = CsvViewer::new();
        assert_eq!(viewer.batch_size, 1000);
        assert!(viewer.has_headers);
        assert_eq!(viewer.delimiter, b',');
    }

    #[test]
    fn test_viewer_with_batch_size() {
        let viewer = CsvViewer::with_batch_size(500);
        assert_eq!(viewer.batch_size, 500);
    }

    #[test]
    fn test_viewer_with_custom_settings() {
        let viewer = CsvViewer::new()
            .with_headers(false)
            .with_delimiter(b'\t');
        assert!(!viewer.has_headers);
        assert_eq!(viewer.delimiter, b'\t');
    }

    #[test]
    fn test_detect_delimiter_comma() {
        let data = b"name,age,city\nJohn,30,NYC";
        assert_eq!(CsvViewer::detect_delimiter(data), b',');
    }

    #[test]
    fn test_detect_delimiter_tab() {
        let data = b"name\tage\tcity\nJohn\t30\tNYC";
        assert_eq!(CsvViewer::detect_delimiter(data), b'\t');
    }

    #[test]
    fn test_detect_delimiter_semicolon() {
        let data = b"name;age;city\nJohn;30;NYC";
        assert_eq!(CsvViewer::detect_delimiter(data), b';');
    }

    #[test]
    fn test_detect_delimiter_pipe() {
        let data = b"name|age|city\nJohn|30|NYC";
        assert_eq!(CsvViewer::detect_delimiter(data), b'|');
    }

    #[test]
    fn test_read_simple_csv() {
        let csv_data = b"name,age,city\nAlice,25,Boston\nBob,30,NYC\nCharlie,35,LA";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.columns[0].name, "name");
        assert_eq!(result.columns[1].name, "age");
        assert_eq!(result.columns[2].name, "city");

        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.loaded_rows, 3);
        assert_eq!(result.total_rows, 3);
        assert!(!result.has_more);

        assert_eq!(result.rows[0], vec!["Alice", "25", "Boston"]);
        assert_eq!(result.rows[1], vec!["Bob", "30", "NYC"]);
        assert_eq!(result.rows[2], vec!["Charlie", "35", "LA"]);
    }

    #[test]
    fn test_read_csv_no_headers() {
        let csv_data = b"Alice,25,Boston\nBob,30,NYC";
        let viewer = CsvViewer::new().with_headers(false);
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.columns[0].name, "Column 1");
        assert_eq!(result.columns[1].name, "Column 2");
        assert_eq!(result.columns[2].name, "Column 3");

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0], vec!["Alice", "25", "Boston"]);
    }

    #[test]
    fn test_read_csv_with_limit() {
        let csv_data = b"name,value\na,1\nb,2\nc,3\nd,4\ne,5";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes_with_limit(csv_data, 3).unwrap();

        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.loaded_rows, 3);
        assert!(result.has_more);
        assert!(result.total_rows >= 5);
    }

    #[test]
    fn test_read_csv_empty_headers() {
        let csv_data = b",age,\nAlice,25,Boston";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        // Empty headers should get default names
        assert_eq!(result.columns[0].name, "Column 1");
        assert_eq!(result.columns[1].name, "age");
        assert_eq!(result.columns[2].name, "Column 3");
    }

    #[test]
    fn test_read_csv_varying_columns() {
        // CSV with rows that have different number of columns
        let csv_data = b"a,b,c\n1,2\n1,2,3,4";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.columns.len(), 3);

        // First data row should be padded
        assert_eq!(result.rows[0].len(), 3);
        assert_eq!(result.rows[0], vec!["1", "2", ""]);

        // Second data row should be truncated
        assert_eq!(result.rows[1].len(), 3);
        assert_eq!(result.rows[1], vec!["1", "2", "3"]);
    }

    #[test]
    fn test_read_csv_with_quotes() {
        let csv_data = b"name,description\n\"John Doe\",\"A description with, comma\"";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.rows[0][0], "John Doe");
        assert_eq!(result.rows[0][1], "A description with, comma");
    }

    #[test]
    fn test_read_csv_with_newlines() {
        let csv_data = b"name,description\n\"John\",\"Line1\nLine2\"";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.rows[0][0], "John");
        assert_eq!(result.rows[0][1], "Line1\nLine2");
    }

    #[test]
    fn test_read_csv_auto_detect_tab() {
        let csv_data = b"name\tage\tcity\nAlice\t25\tBoston";
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes_auto(csv_data).unwrap();

        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.columns[0].name, "name");
        assert_eq!(result.rows[0], vec!["Alice", "25", "Boston"]);
    }

    #[test]
    fn test_read_empty_csv() {
        let csv_data = b"name,age,city";  // Headers only
        let viewer = CsvViewer::new();
        let result = viewer.read_bytes(csv_data).unwrap();

        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.total_rows, 0);
    }

    #[test]
    fn test_normalize_row_padding() {
        let row = vec!["a".to_string(), "b".to_string()];
        let result = normalize_row(row, 4);
        assert_eq!(result, vec!["a", "b", "", ""]);
    }

    #[test]
    fn test_normalize_row_truncation() {
        let row = vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string()];
        let result = normalize_row(row, 2);
        assert_eq!(result, vec!["a", "b"]);
    }
}
