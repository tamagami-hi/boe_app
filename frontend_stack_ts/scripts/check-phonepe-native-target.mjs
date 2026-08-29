import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const PHONEPE_MARKERS = [
  "phonepe",
  "PhonePe",
  "PHONEPE",
  "com.phonepe",
  "intentsdk",
  "IntentSDK",
]

const FILES = [
  "capacitor.config.ts",
  "android/app/build.gradle",
  "android/build.gradle",
  "android/variables.gradle",
  "android/app/capacitor.build.gradle",
]

const failures = []

const readIfPresent = async (relative) => {
  try {
    return await readFile(join(projectRoot, relative), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

for (const relative of FILES) {
  const source = await readIfPresent(relative)
  if (source === null) continue
  for (const marker of PHONEPE_MARKERS) {
    if (source.includes(marker)) {
      failures.push(`${relative} references ${marker}`)
    }
  }
}

const config = await readIfPresent("capacitor.config.ts")
if (config === null) {
  failures.push("capacitor.config.ts is missing, so the plugin allowlist cannot be checked")
} else {
  for (const variant of ["CLIENT_ANDROID_PLUGINS", "ADMIN_ANDROID_PLUGINS"]) {
    if (!config.includes(variant)) {
      failures.push(`capacitor.config.ts does not declare ${variant}`)
    }
  }
  if (!config.includes("includePlugins")) {
    failures.push(
      "capacitor.config.ts does not pin includePlugins, so every installed plugin would ship in both variants",
    )
  }
}

if (failures.length > 0) {
  console.error("check-phonepe-native-target failed:")
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error(
    "Payments run through the hosted redirect. A native PhonePe SDK must not be linked into either Android variant.",
  )
  process.exit(1)
}

console.log(
  "check-phonepe-native-target passed: no native PhonePe SDK in either variant, and both plugin allowlists are pinned.",
)
