// File: utils/downloader.tsx
export type DownloadProgress = {
  percent?: number
  received: number
  total?: number
  speedBps?: number
}

declare const BackgroundURLSession: any

const LARGE_FALLBACK_BYTES = 50 * 1024 * 1024
const STALL_TIMEOUT_MS = 2 * 60 * 1000
const HARD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRY = 1

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : ""
}

async function downloadWithFetchFallback(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void
) {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("The fallback download requires fetch, which is unavailable")

  const res = await fetchFn(url)
  if (!res?.ok) throw new Error(`Download failed: ${res?.status ?? "unknown"}`)

  const totalHeader = res.headers?.get?.("content-length")
  const total = totalHeader ? Number(totalHeader) : undefined
  const fm = (globalThis as any).FileManager
  const Data = (globalThis as any).Data
  const reader = res?.body?.getReader?.()
  const canAppend =
    !!reader &&
    (typeof fm?.appendData === "function" || typeof fm?.appendDataSync === "function") &&
    (Data?.fromUint8Array || Data?.fromArrayBuffer)

  if (!canAppend && (!Number.isFinite(total) || (typeof total === "number" && total > LARGE_FALLBACK_BYTES))) {
    throw new Error("Fallback download skipped because the file is too large or its size is unavailable")
  }

  if (fm?.createDirectory) {
    const parent = dirOf(dstPath)
    if (parent) {
      try {
        await fm.createDirectory(parent, true)
      } catch {}
    }
  }

  if (canAppend && reader) {
    await removeFileLoose(dstPath)
    let received = 0
    for (;;) {
      const r = await reader.read()
      if (r?.done) break
      if (!r?.value) continue
      const chunk = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value)
      const data = Data.fromUint8Array ? Data.fromUint8Array(chunk) : Data.fromArrayBuffer(chunk.buffer)
      if (data) {
        if (typeof fm.appendDataSync === "function") fm.appendDataSync(dstPath, data)
        else await fm.appendData(dstPath, data)
      }
      received += chunk.length
      onProgress?.({
        received,
        total: Number.isFinite(total) ? total : undefined,
        percent: Number.isFinite(total) && total && total > 0 ? received / total : undefined,
      })
    }
    onProgress?.({
      received,
      total: Number.isFinite(total) ? total : undefined,
      percent: Number.isFinite(total) && total && total > 0 ? received / total : 1,
    })
    return
  }

  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (typeof fm?.writeAsBytes === "function") {
    await fm.writeAsBytes(dstPath, bytes)
  } else {
    const FileEntity = (globalThis as any).FileEntity
    if (FileEntity?.openNewForWriting && (Data?.fromUint8Array || Data?.fromArrayBuffer)) {
      const file = FileEntity.openNewForWriting(dstPath)
      try {
        const data = Data.fromUint8Array ? Data.fromUint8Array(bytes) : Data.fromArrayBuffer(buf)
        if (data) file.write(data)
      } finally {
        try { file.close() } catch {}
      }
    } else {
      throw new Error("Could not write the file (requires FileManager.writeAsBytes or FileEntity/Data)")
    }
  }

  onProgress?.({
    received: bytes.length,
    total: Number.isFinite(total) ? total : undefined,
    percent: Number.isFinite(total) && total && total > 0 ? bytes.length / total : 1,
  })
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    if (r && typeof r.then === "function") return await r
    return r
  } catch {
    return undefined
  }
}

async function fileExistsLoose(path: string): Promise<boolean | undefined> {
  const fm = (globalThis as any).FileManager
  if (!fm) return undefined
  const fn = fm.exists ?? fm.fileExists ?? fm.existsSync
  if (typeof fn !== "function") return undefined
  const r = await callMaybeAsync(fn, fm, [path])
  return typeof r === "boolean" ? r : undefined
}

async function removeFileLoose(path: string) {
  const fm = (globalThis as any).FileManager
  if (!fm) return
  try {
    if (typeof fm.removeSync === "function") {
      fm.removeSync(path)
      return
    }
    if (typeof fm.remove === "function") {
      await fm.remove(path)
      return
    }
    if (typeof fm.delete === "function") {
      await fm.delete(path)
      return
    }
  } catch {}
}

function cancelTask(task: any) {
  try {
    if (typeof task?.cancel === "function") task.cancel()
  } catch {}
  try {
    if (typeof task?.stop === "function") task.stop()
  } catch {}
  try {
    if (typeof task?.suspend === "function") task.suspend()
  } catch {}
}

async function waitForFile(path: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await fileExistsLoose(path)
    if (ok) return true
    await sleep(200)
  }
  return false
}

