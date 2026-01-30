//! JSON file viewer with tree view support
//!
//! Provides tree and text view modes for JSON files with collapsible nodes.

use anyhow::{Context, Result};
use serde_json::Value;

/// Represents a node in the JSON tree structure
#[derive(Debug, Clone)]
pub struct JsonNode {
    /// Unique identifier for this node (path in the JSON tree)
    pub id: String,
    /// Display key (property name or array index)
    pub key: String,
    /// Display value (for primitive types) or type indicator (for objects/arrays)
    pub value: String,
    /// Type of the JSON value
    pub value_type: JsonValueType,
    /// Depth level in the tree (0 = root)
    pub depth: usize,
    /// Whether this node can be expanded (objects and arrays)
    pub expandable: bool,
    /// Whether this node is currently expanded
    pub expanded: bool,
    /// Number of children (for objects: properties count, for arrays: element count)
    pub child_count: usize,
}

/// JSON value type for display purposes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonValueType {
    /// null
    Null,
    /// true/false
    Boolean,
    /// integer or float
    Number,
    /// quoted string
    String,
    /// {...}
    Object,
    /// [...]
    Array,
}

impl JsonValueType {
    /// Get a display name for the type
    pub fn display_name(&self) -> &'static str {
        match self {
            JsonValueType::Null => "null",
            JsonValueType::Boolean => "boolean",
            JsonValueType::Number => "number",
            JsonValueType::String => "string",
            JsonValueType::Object => "object",
            JsonValueType::Array => "array",
        }
    }

    /// Get a color hint for the type (CSS-style hex)
    pub fn color_hint(&self) -> &'static str {
        match self {
            JsonValueType::Null => "#808080",      // gray
            JsonValueType::Boolean => "#0000ff",   // blue
            JsonValueType::Number => "#008000",    // green
            JsonValueType::String => "#a31515",    // red/brown
            JsonValueType::Object => "#000000",    // black
            JsonValueType::Array => "#000000",     // black
        }
    }
}

/// Result of parsing a JSON file
#[derive(Debug)]
pub struct JsonData {
    /// The original JSON content as formatted text
    pub text_content: String,
    /// The flattened tree structure (visible nodes only)
    pub tree_nodes: Vec<JsonNode>,
    /// Total node count (including collapsed children)
    pub total_nodes: usize,
    /// File size in bytes
    pub file_size: usize,
    /// Whether the JSON is valid
    pub is_valid: bool,
    /// Parse error message (if any)
    pub error_message: Option<String>,
}

/// JSON viewer with tree and text modes
pub struct JsonViewer {
    /// Maximum depth for initial expansion
    max_initial_depth: usize,
    /// Maximum nodes to process
    max_nodes: usize,
}

impl JsonViewer {
    /// Create a new JSON viewer with default settings
    pub fn new() -> Self {
        Self {
            max_initial_depth: 2,   // Expand root and first level by default
            max_nodes: 100_000,     // Prevent OOM on huge JSON files
        }
    }

    /// Create a viewer with custom settings
    pub fn with_settings(max_initial_depth: usize, max_nodes: usize) -> Self {
        Self {
            max_initial_depth,
            max_nodes,
        }
    }

    /// Parse JSON from bytes
    pub fn load_bytes(&self, data: &[u8]) -> Result<JsonData> {
        let file_size = data.len();

        // Try to parse as UTF-8
        let text = std::str::from_utf8(data)
            .context("JSON file is not valid UTF-8")?;

        self.load_str(text, file_size)
    }

    /// Parse JSON from string
    pub fn load_str(&self, text: &str, file_size: usize) -> Result<JsonData> {
        // Try to parse JSON
        let value: Value = match serde_json::from_str(text) {
            Ok(v) => v,
            Err(e) => {
                // Return invalid JSON data with error message
                return Ok(JsonData {
                    text_content: text.to_string(),
                    tree_nodes: Vec::new(),
                    total_nodes: 0,
                    file_size,
                    is_valid: false,
                    error_message: Some(format!("JSON parse error: {}", e)),
                });
            }
        };

        // Pretty-print the JSON
        let text_content = serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| text.to_string());

        // Build the tree structure
        let mut nodes = Vec::new();
        let mut node_count = 0;
        let expanded_paths = std::collections::HashSet::new();

        self.build_tree(&value, "", "(root)", 0, &mut nodes, &mut node_count, &expanded_paths);

