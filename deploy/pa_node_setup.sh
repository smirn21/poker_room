#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
cd "$HOME/poker_room"
bash deploy/setup_pa.sh
echo "==> Node setup done: $(node -v) $(npm -v)"
