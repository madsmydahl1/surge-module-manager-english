import {
  Button,
  ForEach,
  Form,
  Group,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  HStack,
  Spacer,
  Picker,
  useEffect,
  useState,
} from "scripting"

import {
  addCategory,
  loadConfig,
  saveConfig,
  type AppConfig,
} from "../utils/config"
import {
  cleanupLegacyPrivateResources,
  countModulesByCategory,
  getSurgeBookmarkRoot,
  loadCategoriesFromModules,
  renameCategoryInModules,
} from "../utils/storage"
import {
  exportMetadataToICloud,
  exportMetadataWithDocumentPicker,
  importMetadataFromFile,
  iCloudMetadataAvailable,
  removeICloudMetadataFile,
} from "../utils/metadata_sync"

function PlainRowButton(props: { title: string; onPress: () => void }) {
  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        props.onPress()
      }}
    >
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function SettingsView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const initialCfg = props.initial ?? loadConfig()
  const [cfg, setCfg] = useState<AppConfig>(initialCfg)

  const [bookmarks, setBookmarks] = useState<{ name: string; path: string }[]>([])
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [metadataAction, setMetadataAction] = useState<"" | "export" | "import">("")
  const concurrencyOptions = Array.from({ length: 10 }, (_, idx) => idx + 1)

  useEffect(() => {
    setCfg(props.initial ?? loadConfig())
    void refreshBookmarks(props.initial ?? loadConfig())
    void refreshCounts(props.initial ?? loadConfig())
  }, [])

  function isPromiseLike(v: any): v is Promise<any> {
    return !!v && typeof v === "object" && typeof v.then === "function"
  }

  function normalizeBookmarkPath(path: string): string {
    return String(path ?? "").trim().replace(/\/+$/, "")
  }

  async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
    try {
      const r = fn.apply(thisArg, args)
      return isPromiseLike(r) ? await r : r
    } catch {
      return undefined
    }
  }

  async function refreshBookmarks(current?: AppConfig): Promise<{ name: string; path: string }[]> {
    const fm: any = (globalThis as any).FileManager
    let list: any = []
    if (fm?.getAllFileBookmarks) {
      try {
        const r = fm.getAllFileBookmarks()
        list = r && typeof r.then === "function" ? await r : r
      } catch {
        list = []
      }
    }
    const arr = Array.isArray(list) ? list : []
    const cleaned = arr
      .map((x: any) => ({ name: String(x?.name ?? ""), path: String(x?.path ?? "") }))
      .filter((x: any) => x.name && x.path)
    setBookmarks(cleaned)

    const targetName = current?.baseBookmarkName ?? cfg.baseBookmarkName
    const targetPath = current?.baseDir ?? cfg.baseDir
    if (cleaned.length) {
      let idx = -1
      if (targetName) idx = cleaned.findIndex((b) => b.name === targetName)
      if (idx < 0 && targetPath) {
        idx = cleaned.findIndex((b) => normalizeBookmarkPath(b.path) === normalizeBookmarkPath(targetPath))
      }
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx >= 0) {
        const matched = cleaned[idx]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [matched.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? matched.path)
          : matched.path
        const selectedPath = normalizeBookmarkPath(resolved || matched.path)
        const pathChanged = selectedPath !== normalizeBookmarkPath(targetPath) || matched.name !== targetName
        if (pathChanged) {
          setCfg((c) => ({ ...c, baseDir: selectedPath, baseBookmarkName: matched.name }))
          try {
            const next = { ...loadConfig(), baseDir: selectedPath, baseBookmarkName: matched.name }
            saveConfig(next)
            props.onDone?.(next)
          } catch {}
        }
      } else if (!targetPath) {
        const first = cleaned[0]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [first.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [first.name])) ?? first.path)
          : first.path
        setCfg((c) => ({ ...c, baseDir: normalizeBookmarkPath(resolved || first.path), baseBookmarkName: first.name }))
      }
    } else {
      setBookmarkIdx(0)
    }
    return cleaned
  }

  async function refreshCounts(current?: AppConfig) {
    try {
      const counts = await countModulesByCategory(current?.baseDir ?? cfg.baseDir)
      setCategoryCounts(counts)
    } catch {
      setCategoryCounts({})
    }
  }

  async function pickAndSaveBookmarkFolder() {
    try {
      HapticFeedback.mediumImpact()
      const picker: any = (globalThis as any).DocumentPicker
      if (typeof picker?.pickDirectoryBookmark !== "function") {
        await Dialog.alert({
          title: "Feature Unavailable",
          message: "This version of Scripting cannot select and save a bookmarked folder directly. Update Scripting to use this feature.",
        })
        return
      }

      const result = await picker.pickDirectoryBookmark({
        preferredName: "Surge模块管理",
        initialDirectory: cfg.baseDir || undefined,
      })
      if (!result) return

      const bookmarkName = String(result.bookmarkName ?? "").trim()
      const pickedPath = normalizeBookmarkPath(String(result.path ?? ""))
      if (!bookmarkName || !pickedPath) {
        throw new Error("Could not obtain a valid bookmarked directory")
      }

      const next: AppConfig = { ...cfg, baseDir: pickedPath, baseBookmarkName: bookmarkName }
      setCfg(next)
      saveConfig(next)
      props.onDone?.(next)
      const updated = await refreshBookmarks(next)
      const idx = updated.findIndex((b) => b.name === bookmarkName)
      if (idx >= 0) setBookmarkIdx(idx)
      await refreshCounts(next)
      await Dialog.alert({ message: "Surge folder saved. Modules will be written to its Module subfolder." })
    } catch (e: any) {
      await Dialog.alert({ title: "Could Not Select Folder", message: String(e?.message ?? e) })
    }
  }

  async function addCategoryAction() {
    const name = (await Dialog.prompt({
      title: "Add Category",
      message: "Enter a category name.",
      placeholder: "Category name",
    }))?.trim()
    if (!name) return
    if (cfg.categories.includes(name)) {
      await Dialog.alert({ message: "This category already exists." })
      return
    }
    try {
      const next = addCategory(cfg, name)
      setCfg(next)
      saveConfig(next)
      props.onDone?.(next)
      await refreshCounts(next)
    } catch (e: any) {
      await Dialog.alert({ title: "Could Not Save Category", message: String(e?.message ?? e) })
    }
  }

  async function importCategories() {
    if (!cfg.baseDir) {
      await Dialog.alert({ message: "Select a bookmarked folder first." })
      return
    }
    const result = await loadCategoriesFromModules(cfg.baseDir)
    const list = result.categories
    const existing = new Set(cfg.categories ?? [])
    const toAdd = list.filter((c) => !existing.has(c))
    if (!list.length) {
      await Dialog.alert({
        message: `No categories found in ${result.scanned} scanned module files.\nRecognized tags: #!category=xxx and #!cagegory=xxx`,
      })
      return
    }
    if (!toAdd.length) {
      await Dialog.alert({
        message: `Import complete. Scanned ${result.scanned} module files and added 0 categories.`,
      })
      return
    }
    const next = { ...cfg, categories: [...(cfg.categories ?? []), ...toAdd] }
    setCfg(next)
    saveConfig(next)
    props.onDone?.(next)
    await Dialog.alert({
      message: `Import complete. Scanned ${result.scanned} module files and added ${toAdd.length} categories.`,
    })
    await refreshCounts(next)
  }

  async function editCategory(oldName: string) {
    const nextName = (await Dialog.prompt({
      title: "Edit Category",
      message: "Enter the new category name.",
      defaultValue: oldName,
      placeholder: "Category name",
    }))?.trim()
    if (!nextName || nextName === oldName) return
    if (cfg.categories.includes(nextName)) {
      await Dialog.alert({ message: "This category already exists." })
      return
    }
    try {
      await renameCategoryInModules(oldName, nextName, cfg.baseDir)
      const next = {
        ...cfg,
        categories: (cfg.categories ?? []).map((n) => (n === oldName ? nextName : n)),
      }
      setCfg(next)
      saveConfig(next)
      props.onDone?.(next)
      await refreshCounts(next)
    } catch (e: any) {
      await Dialog.alert({ title: "Could Not Save Category", message: String(e?.message ?? e) })
    }
  }

  function deleteCategoryAt(indices: number[]) {
    if (!indices.length) return
    HapticFeedback.heavyImpact()
    const next = (() => {
      const categories = [...(cfg.categories ?? [])]
      const sorted = [...indices].sort((a, b) => b - a)
      for (const i of sorted) {
        if (i >= 0 && i < categories.length) categories.splice(i, 1)
      }
      return { ...cfg, categories }
    })()
    try {
      setCfg(next)
      saveConfig(next)
      props.onDone?.(next)
      void refreshCounts(next)
    } catch (e: any) {
      void Dialog.alert({ title: "Could Not Delete Category", message: String(e?.message ?? e) })
    }
  }

  async function saveAndClose() {
    try {
      saveConfig(cfg)
      if (cfg.iCloudMetadataSync) {
        await exportMetadataToICloud()
      }
      props.onDone?.(cfg)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function exportMetadataAction() {
    if (metadataAction) return
    setMetadataAction("export")
    try {
      if (cfg.iCloudMetadataSync && !iCloudMetadataAvailable()) {
        await Dialog.alert({ message: "iCloud is unavailable. Check that you are signed in and Scripting has iCloud access." })
        return
      }
      saveConfig(cfg)
      const result = cfg.iCloudMetadataSync
        ? await exportMetadataToICloud()
        : await exportMetadataWithDocumentPicker()
      await Dialog.alert({
        title: "Export Complete",
        message: `Exported metadata for ${result.count} remote modules\n${result.path}`,
      })
    } catch (e: any) {
      if (String(e?.message ?? e) === "No export location selected") return
      await Dialog.alert({ title: "Export Failed", message: String(e?.message ?? e) })
    } finally {
      setMetadataAction("")
    }
  }

  async function setICloudMetadataSync(value: boolean) {
    HapticFeedback.heavyImpact()
    setCfg((c) => ({ ...c, iCloudMetadataSync: value }))
    if (value) return

    try {
      await removeICloudMetadataFile()
    } catch (e: any) {
      await Dialog.alert({
        title: "Could Not Clean Up iCloud Metadata",
        message: String(e?.message ?? e),
      })
    }
  }

  async function cleanupLegacyPrivateResourcesAction() {
    const confirmed = await Dialog.confirm({
      title: "Clean Up Legacy Private Resources",
      message: "This removes only .scripting-resources directories created by older versions and preserves modules, backups, and configuration. Continue?",
    })
    if (!confirmed) return

    try {
      const result = await cleanupLegacyPrivateResources()
      if (result.skipped) {
        await Dialog.alert({
          title: "Cleanup Skipped",
          message: "The Surge bookmark overlaps with the legacy directory, so cleanup was skipped to protect resources in use.",
        })
        return
      }
      await Dialog.alert({
        title: "Cleanup Complete",
        message: result.removedDirectories
          ? `Removed ${result.removedDirectories} legacy private resource directories.\nModules and backups were preserved.`
          : "No legacy private resource directories found.",
      })
    } catch (e: any) {
      await Dialog.alert({ title: "Cleanup Failed", message: String(e?.message ?? e) })
    }
  }

  async function importMetadataAction() {
    if (metadataAction) return
    setMetadataAction("import")
    try {
      const picker: any = (globalThis as any).DocumentPicker
      if (!picker?.pickFiles) {
        await Dialog.alert({ message: "DocumentPicker.pickFiles is unavailable. The metadata file cannot be selected." })
        return
      }
      const files = await picker.pickFiles({
        types: ["public.json", "public.text", "public.plain-text"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      const filePath = Array.isArray(files) ? files[0] : undefined
      if (!filePath) return

      const result = await importMetadataFromFile(filePath, cfg)
      setCfg(result.config)
      props.onDone?.(result.config)
      await refreshCounts(result.config)
      await Dialog.alert({
        title: "Import Complete",
        message:
          `Module metadata entries scanned: ${result.scanned}\n` +
          `Created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}\n` +
          `Categories added: ${result.categoriesAdded}\n` +
          `${result.path}`,
      })
    } catch (e: any) {
      await Dialog.alert({ title: "Import Failed", message: String(e?.message ?? e) })
    } finally {
      setMetadataAction("")
    }
  }

  const bookmarkContextMenu = {
    menuItems: (
      <Group>
        <Button
          title="Choose a New Folder"
          systemImage="folder.badge.plus"
          action={() => void pickAndSaveBookmarkFolder()}
        />
      </Group>
    ),
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"Settings"}
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
          <Section header={<Text>Storage Directory</Text>}>
            <TextField
              label={<Text>Path</Text>}
              value={cfg.baseDir}
              onChanged={(v: string) => setCfg((c) => ({ ...c, baseDir: v, baseBookmarkName: "" }))}
              prompt="Paste or choose a directory"
              textFieldStyle="roundedBorder"
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              Select the Surge folder in iCloud Drive. The script uses or creates its Module subfolder and scans nested folders.
            </Text>
            {bookmarks.length ? (
              <Picker
                title={"Bookmarked Folder"}
                pickerStyle="menu"
                contextMenu={bookmarkContextMenu}
                value={bookmarkIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    void (async () => {
                      const fm: any = (globalThis as any).FileManager
                      const canUseByName = fm?.bookmarkExists
                        ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [b.name]))
                        : true
                      const resolved = fm?.bookmarkedPath && canUseByName
                        ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? b.path)
                        : b.path
                      const next: AppConfig = { ...cfg, baseDir: normalizeBookmarkPath(resolved || b.path), baseBookmarkName: b.name }
                      setCfg(next)
                      try {
                        saveConfig(next)
                        props.onDone?.(next)
                        await refreshCounts(next)
                      } catch {}
                    })()
                  }
                }}
              >
                {bookmarks.map((b, index) => (
                  <Text key={b.name} tag={index}>
                    {b.name}
                  </Text>
                ))}
              </Picker>
            ) : (
              <Text
                foregroundStyle="secondaryLabel"
                contextMenu={bookmarkContextMenu}
              >
                No bookmarks available. Touch and hold here to select a new folder.
              </Text>
            )}
          </Section>

          <Section header={<Text>Link Format</Text>}>
            <TextField
              label={<Text>Prefix</Text>}
              value={cfg.linkPatternsText}
              onChanged={(v: string) => setCfg((c) => ({ ...c, linkPatternsText: v }))}
              axis="vertical"
              lineLimit={{ min: 3, max: 6 }}
              prompt={"Examples:\n#!url=\n#SUBSCRIBED\nEnter one prefix per line in match order. Omit domains such as http://script.hub"}
              textFieldStyle="roundedBorder"
            />
          </Section>

          <Section
            header={<Text>Download Settings</Text>}
            footer={(
              <Text font="caption" foregroundStyle="secondaryLabel">
                With this setting on, saving syncs existing remote modules. Remote script-path resources in [Script] go to iCloud Drive/Surge/Script, and module references use Script/&lt;filename&gt;. RULE-SET and DOMAIN-SET resources in [Rule]/[Ruleset] and remote #!include resources go to the Surge root. These rules apply to all modules and resources. Module files stay in place. For conversion links, the installed module is the first source, and filenames follow the same naming rules. Ordinary rules, rewrite targets, and request parameters are preserved. Batch writes run sequentially and skip forcing a Surge reload for each module. Later updates continue to correct existing local resource paths with this setting off. If a module is marked as localized and a script is missing, its original module URL is used to restore it before the paths are corrected. Turning this setting off and saving restores remote references to existing remote modules, skips missing-resource recovery, and keeps local downloads. You can still select Make Scripts and Rule Sets Available Offline in an individual module's menu.
              </Text>
            )}
          >
            <Picker
              title={"Concurrent Downloads"}
              pickerStyle="menu"
              value={Math.max(0, concurrencyOptions.indexOf(cfg.downloadConcurrency))}
              onChanged={(idx: number) => {
                HapticFeedback.heavyImpact()
                const next = concurrencyOptions[idx] ?? 3
                setCfg((c) => ({ ...c, downloadConcurrency: next }))
              }}
            >
              {concurrencyOptions.map((num, idx) => (
                <Text key={`${num}`} tag={idx}>
                  {num}
                </Text>
              ))}
            </Picker>
            <Toggle
              title="Download Scripts and Rule Sets for Offline Use"
              value={cfg.localizeScriptsOnDownload}
              onChanged={(value: boolean) => {
                HapticFeedback.heavyImpact()
                void (async () => {
                  if (value) {
                    const root = await getSurgeBookmarkRoot()
                    if (!root) {
                      await Dialog.alert({
                        title: "Could Not Enable Offline Resources",
                        message: "Select a valid iCloud/Surge bookmark first. Modules go in Module, scripts go in Script, and rule sets and includes go in the Surge root. All writes stay within the Surge folder.",
                      })
                      return
                    }
                  }
                  setCfg((c) => ({ ...c, localizeScriptsOnDownload: value }))
                })()
              }}
            />
          </Section>

          <Section
            header={<Text>Legacy Data Cleanup</Text>}
            footer={(
              <Text font="caption" foregroundStyle="secondaryLabel">
                This removes only private resource directories used by older versions and preserves modules, backups, categories, and configuration. Current resources are saved to the iCloud Drive/Surge root. Module references use filenames without nested paths.
              </Text>
            )}
          >
            <PlainRowButton title="Clean Up Legacy Private Resources" onPress={cleanupLegacyPrivateResourcesAction} />
          </Section>

          <Section
            header={<Text>iCloud Metadata Sync</Text>}
            footer={(
              <Text font="caption" foregroundStyle="secondaryLabel">
                With Auto Sync on, exports use the default iCloud metadata file. With it off, exports prompt for a location and remove the default metadata file. You can import a JSON file from Files. Sync includes only names, URLs, categories, relative directories, and link formats.
              </Text>
            )}
          >
            <Toggle
              title="Auto Sync"
              value={cfg.iCloudMetadataSync}
              onChanged={(value: boolean) => void setICloudMetadataSync(value)}
            />
            <PlainRowButton title={metadataAction === "export" ? "Exporting…" : "Export Module Metadata"} onPress={exportMetadataAction} />
            <PlainRowButton title={metadataAction === "import" ? "Importing…" : "Import Module Metadata"} onPress={importMetadataAction} />
          </Section>

          <Section header={<Text>Categories</Text>}>
            {cfg.categories.length === 0 ? (
              <Text>No categories yet</Text>
            ) : (
              <ForEach
                count={cfg.categories.length}
                onDelete={(indices) => deleteCategoryAt(indices)}
                  itemBuilder={(index) => {
                    const cat = cfg.categories[index]
                    const count = categoryCounts[cat] ?? 0
                    return (
                      <HStack
                        key={cat}
                        leadingSwipeActions={{
                          allowsFullSwipe: false,
                          actions: [
                            <Button
                              title="Edit"
                              action={() => {
                                HapticFeedback.mediumImpact()
                                editCategory(cat)
                              }}
                            />,
                          ],
                        }}
                      >
                        <Text>{cat}</Text>
                        <Spacer />
                        <Text>{count}</Text>
                      </HStack>
                    )
                  }}
              />
            )}
          </Section>

          <Section>
            <PlainRowButton title="Import Categories" onPress={importCategories} />
            <PlainRowButton title="Add Category" onPress={addCategoryAction} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
