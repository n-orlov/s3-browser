# Makefile for s3-browser

.PHONY: all build release test coverage coverage-html clean

# Default target
all: build

# Debug build
build:
	cargo build

# Release build
release:
	cargo build --release

# Run tests
test:
	cargo test

# Run coverage with UI file exclusions
# Excludes: main.rs, app.rs, text.rs (non-testable UI/entry code)
# Target: >80% line coverage
coverage:
	cargo llvm-cov --ignore-filename-regex "(main\.rs|app\.rs|text\.rs)"

# Generate HTML coverage report
coverage-html:
	cargo llvm-cov --ignore-filename-regex "(main\.rs|app\.rs|text\.rs)" --html
	@echo "Coverage report generated in target/llvm-cov/html/index.html"

# Generate JSON coverage report
coverage-json:
	cargo llvm-cov --ignore-filename-regex "(main\.rs|app\.rs|text\.rs)" --json

# Clean build artifacts
clean:
	cargo clean
