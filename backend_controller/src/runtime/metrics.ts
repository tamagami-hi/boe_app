export interface MetricsRepository {
  readonly findLatestWorkerHeartbeats: () => Promise<
    readonly {
      readonly workerName: string
      readonly passStartedAt: Date
      readonly passCompletedAt: Date
      readonly success: boolean
    }[]
  >
  readonly countPaymentReconciliationBacklog: () => Promise<number>
  readonly countMandateReconciliationBacklog: () => Promise<number>
  readonly countSetupDispatchBacklog: () => Promise<number>
  readonly countCollectionNotifyBacklog: () => Promise<number>
  readonly countCollectionReconcileBacklog: () => Promise<number>
  readonly countCancelEscalations: () => Promise<number>
  readonly countStaleSetups: (threshold: Date) => Promise<number>
  readonly countStaleCollections: (threshold: Date) => Promise<number>
}

export interface MetricsDeps {
  readonly repository: MetricsRepository
  readonly clock: () => Date
}

interface MetricLine {
  readonly name: string
  readonly labels?: Record<string, string>
  readonly value: number
}

const sanitizeLabelValue = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n")

const formatLabels = (labels: Record<string, string> | undefined): string => {
  if (labels === undefined) return ""
  const entries = Object.entries(labels)
  if (entries.length === 0) return ""
  const parts = entries.map(([key, value]) => `${key}="${sanitizeLabelValue(value)}"`)
  return `{${parts.join(",")}}`
}

const renderLines = (lines: readonly MetricLine[]): string =>
  lines
    .map((line) => {
      const labels = formatLabels(line.labels)
      return `${line.name}${labels} ${Number.isFinite(line.value) ? line.value : 0}`
    })
    .join("\n")

export const isPrivateRequest = (remoteAddress: string | undefined): boolean => {
  if (remoteAddress === undefined) return false
  const address = remoteAddress.startsWith("::ffff:") ? remoteAddress.slice(7) : remoteAddress
  if (address === "127.0.0.1" || address === "::1" || address === "localhost") return true
  // Docker default bridge gateway and link-local private ranges used by the monitoring stack.
  if (address === "172.17.0.1") return true
  if (address.startsWith("172.17.") || address.startsWith("172.18.") || address.startsWith("172.19.")) return true
  if (address.startsWith("10.") || address.startsWith("192.168.")) return true
  return false
}

const workerHeartbeatMetrics = async (
  repository: MetricsRepository,
): Promise<readonly MetricLine[]> => {
  const rows = await repository.findLatestWorkerHeartbeats()

  return rows.flatMap((row) => {
    const worker = row.workerName
    const completedAtSeconds = row.passCompletedAt.getTime() / 1000
    const startedAtSeconds = row.passStartedAt.getTime() / 1000
    const durationSeconds = Math.max(0, completedAtSeconds - startedAtSeconds)
    return [
      { name: "boe_worker_last_success_timestamp_seconds", labels: { worker }, value: completedAtSeconds },
      { name: "boe_worker_last_duration_seconds", labels: { worker }, value: durationSeconds },
      { name: "boe_worker_last_success", labels: { worker }, value: row.success ? 1 : 0 },
    ]
  })
}

const backlogMetrics = async (repository: MetricsRepository): Promise<readonly MetricLine[]> => {
  const [
    paymentBacklog,
    mandateBacklog,
    setupBacklog,
    collectionNotifyBacklog,
    collectionReconcileBacklog,
    cancelEscalationCount,
  ] = await Promise.all([
    repository.countPaymentReconciliationBacklog(),
    repository.countMandateReconciliationBacklog(),
    repository.countSetupDispatchBacklog(),
    repository.countCollectionNotifyBacklog(),
    repository.countCollectionReconcileBacklog(),
    repository.countCancelEscalations(),
  ])

  return [
    { name: "boe_worker_backlog_count", labels: { queue: "payment_reconciliation" }, value: paymentBacklog },
    { name: "boe_worker_backlog_count", labels: { queue: "mandate_reconciliation" }, value: mandateBacklog },
    { name: "boe_worker_backlog_count", labels: { queue: "setup_dispatch" }, value: setupBacklog },
    { name: "boe_worker_backlog_count", labels: { queue: "collection_notify" }, value: collectionNotifyBacklog },
    { name: "boe_worker_backlog_count", labels: { queue: "collection_reconcile" }, value: collectionReconcileBacklog },
    { name: "boe_mandate_cancel_reconciliation_required_count", value: cancelEscalationCount },
  ]
}

const staleMetrics = async (repository: MetricsRepository, now: Date): Promise<readonly MetricLine[]> => {
  const staleSetupThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const staleCollectionThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [staleSetups, staleCollections] = await Promise.all([
    repository.countStaleSetups(staleSetupThreshold),
    repository.countStaleCollections(staleCollectionThreshold),
  ])

  return [
    { name: "boe_mandate_setup_stale_count", value: staleSetups },
    { name: "boe_mandate_collection_stale_count", value: staleCollections },
  ]
}

export const renderMetrics = async (deps: MetricsDeps, remoteAddress: string | undefined): Promise<{ readonly body: string; readonly status: number }> => {
  if (!isPrivateRequest(remoteAddress)) {
    return { body: "# metrics endpoint is only available from internal addresses\n", status: 403 }
  }

  const now = deps.clock()
  const lines: MetricLine[] = [
    ...(await workerHeartbeatMetrics(deps.repository)),
    ...(await backlogMetrics(deps.repository)),
    ...(await staleMetrics(deps.repository, now)),
  ]

  const header = "# HELP boe_worker_last_success_timestamp_seconds Unix timestamp of the last completed worker pass.\n# TYPE boe_worker_last_success_timestamp_seconds gauge\n# HELP boe_worker_last_duration_seconds Duration in seconds of the last completed worker pass.\n# TYPE boe_worker_last_duration_seconds gauge\n# HELP boe_worker_last_success Whether the last completed worker pass succeeded (1) or failed (0).\n# TYPE boe_worker_last_success gauge\n# HELP boe_worker_backlog_count Number of items awaiting worker processing.\n# TYPE boe_worker_backlog_count gauge\n# HELP boe_mandate_cancel_reconciliation_required_count Cancel commands stuck in reconciliation_required.\n# TYPE boe_mandate_cancel_reconciliation_required_count gauge\n# HELP boe_mandate_setup_stale_count Setup attempts not checked recently.\n# TYPE boe_mandate_setup_stale_count gauge\n# HELP boe_mandate_collection_stale_count Collection attempts not checked recently.\n# TYPE boe_mandate_collection_stale_count gauge\n"

  const body = lines.length === 0 ? header : `${header}${renderLines(lines)}\n`
  return { body, status: 200 }
}
