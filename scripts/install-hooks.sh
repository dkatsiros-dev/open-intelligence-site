#!/usr/bin/env sh
# Link the versioned git hooks into .git/hooks. Run once per clone.
set -eu
root=$(git rev-parse --show-toplevel)
ln -sf ../../scripts/git-hooks/pre-commit "$root/.git/hooks/pre-commit"
echo "installed: .git/hooks/pre-commit -> scripts/git-hooks/pre-commit"
