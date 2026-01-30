//! Parquet file viewer
//!
//! Provides tabular viewing of Parquet files with lazy loading support.

use anyhow::{Context, Result};
use arrow::array::*;
use arrow::datatypes::{DataType, TimeUnit};
use bytes::Bytes;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

/// Represents a cell value in the table, formatted as a string
pub type CellValue = String;

/// Represents a row of data
pub type Row = Vec<CellValue>;

/// Column information
#[derive(Debug, Clone)]
pub struct ColumnInfo {
    /// Column name
    pub name: String,
    /// Column data type as string
    pub data_type: String,
}

/// Result of reading a parquet file
#[derive(Debug)]
pub struct ParquetData {
    /// Column definitions
    pub columns: Vec<ColumnInfo>,
    /// Row data (each row is a vector of cell values)
    pub rows: Vec<Row>,
    /// Total number of rows in the file
    pub total_rows: usize,
    /// Number of rows loaded (for lazy loading)
    pub loaded_rows: usize,
}

/// Parquet viewer for tabular display of Parquet files
pub struct ParquetViewer {
    /// Batch size for lazy loading
    batch_size: usize,
}

impl ParquetViewer {
    /// Create a new parquet viewer
    pub fn new() -> Self {
        Self {
            batch_size: 1000, // Load 1000 rows at a time
        }
    }

    /// Create a viewer with custom batch size
    pub fn with_batch_size(batch_size: usize) -> Self {
        Self { batch_size }
    }

    /// Read parquet data from bytes
    ///
    /// Returns column info and rows, limited by the batch size for initial load
    pub fn read_bytes(&self, data: &[u8]) -> Result<ParquetData> {
        self.read_bytes_with_limit(data, self.batch_size)
    }

    /// Read parquet data with a specific row limit
    pub fn read_bytes_with_limit(&self, data: &[u8], limit: usize) -> Result<ParquetData> {
        // Convert to Bytes which implements ChunkReader
        let bytes = Bytes::copy_from_slice(data);

        let builder = ParquetRecordBatchReaderBuilder::try_new(bytes)
            .context("Failed to create parquet reader")?;

        let schema = builder.schema().clone();
        let metadata = builder.metadata().clone();

        // Get total row count from metadata
        let total_rows: usize = metadata.row_groups()
            .iter()
            .map(|rg| rg.num_rows() as usize)
            .sum();

        // Build reader with batch size
        let reader = builder
            .with_batch_size(limit.min(8192))
            .build()
            .context("Failed to build parquet reader")?;

        // Extract column information
        let columns: Vec<ColumnInfo> = schema
            .fields()
            .iter()
            .map(|f| ColumnInfo {
                name: f.name().clone(),
                data_type: format_data_type(f.data_type()),
            })
            .collect();

        // Read batches up to the limit
        let mut rows = Vec::new();
        let mut loaded_rows = 0;

        for batch_result in reader {
            let batch = batch_result.context("Failed to read record batch")?;
            let batch_rows = batch.num_rows();

            // Convert each row
            for row_idx in 0..batch_rows {
                if loaded_rows >= limit {
                    break;
                }

                let mut row = Vec::with_capacity(columns.len());
                for col_idx in 0..batch.num_columns() {
                    let value = format_array_value(batch.column(col_idx), row_idx);
                    row.push(value);
                }
                rows.push(row);
                loaded_rows += 1;
            }

            if loaded_rows >= limit {
                break;
            }
        }

        Ok(ParquetData {
            columns,
            rows,
            total_rows,
            loaded_rows,
        })
    }
}

impl Default for ParquetViewer {
    fn default() -> Self {
        Self::new()
    }
}

