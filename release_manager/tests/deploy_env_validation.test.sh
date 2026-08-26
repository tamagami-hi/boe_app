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
APP_FRONTEND_PORT=47421
ADMIN_FRONTEND_PORT=47422
PUBLIC_API_BASE_URL=https://api.example.test
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
NODE_ENV=development
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
NEWUSER_SHARED_SECRET=test-only-newuser-shared-secret-0123456789
PAYMENT_PROVIDER=phonepe
PHONEPE_CLIENT_ID=test-client
PHONEPE_CLIENT_SECRET=test-secret
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=sandbox
PHONEPE_CALLBACK_USERNAME=test-callback-user
PHONEPE_CALLBACK_PASSWORD=test-callback-password
PHONEPE_CALLBACK_URL=https://dev-app.beonedge.in/api/v1/provider-events/phonepe/payment
PHONEPE_SUBSCRIPTION_CALLBACK_URL=https://dev-app.beonedge.in/api/v1/provider-events/phonepe/subscription
PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST=checkout.setup.order.completed,checkout.setup.order.failed,checkout.order.completed,checkout.order.failed,subscription.notification.completed,subscription.notification.failed,subscription.redemption.order.completed,subscription.redemption.order.failed,subscription.redemption.transaction.completed,subscription.redemption.transaction.failed
PHONEPE_MERCHANT_ID=test-merchant
PHONEPE_MOBILE_SDK_ORDER_ENABLED=false
PHONEPE_AUTOPAY_ENABLED=false
PHONEPE_AUTOPAY_COLLECTION_ENABLED=false
KYC_EMAIL_FROM=support@beonedge.in
EMAIL_SMTP_HOST=smtppro.zoho.in
EMAIL_SMTP_PORT=465
EMAIL_SMTP_USER=support@beonedge.in
EMAIL_SMTP_PASSWORD=test-only-smtp-password
EMAIL_SMTP_SECURE=true
APK_DOWNLOAD_BASE_URL=https://dev-app.beonedge.in/downloads
KYC_CODE_MAX_ATTEMPTS=5
SEED_AUTH_ENABLED=true
SEED_AUTH_OVERWRITE=true
ADMIN_LOGIN_ID=admin@example.test
ADMIN_PASSWORD=test-only-password
ENV
P[environment]="development"

boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: deploy rejected a complete valid security configuration\n' >&2; exit 1; }

phonepe_env="$TEST_DIR/phonepe.env"
cp "$env_file" "$phonepe_env"
chmod 600 "$phonepe_env"
BOE_EFFECTIVE_ENV="$phonepe_env"
boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: deploy rejected canonical PhonePe wiring\n' >&2; exit 1; }

bad_autopay_flag="$TEST_DIR/bad-autopay-flag.env"
sed 's/^PHONEPE_AUTOPAY_ENABLED=.*/PHONEPE_AUTOPAY_ENABLED=yes/' "$phonepe_env" > "$bad_autopay_flag"
chmod 600 "$bad_autopay_flag"
BOE_EFFECTIVE_ENV="$bad_autopay_flag"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a non-boolean PhonePe AutoPay flag\n' >&2
    exit 1
fi

bad_subscription_callback="$TEST_DIR/bad-subscription-callback.env"
sed 's#^PHONEPE_SUBSCRIPTION_CALLBACK_URL=.*#PHONEPE_SUBSCRIPTION_CALLBACK_URL=https://untrusted.example/provider-events/phonepe/subscription#' "$phonepe_env" > "$bad_subscription_callback"
chmod 600 "$bad_subscription_callback"
BOE_EFFECTIVE_ENV="$bad_subscription_callback"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a PhonePe subscription callback on the wrong host\n' >&2
    exit 1
fi

mobile_sdk_missing_secrets="$TEST_DIR/mobile-sdk-missing-secrets.env"
sed 's/^PHONEPE_MOBILE_SDK_ORDER_ENABLED=.*/PHONEPE_MOBILE_SDK_ORDER_ENABLED=true/' "$phonepe_env" > "$mobile_sdk_missing_secrets"
chmod 600 "$mobile_sdk_missing_secrets"
BOE_EFFECTIVE_ENV="$mobile_sdk_missing_secrets"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted mobile SDK checkout without its merchant and encryption keys\n' >&2
    exit 1
fi

mobile_sdk_env="$TEST_DIR/mobile-sdk.env"
cp "$mobile_sdk_missing_secrets" "$mobile_sdk_env"
cat >> "$mobile_sdk_env" <<ENV
CRYPTO_PAYMENT_TOKEN_ENC_KEY=$base64_key
CRYPTO_PAYMENT_TOKEN_ENC_KEY_VERSION=ptk1
ENV
chmod 600 "$mobile_sdk_env"
BOE_EFFECTIVE_ENV="$mobile_sdk_env"
boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: deploy rejected complete mobile SDK checkout configuration\n' >&2; exit 1; }

development_with_production_phonepe="$TEST_DIR/development-with-production-phonepe.env"
sed 's/^PHONEPE_ENV=.*/PHONEPE_ENV=production/' "$phonepe_env" > "$development_with_production_phonepe"
chmod 600 "$development_with_production_phonepe"
BOE_EFFECTIVE_ENV="$development_with_production_phonepe"
boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: development deploy rejected PhonePe production credentials with development callbacks\n' >&2; exit 1; }