        Ok(JsonData {
            text_content,
            tree_nodes: nodes,
            total_nodes: node_count,
            file_size,
            is_valid: true,
            error_message: None,
        })
    }

    /// Build tree nodes from a JSON value recursively
    fn build_tree(
        &self,
        value: &Value,
        path: &str,
        key: &str,
        depth: usize,
        nodes: &mut Vec<JsonNode>,
        node_count: &mut usize,
        expanded_paths: &std::collections::HashSet<String>,
    ) {
        if *node_count >= self.max_nodes {
            return;
        }

        let node_path = if path.is_empty() {
            key.to_string()
        } else {
            format!("{}.{}", path, key)
        };

        *node_count += 1;

        let (value_type, display_value, expandable, child_count) = match value {
            Value::Null => (JsonValueType::Null, "null".to_string(), false, 0),
            Value::Bool(b) => (JsonValueType::Boolean, b.to_string(), false, 0),
            Value::Number(n) => (JsonValueType::Number, n.to_string(), false, 0),
            Value::String(s) => {
                let display = if s.len() > 100 {
                    format!("\"{}...\"", &s[..97])
                } else {
                    format!("\"{}\"", s)
                };
                (JsonValueType::String, display, false, 0)
            }
            Value::Array(arr) => {
                let count = arr.len();
                let display = format!("[{} items]", count);
                (JsonValueType::Array, display, count > 0, count)
            }
            Value::Object(obj) => {
                let count = obj.len();
                let display = format!("{{{} properties}}", count);
                (JsonValueType::Object, display, count > 0, count)
            }
        };

        // Determine if expanded (default expand to max_initial_depth)
        let expanded = if expandable {
            expanded_paths.contains(&node_path) || depth < self.max_initial_depth
        } else {
            false
        };

        nodes.push(JsonNode {
            id: node_path.clone(),
            key: key.to_string(),
            value: display_value,
            value_type,
            depth,
            expandable,
            expanded,
            child_count,
        });

        // Recursively add children if expanded
        if expanded {
            match value {
                Value::Array(arr) => {
                    for (idx, item) in arr.iter().enumerate() {
                        let item_key = format!("[{}]", idx);
                        self.build_tree(item, &node_path, &item_key, depth + 1, nodes, node_count, expanded_paths);
                    }
                }
                Value::Object(obj) => {
                    for (k, v) in obj {
                        self.build_tree(v, &node_path, k, depth + 1, nodes, node_count, expanded_paths);
                    }
                }
                _ => {}
            }
        }
    }

    /// Rebuild tree with toggled expansion state
    pub fn rebuild_with_toggle(&self, data: &[u8], toggle_path: &str, current_expanded: &[String]) -> Result<Vec<JsonNode>> {
        let text = std::str::from_utf8(data)
            .context("JSON file is not valid UTF-8")?;

        let value: Value = serde_json::from_str(text)
            .context("Failed to parse JSON")?;

        // Build set of expanded paths
        let mut expanded_paths: std::collections::HashSet<String> = current_expanded.iter().cloned().collect();

        // Toggle the specified path
        if expanded_paths.contains(toggle_path) {
            expanded_paths.remove(toggle_path);
        } else {
            expanded_paths.insert(toggle_path.to_string());
        }

        // Rebuild tree
        let mut nodes = Vec::new();
        let mut node_count = 0;
        self.build_tree_with_state(&value, "", "(root)", 0, &mut nodes, &mut node_count, &expanded_paths);

        Ok(nodes)
    }

    /// Build tree with specific expansion state
    fn build_tree_with_state(
        &self,
        value: &Value,
        path: &str,
        key: &str,
        depth: usize,
        nodes: &mut Vec<JsonNode>,
        node_count: &mut usize,
        expanded_paths: &std::collections::HashSet<String>,
    ) {
        if *node_count >= self.max_nodes {
            return;
        }

        let node_path = if path.is_empty() {
            key.to_string()
        } else {
            format!("{}.{}", path, key)
        };

        *node_count += 1;

        let (value_type, display_value, expandable, child_count) = match value {
            Value::Null => (JsonValueType::Null, "null".to_string(), false, 0),
            Value::Bool(b) => (JsonValueType::Boolean, b.to_string(), false, 0),
            Value::Number(n) => (JsonValueType::Number, n.to_string(), false, 0),
            Value::String(s) => {
                let display = if s.len() > 100 {
                    format!("\"{}...\"", &s[..97])
                } else {
                    format!("\"{}\"", s)
                };
                (JsonValueType::String, display, false, 0)
            }
            Value::Array(arr) => {
                let count = arr.len();
                let display = format!("[{} items]", count);
                (JsonValueType::Array, display, count > 0, count)
            }
            Value::Object(obj) => {
                let count = obj.len();
                let display = format!("{{{} properties}}", count);
                (JsonValueType::Object, display, count > 0, count)
            }
        };

        // Check if this node is expanded
        let expanded = expandable && expanded_paths.contains(&node_path);

        nodes.push(JsonNode {
            id: node_path.clone(),
            key: key.to_string(),
            value: display_value,
            value_type,
            depth,
            expandable,
            expanded,
            child_count,
        });

        // Recursively add children if expanded
        if expanded {
            match value {
                Value::Array(arr) => {
                    for (idx, item) in arr.iter().enumerate() {
                        let item_key = format!("[{}]", idx);
                        self.build_tree_with_state(item, &node_path, &item_key, depth + 1, nodes, node_count, expanded_paths);
                    }
                }
                Value::Object(obj) => {
                    for (k, v) in obj {
                        self.build_tree_with_state(v, &node_path, k, depth + 1, nodes, node_count, expanded_paths);
                    }
                }
                _ => {}
            }
        }
    }

    /// Get expanded node paths from tree nodes
    pub fn get_expanded_paths(nodes: &[JsonNode]) -> Vec<String> {
        nodes.iter()
            .filter(|n| n.expanded)
            .map(|n| n.id.clone())
            .collect()
    }

    /// Collapse all nodes except root
    pub fn collapse_all(&self, data: &[u8]) -> Result<Vec<JsonNode>> {
        let text = std::str::from_utf8(data)
            .context("JSON file is not valid UTF-8")?;

        let value: Value = serde_json::from_str(text)
            .context("Failed to parse JSON")?;

        let expanded_paths = std::collections::HashSet::new();
        let mut nodes = Vec::new();
        let mut node_count = 0;
        self.build_tree_with_state(&value, "", "(root)", 0, &mut nodes, &mut node_count, &expanded_paths);

        Ok(nodes)
    }

    /// Expand all nodes up to a certain depth
    pub fn expand_to_depth(&self, data: &[u8], max_depth: usize) -> Result<Vec<JsonNode>> {
        let text = std::str::from_utf8(data)
            .context("JSON file is not valid UTF-8")?;

        let value: Value = serde_json::from_str(text)
            .context("Failed to parse JSON")?;

        let viewer = JsonViewer::with_settings(max_depth, self.max_nodes);
        let mut nodes = Vec::new();
        let mut node_count = 0;
        let expanded_paths = std::collections::HashSet::new();
        viewer.build_tree(&value, "", "(root)", 0, &mut nodes, &mut node_count, &expanded_paths);

        Ok(nodes)
    }
}

