import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"

import { loadConfig, saveConfig, type AppConfig } from "../utils/config"
import { testRemoteConnection } from "../utils/remote_control"
import { SurgeToolsView } from "./SurgeToolsView"

export function RemoteControlView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [cfg, setCfg] = useState<AppConfig>(props.initial ?? loadConfig())
  const [testing, setTesting] = useState(false)

  async function testConnection() {
    if (testing) return
    setTesting(true)
    try {
      const result = await testRemoteConnection({
        ...cfg,
        remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
        remotePort: String(cfg.remotePort ?? "").trim(),
        remotePassword: String(cfg.remotePassword ?? ""),
        remoteAuthMode: cfg.remoteAuthMode === "bearer" ? "bearer" : "x-key",
      })
      await Dialog.alert({
        title: "Connection Successful",
        message: `Response time: ${result.latencyMs} ms\nModules currently enabled: ${result.enabledCount}`,
      })
    } catch (e: any) {
      await Dialog.alert({
        title: "Connection Failed",
        message: String(e?.message ?? e),
      })
    } finally {
      setTesting(false)
    }
  }

  async function saveAndClose() {
    try {
      const fixed: AppConfig = {
        ...cfg,
        remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
        remotePort: String(cfg.remotePort ?? "").trim(),
        remotePassword: String(cfg.remotePassword ?? ""),
        remoteAuthMode: cfg.remoteAuthMode === "bearer" ? "bearer" : "x-key",
      }
      saveConfig(fixed)
      props.onDone?.(fixed)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"HTTP Remote Control"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="Save"
              action={() => {
                HapticFeedback.mediumImpact()
                void saveAndClose()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>Connection Details</Text>}>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                Address:
              </Text>
              <TextField
                title=""
                value={cfg.remoteHost}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remoteHost: v }))}
                prompt="http://127.0.0.1"
                keyboardType="URL"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                Port:
              </Text>
              <TextField
                title=""
                value={cfg.remotePort}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePort: v }))}
                prompt="6171"
                keyboardType="numberPad"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                Password:
              </Text>
              <SecureField
                title=""
                value={cfg.remotePassword}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePassword: v }))}
                prompt="Surge HTTP API key"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <Picker
              title="Authentication"
              pickerStyle="menu"
              value={cfg.remoteAuthMode === "bearer" ? 1 : 0}
              onChanged={(index: number) => setCfg((c) => ({ ...c, remoteAuthMode: index === 1 ? "bearer" : "x-key" }))}
            >
              <Text tag={0}>X-Key (Default)</Text>
              <Text tag={1}>Bearer</Text>
            </Picker>
            <Button
              title={testing ? "Testing Connection…" : "Test Connection"}
              systemImage="antenna.radiowaves.left.and.right"
              disabled={testing}
              action={() => {
                HapticFeedback.mediumImpact()
                void testConnection()
              }}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              The test checks module status through the Surge HTTP API and leaves module switches as they are. X-Key is the default. Use Bearer when your setup requires the Authorization header.
            </Text>
            <Button
              title="Advanced Surge Controls"
              systemImage="slider.horizontal.3"
              action={() => {
                HapticFeedback.mediumImpact()
                void Navigation.present({ element: <SurgeToolsView initial={cfg} /> })
              }}
            />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