wrong_node_environment="$TEST_DIR/wrong-node-environment.env"
sed 's/^NODE_ENV=.*/NODE_ENV=production/' "$phonepe_env" > "$wrong_node_environment"
chmod 600 "$wrong_node_environment"
BOE_EFFECTIVE_ENV="$wrong_node_environment"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: development deploy accepted NODE_ENV=production\n' >&2
    exit 1
fi

unsupported_provider_env="$TEST_DIR/unsupported-provider.env"
sed 's/^PAYMENT_PROVIDER=.*/PAYMENT_PROVIDER=manual/' "$phonepe_env" > "$unsupported_provider_env"
chmod 600 "$unsupported_provider_env"
BOE_EFFECTIVE_ENV="$unsupported_provider_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted an unsupported payment provider\n' >&2
    exit 1
fi

production_phonepe_env="$TEST_DIR/production-phonepe.env"
sed \
    -e 's/^PHONEPE_ENV=.*/PHONEPE_ENV=production/' \
    -e 's#^PHONEPE_CALLBACK_URL=.*#PHONEPE_CALLBACK_URL=https://app.beonedge.in/api/v1/provider-events/phonepe/payment#' \
    -e 's#^PHONEPE_SUBSCRIPTION_CALLBACK_URL=.*#PHONEPE_SUBSCRIPTION_CALLBACK_URL=https://app.beonedge.in/api/v1/provider-events/phonepe/subscription#' \
    -e 's#^APK_DOWNLOAD_BASE_URL=.*#APK_DOWNLOAD_BASE_URL=https://app.beonedge.in/downloads#' \
    -e 's/^NODE_ENV=.*/NODE_ENV=production/' \
    -e 's/^SEED_AUTH_ENABLED=.*/SEED_AUTH_ENABLED=false/' \
    -e 's/^SEED_AUTH_OVERWRITE=.*/SEED_AUTH_OVERWRITE=false/' \
    "$phonepe_env" > "$production_phonepe_env"
chmod 600 "$production_phonepe_env"
P[environment]="production"
BOE_EFFECTIVE_ENV="$production_phonepe_env"
boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: deploy rejected canonical production PhonePe wiring\n' >&2; exit 1; }

production_with_sandbox_env="$TEST_DIR/production-with-sandbox.env"
sed 's/^PHONEPE_ENV=.*/PHONEPE_ENV=sandbox/' \
    "$production_phonepe_env" > "$production_with_sandbox_env"
chmod 600 "$production_with_sandbox_env"
BOE_EFFECTIVE_ENV="$production_with_sandbox_env"
boe_deploy_assert_env >/dev/null \
    || { printf 'FAIL: production deploy rejected PhonePe sandbox credentials with production callbacks\n' >&2; exit 1; }

P[environment]="development"

BOE_EFFECTIVE_ENV="$env_file"

insecure_smtp_env="$TEST_DIR/insecure-smtp.env"
sed 's/^EMAIL_SMTP_SECURE=.*/EMAIL_SMTP_SECURE=false/' "$env_file" > "$insecure_smtp_env"
chmod 600 "$insecure_smtp_env"
BOE_EFFECTIVE_ENV="$insecure_smtp_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted SMTP without implicit TLS\n' >&2
    exit 1
fi

untrusted_apk_env="$TEST_DIR/untrusted-apk.env"
sed 's#^APK_DOWNLOAD_BASE_URL=.*#APK_DOWNLOAD_BASE_URL=https://untrusted.example/downloads#' \
    "$env_file" > "$untrusted_apk_env"
chmod 600 "$untrusted_apk_env"
BOE_EFFECTIVE_ENV="$untrusted_apk_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted an untrusted APK download origin\n' >&2
    exit 1
fi

unsafe_database_env="$TEST_DIR/unsafe-database.env"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=bad@password/' "$env_file" > "$unsafe_database_env"
chmod 600 "$unsafe_database_env"
BOE_EFFECTIVE_ENV="$unsafe_database_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a database password unsafe for DATABASE_URL\n' >&2
    exit 1
fi

# POSTGRES_USER / POSTGRES_DB become SQL identifiers in the restore path
# (DROP/CREATE DATABASE), so anything outside [A-Za-z0-9_] must be rejected.
unsafe_user_env="$TEST_DIR/unsafe-user.env"
sed 's/^POSTGRES_USER=.*/POSTGRES_USER=bad;user/' "$env_file" > "$unsafe_user_env"
chmod 600 "$unsafe_user_env"
BOE_EFFECTIVE_ENV="$unsafe_user_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a POSTGRES_USER unsafe as a SQL identifier\n' >&2
    exit 1
fi

unsafe_db_env="$TEST_DIR/unsafe-db.env"
sed 's/^POSTGRES_DB=.*/POSTGRES_DB=bad"db/' "$env_file" > "$unsafe_db_env"
chmod 600 "$unsafe_db_env"
BOE_EFFECTIVE_ENV="$unsafe_db_env"
if (boe_deploy_assert_env >/dev/null 2>&1); then
    printf 'FAIL: deploy accepted a POSTGRES_DB unsafe as a SQL identifier\n' >&2
    exit 1
fi

printf 'PASS: deployment validates complete application security configuration\n'
