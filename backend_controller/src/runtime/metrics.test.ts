import { describe, expect, test } from "vitest"

import { isPrivateRequest, renderMetrics, type MetricsDeps, type MetricsRepository } from "./metrics.js"

const createMockRepository = (overrides?: Partial<MetricsRepository>): MetricsRepository => ({
  findLatestWorkerHeartbeats: async () => [],
  countPaymentReconciliationBacklog: async () => 0,
  countMandateReconciliationBacklog: async () => 0,
  countSetupDispatchBacklog: async () => 0,
  countCollectionNotifyBacklog: async () => 0,
  countCollectionReconcileBacklog: async () => 0,
  countCancelEscalations: async () => 0,
  countStaleSetups: async () => 0,
  countStaleCollections: async () => 0,
  ...overrides,
})

const buildDeps = (overrides?: Partial<MetricsDeps>): MetricsDeps => ({
  repository: createMockRepository(),
  clock: () => new Date("2026-08-24T10:00:00.000Z"),
  ...overrides,
})

describe("isPrivateRequest", () => {
  test("allows loopback addresses", () => {
    expect(isPrivateRequest("127.0.0.1")).toBe(true)
    expect(isPrivateRequest("::1")).toBe(true)
    expect(isPrivateRequest("localhost")).toBe(true)
  })

  test("allows docker bridge gateway and private ranges", () => {
    expect(isPrivateRequest("172.17.0.1")).toBe(true)
    expect(isPrivateRequest("172.17.42.9")).toBe(true)
    expect(isPrivateRequest("172.18.0.5")).toBe(true)
    expect(isPrivateRequest("172.19.255.254")).toBe(true)
    expect(isPrivateRequest("10.0.0.1")).toBe(true)
    expect(isPrivateRequest("192.168.1.1")).toBe(true)
    expect(isPrivateRequest("172.20.0.1")).toBe(false)
  })

  test("allows IPv4-mapped loopback", () => {
    expect(isPrivateRequest("::ffff:127.0.0.1")).toBe(true)
  })

  test("rejects public addresses", () => {
    expect(isPrivateRequest("203.0.113.1")).toBe(false)
    expect(isPrivateRequest("8.8.8.8")).toBe(false)
    expect(isPrivateRequest("1.1.1.1")).toBe(false)
  })

  test("rejects undefined addresses", () => {
    expect(isPrivateRequest(undefined)).toBe(false)
  })
})

describe("renderMetrics", () => {
  test("refuses non-internal addresses", async () => {
    const result = await renderMetrics(buildDeps(), "203.0.113.1")
    expect(result.status).toBe(403)
    expect(result.body).toContain("internal addresses")
  })

  test("accepts loopback addresses and renders exposition headers", async () => {
    const result = await renderMetrics(buildDeps(), "127.0.0.1")
    expect(result.status).toBe(200)
    expect(result.body).toContain("# TYPE boe_worker_last_success_timestamp_seconds gauge")
    expect(result.body).toContain("# TYPE boe_worker_backlog_count gauge")
    expect(result.body).toContain("# TYPE boe_mandate_setup_stale_count gauge")
  })

  test("renders worker heartbeat metrics", async () => {
    const completedAt = new Date("2026-08-24T09:59:30.000Z")
    const startedAt = new Date("2026-08-24T09:59:00.000Z")
    const result = await renderMetrics(
      buildDeps({
        repository: createMockRepository({
          findLatestWorkerHeartbeats: async () => [
            { workerName: "payment_reconciliation", passStartedAt: startedAt, passCompletedAt: completedAt, success: true },
          ],
        }),
      }),
      "127.0.0.1",
    )
    expect(result.status).toBe(200)
    expect(result.body).toContain('boe_worker_last_success{worker="payment_reconciliation"} 1')
    expect(result.body).toContain('boe_worker_last_duration_seconds{worker="payment_reconciliation"}')
  })

  test("renders failed and clock-skewed heartbeats safely", async () => {
    const result = await renderMetrics(
      buildDeps({
        repository: createMockRepository({
          findLatestWorkerHeartbeats: async () => [
            {
              workerName: "mandate_collection",
              passStartedAt: new Date("2026-08-24T10:00:30.000Z"),
              passCompletedAt: new Date("2026-08-24T10:00:00.000Z"),
              success: false,
            },
          ],
          countPaymentReconciliationBacklog: async () => Number.NaN,
        }),
      }),
      "127.0.0.1",
    )
    expect(result.body).toContain('boe_worker_last_success{worker="mandate_collection"} 0')
    expect(result.body).toContain('boe_worker_last_duration_seconds{worker="mandate_collection"} 0')
    expect(result.body).toContain('boe_worker_backlog_count{queue="payment_reconciliation"} 0')
  })

  test("renders backlog and stale counts", async () => {
    const result = await renderMetrics(
      buildDeps({
        repository: createMockRepository({
          countPaymentReconciliationBacklog: async () => 3,
          countMandateReconciliationBacklog: async () => 2,
          countSetupDispatchBacklog: async () => 5,
          countCollectionNotifyBacklog: async () => 1,
          countCollectionReconcileBacklog: async () => 4,
          countCancelEscalations: async () => 7,
          countStaleSetups: async () => 6,
          countStaleCollections: async () => 8,
        }),
      }),
      "127.0.0.1",
    )
    expect(result.status).toBe(200)
    expect(result.body).toContain('boe_worker_backlog_count{queue="payment_reconciliation"} 3')
    expect(result.body).toContain('boe_worker_backlog_count{queue="mandate_reconciliation"} 2')
    expect(result.body).toContain('boe_worker_backlog_count{queue="setup_dispatch"} 5')
    expect(result.body).toContain('boe_worker_backlog_count{queue="collection_notify"} 1')
    expect(result.body).toContain('boe_worker_backlog_count{queue="collection_reconcile"} 4')
    expect(result.body).toContain("boe_mandate_cancel_reconciliation_required_count 7")
    expect(result.body).toContain("boe_mandate_setup_stale_count 6")
    expect(result.body).toContain("boe_mandate_collection_stale_count 8")
  })

  test("escapes special characters in label values", async () => {
    const result = await renderMetrics(
      buildDeps({
        repository: createMockRepository({
          findLatestWorkerHeartbeats: async () => [
            {
              workerName: 'worker"with\\special\nchars',
              passStartedAt: new Date(),
              passCompletedAt: new Date(),
              success: true,
            },
          ],
        }),
      }),
      "127.0.0.1",
    )
    expect(result.status).toBe(200)
    expect(result.body).toContain('worker\\"with\\\\special\\nchars')
  })
})
