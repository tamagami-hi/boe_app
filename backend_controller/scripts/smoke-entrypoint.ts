import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"

const HOST = "127.0.0.1"
const START_TIMEOUT_MS = 5_000
const STOP_TIMEOUT_MS = 2_000

type SmokeMode = "dist" | "source"

const reservePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const reservation = createServer()
  reservation.once("error", reject)
  reservation.listen(0, HOST, () => {
    const address = reservation.address()
    if (address === null || typeof address === "string") {
      reservation.close()
      reject(new Error("Expected TCP address"))
      return
    }

    reservation.close((error) => error === undefined ? resolve(address.port) : reject(error))
  })
})

// A complete ephemeral environment so the smoke boots the *full* composed server
// (all canonical routes wired), not just the health endpoint. Keys are generated
// per run; the database URL never connects because the smoke only probes
// /health/live, and breach checking is bypassed in test mode.
const buildSmokeEnvironment = (port: number): NodeJS.ProcessEnv => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const signingKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string
  const verificationKey = publicKey.export({ type: "spki", format: "pem" }) as string
  const kid = "smoke-k1"
  const base64Key = (): string => randomBytes(32).toString("base64")

  return {
    ...process.env,
    HOST,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:5432/smoke",
    CRYPTO_TOKEN_HASH_KEY: base64Key(),
    CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
    CRYPTO_CONSENT_IP_HMAC_KEY: base64Key(),
    CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
    CRYPTO_RECIPIENT_HMAC_KEY: base64Key(),
    CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
    CRYPTO_RECIPIENT_ENC_KEY: base64Key(),
    CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    ACCESS_TOKEN_ISSUER: "https://smoke.example",
    ACCESS_TOKEN_AUDIENCE: "boe-smoke",
    ACCESS_TOKEN_CURRENT_KID: kid,
    ACCESS_TOKEN_SIGNING_KEY: signingKey,
    ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({ [kid]: verificationKey }),
    REFRESH_HMAC_KEY: base64Key(),
    REFRESH_KEY_VERSION: "rt1",
    CSRF_KEY_VERSION: "cs1",
    CURSOR_HMAC_KEY: base64Key(),
    WEB_COOKIE_SECURE: "false",
    WEB_ORIGIN_ALLOWLIST: "http://127.0.0.1",
    AWS_REGION: "us-east-1",
    SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:000000000000:smoke",
    SES_CONFIGURATION_SET: "smoke-set",
    PASSWORD_BREACH_CHECK_MODE: "bypass",
  }
}

const createEntrypointProcess = (mode: SmokeMode, port: number): ChildProcess => {
  const argumentsByMode = {
    dist: ["dist/server.js"],
    source: ["--import=tsx", "src/server.ts"],
  } as const

  return spawn(process.execPath, argumentsByMode[mode], {
    env: buildSmokeEnvironment(port),
    stdio: "ignore",
  })
}

const waitForLiveness = async (child: ChildProcess, port: number): Promise<void> => {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Entrypoint exited before liveness")

    try {
      const response = await fetch(`http://${HOST}:${port}/health/live`, {
        signal: AbortSignal.timeout(500),
      })
      const body: unknown = await response.json()
      if (response.ok && JSON.stringify(body) === '{"status":"ok"}') return
    } catch {
      // The process may still be starting; the hard deadline bounds retries.
    }

    await delay(50)
  }

  throw new Error("Entrypoint did not become live before timeout")
}

type ExitResult = Readonly<{
  code: number | null
  signal: NodeJS.Signals | null
  killedByTimeout: boolean
}>

const stopProcessGracefully = async (child: ChildProcess): Promise<ExitResult> => {
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal })
      })
    },
  )

  child.kill("SIGTERM")

  const controller = new AbortController()
  let killedByTimeout = false
  const timeout = delay(STOP_TIMEOUT_MS, undefined, { signal: controller.signal }).then(
    () => {
      killedByTimeout = true
      child.kill("SIGKILL")
    },
    () => undefined,
  )

  const result = await exited
  controller.abort()
  await timeout
  return { code: result.code, signal: result.signal, killedByTimeout }
}

const runSmoke = async (mode: SmokeMode): Promise<void> => {
  const port = await reservePort()
  const child = createEntrypointProcess(mode, port)
  try {
    await waitForLiveness(child, port)

    const result = await stopProcessGracefully(child)
    if (result.killedByTimeout) {
      throw new Error(`Entrypoint did not exit within ${STOP_TIMEOUT_MS}ms of SIGTERM`)
    }
    if (result.signal !== null) {
      throw new Error(`Entrypoint was terminated by ${result.signal} instead of draining`)
    }
    if (result.code !== 0) {
      throw new Error(`Entrypoint exited with code ${String(result.code)} instead of 0`)
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
}

const mode = process.argv[2]
if (mode !== "source" && mode !== "dist") throw new Error("Expected source or dist smoke mode")

void runSmoke(mode).catch(() => {
  process.stderr.write("Backend entrypoint smoke failed\n")
  process.exitCode = 1
})