impl Default for JsonViewer {
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
    fn test_viewer_creation() {
        let viewer = JsonViewer::new();
        assert_eq!(viewer.max_initial_depth, 2);
        assert_eq!(viewer.max_nodes, 100_000);
    }

    #[test]
    fn test_viewer_with_settings() {
        let viewer = JsonViewer::with_settings(3, 50_000);
        assert_eq!(viewer.max_initial_depth, 3);
        assert_eq!(viewer.max_nodes, 50_000);
    }

    #[test]
    fn test_viewer_default() {
        let viewer = JsonViewer::default();
        assert_eq!(viewer.max_initial_depth, 2);
    }

    #[test]
    fn test_parse_null() {
        let viewer = JsonViewer::new();
        let data = r#"null"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
        assert_eq!(result.tree_nodes.len(), 1);
        assert_eq!(result.tree_nodes[0].value_type, JsonValueType::Null);
        assert_eq!(result.tree_nodes[0].value, "null");
    }

    #[test]
    fn test_parse_boolean() {
        let viewer = JsonViewer::new();

        let data = r#"true"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value_type, JsonValueType::Boolean);
        assert_eq!(result.tree_nodes[0].value, "true");

        let data = r#"false"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value, "false");
    }

    #[test]
    fn test_parse_number() {
        let viewer = JsonViewer::new();

        let data = r#"42"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value_type, JsonValueType::Number);
        assert_eq!(result.tree_nodes[0].value, "42");

        let data = r#"3.14159"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value, "3.14159");

        let data = r#"-123"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value, "-123");
    }

    #[test]
    fn test_parse_string() {
        let viewer = JsonViewer::new();

        let data = r#""hello world""#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();
        assert_eq!(result.tree_nodes[0].value_type, JsonValueType::String);
        assert_eq!(result.tree_nodes[0].value, "\"hello world\"");
    }

