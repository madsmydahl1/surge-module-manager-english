import {
  Button,
  ForEach,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"

import type { AppConfig } from "../utils/config"
import {
  fetchAvoidedPolicies,
  fetchCaptureEnabled,
  fetchCaptureFilters,
  fetchCaptureSessions,
  fetchSurgePolicies,
  setCaptureEnabled,
  setCaptureFilter,
  setPolicyAvoided,
  type CaptureFilter,
  type CaptureFilterScope,
  type CaptureFilterType,
  type CaptureSession,
} from "../utils/remote_control"

const FILTER_TYPES: CaptureFilterType[] = ["off", "with-keywords", "without-keywords", "pattern"]

function splitKeywords(value: string): string[] {
  return Array.from(new Set(
    String(value ?? "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 128),
  ))
}

function joinKeywords(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join(", ") : ""
}

function formatSession(session: CaptureSession): string {
  const count = Number.isFinite(Number(session.requestCount)) ? ` · ${session.requestCount} requests` : ""
  const state = session.active ? "Active" : session.endReason ? `Ended · ${session.endReason}` : "Saved"
  return `${session.name} · ${state}${count}`
}

export function SurgeToolsView(props: { initial: AppConfig }) {
  const dismiss = Navigation.useDismiss()
  const [cfg] = useState<AppConfig>(props.initial)
  const [policies, setPolicies] = useState<string[]>([])
  const [avoided, setAvoided] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<CaptureFilterScope>("in-memory")
  const [filters, setFilters] = useState<Partial<Record<CaptureFilterScope, CaptureFilter>>>({})
  const [filter, setFilter] = useState<CaptureFilter>({
    type: "off",
    keywords: [],
    disabledKeywords: [],
    httpOnly: false,
    hideCrashReporterRequests: true,
    hideAppleRequests: false,
    hideUDP: false,
  })
  const [captureEnabled, setCaptureEnabledState] = useState(false)
  const [sessions, setSessions] = useState<CaptureSession[]>([])
  const [keywordsText, setKeywordsText] = useState("")
  const [status, setStatus] = useState("Reading Surge capabilities…")
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      const policyResult = await fetchSurgePolicies(cfg)
      const [avoidedResult, filtersResult, captureResult, sessionResult] = await Promise.all([
        fetchAvoidedPolicies(cfg).catch(() => null),
        fetchCaptureFilters(cfg).catch(() => null),
        fetchCaptureEnabled(cfg).catch(() => null),
        fetchCaptureSessions(cfg).catch(() => null),
      ])
      setPolicies(Array.from(new Set((policyResult.proxies ?? []).map((item) => String(item).trim()).filter(Boolean))))
      if (avoidedResult) setAvoided(avoidedResult)
      if (captureResult !== null) setCaptureEnabledState(captureResult)
      if (sessionResult) setSessions(sessionResult)
      if (filtersResult) setFilters(filtersResult.filters ?? {})
      const nextFilter = filtersResult?.filters?.[scope]
      if (nextFilter) {
        setFilter(nextFilter)
        setKeywordsText(joinKeywords(nextFilter.keywords))
      }
      const unsupported = [
        avoidedResult ? "" : "Policy avoidance",
        filtersResult ? "" : "Capture filters",
        captureResult === null ? "Capture toggle" : "",
        sessionResult ? "" : "Capture sessions",
      ].filter(Boolean)
      setStatus(`Connected · Policies: ${policyResult.proxies?.length ?? 0} · Saved capture sessions: ${sessionResult?.length ?? 0}${unsupported.length ? ` · Unsupported or unavailable in this Surge instance: ${unsupported.join(", ")}` : ""}`)
    } catch (e: any) {
      setStatus(`Could not read Surge status: ${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function togglePolicy(name: string, value: boolean) {
    if (busy) return
    setBusy(true)
    try {
      setAvoided(await setPolicyAvoided(cfg, name, value))
      setStatus(value ? `Avoiding policy: ${name}` : `Cleared avoidance for ${name}`)
    } catch (e: any) {
      setStatus(`Could not update policy avoidance: ${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveFilter() {
    if (busy) return
    setBusy(true)
    try {
      const next: CaptureFilter = {
        ...filter,
        keywords: splitKeywords(keywordsText),
      }
      const applied = await setCaptureFilter(cfg, scope, next)
      setFilter(applied)
      setFilters((current) => ({ ...current, [scope]: applied }))
      setKeywordsText(joinKeywords(applied.keywords))
      setStatus(`${scope === "in-memory" ? "In-memory" : "On-disk"} capture filters saved`)
    } catch (e: any) {
      setStatus(`Could not save filters: ${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleCapture(value: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const applied = await setCaptureEnabled(cfg, value)
      setCaptureEnabledState(applied)
      setStatus(applied ? "HTTP Capture started" : "HTTP Capture stopped")
      if (!applied) setSessions(await fetchCaptureSessions(cfg))
    } catch (e: any) {
      setStatus(`Could not toggle capture: ${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  function changeScope(nextScope: CaptureFilterScope) {
    setScope(nextScope)
    const nextFilter = filters[nextScope]
    if (nextFilter) {
      setFilter(nextFilter)
      setKeywordsText(joinKeywords(nextFilter.keywords))
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Advanced Surge Controls"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="Close" action={dismiss} />,
          topBarTrailing: <Button title="Refresh" disabled={busy} action={() => void refresh()} />,
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>Status</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4}>{status}</Text>
            <Toggle
              title="HTTP Capture"
              value={captureEnabled}
              disabled={busy}
              onChanged={(value: boolean) => void toggleCapture(value)}
            />
            <Text font="caption" foregroundStyle="systemOrange" lineLimit={4}>
              Starting or stopping capture closes existing connections. Use capture while troubleshooting requests and turn it off when finished.
            </Text>
          </Section>

          <Section
            header={<Text>Policy Avoidance</Text>}
            footer={<Text font="caption" foregroundStyle="secondaryLabel">Applies only to the url-test, fallback, load-balance, and smart automatic policy groups. Manual selections, direct rules, and permanent configuration are preserved. Surge clears the avoidance flags when it restarts.</Text>}
          >
            {policies.length ? (
              <ForEach
                count={policies.length}
                itemBuilder={(index) => {
                  const name = policies[index]
                  return (
                    <Toggle
                      key={name}
                      title={name}
                      value={avoided.has(name)}
                      disabled={busy}
                      onChanged={(value: boolean) => void togglePolicy(name, value)}
                    />
                  )
                }}
              />
            ) : (
              <Text foregroundStyle="secondaryLabel">No proxy policies available to avoid</Text>
            )}
          </Section>

          <Section
            header={<Text>Capture Filters</Text>}
            footer={<Text font="caption" foregroundStyle="secondaryLabel">These options match Surge HTTP API `/v1/capture/filters`. Separate keywords with commas or newlines. Patterns support * and ?, with a leading - to exclude matches.</Text>}
          >
            <Picker
              title="Filter Scope"
              pickerStyle="segmented"
              value={scope === "in-memory" ? 0 : 1}
              onChanged={(index: number) => changeScope(index === 1 ? "on-disk" : "in-memory")}
            >
              <Text tag={0}>In-Memory Requests</Text>
              <Text tag={1}>On-Disk Sessions</Text>
            </Picker>
            <Picker
              title="Match Type"
              pickerStyle="menu"
              value={Math.max(0, FILTER_TYPES.indexOf(filter.type ?? "off"))}
              onChanged={(index: number) => setFilter((current) => ({ ...current, type: FILTER_TYPES[index] ?? "off" }))}
            >
              {FILTER_TYPES.map((item, index) => <Text key={item} tag={index}>{item}</Text>)}
            </Picker>
            <TextField
              label={<Text>Keywords</Text>}
              value={keywordsText}
              onChanged={setKeywordsText}
              prompt="example.com, api.example.net"
              axis="vertical"
              lineLimit={{ min: 2, max: 5 }}
            />
            <Toggle title="HTTP Only" value={!!filter.httpOnly} onChanged={(value: boolean) => setFilter((current) => ({ ...current, httpOnly: value }))} />
            <Toggle title="Hide Crash Report Requests" value={filter.hideCrashReporterRequests !== false} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideCrashReporterRequests: value }))} />
            <Toggle title="Hide Apple Requests" value={!!filter.hideAppleRequests} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideAppleRequests: value }))} />
            <Toggle title="Hide UDP Requests" value={!!filter.hideUDP} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideUDP: value }))} />
            <Button title={busy ? "Saving…" : "Save Capture Filters"} systemImage="checkmark" disabled={busy} action={() => void saveFilter()} />
          </Section>

          <Section header={<Text>Saved HTTP Capture Sessions</Text>}>
            {sessions.length ? sessions.slice(0, 12).map((session) => (
              <HStack key={session.name}>
                <Text lineLimit={2}>{formatSession(session)}</Text>
              </HStack>
            )) : <Text foregroundStyle="secondaryLabel">No saved sessions</Text>}
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
