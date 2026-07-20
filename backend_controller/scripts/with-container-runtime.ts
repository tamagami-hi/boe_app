import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

/**
 * Run a command with a container runtime available for Testcontainers.
 *
 * Real CI/dev provides a Docker (or Docker-compatible) API socket via
 * `DOCKER_HOST` or the default socket, and this wrapper runs the command
 * unchanged. In a rootless sandbox that only ships the `podman` CLI (no API
 * socket), it starts a temporary `podman system service`, points `DOCKER_HOST`
 * at it, and disables the ryuk reaper (unsupported rootless), then tears the
 * service down afterwards. This keeps `test:integration` reproducible without
 * assuming a specific host runtime.
 */
const PODMAN_BINARY = "/usr/local/bin/podman"
const PODMAN_SOCKET = "/tmp/boe-podman.sock"
const SERVICE_START_DELAY_MS = 6_000

const [command, ...commandArgs] = process.argv.slice(2)
if (command === undefined) {
  process.stderr.write("usage: with-container-runtime <command> [args...]\n")
  process.exit(2)
}

let service: ChildProcess | undefined
if (process.env.DOCKER_HOST === undefined && existsSync(PODMAN_BINARY)) {
  service = spawn(
    PODMAN_BINARY,
    ["system", "service", "--time=0", `unix://${PODMAN_SOCKET}`],
    { stdio: "ignore" },
  )
  process.env.DOCKER_HOST = `unix://${PODMAN_SOCKET}`
  process.env.TESTCONTAINERS_RYUK_DISABLED = "true"
  await delay(SERVICE_START_DELAY_MS)
}

const child = spawn(command, commandArgs, { stdio: "inherit", env: process.env })
const exitCode = await new Promise<number>((resolve) => {
  child.on("exit", (code) => {
    resolve(code ?? 1)
  })
})

if (service !== undefined) service.kill()
process.exit(exitCode)
