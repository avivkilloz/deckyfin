#!/bin/bash

# Script to install dependencies in a Proton prefix using protontricks
# Usage: ./protontricks-install-dependencies.sh <pfxid> <dependencies>
# Example: ./protontricks-install-dependencies.sh 730 vcrun2022,d3dx9

# Check if correct number of arguments provided
if [ $# -ne 2 ]; then
    echo "Error: Invalid number of arguments"
    echo "Usage: $0 <pfxid> <dependencies>"
    echo "Example: $0 730 vcrun2022,d3dx9"
    exit 1
fi

pfxid=$1
dependencies=$2

# Check if pfxid is a number
if ! [[ "$pfxid" =~ ^[0-9]+$ ]]; then
    echo "Error: pfxid must be a numeric Steam App ID"
    exit 1
fi

# Check if dependencies parameter is provided
if [ -z "$dependencies" ]; then
    echo "Error: No dependencies specified"
    exit 1
fi

echo "Installing dependencies for Proton prefix: $pfxid"
echo "Dependencies: $dependencies"
echo ""

# Convert comma-separated list to array
IFS=',' read -ra dep_array <<< "$dependencies"

# Install each dependency
for dep in "${dep_array[@]}"; do
    # Trim whitespace
    dep=$(echo "$dep" | xargs)

    echo "Installing $dep..."
    flatpak run com.github.Matoking.protontricks "$pfxid" -- --force --unattended "$dep"

    if [ $? -eq 0 ]; then
        echo "✓ Successfully installed $dep"
    else
        echo "✗ Failed to install $dep"
    fi
    echo ""
done

echo "Installation complete!"

