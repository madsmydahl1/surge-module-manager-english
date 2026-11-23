import { normalizeSourceURL } from "./source_fetcher"

// Keep the existing UI import path stable while the shared fetch layer remains
// the single implementation of URL validation.
export { normalizeSourceURL } from "./source_fetcher"

/** Values accepted by Script-Hub's `type` query parameter for remote input. */
export type ScriptHubSourceFormat =
  | "qx-rewrite"
  | "surge-module"
  | "loon-plugin"
  | "rule-set"
  | "qx-script"
  | "plain-text"

/** Target values exposed by Script-Hub's conversion UI. */
export type ScriptHubTargetFormat =
  | "surge-module"
  | "stash-stoverride"
  | "shadowrocket-module"
  | "loon-plugin"
  | "loon-rule-set"
  | "shadowrocket-rule-set"
  | "surge-rule-set"
  | "surge-domain-set"
  | "surge-domain-set2"
  | "stash-rule-set"
  | "stash-domain-set"
  | "stash-domain-set2"
  | "surge-script"
  | "plain-text"

export type ScriptHubFormatDetection = {
  sourceFormat: ScriptHubSourceFormat
  suggestedTargetFormat?: ScriptHubTargetFormat
  confidence: "high" | "medium" | "low"
  reason: string
}

export type ScriptHubFormatOption<T extends string> = {
  value: T
  label: string
  suffix: string
}

export const SCRIPT_HUB_SOURCE_FORMATS: ScriptHubFormatOption<ScriptHubSourceFormat>[] = [
  { value: "qx-rewrite", label: "QX Rewrite", suffix: ".sgmodule" },
  { value: "surge-module", label: "Surge Module", suffix: ".sgmodule" },
  { value: "loon-plugin", label: "Loon Plugin", suffix: ".plugin" },
  { value: "rule-set", label: "Rule Set", suffix: ".list" },
  { value: "qx-script", label: "QX-Specific Script", suffix: ".js" },
  { value: "plain-text", label: "Plain Text", suffix: ".txt" },
]

export const SCRIPT_HUB_TARGET_FORMATS: ScriptHubFormatOption<ScriptHubTargetFormat>[] = [
  { value: "surge-module", label: "Surge / Egern Module", suffix: ".sgmodule" },
  { value: "stash-stoverride", label: "Stash Override", suffix: ".stoverride" },
  { value: "shadowrocket-module", label: "Shadowrocket Module", suffix: ".sgmodule" },
  { value: "loon-plugin", label: "Loon Plugin", suffix: ".plugin" },
  { value: "loon-rule-set", label: "Rule Set (Loon)", suffix: ".list" },
  { value: "shadowrocket-rule-set", label: "Rule Set (Shadowrocket)", suffix: ".list" },
  { value: "surge-rule-set", label: "Rule Set (Surge)", suffix: ".list" },
  { value: "surge-domain-set", label: "Domain Set (Surge)", suffix: ".list" },
  { value: "surge-domain-set2", label: "Remaining Rule Set (Surge)", suffix: ".list" },
  { value: "stash-rule-set", label: "Rule Set (Stash)", suffix: ".list" },
  { value: "stash-domain-set", label: "Domain Set (Stash)", suffix: ".list" },
  { value: "stash-domain-set2", label: "Remaining Rule Set (Stash)", suffix: ".list" },
  { value: "surge-script", label: "Surge Script (Compatible)", suffix: ".js" },
  { value: "plain-text", label: "Plain Text", suffix: "" },
]

export function scriptHubSourceFormatLabel(value: ScriptHubSourceFormat): string {
  return SCRIPT_HUB_SOURCE_FORMATS.find((item) => item.value === value)?.label ?? value
}

export function scriptHubTargetFormatLabel(value: ScriptHubTargetFormat): string {
  return SCRIPT_HUB_TARGET_FORMATS.find((item) => item.value === value)?.label ?? value
}

export function scriptHubTargetSuffix(value: ScriptHubTargetFormat): string {
  return SCRIPT_HUB_TARGET_FORMATS.find((item) => item.value === value)?.suffix ?? ".txt"
}

