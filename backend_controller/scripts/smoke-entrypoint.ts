import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
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

const createEntrypointProcess = (mode: SmokeMode, port: number): ChildProcess => {
  const argumentsByMode = {
    dist: ["dist/server.js"],
    source: ["--import=tsx", "src/server.ts"],
  } as const

  return spawn(process.execPath, argumentsByMode[mode], {
    env: { ...process.env, HOST, LOG_LEVEL: "silent", NODE_ENV: "test", PORT: String(port) },
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
