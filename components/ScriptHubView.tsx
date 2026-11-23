import {
  Button,
  Divider,
  DisclosureGroup,
  Form,
  HStack,
  Image,
  Menu,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import { loadConfig, persistCategory, type AppConfig } from "../utils/config"
import { downloadModule } from "../utils/downloader"
import {
  buildScriptHubConversionURL,
  detectScriptHubSourceFormat,
  deriveModuleNameFromSource,
  isScriptHubSourceTargetCompatible,
  normalizeModuleName,
  SCRIPT_HUB_SOURCE_FORMATS,
  SCRIPT_HUB_TARGET_FORMATS,
  scriptHubSourceCategory,
  scriptHubSourceFormatLabel,
  scriptHubTargetFormatLabel,
  suggestedScriptHubTargetFormat,
  type ScriptHubSourceFormat,
  type ScriptHubTargetFormat,
} from "../utils/script_hub_adapter"
import { fetchSourceText } from "../utils/source_fetcher"
import { disableNewModuleByDefault, getModuleRemoteName } from "../utils/remote_control"
import {
  ensureStorage,
  getModulesDirResolved,
  loadModuleAtPath,
  loadModules,
  type ModuleInfo,
} from "../utils/storage"
import { recordRecentImport } from "../utils/recent_imports"

type InputMode = "remote-url" | "local-text"

type ScriptHubPlatform = "quantumult-x" | "loon" | "surge" | "egern" | "shadowrocket" | "scripting"

type ScriptHubPlatformOption = {
  value: ScriptHubPlatform
  label: string
  summary: string
}

const SCRIPT_HUB_PLATFORMS: ScriptHubPlatformOption[] = [
  { value: "quantumult-x", label: "Quantumult X", summary: "Remote QX rewrites and rule sets" },
  { value: "loon", label: "Loon", summary: "Loon plugins and rule sets" },
  { value: "surge", label: "Surge", summary: "Surge modules and rule sets with local write support" },
  { value: "egern", label: "Egern", summary: "Egern modules and rule sets in Surge-compatible formats" },
  { value: "shadowrocket", label: "Shadowrocket", summary: "Shadowrocket modules and rule sets" },
  { value: "scripting", label: "Scripting (Module Import)", summary: "Native Scripting import for Surge .sgmodule and Loon .plugin files" },
]

export type ScriptHubInitialInput = {
  sourceURL?: string
  localText?: string
  name?: string
  category?: string
  sourceFormat?: ScriptHubSourceFormat
  targetFormat?: ScriptHubTargetFormat
  sourceUserAgent?: string
  removeSourceMetadata?: boolean
  enableJQ?: boolean
}

type ScriptHubAdvancedValues = {
  description: string
  filename: string
  icon: string
  headers: string
  keepRewrite: string
  excludeRewrite: string
  keepRule: string
  excludeRule: string
  headerAdd: string
  headerDelete: string
  headerRegexDelete: string
  scriptTransform: string
  scriptTransformAll: boolean
  scriptTransform2: string
  scriptTransform2All: boolean
  cron: string
  cronExpression: string
  scriptName: string
  scriptTarget: string
  timeoutTarget: string
  timeoutValue: string
  engineTarget: string
  engineValue: string
  policy: string
  arg: string
  argv: string
  tiles: string
  tileColor: string
  cacheExpiry: string
  noCache: boolean
  noResolve: boolean
  syncMitm: boolean
  noNotification: boolean
  wrapResponse: boolean
  compatibilityOnly: boolean
  prepend: string
  evalScriptOriginal: string
  evalScriptModified: string
  evalURLOriginal: string
  evalURLModified: string
  evalJSOriginal: string
  evalJSModified: string
  evalURLJSOriginal: string
  evalURLJSModified: string
  keepHeader: boolean
  jsDelivr: boolean
  sni: string
  preMatching: string
}

const DEFAULT_ADVANCED: ScriptHubAdvancedValues = {
  description: "",
  filename: "",
  icon: "",
  headers: "",
  keepRewrite: "",
  excludeRewrite: "",
  keepRule: "",
  excludeRule: "",
  headerAdd: "",
  headerDelete: "",
  headerRegexDelete: "",
  scriptTransform: "",
  scriptTransformAll: false,
  scriptTransform2: "",
  scriptTransform2All: false,
  cron: "",
  cronExpression: "",
  scriptName: "",
  scriptTarget: "",
  timeoutTarget: "",
  timeoutValue: "",
  engineTarget: "",
  engineValue: "",
  policy: "",
  arg: "",
  argv: "",
  tiles: "",
  tileColor: "",
  cacheExpiry: "",
  noCache: false,
  noResolve: false,
  syncMitm: false,
  noNotification: false,
  wrapResponse: false,
  compatibilityOnly: false,
  prepend: "",
  evalScriptOriginal: "",
  evalScriptModified: "",
  evalURLOriginal: "",
  evalURLModified: "",
  evalJSOriginal: "",
  evalJSModified: "",
  evalURLJSOriginal: "",
  evalURLJSModified: "",
  keepHeader: false,
  jsDelivr: false,
  sni: "",
  preMatching: "",
}

const SCRIPT_NAME_KEY = "script-hub-scripting-script-name"
const PLATFORM_KEY = "script-hub-target-platform"

function loadStoredScriptName(): string {
  try {
    const storage: any = (globalThis as any).Storage
    return String(storage?.get?.(SCRIPT_NAME_KEY) ?? storage?.getString?.(SCRIPT_NAME_KEY) ?? "").trim()
  } catch {
    return ""
  }
}

function saveStoredScriptName(value: string): void {
  try {
    const storage: any = (globalThis as any).Storage
    const name = String(value ?? "").trim()
    if (typeof storage?.set === "function") storage.set(SCRIPT_NAME_KEY, name)
    else storage?.setString?.(SCRIPT_NAME_KEY, name)
  } catch {}
}

function loadStoredPlatform(): ScriptHubPlatform {
  try {
    const storage: any = (globalThis as any).Storage
    const value = String(storage?.get?.(PLATFORM_KEY) ?? storage?.getString?.(PLATFORM_KEY) ?? "").trim()
    return SCRIPT_HUB_PLATFORMS.some((item) => item.value === value)
      ? value as ScriptHubPlatform
      : "surge"
  } catch {
    return "surge"
  }
}

function saveStoredPlatform(value: ScriptHubPlatform): void {
  try {
    const storage: any = (globalThis as any).Storage
    if (typeof storage?.set === "function") storage.set(PLATFORM_KEY, value)
    else storage?.setString?.(PLATFORM_KEY, value)
  } catch {}
}

function hideKeyboard(): void {
  try {
    ;(globalThis as any).Keyboard?.hide?.()
  } catch {}
}

async function readClipboardText(): Promise<string> {
  const pasteboard: any = (globalThis as any).Pasteboard
  if (typeof pasteboard?.getString === "function") return String(await pasteboard.getString() ?? "")
  if (typeof pasteboard?.string === "function") return String(await pasteboard.string() ?? "")
  if (typeof pasteboard?.string === "string") return pasteboard.string
  return ""
}

function clipboardURL(value: string): string {
  const match = String(value ?? "").trim().match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return ""
  const candidate = match[0].replace(/[),.;!?，。；！？]+$/g, "")
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""
    return parsed.toString()
  } catch {
    return ""
  }
}

function looksLikeConvertibleText(value: string): boolean {
  const text = String(value ?? "").trim()
  if (!text || text.length < 8) return false
  return /(?:^|\n)\s*\[(?:general|rewrite_local|rewrite_remote|filter_remote|script|rewrite|rule|url rewrite|header rewrite|body rewrite|map local)\]\s*$/im.test(text)
    || /^\s*#!(?:name|desc|category|icon|author)\s*=/im.test(text)
    || /(?:^|\n)\s*(?:DOMAIN(?:-SUFFIX|-KEYWORD)?|IP-CIDR6?|GEOIP|URL-REGEX|HOST(?:-SUFFIX|-KEYWORD)?),/im.test(text)
    || /\b(?:const|let|var|function|class|import|export|module\.exports|\$request|\$response|\$done|\$task)\b/.test(text)
}

function sourceNameFromText(value: string): string {
  const metadata = value.match(/^\s*#!(?:name|title)\s*=\s*(.+)$/im)?.[1]
  const firstUsefulLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("//"))
  const candidate = String(metadata ?? firstUsefulLine ?? "本地转换模块")
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return candidate.slice(0, 128) || "本地转换模块"
}

function previewURL(value: string): string {
  try {
    const parts = value.split("/_end_/")
    if (parts.length !== 2) return value
    const suffix = parts[1].replace("?", ".txt?")
    return `${parts[0]}/_end_/${suffix}${suffix.includes("?") ? "&" : "?"}noNtf=true`
  } catch {
    return value
  }
}