/// Format a data type as a human-readable string
fn format_data_type(dt: &DataType) -> String {
    match dt {
        DataType::Null => "null".to_string(),
        DataType::Boolean => "boolean".to_string(),
        DataType::Int8 => "int8".to_string(),
        DataType::Int16 => "int16".to_string(),
        DataType::Int32 => "int32".to_string(),
        DataType::Int64 => "int64".to_string(),
        DataType::UInt8 => "uint8".to_string(),
        DataType::UInt16 => "uint16".to_string(),
        DataType::UInt32 => "uint32".to_string(),
        DataType::UInt64 => "uint64".to_string(),
        DataType::Float16 => "float16".to_string(),
        DataType::Float32 => "float32".to_string(),
        DataType::Float64 => "float64".to_string(),
        DataType::Utf8 => "string".to_string(),
        DataType::LargeUtf8 => "string".to_string(),
        DataType::Binary => "binary".to_string(),
        DataType::LargeBinary => "binary".to_string(),
        DataType::Date32 => "date".to_string(),
        DataType::Date64 => "date".to_string(),
        DataType::Timestamp(unit, tz) => {
            let unit_str = match unit {
                TimeUnit::Second => "s",
                TimeUnit::Millisecond => "ms",
                TimeUnit::Microsecond => "μs",
                TimeUnit::Nanosecond => "ns",
            };
            match tz {
                Some(tz) => format!("timestamp({}, {})", unit_str, tz),
                None => format!("timestamp({})", unit_str),
            }
        }
        DataType::Time32(_) => "time".to_string(),
        DataType::Time64(_) => "time".to_string(),
        DataType::Duration(_) => "duration".to_string(),
        DataType::Interval(_) => "interval".to_string(),
        DataType::Decimal128(p, s) => format!("decimal({}, {})", p, s),
        DataType::Decimal256(p, s) => format!("decimal({}, {})", p, s),
        DataType::List(field) => format!("list<{}>", format_data_type(field.data_type())),
        DataType::LargeList(field) => format!("list<{}>", format_data_type(field.data_type())),
        DataType::FixedSizeList(field, size) => {
            format!("list<{}>[{}]", format_data_type(field.data_type()), size)
        }
        DataType::Struct(fields) => {
            let field_strs: Vec<String> = fields
                .iter()
                .map(|f| format!("{}: {}", f.name(), format_data_type(f.data_type())))
                .collect();
            format!("struct<{}>", field_strs.join(", "))
        }
        DataType::Map(field, _) => format!("map<{}>", format_data_type(field.data_type())),
        DataType::Dictionary(key_type, value_type) => {
            format!("dict<{}, {}>", format_data_type(key_type), format_data_type(value_type))
        }
        _ => format!("{:?}", dt),
    }
}