export function scriptHubTargetPath(value: ScriptHubTargetFormat): "file" | "convert" {
  return value === "plain-text" || value.endsWith("-script") ? "convert" : "file"
}

function sourceFormatFromPath(value: unknown): ScriptHubSourceFormat {
  const raw = String(value ?? "").split(/[?#]/, 1)[0].toLowerCase()
  if (/\.(?:plugin|lpx)$/.test(raw)) return "loon-plugin"
  if (/\.(?:list|rules?)$/.test(raw)) return "rule-set"
  // `.snippet` is commonly used by Quantumult X rewrite collections, while a
  // standalone `.js` is the script source convention used by Script-Hub.
  // Content detection below still wins when a file exposes an explicit
  // module/rewrite section.
  if (/\.script$/.test(raw)) return "qx-script"
  if (/\.js$/.test(raw)) return "qx-script"
  if (/\.(?:sgmodule|sgmodulle)$/.test(raw)) return "surge-module"
  if (/\.conf$/.test(raw)) return "qx-rewrite"
  // QX community rewrite collections commonly use `.snippet`; it is a
  // rewrite source, not a generic text file.  A standalone `.js` is handled
  // as a script below when its content does not expose rewrite sections.
  if (/\.snippet$/.test(raw)) return "qx-rewrite"
  return "loon-plugin"
}

function normalizedSourceContent(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, 512 * 1024)
}

export function scriptHubSourceCategory(value: unknown): string {
  const match = String(value ?? "").match(/^\s*#!\s*category\s*=\s*(.+?)\s*$/im)
  return String(match?.[1] ?? "").trim().slice(0, 64)
}

function hasSection(content: string, names: string): boolean {
  return new RegExp(`^\\s*\\[(?:${names})\\]\\s*$`, "im").test(content)
}

function looksLikeRuleSet(content: string): boolean {
  return content.split("\n").some((line) => {
    const value = line.trim()
    if (!value || value.startsWith("#") || value.startsWith("//")) return false
    return /^(?:DOMAIN(?:-SUFFIX|-KEYWORD)?|IP-CIDR6?|GEOIP|USER-AGENT|URL-REGEX|HOST(?:-SUFFIX|-KEYWORD)?|PROCESS-NAME|FINAL|MATCH|AND|OR|NOT),/i.test(value)
  })
}

function looksLikeSurgeModule(content: string): boolean {
  const hasSurgeSection = hasSection(
    content,
    "General|Rule|Rule Set|URL Rewrite|Header Rewrite|Body Rewrite|Map Local",
  )
  const hasSurgeScriptEntry = /\btype\s*=\s*(?:http-request|http-response|cron|event|generic|request|response|websocket|dns)\b/i.test(content)
  const hasSurgeMetadata = /^\s*#!(?:name|desc|category|icon|author|arguments)\s*=/im.test(content)
  return hasSurgeSection || (hasSurgeMetadata && hasSurgeScriptEntry)
}

function looksLikeLoonPlugin(content: string): boolean {
  const hasLoonScriptEntry = /^\s*(?:http-request|http-response|cron|event|dns|websocket)\b[^\n]*\bscript-path\s*=/im.test(content)
  const hasLoonRewriteEntry = /^\s*(?:http-request|http-response|http-data|request-header|response-header)\b/im.test(content)
  const hasLoonSection = hasSection(content, "Script|Rewrite|MITM|Host|Remote Filter")
  const hasSurgeType = /\btype\s*=\s*(?:http-request|http-response|cron|event|generic|request|response|websocket|dns)\b/i.test(content)
  return !hasSurgeType && (hasLoonScriptEntry || hasLoonRewriteEntry || hasLoonSection && /\bscript-path\s*=/i.test(content))
}

function looksLikeQXRewrite(content: string): boolean {
  const hasQXSection = hasSection(content, "rewrite_local|rewrite_remote|filter_remote")
  const hasSurgeSection = hasSection(content, "General|Rule|Rule Set|URL Rewrite|Header Rewrite|Body Rewrite|Map Local")
  return hasQXSection || (!hasSurgeSection && (
    /\burl\s+(?:reject|reject-200|script-(?:request|response)-(?:body|header)|request-header|response-header|echo|rewrite|307|302)\b/i.test(content)
      || /\b(?:script-(?:request|response)-(?:body|header)|request-header|response-header)\s+/i.test(content)
  ))
}

function looksLikeJavaScript(content: string): boolean {
  return /(?:^|\n)\s*(?:const|let|var|function|class|import|export)\s+[$A-Z_a-z]/m.test(content)
    || /\b(?:module\.exports|require\s*\(|\$request|\$response|\$done|\$task|\$notify)\b/.test(content)
}

/**
 * Detect the actual Script-Hub input type. Filename-only detection is not
 * enough for community repositories. Content signals win over the suffix;
 * when the content is unavailable, `.snippet` is treated as QX rewrite and
 * `.js` is treated as a QX script source.
 */
export function detectScriptHubSourceFormat(
  value: unknown,
  content?: unknown,
): ScriptHubFormatDetection {
  const fallback = sourceFormatFromPath(value)
  const pathWithoutQuery = String(value ?? "").split(/[?#]/, 1)[0].toLowerCase()
  const isQXSnippet = /\.snippet$/.test(pathWithoutQuery)
  const text = normalizedSourceContent(content)

  if (text) {
    if (looksLikeSurgeModule(text)) {
      return { sourceFormat: "surge-module", confidence: "high", reason: "Detected Surge module sections or script parameters" }
    }
    // QX snippet collections often contain DOMAIN/IP rules inside rewrite
    // blocks. Do not let the generic rule-line detector reclassify an
    // explicitly named snippet source as a standalone rule set.
    if (isQXSnippet && (fallback === "qx-rewrite" || looksLikeQXRewrite(text))) {
      return { sourceFormat: "qx-rewrite", confidence: "high", reason: "Detected a .snippet source. Treating it as a Quantumult X rewrite." }
    }
    if (looksLikeLoonPlugin(text)) {
      return { sourceFormat: "loon-plugin", confidence: "high", reason: "Detected Loon plugin script syntax" }
    }
    if (looksLikeQXRewrite(text)) {
      return { sourceFormat: "qx-rewrite", confidence: "high", reason: "Detected Quantumult X rewrite syntax" }
    }
    if (looksLikeRuleSet(text)) {
      return { sourceFormat: "rule-set", confidence: "high", reason: "Detected rule set entries" }
    }
    // A JavaScript-looking source with a `.js`/`.script` path is an explicit
    // script source. Script-Hub can still convert it to a module, so the
    // default target is Surge/Egern module rather than Surge script only.
    if (looksLikeJavaScript(text) && fallback === "qx-script") {
      return {
        sourceFormat: "qx-script",
        suggestedTargetFormat: "surge-module",
        confidence: "medium",
        reason: "Detected a standalone script. Using the source format for scripts that can be converted to Surge modules.",
      }
    }
    if (looksLikeJavaScript(text) && fallback === "qx-rewrite") {
      return {
        sourceFormat: "qx-rewrite",
        suggestedTargetFormat: "surge-module",
        confidence: "medium",
        reason: "Detected a JavaScript rewrite source. Treating it as a QX rewrite with Surge Module as the target.",
      }
    }
    if (/^\s*#!(?:name|desc|category|icon|author)\s*=/im.test(text)) {
      return { sourceFormat: "surge-module", confidence: "medium", reason: "Detected module metadata" }
    }
  }

  if (fallback === "qx-script") {
    return {
      sourceFormat: fallback,
      suggestedTargetFormat: "surge-module",
      confidence: "low",
      reason: "Could not read the contents to confirm the format. Used the script extension and selected Surge Module as the default target.",
    }
  }
  return {
    sourceFormat: fallback,
    confidence: text ? "low" : "medium",
    reason: text ? "Could not detect a format. Using the file extension." : "Used the file extension because the source contents were unread",
  }
}

/** Pick a sensible source type for a marketplace file. */
export function inferScriptHubSourceFormat(value: unknown, content?: unknown): ScriptHubSourceFormat {
  return detectScriptHubSourceFormat(value, content).sourceFormat
}

export function isScriptHubSourceTargetCompatible(
  sourceFormat: ScriptHubSourceFormat,
  targetFormat: ScriptHubTargetFormat,
): boolean {
  if (sourceFormat !== "qx-script") return true
  // Script-Hub can wrap most QX JavaScript sources as a module.  Keep the
  // explicit Surge-script target for scripts that must remain executable, but
  // do not reject the common script-to-module path.
  return targetFormat === "surge-module" || targetFormat === "surge-script"
}

export function suggestedScriptHubTargetFormat(
  sourceFormat: ScriptHubSourceFormat,
  currentTarget: ScriptHubTargetFormat,
): ScriptHubTargetFormat {
  if (sourceFormat !== "qx-script") return currentTarget
  return currentTarget === "surge-script" ? "surge-script" : "surge-module"
}

export type ScriptHubConversionOptions = {
  sourceURL: string
  /** Local text is sent to Script-Hub beta through its documented local.text route. */
  localText?: string
  sourceFormat?: ScriptHubSourceFormat
  targetFormat?: ScriptHubTargetFormat
  moduleName?: string
  /** Script-Hub's filename path component; plain-text may include its suffix. */
  filename?: string
  category?: string
  sourceUserAgent?: string
  headers?: string
  removeSourceMetadata?: boolean
  enableJQ?: boolean
  /** Additional first-party Script-Hub options selected by the UI. */
  extraParams?: Record<string, string | number | boolean | undefined>
}

const SCRIPT_HUB_ORIGIN = "http://script.hub"
const DEFAULT_SOURCE_TYPE: ScriptHubSourceFormat = "loon-plugin"
const DEFAULT_TARGET_TYPE: ScriptHubTargetFormat = "surge-module"

function cleanOneLine(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

export function deriveModuleNameFromSource(value: unknown): string {
  try {
    const raw = String(value ?? "").trim()
    const parsed = raw.startsWith("http://local.text")
      ? new URL(raw)
      : new URL(normalizeSourceURL(raw))
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? ""
    const decoded = decodeURIComponent(last)
      .replace(/\.(?:plugin|lpx|conf|sgmodule|stoverride|module|list|txt|js)$/i, "")
      .trim()
    return cleanOneLine(decoded, 128) || "第三方模块"
  } catch {
    return "第三方模块"
  }
}

export function normalizeModuleName(value: unknown, sourceURL: string): string {
  const fallback = deriveModuleNameFromSource(sourceURL)
  const name = cleanOneLine(value, 128) || fallback
  const safe = name
    .replace(/\.(?:plugin|lpx|conf|sgmodule|stoverride|module|list|txt|js)$/i, "")
    .replace(/[\\/]/g, "-")
    .trim()
  if (!safe || safe === "." || safe === "..") throw new Error("The module name is missing or invalid")
  return safe
}

function encodeSourceRoutePart(sourceURL: string): string {
  // Match Script-Hub's own URL builder. Its parser reads the raw text between
  // `_start_` and `_end_` and then fetches that value directly. In particular,
  // a source query string must stay unencoded or `%3F` becomes part of the
  // fetched path instead of the original query.
  return sourceURL
    .replace(/#.*$/, "")
    .replace(/😂/g, "%F0%9F%98%82")
}

function normalizeScriptHubSourceURL(sourceURL: string): string {
  if (String(sourceURL ?? "").trim() === "http://local.text") return "http://local.text"
  const parts = String(sourceURL ?? "")
    .split("😂")
    .map((item) => item.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error("The source URL is missing")
  return parts.map((item) => normalizeSourceURL(item)).join("😂")
}

function normalizeLocalText(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, 2 * 1024 * 1024)
}

const SCRIPT_HUB_EXTRA_PARAMS = new Set([
  "n",
  "icon",
  "y",
  "x",
  "hnadd",
  "hndel",
  "hnregdel",
  "jsc",
  "jsc2",
  "cron",
  "cronexp",
  "njsname",
  "njsnametarget",
  "timeoutt",
  "timeoutv",
  "enginet",
  "enginev",
  "policy",
  "arg",
  "argv",
  "tiles",
  "tcolor",
  "cachexp",
  "nocache",
  "nore",
  "synMitm",
  "noNtf",
  "wrap_response",
  "compatibilityOnly",
  "evalScriptori",
  "evalScriptmodi",
  "evalUrlori",
  "evalUrlmodi",
  "evJsori",
  "evJsmodi",
  "evUrlori",
  "evUrlmodi",
  "prepend",
  "keepHeader",
  "jsDelivr",
  "sni",
  "pm",
])

function normalizeFilename(
  value: unknown,
  moduleName: unknown,
  sourceURL: string,
  targetFormat: ScriptHubTargetFormat,
): string {
  const explicit = cleanOneLine(value, 160)
  if (explicit) {
    if (targetFormat === "plain-text") return explicit.replace(/[\\/]/g, "-")
    return explicit
      .replace(/\.(?:plugin|lpx|conf|sgmodule|stoverride|module|list|txt|js)$/i, "")
      .replace(/[\\/]/g, "-")
  }
  const fallback = cleanOneLine(moduleName, 160)
    || deriveModuleNameFromSource(sourceURL)
    || `untitled-${Date.now()}`
  return fallback.replace(/[\\/]/g, "-")
}

function normalizeHeaders(value: unknown): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim().slice(0, 512))
    .filter(Boolean)
    .join("\n")
    .slice(0, 8192)
}

function sourceFilenameForPlainText(sourceURL: string): string {
  try {
    const raw = sourceURL.split("😂")[0]
    const parsed = new URL(raw)
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? ""
    return cleanOneLine(decodeURIComponent(last), 160).replace(/[\\/]/g, "-")
  } catch {
    return ""
  }
}

export function buildScriptHubConversionURL(options: ScriptHubConversionOptions): string {
  const localText = normalizeLocalText(options.localText)
  const sourceURL = localText
    ? "http://local.text"
    : normalizeScriptHubSourceURL(options.sourceURL)
  const sourceFormat = options.sourceFormat ?? DEFAULT_SOURCE_TYPE
  const targetFormat = options.targetFormat ?? DEFAULT_TARGET_TYPE
  const filename = normalizeFilename(
    options.filename,
    targetFormat === "plain-text" ? sourceFilenameForPlainText(sourceURL) || options.moduleName : options.moduleName,
    sourceURL,
    targetFormat,
  )
  const removeSourceMetadata = options.removeSourceMetadata !== false
  const enableJQ = options.enableJQ !== false
  const params = [
    `type=${sourceFormat}`,
    `target=${targetFormat}`,
    `del=${removeSourceMetadata ? "true" : "false"}`,
    `jqEnabled=${enableJQ ? "true" : "false"}`,
  ]
  const category = cleanOneLine(options.category, 64)
  if (category) params.push(`category=${encodeURIComponent(category)}`)
  const headers = normalizeHeaders(options.headers)
  const sourceUserAgent = cleanOneLine(options.sourceUserAgent, 256)
  if (headers) {
    params.push(`headers=${encodeURIComponent(headers)}`)
  } else if (sourceUserAgent) {
    params.push(`headers=${encodeURIComponent(`User-Agent: ${sourceUserAgent}`)}`)
  }
  if (localText) params.push(`localtext=${encodeURIComponent(localText)}`)

  const reserved = new Set(["type", "target", "del", "jqEnabled", "headers", "localtext"])
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    const cleanKey = cleanOneLine(key, 64)
    if (!cleanKey || reserved.has(cleanKey) || !SCRIPT_HUB_EXTRA_PARAMS.has(cleanKey) || value === undefined) continue
    // Advanced Script-Hub fields include executable snippets and may contain
    // newlines. Keep their content intact; only remove NUL and cap the value
    // before URL encoding.
    const cleanValue = String(value ?? "")
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 128 * 1024)
    if (!cleanValue) continue
    params.push(`${encodeURIComponent(cleanKey)}=${encodeURIComponent(cleanValue)}`)
  }

  return `${SCRIPT_HUB_ORIGIN}/${scriptHubTargetPath(targetFormat)}/_start_/${encodeSourceRoutePart(sourceURL)}/_end_/${encodeURIComponent(filename)}${scriptHubTargetSuffix(targetFormat)}?${params.join("&")}`
}

export function isScriptHubConversionURL(value: unknown): boolean {
  return /^https?:\/\/script\.hub\/(?:file|convert)\/_start_\/.+\/_end_\//i.test(String(value ?? "").trim())
}