async function openExternalURL(url: string): Promise<boolean> {
  const safari: any = (globalThis as any).Safari
  try {
    if (typeof safari?.openURL === "function") {
      await safari.openURL(url)
      return true
    }
    if (typeof safari?.open === "function") {
      await safari.open(url)
      return true
    }
  } catch {}
  return false
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await Pasteboard.setString(value)
    await Dialog.alert({ message: successMessage })
  } catch (e: any) {
    await Dialog.alert({ title: "Copy Failed", message: String(e?.message ?? e) })
  }
}

function clientImportURL(
  platform: ScriptHubPlatform,
  sourceFormat: ScriptHubSourceFormat,
  target: ScriptHubTargetFormat,
  result: string,
  filename: string,
): string {
  const encodedResult = encodeURIComponent(result)
  const encodedName = encodeURIComponent(filename)
  if (platform === "quantumult-x" && target === "plain-text") {
    const resourceKey = sourceFormat === "rule-set" ? "filter_remote" : "rewrite_remote"
    const resource = JSON.stringify({ [resourceKey]: [result] })
    return "quantumult-x:///add-resource?remote-resource=" + encodeURIComponent(resource)
  }
  if (platform === "loon" && target === "loon-plugin") {
    return "loon://import?plugin=" + encodedResult
  }
  if (platform === "loon" && target === "loon-rule-set") {
    return "loon://import?rules=" + encodedResult
  }
  if (platform === "egern" && (target === "surge-rule-set" || target.includes("domain-set"))) {
    return "egern:/rules/new?type=rule_set&match=" + encodedResult
  }
  if (platform === "egern" && target === "surge-module") {
    return "egern:/modules/new?name=" + encodedName + "&url=" + encodedResult
  }
  if (platform === "shadowrocket" && target === "shadowrocket-module") {
    return "shadowrocket://install?module=" + encodedResult
  }
  if (platform === "scripting" && (target === "surge-module" || target === "loon-plugin")) {
    return "scripting://import_module?url=" + encodedResult
  }
  if (platform === "surge" && target === "surge-module") {
    return "surge:///install-module?url=" + encodedResult + "&name=" + encodedName
  }
  if (target === "stash-stoverride") {
    return "stash://install-override?url=" + encodedResult
  }
  if (target === "plain-text") return result
  return ""
}