    #[test]
    fn test_parse_string_truncation() {
        let viewer = JsonViewer::new();

        // Create a string longer than 100 characters
        let long_string = "a".repeat(150);
        let data = format!(r#""{}""#, long_string);
        let result = viewer.load_bytes(data.as_bytes()).unwrap();

        assert!(result.tree_nodes[0].value.len() < 110);
        assert!(result.tree_nodes[0].value.ends_with("...\""));
    }

    #[test]
    fn test_parse_array() {
        let viewer = JsonViewer::new();

        let data = r#"[1, 2, 3]"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
        assert!(result.tree_nodes[0].value_type == JsonValueType::Array);
        assert!(result.tree_nodes[0].expandable);
        assert_eq!(result.tree_nodes[0].child_count, 3);

        // Since depth < max_initial_depth, array should be expanded
        assert!(result.tree_nodes[0].expanded);
        // Should have root + 3 children
        assert!(result.tree_nodes.len() >= 4);
    }

    #[test]
    fn test_parse_empty_array() {
        let viewer = JsonViewer::new();

        let data = r#"[]"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.tree_nodes[0].value_type == JsonValueType::Array);
        assert!(!result.tree_nodes[0].expandable);  // Empty array is not expandable
        assert_eq!(result.tree_nodes[0].child_count, 0);
    }

    #[test]
    fn test_parse_object() {
        let viewer = JsonViewer::new();

        let data = r#"{"name": "test", "value": 42}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
        assert!(result.tree_nodes[0].value_type == JsonValueType::Object);
        assert!(result.tree_nodes[0].expandable);
        assert_eq!(result.tree_nodes[0].child_count, 2);
    }

    #[test]
    fn test_parse_empty_object() {
        let viewer = JsonViewer::new();

        let data = r#"{}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.tree_nodes[0].value_type == JsonValueType::Object);
        assert!(!result.tree_nodes[0].expandable);
        assert_eq!(result.tree_nodes[0].child_count, 0);
    }

    #[test]
    fn test_parse_nested_structure() {
        let viewer = JsonViewer::new();

        let data = r#"{
            "name": "root",
            "children": [
                {"id": 1, "name": "child1"},
                {"id": 2, "name": "child2"}
            ]
        }"#.as_bytes();

        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
        assert!(result.tree_nodes.len() > 1);

        // Check that the pretty-printed text is valid
        assert!(result.text_content.contains("\"name\""));
        assert!(result.text_content.contains("\"children\""));
    }

    #[test]
    fn test_parse_invalid_json() {
        let viewer = JsonViewer::new();

        let data = r#"{invalid json"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(!result.is_valid);
        assert!(result.error_message.is_some());
        assert!(result.error_message.unwrap().contains("parse error"));
        assert!(result.tree_nodes.is_empty());
    }

