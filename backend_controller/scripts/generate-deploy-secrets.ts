/**
 * Operator helper: generate the key material the rearchitected backend requires
 * that the release_manager deploy env does not yet provide, and print a
 * ready-to-paste `.env` block. Run locally and paste the output into your
 * deployment env (e.g. release_manager/BOE_APP/.env). Secrets are generated
 * fresh on each run and are NEVER committed.
 *
 *   npx tsx scripts/generate-deploy-secrets.ts
 *
 * The ES256 signing key is emitted with `\n` escapes so it fits on one .env
 * line; the backend restores the newlines (runtime/environment.ts). Verification
 * keys are emitted as JSON (its `\n` escapes are decoded by JSON.parse).
 */
import { randomBytes } from "node:crypto"

import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"

const base64Key = (): string => randomBytes(32).toString("base64")
const escapePem = (pem: string): string => pem.replace(/\n/gu, "\\n").trim()

const main = async (): Promise<void> => {
  const kid = `k${String(Date.now())}`
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true })
  const signingKey = escapePem(await exportPKCS8(privateKey))
  const verificationKeys = JSON.stringify({ [kid]: (await exportSPKI(publicKey)).trim() })

  const lines = [
    "# --- Generated backend key material (paste into your deploy .env) ---",
    "# Access token (ES256). Set issuer/audience to your real values.",
    "ACCESS_TOKEN_ISSUER=https://api.your-domain.example",
    "ACCESS_TOKEN_AUDIENCE=boe",
    `ACCESS_TOKEN_CURRENT_KID=${kid}`,
    `ACCESS_TOKEN_SIGNING_KEY=${signingKey}`,
    `ACCESS_TOKEN_VERIFICATION_KEYS=${verificationKeys}`,
    "",
    "# Session/cursor keys (base64, 32 bytes each).",
    `REFRESH_HMAC_KEY=${base64Key()}`,
    "REFRESH_KEY_VERSION=rt1",
    "CSRF_KEY_VERSION=cs1",
    `CURSOR_HMAC_KEY=${base64Key()}`,
    "",
    "# Onboarding crypto keys (base64; ENC key must be exactly 32 bytes).",
    `CRYPTO_TOKEN_HASH_KEY=${base64Key()}`,
    "CRYPTO_TOKEN_HASH_KEY_VERSION=th1",
    `CRYPTO_CONSENT_IP_HMAC_KEY=${base64Key()}`,
    "CRYPTO_CONSENT_IP_HMAC_KEY_VERSION=ip1",
    `CRYPTO_RECIPIENT_HMAC_KEY=${base64Key()}`,
    "CRYPTO_RECIPIENT_HMAC_KEY_VERSION=rh1",
    `CRYPTO_RECIPIENT_ENC_KEY=${base64Key()}`,
    "CRYPTO_RECIPIENT_ENC_KEY_VERSION=re1",
    "",
    "# Optional email (Amazon SES/SNS). Leave unset to boot with email disabled.",
    "# AWS_REGION=ap-south-1",
    "# SNS_TOPIC_ARN=arn:aws:sns:ap-south-1:000000000000:boe-email-events",
    "# SES_CONFIGURATION_SET=boe-default",
    "# --- end generated block ---",
    "",
  ]
  process.stdout.write(`${lines.join("\n")}\n`)
}

await main()
