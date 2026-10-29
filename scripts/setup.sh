#!/bin/bash

set -e

echo "==== epubLegend Setup Script ===="

# Check Python version
echo "Checking Python installation..."
PYTHON_PATH=${PYTHON_PATH:-/usr/bin/python3}

if ! command -v $PYTHON_PATH &> /dev/null; then
    echo "ERROR: Python 3 not found at $PYTHON_PATH"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_PATH --version 2>&1 | awk '{print $2}')
echo "Found Python version: $PYTHON_VERSION"

# Parse version
IFS='.' read -r MAJOR MINOR PATCH <<< "$PYTHON_VERSION"
if [[ $MAJOR -lt 3 ]] || [[ $MAJOR -eq 3 && $MINOR -lt 9 ]]; then
    echo "ERROR: Python 3.9+ required (found $PYTHON_VERSION)"
    exit 1
fi

# Install Python dependencies
echo "Installing Python dependencies..."
$PYTHON_PATH -m pip install beautifulsoup4 requests --upgrade

# Create necessary directories
echo "Creating directories..."
mkdir -p /Users/mac/Documents/epubLegend/db
mkdir -p /Users/mac/Documents/epubLegend/downloads/novels

echo "✓ Setup complete!"
