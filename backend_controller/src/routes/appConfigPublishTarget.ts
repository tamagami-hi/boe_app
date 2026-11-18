import { z } from "zod"

import { hashRequest } from "./adminRouteKit.js"

export const longText = z.string().trim().max(8000)

const semverish = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9]+(?:\.[0-9]+){0,3}$/u, "must be a dotted numeric version")

export const appConfigPayloadSchema = z
  .object({
    featureFlags: z.record(z.string().max(80), z.boolean()).default({}),
    minimumSupportedVersion: z
      .object({
        android: semverish.optional(),
        ios: semverish.optional(),
        web: semverish.optional(),
        message: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .default({}),
    downloads: z
      .object({
        androidUrl: z.string().url().max(2048).optional(),
        iosUrl: z.string().url().max(2048).optional(),
      })
      .strict()
      .default({}),
    maintenance: z
      .object({
        enabled: z.boolean().default(false),
        message: longText.optional(),
        scheduledFor: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .default({ enabled: false }),
    presentation: z
      .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean()]))
      .default({}),
  })
  .strict()

export const expectedVersionSchema = z.number().int().positive().nullable().optional()

export const appConfigPublishTargetSchema = z
  .object({ config: appConfigPayloadSchema, expectedVersion: expectedVersionSchema })
  .strict()

export type AppConfigPublishTarget = Pick<z.infer<typeof appConfigPublishTargetSchema>, "config" | "expectedVersion">

export const appConfigPublishCanonical = (target: AppConfigPublishTarget): Readonly<Record<string, unknown>> => ({
  config: target.config,
  ...(target.expectedVersion === undefined ? {} : { expectedVersion: target.expectedVersion }),
})

export const appConfigPublishHash = (target: AppConfigPublishTarget): Buffer =>
  hashRequest(appConfigPublishCanonical(target))
