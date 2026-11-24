# Source this file so subsequent Forge commands inherit the credentials.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  echo 'Run: source scripts/forge-login.bash' >&2
  exit 1
fi

_checkpoint_forge_login() {
  local email token nvm_script
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if ! declare -F nvm >/dev/null && [[ -r $nvm_script ]]; then
    source "$nvm_script" --no-use || return 1
  fi
  if declare -F nvm >/dev/null; then
    nvm use --silent || return 1
  fi
  email=${FORGE_EMAIL:-}
  token=${FORGE_API_TOKEN:-}
  if [[ -f .env ]]; then
    if [[ -z $email ]]; then
      email=$(node -p 'require("node:util").parseEnv(require("node:fs").readFileSync(".env", "utf8")).FORGE_EMAIL || ""') || return 1
    fi
    if [[ -z $token ]]; then
      token=$(node -p 'const vars = require("node:util").parseEnv(require("node:fs").readFileSync(".env", "utf8")); vars.FORGE_API_TOKEN || vars["API-FORGE"] || ""') || return 1
    fi
  fi
  if [[ -z $email ]]; then
    IFS= read -r -p 'Atlassian account email: ' email </dev/tty || return 1
  fi
  if [[ -z $email ]]; then
    echo 'Email was empty. Run the helper again.' >&2
    return 1
  fi
  if [[ -z $token ]]; then
    IFS= read -rs -p 'Forge scoped API token (hidden): ' token </dev/tty || return 1
    printf '\n' >/dev/tty
  fi
  if [[ -z $token ]]; then
    echo 'Token was empty. Run the helper again.' >&2
    return 1
  fi
  export FORGE_EMAIL="$email" FORGE_API_TOKEN="$token"
  npm run forge -- whoami
}

_checkpoint_forge_login