async function fetchContentLength(url: string): Promise<number | undefined> {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") return undefined

  // 1) Try HEAD first
  try {
    const res = await fetchFn(url, { method: "HEAD" })
    const len = res?.headers?.get?.("content-length")
    const n = len != null ? Number(len) : NaN
    if (Number.isFinite(n) && n > 0) return n
  } catch {}

  // 2) Fall back to Range (some servers disallow HEAD)
  try {
    const res = await fetchFn(url, { method: "GET", headers: { Range: "bytes=0-0" } })
    const cr = res?.headers?.get?.("content-range") ?? res?.headers?.get?.("Content-Range")
    if (typeof cr === "string") {
      const m = cr.match(/\/(\d+)\s*$/)
      const n = m ? Number(m[1]) : NaN
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {}

  return undefined
}

function num(v: any): number | undefined {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function pickNum(obj: any, keys: string[]): number | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = num(obj[k])
    if (v !== undefined) return v
  }
  return undefined
}

function getFraction(task: any): number | undefined {
  // Support different fields such as progress.fractionCompleted, fractionCompleted, and progressPercent.
  const p = task?.progress
  const f1 = num(p?.fractionCompleted)
  if (f1 !== undefined) return f1

  const f2 = num(task?.fractionCompleted)
  if (f2 !== undefined) return f2

  const f3 = num(task?.progressPercent)
  if (f3 !== undefined) return f3 > 1 ? f3 / 100 : f3

  // Some implementations expose only bytes written and total bytes.
  const written =
    pickNum(task, ["totalBytesWritten", "bytesWritten", "receivedBytes", "completedBytes"]) ??
    pickNum(p, ["completedUnitCount", "totalBytesWritten"])
  const total =
    pickNum(task, ["totalBytesExpectedToWrite", "expectedBytes", "totalBytes", "contentLength"]) ??
    pickNum(p, ["totalUnitCount", "totalBytesExpectedToWrite"])

  if (typeof written === "number" && typeof total === "number" && total > 0) {
    return written / total
  }
  return undefined
}

function attachOnProgress(task: any, onProgress?: (p: DownloadProgress) => void) {
  if (!task || typeof onProgress !== "function") return

  let lastTs = Date.now()
  let lastBytes = 0

  task.onProgress = (d: any) => {
    const received =
      pickNum(d, ["receivedBytes", "bytesWritten", "totalBytesWritten", "completedBytes", "written"]) ?? 0
    const total =
      pickNum(d, ["totalBytes", "expectedBytes", "totalBytesExpected", "totalBytesExpectedToWrite", "contentLength"])

    const now = Date.now()
    const dt = Math.max(1, now - lastTs)
    const db = received - lastBytes
    const speedBps = (db * 1000) / dt

    onProgress({
      received,
      total,
      percent: typeof total === "number" && total > 0 ? received / total : undefined,
      speedBps,
    })

    lastTs = now
    lastBytes = received
  }
}

function attachOnError(task: any, setError: (e: any) => void) {
  if (!task) return
  // Support alternative field names where possible.
  if ("onError" in task) task.onError = setError
  if ("onFailed" in task) task.onFailed = setError
  if ("onFailure" in task) task.onFailure = setError
}

function startIfNeeded(task: any) {
  // Some implementations require a manual resume/start call.
  try {
    if (typeof task?.resume === "function") task.resume()
  } catch {}
  try {
    if (typeof task?.start === "function") task.start()
  } catch {}
}

function readBytes(task: any): { received?: number; total?: number } {
  const p = task?.progress
  const received =
    pickNum(task, ["totalBytesWritten", "bytesWritten", "receivedBytes", "completedBytes"]) ??
    pickNum(p, ["completedUnitCount", "totalBytesWritten"])
  const total =
    pickNum(task, ["totalBytesExpectedToWrite", "expectedBytes", "totalBytes", "contentLength"]) ??
    pickNum(p, ["totalUnitCount", "totalBytesExpectedToWrite"])
  return { received, total }
}

/**
 * ✅ The system downloads to dstPath without FileManager.write*.
 * Poll the task's progress/state until completion so a stalled progress callback cannot leave it stuck at 2%.
 */
export async function downloadWithProgress(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void
) {
  return downloadWithProgressInternal(url, dstPath, onProgress, 0)
}

async function downloadWithProgressInternal(
  url: string,
  dstPath: string,
  onProgress: ((p: DownloadProgress) => void) | undefined,
  attempt: number
) {
  if (!BackgroundURLSession || typeof BackgroundURLSession.startDownload !== "function") {
    throw new Error("BackgroundURLSession is unavailable. A background download to disk cannot run.")
  }

  let hintedTotal: number | undefined
  void fetchContentLength(url).then((n) => (hintedTotal = n)).catch(() => {})

  const task: any = BackgroundURLSession.startDownload({
    url,
    destination: dstPath,
  })

  if (!task || typeof task !== "object") {
    throw new Error("startDownload did not return a valid task object")
  }

  const startedAt = Date.now()
  let lastTs = Date.now()
  let lastBytes = 0
  let lastPercent: number | undefined
  let lastTotal: number | undefined
  let lastProgressAt = Date.now()
  let lastAnySignalAt = Date.now()
  let completionSince: number | null = null
  let err: any = null

  function emitProgress(p: DownloadProgress) {
    let received = typeof p.received === "number" ? p.received : 0
    let total = typeof p.total === "number" ? p.total : hintedTotal ?? lastTotal

    if (typeof total === "number") lastTotal = total
    if (!Number.isFinite(received)) received = 0
    if (received < lastBytes) received = lastBytes
    const bytesChanged = received !== lastBytes
    if (bytesChanged) lastProgressAt = Date.now()
    lastBytes = received

    let percent = p.percent
    if (typeof percent !== "number" && typeof total === "number" && total > 0) {
      percent = received / total
    }
    let pctChanged = false
    if (typeof percent === "number") {
      percent = Math.max(0, Math.min(1, percent))
      if (typeof lastPercent === "number" && percent < lastPercent) percent = lastPercent
      pctChanged = percent !== lastPercent
      if (pctChanged) lastProgressAt = Date.now()
      lastPercent = percent
    }

    if (bytesChanged || pctChanged) lastAnySignalAt = Date.now()
    onProgress?.({
      received,
      total,
      percent,
      speedBps: p.speedBps,
    })
  }

  attachOnProgress(task, emitProgress)
  attachOnError(task, (e) => (err = e))
  startIfNeeded(task)

  // Poll actively to keep the UI current and detect completion if onProgress stops firing.
  for (;;) {
    if (err) {
      throw (err instanceof Error ? err : new Error(String(err?.message ?? err ?? "Download failed")))
    }

    // Some implementations provide a completion flag.
    if (task?.isCompleted === true || task?.completed === true || task?.finished === true) {
      const ok = await waitForFile(dstPath, 3000)
      if (!ok) {
        await downloadWithFetchFallback(url, dstPath, onProgress)
      }
      emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
      return
    }

    const f = getFraction(task)
    const { received, total } = readBytes(task)

    // Estimate the download speed when possible.
    const now = Date.now()
    const dt = Math.max(1, now - lastTs)
    const rcv = typeof received === "number" ? received : lastBytes
    const db = rcv - lastBytes
    const speedBps = (db * 1000) / dt

    if (typeof f === "number" || typeof received === "number") {
      emitProgress({
        received: typeof received === "number" ? received : lastBytes,
        total,
        percent: typeof f === "number" ? f : undefined,
        speedBps,
      })
    } else if (typeof lastPercent === "number") {
      emitProgress({ received: lastBytes, total: lastTotal, percent: lastPercent, speedBps })
    }

    lastTs = now

    const doneByBytes = typeof lastTotal === "number" && lastTotal > 0 && lastBytes >= lastTotal
    const staleMs = Date.now() - lastProgressAt
    const doneByStale = typeof lastPercent === "number" && lastPercent >= 0.999 && staleMs > 1500
    if (doneByBytes || doneByStale) {
      if (completionSince == null) completionSince = Date.now()
      const ok = await waitForFile(dstPath, 1500)
      if (ok) {
        emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
      if (completionSince && Date.now() - completionSince > 6000) {
        // Try the fallback download if file existence cannot be confirmed.
        await downloadWithFetchFallback(url, dstPath, onProgress)
        emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
    } else {
      completionSince = null
    }

    // Time out and retry if progress stalls.
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      cancelTask(task)
      if (attempt < MAX_RETRY) {
        await removeFileLoose(dstPath)
        return downloadWithProgressInternal(url, dstPath, onProgress, attempt + 1)
      }
      throw new Error("Download timed out while waiting for progress")
    }

    // Abort when the total elapsed time exceeds the limit.
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      cancelTask(task)
      throw new Error("Download exceeded the total time limit")
    }

    // If the file already exists after a long period without updates, avoid waiting indefinitely.
    if (Date.now() - lastAnySignalAt > 12000) {
      const ok = await waitForFile(dstPath, 2000)
      if (ok) {
        emitProgress({ received: lastBytes, total: lastTotal, percent: lastPercent ?? 1 })
        return
      }
      lastAnySignalAt = Date.now()
    }

    await sleep(500)
  }
}