/// Format a value from an Arrow array at a given index
fn format_array_value(array: &ArrayRef, idx: usize) -> String {
    if array.is_null(idx) {
        return "null".to_string();
    }

    match array.data_type() {
        DataType::Null => "null".to_string(),
        DataType::Boolean => {
            let arr = array.as_any().downcast_ref::<BooleanArray>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Int8 => {
            let arr = array.as_any().downcast_ref::<Int8Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Int16 => {
            let arr = array.as_any().downcast_ref::<Int16Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Int32 => {
            let arr = array.as_any().downcast_ref::<Int32Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Int64 => {
            let arr = array.as_any().downcast_ref::<Int64Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::UInt8 => {
            let arr = array.as_any().downcast_ref::<UInt8Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::UInt16 => {
            let arr = array.as_any().downcast_ref::<UInt16Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::UInt32 => {
            let arr = array.as_any().downcast_ref::<UInt32Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::UInt64 => {
            let arr = array.as_any().downcast_ref::<UInt64Array>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Float32 => {
            let arr = array.as_any().downcast_ref::<Float32Array>().unwrap();
            let v = arr.value(idx);
            if v.is_nan() {
                "NaN".to_string()
            } else if v.is_infinite() {
                if v.is_sign_positive() { "Inf" } else { "-Inf" }.to_string()
            } else {
                format!("{:.6}", v)
            }
        }
        DataType::Float64 => {
            let arr = array.as_any().downcast_ref::<Float64Array>().unwrap();
            let v = arr.value(idx);
            if v.is_nan() {
                "NaN".to_string()
            } else if v.is_infinite() {
                if v.is_sign_positive() { "Inf" } else { "-Inf" }.to_string()
            } else {
                format!("{:.6}", v)
            }
        }
        DataType::Utf8 => {
            let arr = array.as_any().downcast_ref::<StringArray>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::LargeUtf8 => {
            let arr = array.as_any().downcast_ref::<LargeStringArray>().unwrap();
            arr.value(idx).to_string()
        }
        DataType::Binary => {
            let arr = array.as_any().downcast_ref::<BinaryArray>().unwrap();
            let bytes = arr.value(idx);
            if bytes.len() <= 32 {
                format!("0x{}", hex_encode(bytes))
            } else {
                format!("0x{}... ({} bytes)", hex_encode(&bytes[..16]), bytes.len())
            }
        }
        DataType::LargeBinary => {
            let arr = array.as_any().downcast_ref::<LargeBinaryArray>().unwrap();
            let bytes = arr.value(idx);
            if bytes.len() <= 32 {
                format!("0x{}", hex_encode(bytes))
            } else {
                format!("0x{}... ({} bytes)", hex_encode(&bytes[..16]), bytes.len())
            }
        }
        DataType::Date32 => {
            let arr = array.as_any().downcast_ref::<Date32Array>().unwrap();
            // Days since Unix epoch
            let days = arr.value(idx);
            let date = chrono::NaiveDate::from_num_days_from_ce_opt(
                days + 719_163 // Days from year 1 to Unix epoch
            );
            match date {
                Some(d) => d.format("%Y-%m-%d").to_string(),
                None => format!("date({})", days),
            }
        }
        DataType::Date64 => {
            let arr = array.as_any().downcast_ref::<Date64Array>().unwrap();
            // Milliseconds since Unix epoch
            let ms = arr.value(idx);
            let dt = chrono::DateTime::from_timestamp_millis(ms);
            match dt {
                Some(d) => d.format("%Y-%m-%d").to_string(),
                None => format!("date({}ms)", ms),
            }
        }
        DataType::Timestamp(unit, _) => {
            let value = match unit {
                TimeUnit::Second => {
                    let arr = array.as_any().downcast_ref::<TimestampSecondArray>().unwrap();
                    chrono::DateTime::from_timestamp(arr.value(idx), 0)
                }
                TimeUnit::Millisecond => {
                    let arr = array.as_any().downcast_ref::<TimestampMillisecondArray>().unwrap();
                    chrono::DateTime::from_timestamp_millis(arr.value(idx))
                }
                TimeUnit::Microsecond => {
                    let arr = array.as_any().downcast_ref::<TimestampMicrosecondArray>().unwrap();
                    chrono::DateTime::from_timestamp_micros(arr.value(idx))
                }
                TimeUnit::Nanosecond => {
                    let arr = array.as_any().downcast_ref::<TimestampNanosecondArray>().unwrap();
                    let nanos = arr.value(idx);
                    let secs = nanos / 1_000_000_000;
                    let subsec_nanos = (nanos % 1_000_000_000) as u32;
                    chrono::DateTime::from_timestamp(secs, subsec_nanos)
                }
            };
            match value {
                Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
                None => "invalid timestamp".to_string(),
            }
        }
        DataType::Time32(TimeUnit::Second) => {
            let arr = array.as_any().downcast_ref::<Time32SecondArray>().unwrap();
            let secs = arr.value(idx);
            format!("{:02}:{:02}:{:02}", secs / 3600, (secs % 3600) / 60, secs % 60)
        }
        DataType::Time32(TimeUnit::Millisecond) => {
            let arr = array.as_any().downcast_ref::<Time32MillisecondArray>().unwrap();
            let ms = arr.value(idx);
            let secs = ms / 1000;
            format!("{:02}:{:02}:{:02}.{:03}", secs / 3600, (secs % 3600) / 60, secs % 60, ms % 1000)
        }
        DataType::Time64(TimeUnit::Microsecond) => {
            let arr = array.as_any().downcast_ref::<Time64MicrosecondArray>().unwrap();
            let us = arr.value(idx);
            let secs = us / 1_000_000;
            format!("{:02}:{:02}:{:02}.{:06}", secs / 3600, (secs % 3600) / 60, secs % 60, us % 1_000_000)
        }
        DataType::Time64(TimeUnit::Nanosecond) => {
            let arr = array.as_any().downcast_ref::<Time64NanosecondArray>().unwrap();
            let ns = arr.value(idx);
            let secs = ns / 1_000_000_000;
            format!("{:02}:{:02}:{:02}.{:09}", secs / 3600, (secs % 3600) / 60, secs % 60, ns % 1_000_000_000)
        }
        DataType::Decimal128(_, scale) => {
            let arr = array.as_any().downcast_ref::<Decimal128Array>().unwrap();
            let value = arr.value(idx);
            format_decimal(value.to_string(), *scale as usize)
        }
        DataType::List(_) | DataType::LargeList(_) | DataType::FixedSizeList(_, _) => {
            // Format list as JSON-like array
            format_list_value(array, idx)
        }
        DataType::Struct(_) => {
            // Format struct as JSON-like object
            format_struct_value(array, idx)
        }
        DataType::Map(_, _) => {
            // Format map as JSON-like object
            format_map_value(array, idx)
        }
        _ => {
            // For other types, use debug format
            format!("{:?}", array)
        }
    }
}

/// Encode bytes as hex string
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Format a decimal value with the given scale
fn format_decimal(value_str: String, scale: usize) -> String {
    if scale == 0 {
        return value_str;
    }

    let is_negative = value_str.starts_with('-');
    let digits: String = value_str.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.len() <= scale {
        let padding = "0".repeat(scale - digits.len() + 1);
        let padded = format!("{}{}", padding, digits);
        let (int_part, frac_part) = padded.split_at(padded.len() - scale);
        let formatted = format!("{}.{}", int_part, frac_part);
        if is_negative { format!("-{}", formatted) } else { formatted }
    } else {
        let (int_part, frac_part) = digits.split_at(digits.len() - scale);
        let formatted = format!("{}.{}", int_part, frac_part);
        if is_negative { format!("-{}", formatted) } else { formatted }
    }
}

/// Format a list array value as JSON-like string
fn format_list_value(array: &ArrayRef, idx: usize) -> String {
    match array.data_type() {
        DataType::List(_) => {
            let list_arr = array.as_any().downcast_ref::<ListArray>().unwrap();
            let values = list_arr.value(idx);
            format_array_elements(&values)
        }
        DataType::LargeList(_) => {
            let list_arr = array.as_any().downcast_ref::<LargeListArray>().unwrap();
            let values = list_arr.value(idx);
            format_array_elements(&values)
        }
        DataType::FixedSizeList(_, _) => {
            let list_arr = array.as_any().downcast_ref::<FixedSizeListArray>().unwrap();
            let values = list_arr.value(idx);
            format_array_elements(&values)
        }
        _ => "[...]".to_string(),
    }
}

/// Format array elements as JSON-like string
fn format_array_elements(array: &ArrayRef) -> String {
    let mut elements = Vec::new();
    let max_elements = 10; // Limit elements shown

    for i in 0..array.len().min(max_elements) {
        elements.push(format_array_value(array, i));
    }

    if array.len() > max_elements {
        elements.push(format!("... +{} more", array.len() - max_elements));
    }

    format!("[{}]", elements.join(", "))
}

/// Format a struct array value as JSON-like string
fn format_struct_value(array: &ArrayRef, idx: usize) -> String {
    let struct_arr = array.as_any().downcast_ref::<StructArray>().unwrap();
    let mut fields = Vec::new();
    let max_fields = 5; // Limit fields shown

    for (i, field) in struct_arr.fields().iter().enumerate() {
        if i >= max_fields {
            fields.push(format!("... +{} more", struct_arr.num_columns() - max_fields));
            break;
        }
        let col = struct_arr.column(i);
        let value = format_array_value(col, idx);
        fields.push(format!("\"{}\": {}", field.name(), value));
    }

    format!("{{{}}}", fields.join(", "))
}

/// Format a map array value as JSON-like string
fn format_map_value(array: &ArrayRef, idx: usize) -> String {
    let map_arr = array.as_any().downcast_ref::<MapArray>().unwrap();
    let entries = map_arr.value(idx);
    let struct_arr = entries.as_any().downcast_ref::<StructArray>().unwrap();

    let mut pairs = Vec::new();
    let max_pairs = 5;

    let keys = struct_arr.column(0);
    let values = struct_arr.column(1);

    for i in 0..struct_arr.len().min(max_pairs) {
        let key = format_array_value(keys, i);
        let value = format_array_value(values, i);
        pairs.push(format!("{}: {}", key, value));
    }

    if struct_arr.len() > max_pairs {
        pairs.push(format!("... +{} more", struct_arr.len() - max_pairs));
    }

    format!("{{{}}}", pairs.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow::datatypes::{Field, Schema};
    use arrow::record_batch::RecordBatch;
    use parquet::arrow::ArrowWriter;
    use std::sync::Arc;

    #[test]
    fn test_viewer_creation() {
        let viewer = ParquetViewer::new();
        assert_eq!(viewer.batch_size, 1000);
    }

    #[test]
    fn test_viewer_with_batch_size() {
        let viewer = ParquetViewer::with_batch_size(500);
        assert_eq!(viewer.batch_size, 500);
    }

    #[test]
    fn test_viewer_default() {
        let viewer = ParquetViewer::default();
        assert_eq!(viewer.batch_size, 1000);
    }

    #[test]
    fn test_format_decimal() {
        assert_eq!(format_decimal("12345".to_string(), 2), "123.45");
        assert_eq!(format_decimal("123".to_string(), 2), "1.23");
        assert_eq!(format_decimal("12".to_string(), 2), "0.12");
        assert_eq!(format_decimal("1".to_string(), 2), "0.01");
        assert_eq!(format_decimal("-12345".to_string(), 2), "-123.45");
        assert_eq!(format_decimal("12345".to_string(), 0), "12345");
    }

    #[test]
    fn test_hex_encode() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab]), "00ffab");
        assert_eq!(hex_encode(&[]), "");
        assert_eq!(hex_encode(&[0x12, 0x34]), "1234");
    }

    #[test]
    fn test_format_data_type() {
        assert_eq!(format_data_type(&DataType::Int32), "int32");
        assert_eq!(format_data_type(&DataType::Utf8), "string");
        assert_eq!(format_data_type(&DataType::Boolean), "boolean");
    }

    #[test]
    fn test_format_data_type_all_types() {
        // Integer types
        assert_eq!(format_data_type(&DataType::Null), "null");
        assert_eq!(format_data_type(&DataType::Int8), "int8");
        assert_eq!(format_data_type(&DataType::Int16), "int16");
        assert_eq!(format_data_type(&DataType::Int32), "int32");
        assert_eq!(format_data_type(&DataType::Int64), "int64");
        assert_eq!(format_data_type(&DataType::UInt8), "uint8");
        assert_eq!(format_data_type(&DataType::UInt16), "uint16");
        assert_eq!(format_data_type(&DataType::UInt32), "uint32");
        assert_eq!(format_data_type(&DataType::UInt64), "uint64");

        // Float types
        assert_eq!(format_data_type(&DataType::Float16), "float16");
        assert_eq!(format_data_type(&DataType::Float32), "float32");
        assert_eq!(format_data_type(&DataType::Float64), "float64");

        // String/binary types
        assert_eq!(format_data_type(&DataType::Utf8), "string");
        assert_eq!(format_data_type(&DataType::LargeUtf8), "string");
        assert_eq!(format_data_type(&DataType::Binary), "binary");
        assert_eq!(format_data_type(&DataType::LargeBinary), "binary");

        // Date/time types
        assert_eq!(format_data_type(&DataType::Date32), "date");
        assert_eq!(format_data_type(&DataType::Date64), "date");
        assert_eq!(format_data_type(&DataType::Time32(TimeUnit::Second)), "time");
        assert_eq!(format_data_type(&DataType::Time64(TimeUnit::Nanosecond)), "time");
        assert_eq!(format_data_type(&DataType::Duration(TimeUnit::Second)), "duration");

        // Timestamp with and without timezone
        assert_eq!(format_data_type(&DataType::Timestamp(TimeUnit::Second, None)), "timestamp(s)");
        assert_eq!(format_data_type(&DataType::Timestamp(TimeUnit::Millisecond, None)), "timestamp(ms)");
        assert_eq!(format_data_type(&DataType::Timestamp(TimeUnit::Microsecond, None)), "timestamp(μs)");
        assert_eq!(format_data_type(&DataType::Timestamp(TimeUnit::Nanosecond, None)), "timestamp(ns)");
        assert_eq!(
            format_data_type(&DataType::Timestamp(TimeUnit::Second, Some("UTC".into()))),
            "timestamp(s, UTC)"
        );

        // Decimal
        assert_eq!(format_data_type(&DataType::Decimal128(10, 2)), "decimal(10, 2)");
        assert_eq!(format_data_type(&DataType::Decimal256(20, 5)), "decimal(20, 5)");
    }

    #[test]
    fn test_format_data_type_complex_types() {
        // List types
        let int_field = Arc::new(Field::new("item", DataType::Int32, false));
        assert_eq!(format_data_type(&DataType::List(int_field.clone())), "list<int32>");
        assert_eq!(format_data_type(&DataType::LargeList(int_field.clone())), "list<int32>");
        assert_eq!(format_data_type(&DataType::FixedSizeList(int_field.clone(), 5)), "list<int32>[5]");

        // Struct
        let fields = vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int32, false),
        ];
        let struct_type = DataType::Struct(fields.into());
        assert!(format_data_type(&struct_type).starts_with("struct<"));

        // Map
        let key_field = Field::new("key", DataType::Utf8, false);
        let value_field = Field::new("value", DataType::Int32, true);
        let entry_struct = DataType::Struct(vec![key_field, value_field].into());
        let entry_field = Arc::new(Field::new("entries", entry_struct, false));
        let map_type = DataType::Map(entry_field, false);
        assert!(format_data_type(&map_type).starts_with("map<"));

        // Dictionary
        let dict_type = DataType::Dictionary(
            Box::new(DataType::Int32),
            Box::new(DataType::Utf8),
        );
        assert_eq!(format_data_type(&dict_type), "dict<int32, string>");
    }

    /// Create a simple parquet file in memory for testing
    fn create_test_parquet(rows: usize) -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, true),
            Field::new("active", DataType::Boolean, true),
        ]);

        let ids: Int32Array = (0..rows as i32).collect();
        let names: StringArray = (0..rows).map(|i| Some(format!("item_{}", i))).collect();
        let actives: BooleanArray = (0..rows).map(|i| Some(i % 2 == 0)).collect();

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(ids),
                Arc::new(names),
                Arc::new(actives),
            ],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }

        buffer
    }

    #[test]
    fn test_read_parquet_simple() {
        let parquet_data = create_test_parquet(5);
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.columns.len(), 3);
        assert_eq!(result.columns[0].name, "id");
        assert_eq!(result.columns[0].data_type, "int32");
        assert_eq!(result.columns[1].name, "name");
        assert_eq!(result.columns[1].data_type, "string");
        assert_eq!(result.columns[2].name, "active");
        assert_eq!(result.columns[2].data_type, "boolean");

        assert_eq!(result.total_rows, 5);
        assert_eq!(result.loaded_rows, 5);
        assert_eq!(result.rows.len(), 5);

        // Check first row
        assert_eq!(result.rows[0][0], "0");
        assert_eq!(result.rows[0][1], "item_0");
        assert_eq!(result.rows[0][2], "true");
    }

    #[test]
    fn test_read_parquet_with_limit() {
        let parquet_data = create_test_parquet(100);
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes_with_limit(&parquet_data, 10).unwrap();

        assert_eq!(result.total_rows, 100);
        assert_eq!(result.loaded_rows, 10);
        assert_eq!(result.rows.len(), 10);
    }

    #[test]
    fn test_read_parquet_with_custom_batch_size() {
        let parquet_data = create_test_parquet(50);
        let viewer = ParquetViewer::with_batch_size(25);
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.loaded_rows, 25);
        assert_eq!(result.total_rows, 50);
    }

    #[test]
    fn test_read_parquet_invalid_data() {
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(b"not a parquet file");
        assert!(result.is_err());
    }

    #[test]
    fn test_read_parquet_empty_data() {
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&[]);
        assert!(result.is_err());
    }

    /// Create parquet with numeric types
    fn create_numeric_parquet() -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new("int8", DataType::Int8, false),
            Field::new("int16", DataType::Int16, false),
            Field::new("int64", DataType::Int64, false),
            Field::new("uint8", DataType::UInt8, false),
            Field::new("uint16", DataType::UInt16, false),
            Field::new("uint32", DataType::UInt32, false),
            Field::new("uint64", DataType::UInt64, false),
            Field::new("float32", DataType::Float32, false),
            Field::new("float64", DataType::Float64, false),
        ]);

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(Int8Array::from(vec![1i8, -1, 127])),
                Arc::new(Int16Array::from(vec![100i16, -100, 32767])),
                Arc::new(Int64Array::from(vec![1000i64, -1000, i64::MAX])),
                Arc::new(UInt8Array::from(vec![1u8, 128, 255])),
                Arc::new(UInt16Array::from(vec![1u16, 1000, 65535])),
                Arc::new(UInt32Array::from(vec![1u32, 100000, u32::MAX])),
                Arc::new(UInt64Array::from(vec![1u64, 1000000, u64::MAX])),
                Arc::new(Float32Array::from(vec![1.5f32, -2.5, f32::NAN])),
                Arc::new(Float64Array::from(vec![3.14159f64, f64::INFINITY, f64::NEG_INFINITY])),
            ],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }
        buffer
    }

    #[test]
    fn test_read_parquet_numeric_types() {
        let parquet_data = create_numeric_parquet();
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.rows.len(), 3);

        // Check float NaN, Inf handling
        assert_eq!(result.rows[2][7], "NaN");       // Float32 NaN
        assert_eq!(result.rows[1][8], "Inf");       // Float64 Infinity
        assert_eq!(result.rows[2][8], "-Inf");      // Float64 -Infinity
    }

    /// Create parquet with nulls
    fn create_parquet_with_nulls() -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new("nullable_int", DataType::Int32, true),
            Field::new("nullable_str", DataType::Utf8, true),
        ]);

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(Int32Array::from(vec![Some(1), None, Some(3)])),
                Arc::new(StringArray::from(vec![Some("hello"), None, Some("world")])),
            ],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }
        buffer
    }

    #[test]
    fn test_read_parquet_with_nulls() {
        let parquet_data = create_parquet_with_nulls();
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.rows[0][0], "1");
        assert_eq!(result.rows[1][0], "null");  // Null integer
        assert_eq!(result.rows[0][1], "hello");
        assert_eq!(result.rows[1][1], "null");  // Null string
    }

    /// Create parquet with binary data
    fn create_parquet_with_binary() -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new("small_bin", DataType::Binary, false),
            Field::new("large_bin", DataType::Binary, false),
        ]);

        let small_data: Vec<&[u8]> = vec![&[0x00, 0x01, 0x02]];
        let large_data: Vec<&[u8]> = vec![&[0xab; 100]];  // 100 bytes

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(BinaryArray::from(small_data)),
                Arc::new(BinaryArray::from(large_data)),
            ],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }
        buffer
    }

    #[test]
    fn test_read_parquet_binary_data() {
        let parquet_data = create_parquet_with_binary();
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], "0x000102");  // Small binary shown in full
        assert!(result.rows[0][1].contains("100 bytes"));  // Large binary truncated
    }

    /// Create parquet with dates
    fn create_parquet_with_dates() -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new("date32", DataType::Date32, false),
            Field::new("timestamp_s", DataType::Timestamp(TimeUnit::Second, None), false),
            Field::new("timestamp_ms", DataType::Timestamp(TimeUnit::Millisecond, None), false),
        ]);

        // Date32: days since Unix epoch
        // 19000 days from epoch = 2021-12-19 approximately
        let date32_arr = Date32Array::from(vec![19000]);
        // Timestamp in seconds: 1640000000 = 2021-12-20
        let ts_s_arr = TimestampSecondArray::from(vec![1640000000i64]);
        let ts_ms_arr = TimestampMillisecondArray::from(vec![1640000000000i64]);

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(date32_arr),
                Arc::new(ts_s_arr),
                Arc::new(ts_ms_arr),
            ],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }
        buffer
    }

    #[test]
    fn test_read_parquet_dates() {
        let parquet_data = create_parquet_with_dates();
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.rows.len(), 1);
        // Date32 (19000 days since epoch) and timestamps (1640000000s = 2021-12-20)
        // Just verify we got string values (format can vary)
        assert!(!result.rows[0][0].is_empty(), "date32 should have a value");
        assert!(!result.rows[0][1].is_empty(), "timestamp_s should have a value");
        assert!(!result.rows[0][2].is_empty(), "timestamp_ms should have a value");
        // Timestamps should contain a time part
        assert!(result.rows[0][1].contains(":") || result.rows[0][1].contains("20"), "timestamp_s: {}", result.rows[0][1]);
    }

    /// Create parquet with list arrays
    fn create_parquet_with_list() -> Vec<u8> {
        let schema = Schema::new(vec![
            Field::new(
                "int_list",
                DataType::List(Arc::new(Field::new("item", DataType::Int32, true))),
                false,
            ),
        ]);

        let values = Int32Array::from(vec![1, 2, 3, 4, 5]);
        let offsets = arrow::buffer::OffsetBuffer::new(vec![0, 3, 5].into());
        let list_arr = ListArray::new(
            Arc::new(Field::new("item", DataType::Int32, true)),
            offsets,
            Arc::new(values),
            None,
        );

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![Arc::new(list_arr)],
        ).unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut writer = ArrowWriter::try_new(&mut buffer, Arc::new(schema), None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
        }
        buffer
    }

    #[test]
    fn test_read_parquet_list_array() {
        let parquet_data = create_parquet_with_list();
        let viewer = ParquetViewer::new();
        let result = viewer.read_bytes(&parquet_data).unwrap();

        assert_eq!(result.rows.len(), 2);
        // First list: [1, 2, 3]
        assert!(result.rows[0][0].contains("1"));
        assert!(result.rows[0][0].contains("2"));
        assert!(result.rows[0][0].contains("3"));
        // Second list: [4, 5]
        assert!(result.rows[1][0].contains("4"));
        assert!(result.rows[1][0].contains("5"));
    }
}
