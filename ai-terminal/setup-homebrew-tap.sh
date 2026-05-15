#!/bin/bash

# Exit on error
set -e

echo "🍺 Setting up Homebrew tap repository for ai-terminal..."

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI (gh) is not installed. Please install it with: brew install gh"
    exit 1
fi

# Check if logged in to GitHub
if ! gh auth status &> /dev/null; then
    echo "Please log in to GitHub with: gh auth login"
    exit 1
fi

# Create the tap repository on GitHub
echo "Creating GitHub repository for Homebrew tap..."
REPO_NAME="ai-terminal"
ORGANIZATION="AiTerminalFoundation"

# Check if the repo already exists
if gh repo view $ORGANIZATION/$REPO_NAME &> /dev/null; then
    echo "Repository $ORGANIZATION/$REPO_NAME already exists. Skipping creation."
else
    echo "Creating repository $ORGANIZATION/$REPO_NAME..."
    gh repo create $ORGANIZATION/$REPO_NAME --public --description "Homebrew Tap for AI Terminal" || {
        echo "Failed to create repository. Please create it manually on GitHub."
        exit 1
    }
fi

# Clone the repo
echo "Cloning the tap repository..."
TMP_DIR=$(mktemp -d)
cd $TMP_DIR
gh repo clone $ORGANIZATION/$REPO_NAME || {
    echo "Failed to clone repository. Please check if it exists and you have access."
    exit 1
}

cd $REPO_NAME

# Copy the formula to the repository
echo "Copying formula to the repository..."
cp "$OLDPWD/ai-terminal.rb" ./Formula/

# Commit and push changes
echo "Committing and pushing changes..."
git add ./Formula/ai-terminal.rb
git commit -m "Update ai-terminal formula to version $(grep -m1 "version" $OLDPWD/package.json | cut -d '"' -f 4)"
git push

echo "✅ Homebrew tap repository setup complete!"
echo "Users can now install ai-terminal with:"
echo "  brew tap $ORGANIZATION/ai-terminal"
echo "  brew install ai-terminal"
echo ""
echo "To update the formula in the future, run:"
echo "  ./build-macos.sh"
echo "  ./setup-homebrew-tap.sh"

# Clean up temporary directory
cd $OLDPWD
rm -rf $TMP_DIR 