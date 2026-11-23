import {
  Button,
  Editor,
  Form,
  Image,
  Navigation,
  NavigationStack,
  Section,
  Toggle,
  Text,
  TextField,
  VStack,
  HStack,
  Spacer,
  Picker,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import { loadModules, type ModuleInfo } from "../utils/storage"
import {
  clearRecentImports,
  loadRecentImports,
  type RecentImport,
} from "../utils/recent_imports"

function QuickImportRow(props: {
  title: string
  subtitle: string
  systemImage: string
  tint: "systemBlue" | "systemGreen" | "systemPurple"
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
    >
      <HStack
        spacing={12}
        padding={{ top: 12, bottom: 12, leading: 4, trailing: 4 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <Image
          systemName={props.systemImage}
          font={22}
          foregroundStyle={props.tint}
          frame={{ width: 42, height: 42 }}
          background={{
            style: "secondarySystemBackground",
            shape: { type: "rect", cornerRadius: 12 },
          }}
        />
        <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="headline">{props.title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {props.subtitle}
          </Text>
        </VStack>
        <Image systemName="chevron.right" font={14} foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  )
}

function relativeImportTime(timestamp: number): string {
  if (!timestamp) return "Time unknown"
  const delta = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return "Just now"
  if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))} min ago`
  if (delta < day) return `${Math.max(1, Math.floor(delta / hour))} hr ago`
  return `${Math.max(1, Math.floor(delta / day))} d ago`
}

function LocalContentEditorView(props: {
  initialContent: string
}) {
  const dismiss = Navigation.useDismiss()
  const [controller] = useState(() => new EditorController({
    content: props.initialContent,
    ext: "txt",
    readOnly: false,
  }))

  useEffect(() => {
    return () => {
      controller.dispose()
    }
  }, [controller])

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Edit Module Content"
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toolbar={{
          topBarTrailing: (
            <Button
              title="Save"
              action={() => {
                HapticFeedback.mediumImpact()
                dismiss(String(controller.content ?? ""))
              }}
            />
          ),
        }}
      >
        <Editor
          controller={controller}
          scriptName="Surge Module"
          showAccessoryView
          searchEnabled
          ignoresSafeArea={{ regions: "container", edges: "bottom" }}
        />
      </VStack>
    </NavigationStack>
  )
}

export function EditModuleView(props: {
  title: string
  categories: string[]
  initial?: ModuleInfo
  saveDirs?: string[]
}) {
  const dismiss = Navigation.useDismiss()

  const initial = props.initial
  const [name, setName] = useState<string>(initial?.name ?? "")
  const [link, setLink] = useState<string>(initial?.link ?? "")
  const [isRemote, setIsRemote] = useState<boolean>(initial ? !!initial.link : true)
  const [content, setContent] = useState<string>("")
  const [existingLinks, setExistingLinks] = useState<Set<string>>(new Set())
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set())
  const [recentImports, setRecentImports] = useState<RecentImport[]>([])

  const categoryOptions = useMemo<string[]>(() => ["不设置分类", ...props.categories], [props.categories])
  const initialIdx = Math.max(
    0,
    categoryOptions.findIndex((c) => c === (initial?.category ?? ""))
  )
  const [categoryIdx, setCategoryIdx] = useState<number>(initialIdx >= 0 ? initialIdx : 0)
  const [customCategory, setCustomCategory] = useState<string>(() => {
    const value = String(initial?.category ?? "").trim()
    return value && !props.categories.includes(value) ? value : ""
  })
  const saveDirOptions = useMemo<string[]>(() => {
    const dirs = props.saveDirs ?? []
    if (!dirs.length) return []
    return ["Root Folder", ...dirs]
  }, [props.saveDirs])
  const [saveDirIdx, setSaveDirIdx] = useState<number>(0)

  useEffect(() => {
    if (initial) return
    void loadExistingLinks()
    setRecentImports(loadRecentImports())
  }, [initial])

  useEffect(() => {
    const currentDir = initial?.saveDir ?? ""
    if (!saveDirOptions.length || !currentDir) {
      setSaveDirIdx(0)
      return
    }
    const idx = saveDirOptions.findIndex((dir) => dir === currentDir)
    setSaveDirIdx(idx >= 0 ? idx : 0)
  }, [initial?.saveDir, saveDirOptions])

  useEffect(() => {
    if (!initial || initial.link || !initial.filePath) return
    const fm: any = (globalThis as any).FileManager
    if (!fm?.readAsString) return
    void (async () => {
      try {
        const text = await fm.readAsString(initial.filePath)
        setContent(String(text ?? ""))
      } catch {}
    })()
  }, [initial])

  async function loadExistingLinks() {
    try {
      const list = await loadModules()
      setExistingLinks(new Set(list.map((m) => m.link).filter(Boolean)))
      setExistingNames(new Set(list.map((m) => m.name).filter(Boolean)))
    } catch {
      setExistingLinks(new Set())
      setExistingNames(new Set())
    }
  }

  async function onSave() {
    const trimmedName = name.trim()
    const trimmedLink = link.trim()
    const localContent = String(content ?? "")
    const trimmedContent = localContent.trim()
    const selectedCategory = categoryOptions[categoryIdx] === "不设置分类"
      ? ""
      : categoryOptions[categoryIdx]
    const cat = customCategory.trim() || selectedCategory || undefined
    const saveDir =
      saveDirOptions.length && saveDirIdx > 0 ? saveDirOptions[saveDirIdx] : undefined

    if (!trimmedName || !trimmedLink) {
      if (!trimmedName) {
        await Dialog.alert({ message: "Enter a name." })
        return
      }
      if (isRemote) {
        await Dialog.alert({ message: "Enter a link." })
        return
      }
      if (!trimmedContent) {
        await Dialog.alert({ message: "Enter the module content." })
        return
      }
    } else if (!isRemote && !trimmedContent) {
      await Dialog.alert({ message: "Enter the module content." })
      return
    }

    if (!initial) {
      let names = existingNames
      let links = existingLinks
      if (!names.size && !links.size) {
        try {
          const list = await loadModules()
          names = new Set(list.map((m) => m.name).filter(Boolean))
          links = new Set(list.map((m) => m.link).filter(Boolean))
          setExistingNames(names)
          setExistingLinks(links)
        } catch {}
      }

      if (names.has(trimmedName)) {
        await Dialog.alert({
          title: "Module Already Exists",
          message: `A module already uses this name: ${trimmedName}`,
        })
        return
      }
      if (isRemote && links.has(trimmedLink)) {
        await Dialog.alert({
          title: "Module Already Exists",
          message: "A module already uses this download link.",
        })
        return
      }
    }

    const result: ModuleInfo = {
      name: trimmedName,
      link: isRemote ? trimmedLink : "",
      isLocal: !isRemote,
      content: isRemote ? undefined : localContent,
      category: cat,
      saveDir,
    }
    dismiss(result)
  }

  async function openLocalContentEditor() {
    const next = await Navigation.present<string | null>({
      element: <LocalContentEditorView initialContent={content} />,
      modalPresentationStyle: "pageSheet",
    })
    if (next == null) return
    setContent(next)
  }

  function deriveNameFromURL(rawURL: string): string {
    try {
      const parsed = new URL(rawURL)
      const last = parsed.pathname.split("/").filter(Boolean).pop() ?? ""
      const value = decodeURIComponent(last).replace(/\.(?:sgmodule|plugin|conf)$/i, "").trim()
      return value || "远程模块"
    } catch {
      return "远程模块"
    }
  }

  function deriveNameFromContent(rawContent: string): string {
    const tagged = String(rawContent ?? "").match(/^\s*(?:#!|#)name\s*=\s*(.+?)\s*$/im)?.[1]
    return String(tagged ?? "").trim() || "本地模块"
  }

  function setRemoteSource(rawURL: string) {
    const value = String(rawURL ?? "").trim()
    if (!value) return
    setIsRemote(true)
    setLink(value)
    setContent("")
    if (!name.trim()) setName(deriveNameFromURL(value))
  }

  async function openRemoteLinkInput() {
    const input = await Dialog.prompt({
      title: "Remote Link",
      message: "Paste an HTTPS module link or a Script-Hub conversion result.",
      defaultValue: link,
      placeholder: "https://",
    })
    if (input == null) return
    setRemoteSource(input)
  }

  async function openLocalFilePicker() {
    try {
      const picker: any = (globalThis as any).DocumentPicker
      if (typeof picker?.pickFiles !== "function") {
        await Dialog.alert({ message: "DocumentPicker.pickFiles is unavailable. Use the share sheet to import the file." })
        return
      }
      const files = await picker.pickFiles({
        types: ["public.data", "public.text", "public.plain-text"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      const filePath = Array.isArray(files) ? files[0] : undefined
      if (!filePath) return
      const fm: any = (globalThis as any).FileManager
      if (typeof fm?.readAsString !== "function") throw new Error("FileManager.readAsString is unavailable")
      const path = String(filePath)
      const text = String(await fm.readAsString(path) ?? "")
      if (!text.trim()) throw new Error("The selected file has no content to import.")
      setIsRemote(false)
      setLink("")
      setContent(text)
      if (!name.trim()) {
        const filename = path.split("/").pop() ?? ""
        setName(filename.replace(/\.(?:sgmodule|plugin|conf|txt)$/i, "") || deriveNameFromContent(text))
      }
    } catch (e: any) {
      await Dialog.alert({ title: "Could Not Read File", message: String(e?.message ?? e) })
    }
  }

  async function openClipboardImport() {
    try {
      const pasteboard: any = (globalThis as any).Pasteboard
      let raw = ""
      if (typeof pasteboard?.getString === "function") raw = String(await pasteboard.getString() ?? "")
      else if (typeof pasteboard?.string === "function") raw = String(await pasteboard.string() ?? "")
      else if (typeof pasteboard?.string === "string") raw = pasteboard.string

      if (!raw.trim()) {
        raw = String(await Dialog.prompt({
          title: "Import from Clipboard",
          message: "Paste a module link or the module content.",
          placeholder: "https:// or [Rule] / [Script]",
        }) ?? "")
      }
      const value = raw.trim()
      if (!value) return
      if (/^https?:\/\//i.test(value)) setRemoteSource(value)
      else {
        setIsRemote(false)
        setLink("")
        setContent(value)
        if (!name.trim()) setName(deriveNameFromContent(value))
      }
    } catch (e: any) {
      await Dialog.alert({ title: "Could Not Read Clipboard", message: String(e?.message ?? e) })
    }
  }

  function restoreRecentImport(item: RecentImport) {
    if (!item.link) return
    setRemoteSource(item.link)
    setName(item.name)
    if (item.category) setCustomCategory(item.category)
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.title}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="Save"
              action={() => {
                HapticFeedback.mediumImpact()
                void onSave()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>Module Information</Text>}>
            <TextField
              label={<Text>Name</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="Module name"
            />
            <Toggle
              title="Remote Module"
              value={isRemote}
              onChanged={(value: boolean) => {
                HapticFeedback.heavyImpact()
                setIsRemote(value)
              }}
            />
            {isRemote ? (
              <TextField
                label={<Text>Link</Text>}
                value={link}
                onChanged={(v: string) => setLink(v)}
                prompt="https://"
              />
            ) : (
              <VStack
                spacing={8}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <Text foregroundStyle="secondaryLabel">Module Content (Tap to Edit)</Text>
                <Button
                  buttonStyle="plain"
                  action={() => {
                    HapticFeedback.mediumImpact()
                    void openLocalContentEditor()
                  }}
                >
                  <VStack
                    spacing={8}
                    padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}
                    frame={{ maxWidth: "infinity", minHeight: 120, alignment: "topLeading" }}
                    background={{
                      style: "secondarySystemBackground",
                      shape: { type: "rect", cornerRadius: 14 },
                    }}
                  >
                    <Text
                      font="caption"
                      foregroundStyle={content.trim() ? "secondaryLabel" : "tertiaryLabel"}
                      lineLimit={5}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {content.trim() || "No content yet. Tap to open the editor."}
                    </Text>
                  </VStack>
                </Button>
              </VStack>
            )}
          </Section>

          <Section header={<Text>Category</Text>}>
            <Picker
              title={"Module Category"}
              pickerStyle="menu"
              value={categoryIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setCategoryIdx(idx)
                }}
              >
              {categoryOptions.map((c, idx) => (
                <Text key={`${c}-${idx}`} tag={idx}>
                  {c}
                </Text>
              ))}
            </Picker>
            <TextField
              label={<Text>Custom Category</Text>}
              value={customCategory}
              onChanged={(value: string) => setCustomCategory(value)}
              prompt="Added to the category list automatically"
              textFieldStyle="roundedBorder"
            />
          </Section>

          {saveDirOptions.length ? (
            <Section header={<Text>Save Location</Text>}>
              <Picker
                title={"Save Location"}
                pickerStyle="menu"
                value={saveDirIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setSaveDirIdx(idx)
                }}
              >
                {saveDirOptions.map((p, idx) => {
                  const label = idx === 0 ? "Root Folder" : (String(p).split("/").pop() ?? p)
                  return (
                    <Text key={`${p}-${idx}`} tag={idx}>
                      {label}
                    </Text>
                  )
                })}
              </Picker>
            </Section>
          ) : null}

          {!initial ? (
            <>
              <Section header={<Text>Quick Import</Text>}>
                <QuickImportRow
                  title="Remote Link"
                  subtitle="Supports HTTPS module links and Script-Hub conversion results"
                  systemImage="link"
                  tint="systemBlue"
                  onPress={openRemoteLinkInput}
                />
                <QuickImportRow
                  title="Local File"
                  subtitle="Choose a .sgmodule, .plugin, or text file from your device"
                  systemImage="doc"
                  tint="systemPurple"
                  onPress={openLocalFilePicker}
                />
                <QuickImportRow
                  title="Clipboard"
                  subtitle="Detects a module link or module content on the clipboard"
                  systemImage="doc.on.clipboard"
                  tint="systemGreen"
                  onPress={openClipboardImport}
                />
              </Section>

              <Section
                header={(
                  <HStack>
                    <Text>Recent Imports</Text>
                    <Spacer />
                    {recentImports.length ? (
                      <Button
                        title="Clear"
                        action={() => {
                          HapticFeedback.mediumImpact()
                          clearRecentImports()
                          setRecentImports([])
                        }}
                      />
                    ) : null}
                  </HStack>
                )}
              >
                {recentImports.length ? recentImports.slice(0, 3).map((item) => (
                  <HStack key={`${item.link || item.name}-${item.importedAt}`} padding={{ top: 8, bottom: 8 }}>
                    <Image
                      systemName={item.link ? "arrow.down.circle.fill" : "doc.fill"}
                      font={18}
                      foregroundStyle={item.link ? "systemBlue" : "secondaryLabel"}
                    />
                    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text lineLimit={1}>{item.name}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {item.category ? `Category: ${item.category} · ` : ""}{relativeImportTime(item.importedAt)}
                      </Text>
                    </VStack>
                    {item.link ? (
                      <Button
                        title="Import Again"
                        buttonStyle="borderedProminent"
                        tint="systemGreen"
                        action={() => restoreRecentImport(item)}
                      />
                    ) : (
                      <Text font="caption" foregroundStyle="secondaryLabel">Local Module</Text>
                    )}
                  </HStack>
                )) : (
                  <Text foregroundStyle="secondaryLabel">Recently imported modules will appear here.</Text>
                )}
              </Section>

              <Section header={<Text>Script-Hub</Text>}>
                <Text foregroundStyle="secondaryLabel" lineLimit={4}>
                  To convert a plugin or module, open Script-Hub and enter a direct HTTPS link. Surge module output can be written directly to the module directory.
                </Text>
              </Section>
            </>
          ) : null}
        </Form>
      </VStack>
    </NavigationStack>
  )
}
