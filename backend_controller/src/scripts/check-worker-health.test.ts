import { describe, expect, test, vi } from "vitest"

import { checkWorkerHealth, runCli } from "./check-worker-health.js"
import { createWorkerHeartbeatRepository } from "../repositories/workerHeartbeatRepository.js"
import type { WorkerHeartbeatRepository } from "../repositories/workerHeartbeatRepository.js"

vi.mock("../db/pool.js", () => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
}))

vi.mock("../db/database.js", () => ({
  createDatabase: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock("../db/config.js", () => ({
  parseDatabaseConfig: vi.fn(() => ({ connectionString: "mock" })),
}))

vi.mock("../repositories/workerHeartbeatRepository.js", () => ({
  createWorkerHeartbeatRepository: vi.fn(),
}))

const createMockRepository = (heartbeat: Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>): WorkerHeartbeatRepository =>
  ({
    findLatestByWorker: async () => heartbeat,
    recordHeartbeat: async () => {
      throw new Error("unexpected")
    },
    findLatestAllWorkers: async () => {
      throw new Error("unexpected")
    },
  })

const fakeDatabase = { destroy: async () => undefined }

describe("checkWorkerHealth", () => {
  test("returns success for a recent successful heartbeat", async () => {
    const now = Date.now()
    const result = await checkWorkerHealth({
      workerName: "payment_reconciliation",
      maxAgeSeconds: 120,
      nowMs: now,
      repository: createMockRepository({
        worker_name: "payment_reconciliation",
        pass_started_at: new Date(now - 30_000),
        pass_completed_at: new Date(now - 10_000),
        success: true,
        summary: {},
        error_code: null,
        id: "hb-1",
      } as unknown as Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>),
      database: fakeDatabase,
    })
    expect(result.exitCode).toBe(0)
    expect(result.message).toContain("healthy")
  })

  test("returns failure when no heartbeat exists", async () => {
    const result = await checkWorkerHealth({
      workerName: "missing_worker",
      maxAgeSeconds: 120,
      nowMs: Date.now(),
      repository: createMockRepository(null),
      database: fakeDatabase,
    })
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain("No heartbeat found")
  })

  test("returns failure when heartbeat is stale", async () => {
    const now = Date.now()
    const result = await checkWorkerHealth({
      workerName: "stale_worker",
      maxAgeSeconds: 120,
      nowMs: now,
      repository: createMockRepository({
        worker_name: "stale_worker",
        pass_started_at: new Date(now - 300_000),
        pass_completed_at: new Date(now - 200_000),
        success: true,
        summary: {},
        error_code: null,
        id: "hb-2",
      } as unknown as Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>),
      database: fakeDatabase,
    })
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain("old")
  })

  test("returns failure when last pass failed", async () => {
    const now = Date.now()
    const result = await checkWorkerHealth({
      workerName: "failed_worker",
      maxAgeSeconds: 120,
      nowMs: now,
      repository: createMockRepository({
        worker_name: "failed_worker",
        pass_started_at: new Date(now - 30_000),
        pass_completed_at: new Date(now - 10_000),
        success: false,
        summary: {},
        error_code: "TIMEOUT",
        id: "hb-3",
      } as unknown as Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>),
      database: fakeDatabase,
    })
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain("last pass failed")
  })
})

describe("runCli", () => {
  test("returns 2 when worker name is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const result = await runCli(["node", "script"], {}, Date.now())
    expect(result).toBe(2)
    errorSpy.mockRestore()
  })

  test("returns 2 when max age is not a positive number", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const result = await runCli(["node", "script", "worker", "not-a-number"], {}, Date.now())
    expect(result).toBe(2)
    errorSpy.mockRestore()
  })

  test("returns 0 and logs success for a recent healthy heartbeat", async () => {
    const now = Date.now()
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    vi.mocked(createWorkerHeartbeatRepository).mockReturnValue(
      createMockRepository({
        worker_name: "payment_reconciliation",
        pass_started_at: new Date(now - 30_000),
        pass_completed_at: new Date(now - 10_000),
        success: true,
        summary: {},
        error_code: null,
        id: "hb-cli-1",
      } as unknown as Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>),
    )

    const result = await runCli(["node", "script", "payment_reconciliation", "120"], {}, now)

    expect(result).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("healthy"))
    logSpy.mockRestore()
  })

  test("returns 1 and logs error for a stale heartbeat", async () => {
    const now = Date.now()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(createWorkerHeartbeatRepository).mockReturnValue(
      createMockRepository({
        worker_name: "mandate_collection",
        pass_started_at: new Date(now - 300_000),
        pass_completed_at: new Date(now - 200_000),
        success: true,
        summary: {},
        error_code: null,
        id: "hb-cli-2",
      } as unknown as Awaited<ReturnType<WorkerHeartbeatRepository["findLatestByWorker"]>>),
    )

    const result = await runCli(["node", "script", "mandate_collection", "120"], {}, now)

    expect(result).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("old"))
    errorSpy.mockRestore()
  })
})
