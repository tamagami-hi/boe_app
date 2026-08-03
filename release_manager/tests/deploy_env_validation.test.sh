#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=../lib/ui.sh
source "$ROOT_DIR/release_manager/lib/ui.sh"
# shellcheck source=../stacks/_shared/_boe_lib.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_lib.sh"
# shellcheck source=../stacks/_shared/_boe_deploy.sh
source "$ROOT_DIR/release_manager/stacks/_shared/_boe_deploy.sh"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
chmod 700 "$TEST_DIR"

env_file="$TEST_DIR/.env"
cat > "$env_file" <<'ENV'
POSTGRES_USER=test
POSTGRES_PASSWORD=test_database_password_1234
POSTGRES_DB=test
BACKEND_PORT=47423
LANDING_PORT=47420
APP_FRONTEND_PORT=47421
ADMIN_FRONTEND_PORT=47422
PUBLIC_API_BASE_URL=https://api.example.test
PUBLIC_LANDING_ORIGIN=https://example.test
CORS_ORIGIN=https://api.example.test
ENV
chmod 600 "$env_file"

P[has_database]="true"
P[env_file]="$env_file"
BOE_EFFECTIVE_ENV="$env_file"

if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted an environment without signing and crypto keys\n' >&2
    exit 1
fi

private_key="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null)"
public_key="$(printf '%s\n' "$private_key" | openssl pkey -pubout 2>/dev/null)"
escaped_private_key="${private_key//$'\n'/\\n}"
verification_keys="$(jq -cn --arg kid test-kid --arg pem "$public_key" '{($kid): $pem}')"
base64_key="$(head -c 32 /dev/zero | base64 -w0)"

cat >> "$env_file" <<ENV
WEB_ORIGIN_ALLOWLIST=https://api.example.test
WEB_COOKIE_SECURE=true
ACCESS_TOKEN_ISSUER=https://api.example.test
ACCESS_TOKEN_AUDIENCE=boe-test
ACCESS_TOKEN_CURRENT_KID=test-kid
ACCESS_TOKEN_SIGNING_KEY=$escaped_private_key
ACCESS_TOKEN_VERIFICATION_KEYS=$verification_keys
REFRESH_HMAC_KEY=$base64_key
REFRESH_KEY_VERSION=rt1
CSRF_KEY_VERSION=cs1
CURSOR_HMAC_KEY=$base64_key
CRYPTO_TOKEN_HASH_KEY=$base64_key
CRYPTO_TOKEN_HASH_KEY_VERSION=tk1
CRYPTO_CONSENT_IP_HMAC_KEY=$base64_key
CRYPTO_CONSENT_IP_HMAC_KEY_VERSION=ck1
CRYPTO_RECIPIENT_HMAC_KEY=$base64_key
CRYPTO_RECIPIENT_HMAC_KEY_VERSION=rk1
CRYPTO_RECIPIENT_ENC_KEY=$base64_key
CRYPTO_RECIPIENT_ENC_KEY_VERSION=ek1
SIGNUP_PROXY_SECRET=test-only-signup-secret
PAYMENT_PROVIDER=manual
EMAIL_SMTP_HOST=
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
SEED_AUTH_ENABLED=true
SEED_AUTH_OVERWRITE=true
ADMIN_LOGIN_ID=admin@example.test
ADMIN_PASSWORD=test-only-password
ENV
P[environment]="development"

boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: deploy rejected a complete valid security configuration\n' >&2; exit 1; }

unsafe_database_env="$TEST_DIR/unsafe-database.env"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=bad@password/' "$env_file" > "$unsafe_database_env"
chmod 600 "$unsafe_database_env"
BOE_EFFECTIVE_ENV="$unsafe_database_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a database password unsafe for DATABASE_URL\n' >&2
    exit 1
fi

printf 'PASS: deployment validates complete application security configuration\n'