function ActionButton(props: {
  title: string
  systemImage: string
  tint: "systemBlue" | "systemGreen" | "systemPurple" | "systemOrange"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      title={props.title}
      systemImage={props.systemImage}
      buttonStyle="borderedProminent"
      controlSize="small"
      tint={props.tint}
      disabled={props.disabled}
      frame={{ maxWidth: "infinity" }}
      action={() => {
        hideKeyboard()
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
    />
  )
}

function compatibleTargets(sourceFormat: ScriptHubSourceFormat): typeof SCRIPT_HUB_TARGET_FORMATS {
  if (sourceFormat === "qx-script") {
    return SCRIPT_HUB_TARGET_FORMATS.filter((item) => item.value === "surge-module" || item.value === "surge-script")
  }
  if (sourceFormat === "rule-set") {
    return SCRIPT_HUB_TARGET_FORMATS.filter((item) => (
      item.value.endsWith("-rule-set") || item.value.includes("domain-set") || item.value === "plain-text"
    ))
  }
  if (sourceFormat === "plain-text") {
    return SCRIPT_HUB_TARGET_FORMATS.filter((item) => item.value === "plain-text")
  }
  return SCRIPT_HUB_TARGET_FORMATS.filter((item) => (
    !item.value.endsWith("-rule-set") && !item.value.includes("domain-set") && item.value !== "surge-script"
  ))
}

function platformTargets(
  sourceFormat: ScriptHubSourceFormat,
  platform: ScriptHubPlatform,
): typeof SCRIPT_HUB_TARGET_FORMATS {
  const base = compatibleTargets(sourceFormat)
  if (platform === "quantumult-x") {
    const plainText = SCRIPT_HUB_TARGET_FORMATS.find((item) => item.value === "plain-text")
    return plainText ? [plainText] : base
  }

  const values = platform === "loon"
    ? new Set<ScriptHubTargetFormat>(["loon-plugin", "loon-rule-set", "plain-text"])
    : platform === "egern"
      ? new Set<ScriptHubTargetFormat>(["surge-module", "surge-rule-set", "surge-domain-set", "surge-domain-set2", "plain-text"])
      : platform === "scripting"
        ? new Set<ScriptHubTargetFormat>(["surge-module", "loon-plugin"])
      : platform === "shadowrocket"
        ? new Set<ScriptHubTargetFormat>(["shadowrocket-module", "shadowrocket-rule-set", "plain-text"])
      : new Set<ScriptHubTargetFormat>([
        "surge-module",
        "surge-script",
        "surge-rule-set",
        "surge-domain-set",
        "surge-domain-set2",
        "plain-text",
      ])
  const filtered = base.filter((item) => values.has(item.value))
  if (filtered.length > 0) return filtered

  const plainText = SCRIPT_HUB_TARGET_FORMATS.find((item) => item.value === "plain-text")
  return plainText ? [plainText] : base
}

function defaultPlatformTarget(
  sourceFormat: ScriptHubSourceFormat,
  platform: ScriptHubPlatform,
): ScriptHubTargetFormat {
  const options = platformTargets(sourceFormat, platform)
  const preferred = platform === "quantumult-x"
    ? "plain-text"
    : platform === "loon"
      ? sourceFormat === "rule-set" ? "loon-rule-set" : "loon-plugin"
      : platform === "egern"
        ? sourceFormat === "rule-set" ? "surge-rule-set" : "surge-module"
        : platform === "shadowrocket"
          ? sourceFormat === "rule-set" ? "shadowrocket-rule-set" : "shadowrocket-module"
        : platform === "scripting"
          ? sourceFormat === "loon-plugin" ? "loon-plugin" : "surge-module"
        : sourceFormat === "rule-set" ? "surge-rule-set" : "surge-module"
  return options.find((item) => item.value === preferred)?.value
    ?? options[0]?.value
    ?? "surge-module"
}

function targetLabelForPlatform(
  platform: ScriptHubPlatform,
  sourceFormat: ScriptHubSourceFormat,
  targetFormat: ScriptHubTargetFormat,
): string {
  if (platform === "quantumult-x" && targetFormat === "plain-text") {
    return sourceFormat === "rule-set" ? "QX Rule Set (Direct Link)" : "QX Rewrite (Direct Link)"
  }
  if (platform === "loon" && targetFormat === "loon-plugin") return "Loon Plugin"
  if (platform === "loon" && targetFormat === "loon-rule-set") return "Loon Rule Set"
  if (platform === "surge" && targetFormat === "surge-module") return "Surge Module"
  if (platform === "egern" && targetFormat === "surge-module") return "Egern Module"
  if (platform === "egern" && (targetFormat === "surge-rule-set" || targetFormat.includes("domain-set"))) return "Egern Rule Set"
  if (platform === "shadowrocket" && targetFormat === "shadowrocket-module") return "Shadowrocket Module"
  if (platform === "shadowrocket" && targetFormat === "shadowrocket-rule-set") return "Shadowrocket Rule Set"
  if (platform === "scripting" && targetFormat === "surge-module") return "Scripting · Surge Module"
  if (platform === "scripting" && targetFormat === "loon-plugin") return "Scripting · Loon Plugin"
  return scriptHubTargetFormatLabel(targetFormat)
}

function platformCanQuickImport(
  platform: ScriptHubPlatform,
  sourceFormat: ScriptHubSourceFormat,
  targetFormat: ScriptHubTargetFormat,
): boolean {
  if (!isScriptHubSourceTargetCompatible(sourceFormat, targetFormat)) return false
  if (platform === "quantumult-x") {
    return targetFormat === "plain-text" && (sourceFormat === "qx-rewrite" || sourceFormat === "rule-set" || sourceFormat === "plain-text")
  }
  if (platform === "loon") return targetFormat === "loon-plugin" || targetFormat === "loon-rule-set"
  if (platform === "egern") {
    return targetFormat === "surge-module"
      || targetFormat === "surge-rule-set"
      || targetFormat.includes("domain-set")
  }
  if (platform === "shadowrocket") return targetFormat === "shadowrocket-module"
  if (platform === "scripting") return targetFormat === "surge-module" || targetFormat === "loon-plugin"
  return targetFormat === "surge-module"
}

function platformForTarget(targetFormat: ScriptHubTargetFormat): ScriptHubPlatform {
  if (targetFormat === "loon-plugin" || targetFormat === "loon-rule-set") return "loon"
  if (targetFormat === "shadowrocket-module" || targetFormat === "shadowrocket-rule-set") return "shadowrocket"
  if (targetFormat === "plain-text") return "quantumult-x"
  return "surge"
}

export function ScriptHubView(props: { onImported?: () => void; tag?: number; tabItem?: any; initialInput?: ScriptHubInitialInput }) {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [inputMode, setInputMode] = useState<InputMode>("remote-url")
  const [sourceURL, setSourceURL] = useState("")
  const [localText, setLocalText] = useState("")
  const [sourceFormat, setSourceFormat] = useState<ScriptHubSourceFormat>("qx-rewrite")
  const [sourceFormatAuto, setSourceFormatAuto] = useState(true)
  const [platform, setPlatform] = useState<ScriptHubPlatform>(loadStoredPlatform)
  const [targetFormat, setTargetFormat] = useState<ScriptHubTargetFormat>("surge-module")
  const [moduleName, setModuleName] = useState("")
  const [categoryIdx, setCategoryIdx] = useState(0)
  const [customCategory, setCustomCategory] = useState("")
  const [nativeCategory, setNativeCategory] = useState("")
  const [categoryCustomized, setCategoryCustomized] = useState(false)
  const [sourceUserAgent, setSourceUserAgent] = useState("")
  const [keepOriginalLink, setKeepOriginalLink] = useState(true)
  const [removeSourceMetadata, setRemoveSourceMetadata] = useState(true)
  const [enableJQ, setEnableJQ] = useState(true)
  const [advanced, setAdvanced] = useState<ScriptHubAdvancedValues>(() => ({ ...DEFAULT_ADVANCED }))
  const [scriptingScriptName, setScriptingScriptName] = useState(loadStoredScriptName)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [detectedReason, setDetectedReason] = useState("")
  const [sourceSettingsExpanded, setSourceSettingsExpanded] = useState(true)
  const [formatExpanded, setFormatExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [typeGuideExpanded, setTypeGuideExpanded] = useState(false)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [advancedSections, setAdvancedSections] = useState({
    rewrite: false,
    script: false,
    schedule: false,
    runtime: false,
  })
  const [clientExpanded, setClientExpanded] = useState(false)

  const categories = cfg.categories ?? []
  const categoryOptions = useMemo(() => [
    "插件",
    "不设置分类",
    ...categories.filter((item) => item !== "插件" && item !== "不设置分类"),
  ], [categories])
  const menuCategory = categoryOptions[categoryIdx] === "不设置分类"
    ? ""
    : categoryOptions[categoryIdx] ?? "插件"
  const selectedCategory = categoryCustomized
    ? customCategory.trim() || menuCategory
    : nativeCategory || customCategory.trim() || menuCategory
  const selectedPlatform = SCRIPT_HUB_PLATFORMS.find((item) => item.value === platform) ?? SCRIPT_HUB_PLATFORMS[2]!
  const targetOptions = useMemo(() => platformTargets(sourceFormat, platform), [sourceFormat, platform])
  const targetIndex = Math.max(0, targetOptions.findIndex((item) => item.value === targetFormat))
  const targetCanWriteToSurge = platform === "surge" && targetFormat === "surge-module"
  const targetCanQuickImport = platformCanQuickImport(platform, sourceFormat, targetFormat)
  const primaryActionTitle = busy
    ? "Working…"
    : targetCanWriteToSurge
      ? "Convert and Write to Surge"
      : targetCanQuickImport
        ? "Convert and Import into " + selectedPlatform.label
        : "Copy " + selectedPlatform.label + " Result"
  const primaryActionImage = targetCanWriteToSurge
    ? "arrow.down.doc.fill"
    : targetCanQuickImport
      ? "arrow.up.forward.app"
      : "doc.on.clipboard"
 const hasSource = inputMode === "local-text" ? !!localText.trim() : !!sourceURL.trim()
  const sourceForConversion = inputMode === "local-text" ? "http://local.text" : sourceURL.trim()
  const localModuleName = inputMode === "local-text"
    ? sourceNameFromText(localText)
    : deriveModuleNameFromSource(sourceForConversion)
  const outputFilename = (advanced.filename.trim() || moduleName.trim() || localModuleName)
    .replace(/\.(?:plugin|lpx|conf|sgmodule|stoverride|module|list|txt|js)$/i, "")
    .replace(/[\\/]/g, "-")
    .trim() || "转换模块"

 useEffect(() => {
   saveStoredScriptName(scriptingScriptName)
 }, [scriptingScriptName])

  useEffect(() => {
    saveStoredPlatform(platform)
  }, [platform])

  function updateAdvanced<K extends keyof ScriptHubAdvancedValues>(key: K, value: ScriptHubAdvancedValues[K]) {
    setAdvanced((previous) => ({ ...previous, [key]: value }))
  }

  function updateAdvancedSection(key: keyof typeof advancedSections, expanded: boolean) {
    setAdvancedSections((previous) => ({ ...previous, [key]: expanded }))
  }

  function applyNativeCategory(value: string): void {
    const category = String(value ?? "").trim().slice(0, 64)
    if (!category || categoryCustomized) return
    setNativeCategory(category)
    const index = categoryOptions.indexOf(category)
    if (index >= 0) {
      setCategoryIdx(index)
      setCustomCategory("")
    } else {
      setCustomCategory(category)
    }
  }

  function applyNativeCategoryFromText(value: string): void {
    applyNativeCategory(scriptHubSourceCategory(value))
  }

  function advancedParams(): Record<string, string | number | boolean | undefined> {
    const params: Record<string, string | number | boolean | undefined> = {}
    const put = (key: string, value: unknown) => {
      if (typeof value === "boolean") {
        if (value) params[key] = true
        return
      }
      const text = String(value ?? "").trim()
      if (text) params[key] = text
    }
    const description = advanced.description.trim()
    const outputName = moduleName.trim()
    if (outputName || description) put("n", `${outputName}${description ? `+${description}` : ""}`)
    put("icon", advanced.icon)
    put("y", sourceFormat === "rule-set" ? advanced.keepRule : advanced.keepRewrite)
    put("x", sourceFormat === "rule-set" ? advanced.excludeRule : advanced.excludeRewrite)
    put("hnadd", advanced.headerAdd)
    put("hndel", advanced.headerDelete)
    put("hnregdel", advanced.headerRegexDelete)
    put("jsc", advanced.scriptTransformAll ? "." : advanced.scriptTransform)
    put("jsc2", advanced.scriptTransform2All ? "." : advanced.scriptTransform2)
    put("cron", advanced.cron)
    put("cronexp", advanced.cronExpression)
    put("njsname", advanced.scriptName)
    put("njsnametarget", advanced.scriptTarget)
    put("timeoutt", advanced.timeoutTarget)
    put("timeoutv", advanced.timeoutValue)
    put("enginet", advanced.engineTarget)
    put("enginev", advanced.engineValue)
    put("policy", advanced.policy)
    put("arg", advanced.arg)
    put("argv", advanced.argv)
    put("tiles", advanced.tiles)
    put("tcolor", advanced.tileColor)
    put("cachexp", advanced.cacheExpiry)
    put("nocache", advanced.noCache)
    put("nore", advanced.noResolve)
    put("synMitm", advanced.syncMitm)
    put("noNtf", advanced.noNotification)
    put("wrap_response", advanced.wrapResponse)
    put("compatibilityOnly", advanced.compatibilityOnly)
    put("evalScriptori", advanced.evalScriptOriginal)
    put("evalScriptmodi", advanced.evalScriptModified)
    put("evalUrlori", advanced.evalURLOriginal)
    put("evalUrlmodi", advanced.evalURLModified)
    put("evJsori", advanced.evalJSOriginal)
    put("evJsmodi", advanced.evalJSModified)
    put("evUrlori", advanced.evalURLJSOriginal)
    put("evUrlmodi", advanced.evalURLJSModified)
    put("prepend", advanced.prepend)
    put("keepHeader", advanced.keepHeader)
    put("jsDelivr", advanced.jsDelivr)
    put("sni", advanced.sni)
    put("pm", advanced.preMatching)
    return params
  }

  const conversionResult = useMemo(() => {
    if (!hasSource) return { url: "", error: "" }
    try {
     if (!isScriptHubSourceTargetCompatible(sourceFormat, targetFormat)) {
        throw new Error("This source cannot be converted to " + targetLabelForPlatform(platform, sourceFormat, targetFormat))
     }
      const name = moduleName.trim() || localModuleName
      return {
        url: buildScriptHubConversionURL({
          sourceURL: sourceForConversion,
          localText: inputMode === "local-text" ? localText : undefined,
          sourceFormat,
          targetFormat,
          moduleName: name,
          filename: advanced.filename,
          category: selectedCategory,
          sourceUserAgent,
          headers: advanced.headers,
          removeSourceMetadata,
          enableJQ,
          extraParams: advancedParams(),
        }),
        error: "",
      }
    } catch (e: any) {
      return { url: "", error: String(e?.message ?? e) }
    }
  }, [
    hasSource,
    inputMode,
    sourceURL,
    localText,
    sourceForConversion,
   sourceFormat,
   targetFormat,
    platform,
   moduleName,
    localModuleName,
    selectedCategory,
    sourceUserAgent,
    advanced,
    removeSourceMetadata,
    enableJQ,
  ])

  function setDetectedFormat(nextSource: ScriptHubSourceFormat, reason: string, suggested?: ScriptHubTargetFormat) {
    setSourceFormat(nextSource)
   setSourceFormatAuto(true)
   setDetectedReason(reason)
    const suggestedTarget = suggestedScriptHubTargetFormat(nextSource, suggested ?? targetFormat)
    const nextTargets = platformTargets(nextSource, platform)
    const nextTarget = nextTargets.find((item) => item.value === suggestedTarget)?.value
      ?? nextTargets.find((item) => item.value === targetFormat)?.value
      ?? defaultPlatformTarget(nextSource, platform)
    setTargetFormat(nextTarget)
  }

  async function detectFormat() {
    hideKeyboard()
    if (!hasSource) {
      await Dialog.alert({ message: inputMode === "local-text" ? "Enter the local text first." : "Enter the HTTPS source URL first." })
      return
    }
    setBusy(true)
    setStatus(inputMode === "local-text" ? "Detecting the local text format…" : "Reading the source and detecting its format…")
    try {
      if (inputMode === "local-text") {
        const detection = detectScriptHubSourceFormat("local.txt", localText)
        setDetectedFormat(detection.sourceFormat, detection.reason, detection.suggestedTargetFormat)
        applyNativeCategoryFromText(localText)
        if (!moduleName.trim()) setModuleName(sourceNameFromText(localText))
        setStatus(`Detected format: ${scriptHubSourceFormatLabel(detection.sourceFormat)}`)
        return
      }
      const raw = sourceURL.trim()
      const response = await fetchSourceText(raw, {
          userAgent: sourceUserAgent,
          maxChars: 512 * 1024,
          debugLabel: "Script-Hub format detection",
        })
      const detection = detectScriptHubSourceFormat(raw, response.text)
      setDetectedFormat(detection.sourceFormat, detection.reason, detection.suggestedTargetFormat)
      applyNativeCategoryFromText(response.text)
      if (!moduleName.trim()) setModuleName(deriveModuleNameFromSource(raw))
      setStatus(`Detected format: ${scriptHubSourceFormatLabel(detection.sourceFormat)}`)
    } catch (e: any) {
      const fallback = detectScriptHubSourceFormat(
        inputMode === "local-text" ? "local.txt" : sourceURL,
        inputMode === "local-text" ? localText : undefined,
      )
      setDetectedFormat(fallback.sourceFormat, `${fallback.reason} (contents unread)`, fallback.suggestedTargetFormat)
      if (!moduleName.trim()) setModuleName(inputMode === "local-text" ? sourceNameFromText(localText) : deriveModuleNameFromSource(sourceURL))
      setStatus(`Fallback based on the ${inputMode === "local-text" ? "text" : "link"}: ${scriptHubSourceFormatLabel(fallback.sourceFormat)}`)
      await Dialog.alert({
        title: inputMode === "local-text" ? "Could Not Detect Text Format" : "Could Not Detect Remote Format",
        message: `${String(e?.message ?? e)}\n\nYou can still generate a conversion link using the current format.`,
      })
    } finally {
      setBusy(false)
    }
  }

  async function detectInitialInput(
    mode: InputMode,
    value: string,
    userAgent: string,
    isActive: () => boolean = () => true,
  ): Promise<void> {
    const text = String(value ?? "").trim()
    if (!text || !isActive()) return
    if (mode === "local-text") {
      const detection = detectScriptHubSourceFormat("clipboard.txt", text)
      if (!isActive()) return
      setDetectedFormat(detection.sourceFormat, detection.reason, detection.suggestedTargetFormat)
      applyNativeCategoryFromText(text)
      setStatus("Read source and detected format: " + scriptHubSourceFormatLabel(detection.sourceFormat))
      return
    }

    setBusy(true)
    setStatus("Source loaded. Detecting its format…")
    try {
      const response = await fetchSourceText(text, {
        userAgent,
        maxChars: 512 * 1024,
        debugLabel: "Script-Hub shared link detection",
      })
      if (!isActive()) return
      const detection = detectScriptHubSourceFormat(text, response.text)
      setDetectedFormat(detection.sourceFormat, detection.reason, detection.suggestedTargetFormat)
      applyNativeCategoryFromText(response.text)
      setStatus("Detected format: " + scriptHubSourceFormatLabel(detection.sourceFormat))
    } catch (e: any) {
      if (!isActive()) return
      const fallback = detectScriptHubSourceFormat(text)
      setDetectedFormat(fallback.sourceFormat, fallback.reason + " (contents unread)", fallback.suggestedTargetFormat)
      setStatus("Could not read the remote source. Using the URL extension: " + scriptHubSourceFormatLabel(fallback.sourceFormat))
      console.log("[Surge Module Manager][Script-Hub] initial source detection fallback: " + String(e?.message ?? e))
    } finally {
      if (isActive()) setBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    void (async () => {
      const provided = props.initialInput
      let mode: InputMode | null = null
      let value = ""
      if (provided?.sourceURL?.trim()) {
        mode = "remote-url"
        value = provided.sourceURL.trim()
      } else if (provided?.localText?.trim()) {
        mode = "local-text"
        value = provided.localText.trim()
      } else {
        try {
          const clipboard = (await readClipboardText()).trim()
          if (!active) return
          const url = clipboardURL(clipboard)
          if (url) {
            mode = "remote-url"
            value = url
            setStatus("Link pasted from the clipboard. Detecting its format…")
          } else if (looksLikeConvertibleText(clipboard)) {
            mode = "local-text"
            value = clipboard
            setStatus("Text pasted from the clipboard. Detecting its format…")
          }
        } catch (e: any) {
          console.log("[Surge Module Manager][Script-Hub] clipboard read skipped: " + String(e?.message ?? e))
        }
      }
      if (!active || !mode || !value) return

      setInputMode(mode)
      setSourceFormatAuto(!provided?.sourceFormat)
      setDetectedReason("")
      setNativeCategory("")
      setCategoryCustomized(!!provided?.category?.trim())
      setSourceSettingsExpanded(true)
      setFormatExpanded(false)
      hideKeyboard()
      if (mode === "remote-url") {
        setSourceURL(value)
        setLocalText("")
        if (!provided?.name && !moduleName.trim()) setModuleName(deriveModuleNameFromSource(value))
      } else {
        setLocalText(value)
        setSourceURL("")
        if (!provided?.name && !moduleName.trim()) setModuleName(sourceNameFromText(value))
      }
      if (provided?.name?.trim()) setModuleName(provided.name.trim())
      if (provided?.category?.trim()) setCustomCategory(provided.category.trim())
      if (provided?.sourceUserAgent !== undefined) setSourceUserAgent(provided.sourceUserAgent)
      if (provided?.removeSourceMetadata !== undefined) setRemoveSourceMetadata(provided.removeSourceMetadata)
     if (provided?.enableJQ !== undefined) setEnableJQ(provided.enableJQ)
     if (provided?.sourceFormat) setSourceFormat(provided.sourceFormat)
      if (provided?.targetFormat) {
        setPlatform(platformForTarget(provided.targetFormat))
        setTargetFormat(provided.targetFormat)
      }
     hideKeyboard()
      if (provided?.sourceFormat) {
        setDetectedReason("Using the source format specified in the shared parameters")
        setStatus("Source filled in. Using the format from the shared parameters.")
      } else {
        await detectInitialInput(mode, value, provided?.sourceUserAgent ?? sourceUserAgent, () => active)
      }
    })()
    return () => {
      active = false
    }
  }, [
    props.initialInput?.sourceURL,
    props.initialInput?.localText,
    props.initialInput?.name,
    props.initialInput?.category,
    props.initialInput?.sourceFormat,
    props.initialInput?.targetFormat,
    props.initialInput?.sourceUserAgent,
    props.initialInput?.removeSourceMetadata,
    props.initialInput?.enableJQ,
  ])

  async function copyConversionURL() {
    if (!conversionResult.url) {
      await Dialog.alert({ title: "Conversion Link Unavailable", message: conversionResult.error || "Enter the source URL first." })
      return
    }
    await copyText(conversionResult.url, "Script-Hub conversion link copied")
  }

  async function copySource() {
    const value = inputMode === "local-text" ? localText.trim() : sourceURL.trim()
    if (!value) {
      await Dialog.alert({ title: "Original Content Unavailable", message: "Enter a source URL or paste local text first." })
      return
    }
    await copyText(value, inputMode === "local-text" ? "Local text copied" : "Original source URL copied")
  }

  async function openResult() {
    if (!conversionResult.url) return copyConversionURL()
    if (!(await openExternalURL(conversionResult.url))) {
      await copyText(conversionResult.url, "Could not open the link directly. Conversion link copied.")
    }
  }

  async function openPreview() {
    if (!conversionResult.url) return copyConversionURL()
    const url = previewURL(conversionResult.url)
    if (!(await openExternalURL(url))) {
      await copyText(url, "Could not open the link directly. Preview link copied.")
    }
  }

  async function openClientImport(client: "surge" | "scripting" | "scriptable" | "egern" | "target") {
    if (!conversionResult.url) return copyConversionURL()
    let url = ""
    if (client === "surge") url = clientImportURL("surge", sourceFormat, "surge-module", conversionResult.url, outputFilename)
    if (client === "scriptable") {
      url = `scriptable:///run/SurgeModuleTool?url=${encodeURIComponent(conversionResult.url)}&name=${encodeURIComponent(outputFilename)}`
    }
    if (client === "egern") {
      url = clientImportURL("egern", sourceFormat, "surge-module", conversionResult.url, outputFilename)
    }
    if (client === "scripting") {
      if (!scriptingScriptName.trim()) {
        await Dialog.alert({
          title: "Script Name Required",
          message: "Enter the script name as it appears in Scripting. On first use, authorize the iCloud/Surge configuration directory in that script's settings.",
        })
        return
      }
      url = `scripting://run_single/${encodeURIComponent(scriptingScriptName.trim())}?sh_action=import-surge-module&sh_module_url=${encodeURIComponent(conversionResult.url)}&sh_module_name=${encodeURIComponent(outputFilename)}&sh_module_category=${encodeURIComponent(selectedCategory || "Script Hub")}`
    }
    if (client === "target") url = clientImportURL(platform, sourceFormat, targetFormat, conversionResult.url, outputFilename)
    if (!url) return copyConversionURL()
    if (!(await openExternalURL(url))) {
      await copyText(url, "Could not open the client directly. Import link copied.")
    }
  }

  async function writeToSurge() {
    if (busy) return
    if (!targetCanWriteToSurge) {
      if (targetCanQuickImport) await openClientImport("target")
      else await copyConversionURL()
      return
    }
    if (!conversionResult.url) {
      await Dialog.alert({ title: "Could Not Write Module", message: conversionResult.error || "Enter a source URL and check that it is correct." })
      return
    }

    setBusy(true)
    setStatus("Converting and writing to the Surge module directory…")
    try {
      await ensureStorage()
      const baseDir = await getModulesDirResolved()
      if (!baseDir) throw new Error("The Surge module directory is unavailable. Select a bookmarked directory in Scripting settings first.")
      const current = await loadModules(baseDir)
      const name = normalizeModuleName(
        moduleName.trim() || (inputMode === "local-text" ? sourceNameFromText(localText) : ""),
        sourceForConversion,
      )
      if (current.some((item) => item.name === name)) throw new Error(`A local module already uses this name: ${name}`)
      if (current.some((item) => item.link === conversionResult.url)) throw new Error("A local module already uses this conversion link.")

      const nextCfg = selectedCategory ? persistCategory(selectedCategory) : loadConfig()
      setCfg(nextCfg)
      const info: ModuleInfo = {
        name,
        link: conversionResult.url,
        sourceURL: keepOriginalLink && inputMode === "remote-url" ? sourceURL.trim() : undefined,
        category: selectedCategory || undefined,
        saveDir: baseDir,
        isLocal: false,
      }
      const result = await downloadModule(info, { mode: "direct" })
      if (!result.ok) throw new Error(result.message ?? "Could not download the converted file")
      const saved = await loadModuleAtPath(result.path ?? "")
      const savedInfo = saved ?? info
      const disabled = await disableNewModuleByDefault(nextCfg, getModuleRemoteName(savedInfo))
      recordRecentImport(savedInfo)
      props.onImported?.()
      setStatus(`Written: ${name}`)
      await Dialog.alert({
        message: `Converted module saved to the Surge module directory\n${name}${disabled ? "\nNew modules start disabled" : ""}`,
      })
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStatus(`Write failed: ${message}`)
      await Dialog.alert({ title: "Write Failed", message })
    } finally {
      setBusy(false)
    }
  }

  async function performPrimaryAction() {
    if (targetCanWriteToSurge) return writeToSurge()
    if (targetCanQuickImport) return openClientImport("target")
    return copyConversionURL()
  }

  function resetForm() {
    hideKeyboard()
    setInputMode("remote-url")
    setSourceURL("")
    setLocalText("")
    setSourceFormat("qx-rewrite")
    setSourceFormatAuto(true)
    setTargetFormat("surge-module")
    setPlatform("surge")
    setModuleName("")
    setCategoryIdx(0)
    setCustomCategory("")
    setNativeCategory("")
    setCategoryCustomized(false)
    setSourceUserAgent("")
    setKeepOriginalLink(true)
    setRemoveSourceMetadata(true)
    setEnableJQ(true)
    setAdvanced({ ...DEFAULT_ADVANCED })
    setDetectedReason("")
    setSourceSettingsExpanded(true)
    setFormatExpanded(false)
    setOutputExpanded(false)
    setTypeGuideExpanded(false)
    setAdvancedExpanded(false)
    setAdvancedSections({ rewrite: false, script: false, schedule: false, runtime: false })
    setClientExpanded(false)
    setStatus("Reset complete")
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Script-Hub"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: (
            <Button
              title="Reset"
              action={() => {
                HapticFeedback.mediumImpact()
                resetForm()
              }}
            />
          ),
          keyboard: (
            <HStack padding={{ top: 6, bottom: 6, leading: 16, trailing: 16 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">Script-Hub Conversion</Text>
              <Spacer />
              <Button
                title="Dismiss Keyboard"
                systemImage="keyboard.chevron.compact.down"
                buttonStyle="borderless"
                action={hideKeyboard}
              />
            </HStack>
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section>
            <HStack spacing={12} padding={{ top: 6, bottom: 6 }}>
              <Image
                systemName="arrow.triangle.2.circlepath.circle.fill"
                font={30}
                foregroundStyle="systemPurple"
              />
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="title3">Script-Hub Conversion</Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
                  Uses the upstream Script-Hub beta conversion engine and supports remote URLs, local text, and imports into multiple clients.
                </Text>
              </VStack>
            </HStack>
            <Text font="caption" foregroundStyle="systemOrange" lineLimit={3}>
              Conversion sends the source content, request headers, and advanced parameters you enter to Script-Hub beta. Avoid entering sensitive credentials.
            </Text>
          </Section>

          <DisclosureGroup
            title="Source"
            isExpanded={sourceSettingsExpanded}
            onChanged={(expanded: boolean) => {
              hideKeyboard()
              setSourceSettingsExpanded(expanded)
            }}
          >
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              Enter a directly accessible HTTPS file URL for a remote source. To use text from a conversion, paste the raw output into Local Text. Use the generated link to avoid copying an unencoded conversion URL from the address bar.
            </Text>
            <Picker
              title="Input Method"
              pickerStyle="segmented"
              value={inputMode === "remote-url" ? 0 : 1}
              onChanged={(idx: number) => {
                hideKeyboard()
                const next: InputMode = idx === 1 ? "local-text" : "remote-url"
                setInputMode(next)
                setDetectedReason("")
                setNativeCategory("")
                if (!categoryCustomized) setCustomCategory("")
                setSourceFormatAuto(true)
                if (!moduleName.trim()) {
                  setModuleName(next === "local-text" ? sourceNameFromText(localText) : deriveModuleNameFromSource(sourceURL))
                }
              }}
            >
              <Text tag={0}>Source URL</Text>
              <Text tag={1}>Local Text</Text>
            </Picker>
            {inputMode === "remote-url" ? (
              <TextField
                label={<Text>HTTPS Source URL</Text>}
                value={sourceURL}
                onChanged={(value: string) => {
                  setSourceURL(value)
                  setDetectedReason("")
                  setNativeCategory("")
                  if (!categoryCustomized) setCustomCategory("")
                  if (!moduleName.trim()) setModuleName(deriveModuleNameFromSource(value))
                  if (sourceFormatAuto) {
                   const detection = detectScriptHubSourceFormat(value)
                   setSourceFormat(detection.sourceFormat)
                   const nextTarget = suggestedScriptHubTargetFormat(detection.sourceFormat, targetFormat)
                    const nextTargets = platformTargets(detection.sourceFormat, platform)
                    if (nextTargets.some((item) => item.value === nextTarget)) setTargetFormat(nextTarget)
                    else setTargetFormat(defaultPlatformTarget(detection.sourceFormat, platform))
                 }
                }}
                prompt="https://raw.githubusercontent.com/..."
                axis="vertical"
                lineLimit={{ min: 2, max: 4 }}
              />
            ) : (
              <TextField
                label={<Text>Local Text</Text>}
                value={localText}
                onChanged={(value: string) => {
                  setLocalText(value)
                  setDetectedReason("")
                  setNativeCategory("")
                  if (!categoryCustomized) setCustomCategory("")
                  if (!moduleName.trim()) setModuleName(sourceNameFromText(value))
                  if (sourceFormatAuto) {
                   const detection = detectScriptHubSourceFormat("local.txt", value)
                   setSourceFormat(detection.sourceFormat)
                   const nextTarget = suggestedScriptHubTargetFormat(detection.sourceFormat, targetFormat)
                    const nextTargets = platformTargets(detection.sourceFormat, platform)
                    if (nextTargets.some((item) => item.value === nextTarget)) setTargetFormat(nextTarget)
                    else setTargetFormat(defaultPlatformTarget(detection.sourceFormat, platform))
                 }
                }}
                prompt="Paste a rewrite, module, plugin, or rule set"
                axis="vertical"
                lineLimit={{ min: 6, max: 14 }}
              />
            )}
            <ActionButton
              title={busy ? "Working…" : "Detect Source Format"}
              systemImage="wand.and.stars"
              tint="systemBlue"
              disabled={busy || !hasSource}
              onPress={detectFormat}
            />
            {detectedReason ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>{detectedReason}</Text> : null}
          </DisclosureGroup>

          <DisclosureGroup
            title="Format and Target"
            isExpanded={formatExpanded}
            onChanged={(expanded: boolean) => {
              hideKeyboard()
              setFormatExpanded(expanded)
            }}
          >
           <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              Choose the proxy client you want to use. The target format and quick actions update to match. The source format determines how the input is parsed, and you can set it manually if detection fails.
           </Text>
            <Picker
              title="Target Platform"
              pickerStyle="menu"
              value={Math.max(0, SCRIPT_HUB_PLATFORMS.findIndex((item) => item.value === platform))}
              onChanged={(idx: number) => {
                hideKeyboard()
                const nextPlatform = SCRIPT_HUB_PLATFORMS[idx]?.value ?? "surge"
                setPlatform(nextPlatform)
                setTargetFormat(defaultPlatformTarget(sourceFormat, nextPlatform))
                setClientExpanded(false)
              }}
            >
              {SCRIPT_HUB_PLATFORMS.map((item, idx) => <Text key={item.value} tag={idx}>{item.label}</Text>)}
            </Picker>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              {selectedPlatform.summary + ". Changing the platform also updates the target format, file extension, and quick import method."}
            </Text>
           <Picker
             title={sourceFormatAuto ? "Source Format (Automatic)" : "Source Format (Manual)"}
              pickerStyle="menu"
              value={Math.max(0, SCRIPT_HUB_SOURCE_FORMATS.findIndex((item) => item.value === sourceFormat))}
              onChanged={(idx: number) => {
                const next = SCRIPT_HUB_SOURCE_FORMATS[idx]?.value ?? "qx-rewrite"
               setSourceFormat(next)
               setSourceFormatAuto(false)
                const options = platformTargets(next, platform)
               if (!options.some((item) => item.value === targetFormat)) {
                  setTargetFormat(defaultPlatformTarget(next, platform))
               }
              }}
            >
              {SCRIPT_HUB_SOURCE_FORMATS.map((item, idx) => <Text key={item.value} tag={idx}>{item.label}</Text>)}
            </Picker>
            <HStack spacing={8}>
              <Image
                systemName={sourceFormatAuto ? "wand.and.stars" : "hand.point.up.left.fill"}
                font={14}
                foregroundStyle={sourceFormatAuto ? "systemBlue" : "systemOrange"}
              />
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {sourceFormatAuto ? "Detects the format again when the input changes" : "Uses the format you selected regardless of the file extension"}
              </Text>
              <Spacer />
              <Button
                title="Restore Automatic Detection"
                systemImage="arrow.counterclockwise"
                buttonStyle="borderless"
                tint="systemBlue"
                disabled={busy || !hasSource || sourceFormatAuto}
                action={() => { void detectFormat() }}
              />
            </HStack>
            <Text
              font="caption"
              foregroundStyle={sourceFormat === "qx-script" ? "systemBlue" : "secondaryLabel"}
              lineLimit={3}
            >
             {sourceFormat === "qx-script"
               ? "This source is a script. Script-Hub converts it to a Surge / Egern module by default. Choose Surge Script if it needs to run independently."
               : sourceFormat === "qx-rewrite"
                 ? "This source is a Quantumult X rewrite and can usually be converted directly to a Surge / Egern module."
                  : "The target platform determines the default output format. You can also choose any format that the selected platform supports."}
           </Text>
           <Picker
              title="Output Format"
             pickerStyle="menu"
             value={targetIndex}
             onChanged={(idx: number) => {
               const next = targetOptions[idx]?.value ?? "surge-module"
               setTargetFormat(next)
             }}
           >
              {targetOptions.map((item, idx) => <Text key={item.value} tag={idx}>{targetLabelForPlatform(platform, sourceFormat, item.value)}</Text>)}
           </Picker>
            <Text font="caption" foregroundStyle={targetCanQuickImport || targetCanWriteToSurge ? "secondaryLabel" : "systemOrange"} lineLimit={4}>
              {platform === "quantumult-x"
                ? "QX uses add-resource links for remote resources. Direct import is available for QX rewrites, rule sets, and plain text sources."
                : platform === "loon"
                  ? "Loon uses loon://import for plugins and rule sets. For unsupported sources, the conversion result is copied."
                  : platform === "egern"
                    ? "Egern uses the egern:/ URL scheme for Surge-compatible modules and rule sets."
                    : platform === "shadowrocket"
                      ? "Shadowrocket imports modules through shadowrocket://install. Copy the converted rule set when a direct import link is unavailable."
                    : platform === "scripting"
                      ? "Scripting's native module import supports .sgmodule and .plugin. Choose the output format for Surge or Loon."
                    : "Surge modules can be written to the authorized directory or installed remotely through a surge:///install-module link."}
            </Text>
           <HStack>
             <Text>Conversion Engine</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">Script-Hub Beta</Text>
            </HStack>
            <DisclosureGroup
              title="How to Choose a Format"
              isExpanded={typeGuideExpanded}
              onChanged={(expanded: boolean) => setTypeGuideExpanded(expanded)}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={6}>
                Choose the source format that matches the original syntax: QX rewrite, Surge module, Loon plugin, rule set, QX-specific script, or plain text. Choose the target format for the client you use. Surge / Egern Module is the usual choice for plugins or modules.
              </Text>
              <Text font="caption" foregroundStyle="systemOrange" lineLimit={4}>
                QX-specific scripts convert to Surge / Egern modules by default. Choose Surge Script (Compatible) only if the script needs to run independently.
              </Text>
            </DisclosureGroup>
          </DisclosureGroup>

          <DisclosureGroup
            title="Output Settings"
            isExpanded={outputExpanded}
            onChanged={(expanded: boolean) => {
              hideKeyboard()
              setOutputExpanded(expanded)
            }}
          >
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              Set the conversion result's name, filename, category, and module metadata. Leave fields blank to use source values. The output format determines the file extension.
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              These values become Script-Hub conversion parameters. After conversion, the name and category also appear in the local Surge module list.
            </Text>
            <TextField
              label={<Text>Module Name</Text>}
              value={moduleName}
              onChanged={setModuleName}
              prompt="Optional. Defaults to the source filename or local text."
            />
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              The module name appears in the output metadata and local list. Leave this blank to use the source name.
            </Text>
            <TextField
              label={<Text>Description</Text>}
              value={advanced.description}
              onChanged={(value: string) => updateAdvanced("description", value)}
              prompt="Optional. Sets the Script-Hub n parameter."
            />
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              Sets the description in the conversion result. Rules and script content are preserved.
            </Text>
            <TextField
              label={<Text>Output Filename</Text>}
              value={advanced.filename}
              onChanged={(value: string) => updateAdvanced("filename", value)}
              prompt="Optional. Enter a name without an extension or leave it blank."
            />
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              Enter a filename without its extension. The selected format adds .sgmodule, .plugin, .list, or another extension automatically.
            </Text>
            <Picker
              title="Category"
              pickerStyle="menu"
              value={Math.min(categoryIdx, Math.max(0, categoryOptions.length - 1))}
              onChanged={(idx: number) => {
                setCategoryIdx(idx)
                setCustomCategory("")
                setCategoryCustomized(true)
              }}
            >
              {categoryOptions.map((item, idx) => <Text key={`${item}-${idx}`} tag={idx}>{item}</Text>)}
            </Picker>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              The default import category is 插件 (Plugins). When the source already has a category, that category takes precedence. Selecting or entering a category manually overrides the default.
            </Text>
            <TextField
              label={<Text>Custom Category</Text>}
              value={customCategory}
              onChanged={(value: string) => {
                setCustomCategory(value)
                setCategoryCustomized(true)
              }}
              prompt="Defaults to 插件 (Plugins) unless the source has a category"
            />
            <TextField
              label={<Text>Source User-Agent</Text>}
              value={sourceUserAgent}
              onChanged={setSourceUserAgent}
              prompt="Optional, e.g. Example/1.0"
            />
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              Used only to read sources that require a specific client identifier.
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              These switches control metadata and compatibility options in the conversion URL. The defaults are suitable for most conversions.
            </Text>
            <Toggle
              title="Include Original Source in Module"
              value={keepOriginalLink}
              onChanged={setKeepOriginalLink}
              disabled={inputMode !== "remote-url" || !sourceURL.trim()}
            />
            <Toggle title="Remove Source Format Metadata" value={removeSourceMetadata} onChanged={setRemoveSourceMetadata} />
            <Toggle title="Enable jq Compatibility" value={enableJQ} onChanged={setEnableJQ} />
          </DisclosureGroup>

          <Section header={<Text>Quick Actions</Text>}>
            <HStack spacing={10} padding={{ top: 4, bottom: 4 }}>
              <Image
                systemName={hasSource ? "checkmark.circle.fill" : "circle.dashed"}
                font={28}
                foregroundStyle={hasSource ? "systemGreen" : "secondaryLabel"}
              />
              <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="headline">{hasSource ? "Ready to Convert" : "Waiting for Source Content"}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
                  {hasSource
                    ? `${scriptHubSourceFormatLabel(sourceFormat)} → ${targetLabelForPlatform(platform, sourceFormat, targetFormat)} · ${outputFilename}`
                    : "Enter a source URL or paste local text, then choose the target platform."}
                </Text>
              </VStack>
            </HStack>
            <ActionButton
              title={primaryActionTitle}
              systemImage={primaryActionImage}
              tint="systemGreen"
              disabled={busy || !conversionResult.url}
              onPress={performPrimaryAction}
            />
            {!conversionResult.url && hasSource ? (
              <Text font="caption" foregroundStyle="systemOrange" lineLimit={3}>
                {conversionResult.error || "Could not generate a conversion link for this source. Check the format and URL."}
              </Text>
            ) : null}
          </Section>

          <DisclosureGroup
            title="Advanced Conversion Parameters"
            isExpanded={advancedExpanded}
            onChanged={(expanded: boolean) => {
              hideKeyboard()
              setAdvancedExpanded(expanded)
            }}
          >
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
              These parameters match Script-Hub beta. Use the defaults if you are unsure.
            </Text>
            <TextField
              label={<Text>Custom Request Headers</Text>}
              value={advanced.headers}
              onChanged={(value: string) => updateAdvanced("headers", value)}
              prompt="One Header: value per line. Overrides User-Agent."
              axis="vertical"
              lineLimit={{ min: 2, max: 5 }}
            />
            <TextField label={<Text>Icon URL</Text>} value={advanced.icon} onChanged={(value: string) => updateAdvanced("icon", value)} prompt="Optional" />

            <DisclosureGroup
              title="Rewrite and Rule Filters"
              isExpanded={advancedSections.rewrite}
              onChanged={(expanded: boolean) => updateAdvancedSection("rewrite", expanded)}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                Filter rewrites or rules by keyword and modify request headers as needed.
              </Text>
              <TextField label={<Text>Include Rewrites Matching</Text>} value={advanced.keepRewrite} onChanged={(value: string) => updateAdvanced("keepRewrite", value)} prompt="Separate keywords with +" />
              <TextField label={<Text>Exclude Rewrites Matching</Text>} value={advanced.excludeRewrite} onChanged={(value: string) => updateAdvanced("excludeRewrite", value)} prompt="Separate keywords with +" />
              <TextField label={<Text>Include Rules Matching</Text>} value={advanced.keepRule} onChanged={(value: string) => updateAdvanced("keepRule", value)} prompt="Applies to rule set sources" />
              <TextField label={<Text>Exclude Rules Matching</Text>} value={advanced.excludeRule} onChanged={(value: string) => updateAdvanced("excludeRule", value)} prompt="Applies to rule set sources" />
              <TextField label={<Text>Request Headers to Add</Text>} value={advanced.headerAdd} onChanged={(value: string) => updateAdvanced("headerAdd", value)} axis="vertical" lineLimit={{ min: 2, max: 4 }} />
              <TextField label={<Text>Request Headers to Remove</Text>} value={advanced.headerDelete} onChanged={(value: string) => updateAdvanced("headerDelete", value)} axis="vertical" lineLimit={{ min: 2, max: 4 }} />
              <TextField label={<Text>Remove Request Headers by Regex</Text>} value={advanced.headerRegexDelete} onChanged={(value: string) => updateAdvanced("headerRegexDelete", value)} axis="vertical" lineLimit={{ min: 2, max: 4 }} />
              <Toggle title="Keep Original Headers" value={advanced.keepHeader} onChanged={(value: boolean) => updateAdvanced("keepHeader", value)} />
              <Toggle title="Enable jsDelivr Compatibility" value={advanced.jsDelivr} onChanged={(value: boolean) => updateAdvanced("jsDelivr", value)} />
            </DisclosureGroup>

            <DisclosureGroup
              title="Script Conversion and Compatibility"
              isExpanded={advancedSections.script}
              onChanged={(expanded: boolean) => updateAdvancedSection("script", expanded)}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                Use these options for sources that contain scripts. The conversion does not simulate features unsupported by the target.
              </Text>
              <TextField label={<Text>Script Conversion 1 Keywords</Text>} value={advanced.scriptTransform} onChanged={(value: string) => updateAdvanced("scriptTransform", value)} prompt="Separate keywords with +" />
              <Toggle title="Script Conversion 1 (Convert All)" value={advanced.scriptTransformAll} onChanged={(value: boolean) => updateAdvanced("scriptTransformAll", value)} />
              <TextField label={<Text>Script Conversion 2 Keywords</Text>} value={advanced.scriptTransform2} onChanged={(value: string) => updateAdvanced("scriptTransform2", value)} prompt="Separate keywords with +" />
              <Toggle title="Script Conversion 2 (Convert All)" value={advanced.scriptTransform2All} onChanged={(value: boolean) => updateAdvanced("scriptTransform2All", value)} />
              <Toggle title="Apply Compatibility Changes Only" value={advanced.compatibilityOnly} onChanged={(value: boolean) => updateAdvanced("compatibilityOnly", value)} />
              <TextField label={<Text>Code to Prepend to Scripts</Text>} value={advanced.prepend} onChanged={(value: string) => updateAdvanced("prepend", value)} axis="vertical" lineLimit={{ min: 3, max: 8 }} />
              <TextField label={<Text>Process Original Content (Code)</Text>} value={advanced.evalJSOriginal} onChanged={(value: string) => updateAdvanced("evalJSOriginal", value)} axis="vertical" lineLimit={{ min: 3, max: 8 }} />
              <TextField label={<Text>Process Converted Content (Code)</Text>} value={advanced.evalJSModified} onChanged={(value: string) => updateAdvanced("evalJSModified", value)} axis="vertical" lineLimit={{ min: 3, max: 8 }} />
              <TextField label={<Text>Process Original Content (URL)</Text>} value={advanced.evalURLOriginal} onChanged={(value: string) => updateAdvanced("evalURLOriginal", value)} prompt="Optional URL" />
              <TextField label={<Text>Process Converted Content (URL)</Text>} value={advanced.evalURLModified} onChanged={(value: string) => updateAdvanced("evalURLModified", value)} prompt="Optional URL" />
              <TextField label={<Text>Process Original Script (Code)</Text>} value={advanced.evalScriptOriginal} onChanged={(value: string) => updateAdvanced("evalScriptOriginal", value)} axis="vertical" lineLimit={{ min: 3, max: 8 }} />
              <TextField label={<Text>Process Converted Script (Code)</Text>} value={advanced.evalScriptModified} onChanged={(value: string) => updateAdvanced("evalScriptModified", value)} axis="vertical" lineLimit={{ min: 3, max: 8 }} />
              <TextField label={<Text>Process Original Script (URL)</Text>} value={advanced.evalURLJSOriginal} onChanged={(value: string) => updateAdvanced("evalURLJSOriginal", value)} prompt="Optional URL" />
              <TextField label={<Text>Process Converted Script (URL)</Text>} value={advanced.evalURLJSModified} onChanged={(value: string) => updateAdvanced("evalURLJSModified", value)} prompt="Optional URL" />
            </DisclosureGroup>

            <DisclosureGroup
              title="Scheduled Tasks and Script Parameters"
              isExpanded={advancedSections.schedule}
              onChanged={(expanded: boolean) => updateAdvancedSection("schedule", expanded)}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                Configure cron, script names, timeouts, engines, and panel parameters.
              </Text>
              <TextField label={<Text>Task Type</Text>} value={advanced.cron} onChanged={(value: string) => updateAdvanced("cron", value)} prompt="For example, cron" />
              <TextField label={<Text>Schedule Expression</Text>} value={advanced.cronExpression} onChanged={(value: string) => updateAdvanced("cronExpression", value)} prompt="Cron expression" />
              <TextField label={<Text>Script Name Keywords</Text>} value={advanced.scriptName} onChanged={(value: string) => updateAdvanced("scriptName", value)} />
              <TextField label={<Text>New Script Name</Text>} value={advanced.scriptTarget} onChanged={(value: string) => updateAdvanced("scriptTarget", value)} />
              <TextField label={<Text>Timeout Match</Text>} value={advanced.timeoutTarget} onChanged={(value: string) => updateAdvanced("timeoutTarget", value)} />
              <TextField label={<Text>Timeout in Seconds</Text>} value={advanced.timeoutValue} onChanged={(value: string) => updateAdvanced("timeoutValue", value)} />
              <TextField label={<Text>Script Engine Match</Text>} value={advanced.engineTarget} onChanged={(value: string) => updateAdvanced("engineTarget", value)} />
              <TextField label={<Text>Script Engine</Text>} value={advanced.engineValue} onChanged={(value: string) => updateAdvanced("engineValue", value)} />
              <TextField label={<Text>Policy</Text>} value={advanced.policy} onChanged={(value: string) => updateAdvanced("policy", value)} />
              <TextField label={<Text>Parameter Name</Text>} value={advanced.arg} onChanged={(value: string) => updateAdvanced("arg", value)} />
              <TextField label={<Text>Parameter Value</Text>} value={advanced.argv} onChanged={(value: string) => updateAdvanced("argv", value)} />
              <TextField label={<Text>Panel Title</Text>} value={advanced.tiles} onChanged={(value: string) => updateAdvanced("tiles", value)} />
              <TextField label={<Text>Panel Color</Text>} value={advanced.tileColor} onChanged={(value: string) => updateAdvanced("tileColor", value)} prompt="Hex or color value" />
            </DisclosureGroup>

            <DisclosureGroup
              title="Rule Runtime Options"
              isExpanded={advancedSections.runtime}
              onChanged={(expanded: boolean) => updateAdvancedSection("runtime", expanded)}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                Control caching, parsing, MITM, notifications, and response handling.
              </Text>
              <TextField label={<Text>Cache Duration</Text>} value={advanced.cacheExpiry} onChanged={(value: string) => updateAdvanced("cacheExpiry", value)} prompt="cachexp" />
              <Toggle title="Disable Cache" value={advanced.noCache} onChanged={(value: boolean) => updateAdvanced("noCache", value)} />
              <Toggle title="Disable Rule Parsing" value={advanced.noResolve} onChanged={(value: boolean) => updateAdvanced("noResolve", value)} />
              <Toggle title="Sync MITM" value={advanced.syncMitm} onChanged={(value: boolean) => updateAdvanced("syncMitm", value)} />
              <Toggle title="Disable Conversion Notifications" value={advanced.noNotification} onChanged={(value: boolean) => updateAdvanced("noNotification", value)} />
              <Toggle title="Wrap Response Content" value={advanced.wrapResponse} onChanged={(value: boolean) => updateAdvanced("wrapResponse", value)} />
              <TextField label={<Text>SNI</Text>} value={advanced.sni} onChanged={(value: string) => updateAdvanced("sni", value)} />
              <TextField label={<Text>Pre-match</Text>} value={advanced.preMatching} onChanged={(value: string) => updateAdvanced("preMatching", value)} />
            </DisclosureGroup>
          </DisclosureGroup>

          <Section header={<Text>Conversion Result</Text>}>
            <HStack spacing={8}>
              <Image
                systemName={conversionResult.url ? "checkmark.circle.fill" : "info.circle"}
                font={16}
                foregroundStyle={conversionResult.url ? "systemGreen" : "secondaryLabel"}
              />
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {conversionResult.url ? "The conversion link updates as you change the options" : "A conversion link will appear here when you enter a source"}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle={targetCanWriteToSurge ? "systemGreen" : targetCanQuickImport ? "systemBlue" : "systemOrange"}>
                {targetCanWriteToSurge ? "Can Write" : targetCanQuickImport ? "Can Import" : "Copy Required"}
              </Text>
            </HStack>
            <VStack
              alignment="leading"
              spacing={4}
              padding={{ top: 8, bottom: 8, leading: 10, trailing: 10 }}
            >
            {conversionResult.error ? (
              <Text foregroundStyle="systemRed" lineLimit={4}>{conversionResult.error}</Text>
            ) : (
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={5}>
                {conversionResult.url || "Enter a source URL to generate the conversion link"}
              </Text>
            )}
            </VStack>
            <Divider />
            <HStack spacing={8}>
              <ActionButton
                title="Open Result"
                systemImage="safari"
                tint="systemBlue"
                disabled={busy || !conversionResult.url}
                onPress={openResult}
              />
              <ActionButton
                title="Preview Result"
                systemImage="doc.text.magnifyingglass"
                tint="systemPurple"
                disabled={busy || !conversionResult.url}
                onPress={openPreview}
              />
            </HStack>
            <HStack spacing={8}>
              <ActionButton
                title="Copy Conversion Link"
                systemImage="doc.on.doc"
                tint="systemOrange"
                disabled={busy || !conversionResult.url}
                onPress={copyConversionURL}
              />
              <ActionButton
                title={targetCanWriteToSurge ? "Write Again" : targetCanQuickImport ? "Import Result" : "Copy Result"}
                systemImage={targetCanWriteToSurge ? "arrow.down.doc.fill" : targetCanQuickImport ? "arrow.up.forward.app" : "doc.on.clipboard"}
                tint="systemGreen"
                disabled={busy || !conversionResult.url}
                onPress={performPrimaryAction}
              />
            </HStack>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
              {scriptHubSourceFormatLabel(sourceFormat)} → {targetLabelForPlatform(platform, sourceFormat, targetFormat)}
            </Text>
            {busy ? <ProgressView progressViewStyle="circular" /> : null}
            {status ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>{status}</Text> : null}
            <Menu
              label={(
                <HStack spacing={6} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "center" }}>
                  <Image systemName="arrow.up.forward.app" font={15} foregroundStyle="systemBlue" />
                  <Text foregroundStyle="systemBlue">More Import and Copy Options</Text>
                </HStack>
              )}
              disabled={busy || !conversionResult.url}
              buttonStyle="bordered"
              tint="systemBlue"
              frame={{ maxWidth: "infinity", minHeight: 40 }}
            >
              <Button
                title={targetCanQuickImport ? "Import into " + selectedPlatform.label : "Copy " + selectedPlatform.label + " Result"}
                systemImage={targetCanQuickImport ? "arrow.down.circle" : "doc.on.clipboard"}
                action={() => { void performPrimaryAction() }}
              />
              {targetFormat === "surge-module" ? <>
                <Button title="Import into Surge (Remote Module)" systemImage="arrow.down.circle" action={() => { void openClientImport("surge") }} />
                <Button title="Import Egern Module" systemImage="arrow.down.circle" action={() => { void openClientImport("egern") }} />
              </> : null}
              {(platform === "quantumult-x" || platform === "loon") ? (
                <Button title="Import into Quantumult X / Loon" systemImage="arrow.down.circle" disabled={!targetCanQuickImport} action={() => { void openClientImport("target") }} />
              ) : null}
              <Button title="Import into Scriptable" systemImage="square.and.arrow.down" action={() => { void openClientImport("scriptable") }} />
              <Button title="Import into Scripting (Local Module)" systemImage="square.and.arrow.down" disabled={!scriptingScriptName.trim()} action={() => { void openClientImport("scripting") }} />
              <Button title="Copy Original Source" systemImage="doc.on.clipboard" action={() => { void copySource() }} />
              <Button title="Copy Conversion Link" systemImage="doc.on.doc" action={() => { void copyConversionURL() }} />
            </Menu>
          </Section>

          {conversionResult.url && targetFormat === "surge-module" && platform !== "scripting" ? (
            <DisclosureGroup
              title="Client Import Settings"
              isExpanded={clientExpanded}
              onChanged={(expanded: boolean) => {
                hideKeyboard()
                setClientExpanded(expanded)
              }}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
                These buttons open the corresponding client. Script-Hub beta supplies the conversion result. The script name below applies only to the legacy script bridge. Native Scripting module import works without it.
              </Text>
              <TextField label={<Text>Scripting Script Name</Text>} value={scriptingScriptName} onChanged={setScriptingScriptName} prompt="Enter the name shown in Scripting" />
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
                Before importing through Scripting for the first time, authorize the iCloud/Surge configuration directory in the target script's settings. The module is written directly to that directory.
              </Text>
            </DisclosureGroup>
          ) : null}

          {conversionResult.url && targetFormat !== "surge-module" ? (
            <Section header={<Text>Target Client</Text>}>
              <ActionButton
                title={targetCanQuickImport ? "Open " + targetLabelForPlatform(platform, sourceFormat, targetFormat) + " Import Link" : "Copy Result"}
                systemImage={targetCanQuickImport ? "arrow.up.forward.app" : "doc.on.clipboard"}
                tint="systemBlue"
                onPress={() => performPrimaryAction()}
              />
              {!targetCanQuickImport ? (
                <Text font="caption" foregroundStyle="systemOrange" lineLimit={3}>
                  This source cannot be imported directly into the selected platform. Change the source or output format, or copy the conversion link and import it manually.
                </Text>
              ) : null}
            </Section>
          ) : null}
        </Form>
      </VStack>
    </NavigationStack>
  )
}