    #[test]
    fn test_parse_invalid_utf8() {
        let viewer = JsonViewer::new();

        let data = &[0xff, 0xfe, 0x00];
        let result = viewer.load_bytes(data);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("UTF-8"));
    }

    #[test]
    fn test_node_depth() {
        let viewer = JsonViewer::with_settings(10, 1000);  // Expand deeper

        let data = r#"{"a": {"b": {"c": 123}}}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        // Find nodes at different depths
        let root = result.tree_nodes.iter().find(|n| n.key == "(root)").unwrap();
        assert_eq!(root.depth, 0);

        let a = result.tree_nodes.iter().find(|n| n.key == "a").unwrap();
        assert_eq!(a.depth, 1);

        let b = result.tree_nodes.iter().find(|n| n.key == "b").unwrap();
        assert_eq!(b.depth, 2);

        let c = result.tree_nodes.iter().find(|n| n.key == "c").unwrap();
        assert_eq!(c.depth, 3);
    }

    #[test]
    fn test_value_type_display_name() {
        assert_eq!(JsonValueType::Null.display_name(), "null");
        assert_eq!(JsonValueType::Boolean.display_name(), "boolean");
        assert_eq!(JsonValueType::Number.display_name(), "number");
        assert_eq!(JsonValueType::String.display_name(), "string");
        assert_eq!(JsonValueType::Object.display_name(), "object");
        assert_eq!(JsonValueType::Array.display_name(), "array");
    }

    #[test]
    fn test_value_type_color_hint() {
        assert!(!JsonValueType::Null.color_hint().is_empty());
        assert!(!JsonValueType::Boolean.color_hint().is_empty());
        assert!(!JsonValueType::Number.color_hint().is_empty());
        assert!(!JsonValueType::String.color_hint().is_empty());
        assert!(!JsonValueType::Object.color_hint().is_empty());
        assert!(!JsonValueType::Array.color_hint().is_empty());
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(512), "512 B");
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_file_size(1024 * 1024 * 10), "10.0 MB");
    }

    #[test]
    fn test_get_expanded_paths() {
        let nodes = vec![
            JsonNode {
                id: "root".to_string(),
                key: "(root)".to_string(),
                value: "{2 properties}".to_string(),
                value_type: JsonValueType::Object,
                depth: 0,
                expandable: true,
                expanded: true,
                child_count: 2,
            },
            JsonNode {
                id: "root.child".to_string(),
                key: "child".to_string(),
                value: "[3 items]".to_string(),
                value_type: JsonValueType::Array,
                depth: 1,
                expandable: true,
                expanded: false,
                child_count: 3,
            },
        ];

        let paths = JsonViewer::get_expanded_paths(&nodes);
        assert_eq!(paths.len(), 1);
        assert!(paths.contains(&"root".to_string()));
    }

    #[test]
    fn test_collapse_all() {
        let viewer = JsonViewer::new();

        let data = r#"{"a": [1, 2, 3], "b": {"c": "test"}}"#.as_bytes();
        let collapsed = viewer.collapse_all(data).unwrap();

        // All expandable nodes should be collapsed
        for node in &collapsed {
            if node.expandable {
                assert!(!node.expanded, "Node {} should be collapsed", node.key);
            }
        }

        // Should only have the root node visible when all collapsed
        assert_eq!(collapsed.len(), 1);
    }

    #[test]
    fn test_expand_to_depth() {
        let viewer = JsonViewer::new();

        let data = r#"{"a": {"b": {"c": {"d": 1}}}}"#.as_bytes();

        // Expand only to depth 1 (root + first level)
        let nodes = viewer.expand_to_depth(data, 1).unwrap();

        // Root should be expanded
        let root = nodes.iter().find(|n| n.key == "(root)").unwrap();
        assert!(root.expanded);

        // Find 'a' - should NOT be expanded since we only go to depth 1
        let a = nodes.iter().find(|n| n.key == "a");
        if let Some(node) = a {
            assert!(!node.expanded);
        }
    }

    #[test]
    fn test_rebuild_with_toggle() {
        let viewer = JsonViewer::new();

        let data = r#"{"items": [1, 2, 3]}"#.as_bytes();
        let initial = viewer.load_bytes(data).unwrap();

        // Get the path to toggle (the 'items' array)
        let items_node = initial.tree_nodes.iter()
            .find(|n| n.key == "items")
            .unwrap();

        let was_expanded = items_node.expanded;
        let current_expanded = JsonViewer::get_expanded_paths(&initial.tree_nodes);

        // Toggle the node
        let toggled = viewer.rebuild_with_toggle(data, &items_node.id, &current_expanded).unwrap();

        let items_after = toggled.iter().find(|n| n.key == "items").unwrap();
        assert_ne!(items_after.expanded, was_expanded);
    }

    #[test]
    fn test_array_index_keys() {
        let viewer = JsonViewer::with_settings(10, 1000);

        let data = r#"[100, 200, 300]"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        // Check that array elements have [0], [1], [2] as keys
        let keys: Vec<&str> = result.tree_nodes.iter()
            .map(|n| n.key.as_str())
            .collect();

        assert!(keys.contains(&"[0]"));
        assert!(keys.contains(&"[1]"));
        assert!(keys.contains(&"[2]"));
    }

    #[test]
    fn test_pretty_print() {
        let viewer = JsonViewer::new();

        let data = r#"{"a":1,"b":2}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        // Pretty printed should have newlines and indentation
        assert!(result.text_content.contains('\n'));
        assert!(result.text_content.contains("  "));  // Has indentation
    }

    #[test]
    fn test_unicode_json() {
        let viewer = JsonViewer::new();

        let data = r#"{"greeting": "Hello 世界!", "emoji": "🎉"}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
        assert!(result.text_content.contains("世界"));
        assert!(result.text_content.contains("🎉"));
    }

    #[test]
    fn test_special_characters() {
        let viewer = JsonViewer::new();

        let data = r#"{"text": "line1\nline2\ttab"}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
    }

    #[test]
    fn test_large_numbers() {
        let viewer = JsonViewer::new();

        let data = r#"{"big": 9007199254740992, "float": 3.141592653589793}"#.as_bytes();
        let result = viewer.load_bytes(data).unwrap();

        assert!(result.is_valid);
    }
}
