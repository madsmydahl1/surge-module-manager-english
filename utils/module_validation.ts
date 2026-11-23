export function validateSurgeModuleText(rawText: string): string {
  const content = String(rawText ?? "")
  if (!content.trim()) throw new Error("The downloaded content is empty")
  if (content.length > 2 * 1024 * 1024) throw new Error("The module exceeds the 2 MiB limit")

  // A module may consist only of metadata, but an HTML error/login page must
  // never replace a local .sgmodule file during refresh or deep-link import.
  const hasMetadata = /^\s*#!\s*(name|desc|category|icon)\s*=/im.test(content)
  const hasSection = /^\s*\[(General|Rule|Rule Set|URL Rewrite|Header Rewrite|Body Rewrite|Map Local|Script|MITM|Host|Proxy)\]\s*$/im.test(content)
  if (!hasMetadata && !hasSection) {
    throw new Error("The downloaded content is not a recognized Surge module")
  }
  return content
}
