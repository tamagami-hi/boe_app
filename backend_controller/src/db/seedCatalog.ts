/**
 * Canonical bootstrap catalog (spec 02 §3.5, 03 §3.3, 04 role/permission table).
 *
 * This is the always-run, user-independent portion of the bootstrap seed: the
 * role catalog, the permission catalog, the reference role->permission mapping,
 * and the current consent documents. It carries no user foreign keys.
 *
 * The `role_permissions`/`user_roles` grants and the optional admin user +
 * Argon2id credential + redacted audit event are the security bootstrap
 * transaction (they require a granting user because
 * `role_permissions.granted_by_user_id` is NOT NULL) and land with the security
 * batch (BE-009/BE-016). `SEED_ROLE_PERMISSIONS` is published here so those
 * grants derive from a single authoritative mapping.
 */
import { createHash } from "node:crypto"

export interface SeedRole {
  readonly code: string
  readonly name: string
}

export interface SeedPermission {
  readonly code: string
  readonly description: string
}

export interface SeedConsentDocument {
  readonly kind: "terms" | "privacy"
  readonly version: string
  readonly publicPath: string
  readonly contentMarkdown: string
}

export interface SeedStatement {
  readonly text: string
  readonly values: readonly unknown[]
}

export const SEED_ROLES: readonly SeedRole[] = [
  { code: "superadmin", name: "Super Administrator" },
  { code: "onboarding", name: "Onboarding" },
  { code: "finance", name: "Finance" },
  { code: "content", name: "Content" },
  { code: "support", name: "Support" },
]

/**
 * Permission catalog. Every code is a single-dot `domain.action` label to
 * satisfy the `permissions_code_check` constraint.
 */
export const SEED_PERMISSIONS: readonly SeedPermission[] = [
  { code: "applications.read", description: "Read applications and the review queue" },
  { code: "applications.review", description: "Record an application review note" },
  { code: "applications.decide", description: "Approve or reject an application" },
  { code: "invitations.manage", description: "Resend or manage activation invitations" },
  { code: "email_deliveries.read", description: "Read the full email delivery projection" },
  { code: "email_deliveries.read_masked", description: "Read the masked email delivery projection" },
  { code: "users.read", description: "Read user records" },
  { code: "users.read_limited", description: "Read the limited support user projection" },
  { code: "users.suspend", description: "Suspend a user account" },
  { code: "users.close", description: "Close a user account" },
  { code: "roles.assign", description: "Assign and revoke user role grants" },
  { code: "permissions.change", description: "Change role-permission mappings via approved control" },
  { code: "funds.read", description: "Read funds and the catalog" },
  { code: "finance.read", description: "Read finance projections" },
  { code: "finance.operate", description: "Operate finance workflows" },
  { code: "approvals.request", description: "Request a maker-checker approval" },
  { code: "approvals.check", description: "Check (approve or reject) a maker-checker request" },
  { code: "content.read", description: "Read site content" },
  { code: "content.publish", description: "Publish site content and disclosures" },
  { code: "support.read", description: "Read support tickets" },
  { code: "support.write", description: "Respond to support tickets" },
]

const ALL_PERMISSION_CODES: readonly string[] = SEED_PERMISSIONS.map((permission) => permission.code)

/**
 * Reference role->permission mapping. `superadmin` holds every permission; the
 * other roles are least-privilege per spec 04.
 */
export const SEED_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  superadmin: ALL_PERMISSION_CODES,
  onboarding: [
    "applications.read",
    "applications.review",
    "applications.decide",
    "invitations.manage",
    "email_deliveries.read",
    "users.read",
  ],
  finance: ["funds.read", "finance.read", "finance.operate", "approvals.request", "approvals.check"],
  content: ["content.read", "content.publish", "funds.read"],
  support: ["users.read_limited", "email_deliveries.read_masked", "support.read", "support.write"],
}

export const SEED_CONSENT_DOCUMENTS: readonly SeedConsentDocument[] = [
  {
    kind: "terms",
    version: "v1",
    publicPath: "/legal/terms",
    contentMarkdown:
      "# Terms of Service\n\nPlaceholder terms of service pending legal review. " +
      "Replace through the content administration workflow before production use.\n",
  },
  {
    kind: "privacy",
    version: "v1",
    publicPath: "/legal/privacy",
    contentMarkdown:
      "# Privacy Policy\n\nPlaceholder privacy policy pending legal review. " +
      "Replace through the content administration workflow before production use.\n",
  },
]

/** SHA-256 of the Markdown bytes; matches the pgcrypto `digest(..., 'sha256')` CHECK. */
export const consentDigest = (contentMarkdown: string): Buffer =>
  createHash("sha256").update(contentMarkdown, "utf8").digest()

/**
 * Build the idempotent seed statements in dependency-safe order. Every statement
 * is `ON CONFLICT DO NOTHING`, so a repeated run is a no-op.
 */
export const buildSeedStatements = (): readonly SeedStatement[] => {
  const statements: SeedStatement[] = []

  for (const role of SEED_ROLES) {
    statements.push({
      text: "INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING",
      values: [role.code, role.name],
    })
  }

  for (const permission of SEED_PERMISSIONS) {
    statements.push({
      text: "INSERT INTO permissions (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING",
      values: [permission.code, permission.description],
    })
  }

  for (const document of SEED_CONSENT_DOCUMENTS) {
    statements.push({
      text:
        "INSERT INTO consent_documents (kind, version, public_path, content_markdown, content_sha256, published_at) " +
        "VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (kind, version) DO NOTHING",
      values: [
        document.kind,
        document.version,
        document.publicPath,
        document.contentMarkdown,
        consentDigest(document.contentMarkdown),
      ],
    })
  }

  return statements
}
