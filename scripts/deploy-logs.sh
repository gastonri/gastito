#!/bin/bash
set -e

# Add Fly CLI to PATH if installed in default location
if [ -d "$HOME/.fly" ]; then
  export FLYCTL_INSTALL="$HOME/.fly"
  export PATH="$FLYCTL_INSTALL/bin:$PATH"
fi

flyctl logs -a gastito "$@"
