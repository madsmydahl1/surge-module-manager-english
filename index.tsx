import { Intent, Navigation, Script } from "scripting"
import { getSharedSourceRequest, runShortcutUpdate } from "./utils/shortcut_update"
import { isScriptHubImport, resolveScriptHubQueryParameters } from "./utils/deep_link_import"
import { getIntentFileURLs } from "./utils/intent_input"

function hasShortcutInput(): boolean {
  const fileURLs = getIntentFileURLs(Intent as any)
  return !!(
    Intent.shortcutParameter ||
    Intent.urlsParameter?.length ||
    Intent.textsParameter?.length ||
    fileURLs.length
  )
}

function incomingQueryParameters(direct: Record<string, any> | null | undefined): Record<string, any> {
  return resolveScriptHubQueryParameters(direct, [
    ...(Intent.urlsParameter ?? []),
    ...(Intent.textsParameter ?? []),
    Intent.shortcutParameter,
  ])
}

function incomingSharedSource(queryParameters: Record<string, any> | null | undefined) {
  return getSharedSourceRequest({
    shortcutParameter: Intent.shortcutParameter,
    urlsParameter: Intent.urlsParameter,
    textsParameter: Intent.textsParameter,
    queryParameters,
  })
}

async function presentSharedSource(queryParameters: Record<string, any> | null | undefined): Promise<boolean> {
  const shared = incomingSharedSource(queryParameters)
  const fileURLs = getIntentFileURLs(Intent as any)
  if (!shared || fileURLs.length || isScriptHubImport(queryParameters)) return false
  const { AppView } = await import("./components/AppView")
  await Navigation.present({
    element: <AppView initialTab={1} initialInput={shared} />,
  })
  return true
}

async function runExternalInput(queryParameters: Record<string, any> | null | undefined): Promise<boolean> {
  const isImportRequest = isScriptHubImport(queryParameters)
  if (!isImportRequest && !hasShortcutInput()) return false

  // A background run_single launch must have exactly one owner. In particular,
  // do not let an external re-trigger start a second downloader while the
  // first one is waiting for iCloud or the network.
  if (externalInputStarted) {
    console.log("[Surge Module Manager][Intent] duplicate external input ignored")
    return true
  }
  externalInputStarted = true

  try {
    const fileURLs = getIntentFileURLs(Intent as any)
    console.log(
      `[Surge Module Manager][Intent] started env=${Script.env} name=${Script.name} keys=${Object.keys(queryParameters ?? {}).join(",") || "none"} files=${fileURLs.length}`,
    )
    const result = await runShortcutUpdate({
      shortcutParameter: Intent.shortcutParameter,
      urlsParameter: Intent.urlsParameter,
      textsParameter: Intent.textsParameter,
      fileURLsParameter: fileURLs,
      queryParameters,
    })
    // Do not present an app dialog here. A URL-scheme launch has no presented
    // Navigation root, so Dialog.alert may never become visible while its
    // Promise keeps the script alive. Returning through Script.exit is the
    // documented non-interactive Intent lifecycle.
    // This is index.tsx, not intent.tsx. A plain string is valid for the
    // main-app URL-scheme path and does not depend on Intent serialization.
    Script.exit(result.text)
  } catch (e: any) {
    const message = String(e?.stack ?? e?.message ?? e)
    console.log(`[Surge Module Manager][Intent] index fatal: ${message}`)
    Script.exit(`Surge module update failed: ${message}`)
  }
  return true
}

let externalInputStarted = false

async function run() {
  // `run_single` always terminates an old instance and starts index.tsx again.
  // Handle that cold-start input before installing a resume listener, keeping
  // the import path single-shot and free from UI lifecycle races.
  console.log(
    `[Surge Module Manager][Intent] cold start env=${Script.env} query=${Object.keys(Script.queryParameters ?? {}).join(",") || "none"}`,
  )
  const queryParameters = incomingQueryParameters(Script.queryParameters)
  if (await presentSharedSource(queryParameters)) {
    Script.exit()
    return
  }
  if (await runExternalInput(queryParameters)) return

  // Plain `scripting://run/...` can resume an already visible app UI. Keep a
  // listener only for that long-lived UI path.
  const removeResumeHandler = Script.onResume((details) => {
    const queryParameters = incomingQueryParameters(details.queryParameters)
    if (isScriptHubImport(queryParameters)) {
      void runExternalInput(queryParameters)
    }
  })

  // Keep the headless URL/Shortcut path independent from the large UI tree.
  // Scripting supports dynamic imports; load the two-tab app only for normal UI use.
  const { AppView } = await import("./components/AppView")
  await Navigation.present({ element: <AppView /> })

  removeResumeHandler()
  // Exit the script after the view closes (recommended by Scripting).
  Script.exit()
}

void run().catch((e: any) => {
  const message = String(e?.stack ?? e?.message ?? e)
  console.log(`[Surge Module Manager][Intent] unhandled: ${message}`)
  Script.exit(`Surge module manager failed to start: ${message}`)
})
