# Surge Module Manager (Scripting)

Manage local Surge `.sgmodule` files on iPhone and iPad. Download the scripts, rule sets, and includes referenced by your modules to iCloud Drive for offline use in Surge.

## Installation

1. Open “Import Remote Script” in Scripting.
2. Paste `https://github.com/ranzhigg/Scripting-Scripts`.
3. After importing, run “Surge Module Manager”.

The script runs in Scripting without Surge for Mac, Node.js, or Scriptable. To use Script-Hub conversion, enable the corresponding Script-Hub module and rewrites in Surge.

## Universal Magnet Links → MoviePilot 115

The repository also includes a general-purpose userscript for Scripting Safari Browser Scripts.

```text
https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
```

In Scripting's Safari Browser Scripts extension, choose “Install from URL” and paste the address above. The current release uses the name “Universal Magnet Links → MoviePilot 115 (Two Routes)”. If the older `0.2.0` entry is still on your device, use the script with the new name.

The userscript supports two submission routes.

- With MoviePilot, the script calls `P115StrmHelper/add_offline_task`. Enter just the API base URL, such as `http://10.0.200.10:3000`, and omit `#/login`.
- Without MoviePilot, you can enter your own 115 cookie to call the 115 offline download API directly. Enter a directory path such as `/影视/待整理` or a directory ID. The script creates any missing folders along the path.

Use the script menu to configure MoviePilot, your 115 cookie, the offline download folder, and the preferred submission route. The default `auto` setting tries MoviePilot first and falls back to 115 if it fails. You can also choose `mp` or `115`. The cookie stays in Scripting's local script storage on your device and is excluded from repository uploads, notifications, and logs. Keep your cookie out of the source code when sharing it.

The panel supports single and batch submissions and retries for failed items. Its job ends when it submits the magnet links to MoviePilot or 115. It runs independently of the pickcode generated after a download and leaves playback to your existing MoviePilot or 115 setup.

## Initial Setup

1. Confirm that Scripting can access iCloud Drive and see `iCloud Drive/Surge`.
2. Open “Settings” in the upper-right corner of the script, then open “Storage Directory” and select the **`iCloud Drive/Surge` root folder**.
3. Select the root folder itself. The script automatically creates or uses the `Module` and `Script` subfolders.
4. To import files from the system share sheet or Shortcuts, tap the project title, open Intent, and enable `File URLs`, `URLs`, and `Text`.

The directory is organized as follows.

```text
iCloud Drive/Surge/
├─ Module/                 Surge modules (.sgmodule)
│  ├─ .surge-module-backups/ Module backups
│  └─ Other subfolders/     Optional folders for organizing modules
├─ Script/                 Module script resources (.js)
├─ *.list / *.conf         Rule sets and include resources
```

All module and resource writes stay inside this Surge directory, with no fallback to Scripting's private directory. The script rejects writes if the bookmark is invalid or the directory is outside the Surge root.

## Make Module Resources Available Offline

Downloaded modules use upstream remote scripts by default. To make resources available locally, follow these steps.

1. Open “Settings” and enable “Download Scripts and Rule Sets for Offline Use”.
2. Tap “Save” to sync existing remote modules.
3. Future updates and imports automatically download resources and rewrite their paths.

Resources are saved as follows.

- Scripts in `[Script]` are saved in `Surge/Script/`. The module uses `script-path=Script/<filename>`.
- `RULE-SET`, `DOMAIN-SET`, and `#!include` resources are saved in the `Surge/` root. Modules reference those files by filename.
- Filenames use the actual basename of each remote resource. The module reference matches the local filename exactly.
- The module preserves its original `#!url` for future updates and stays in `Surge/Module/`.
- Turning the setting off and saving restores remote references in existing modules and keeps the local downloads.

After each write, the script reads back the module and its resources to verify them. If a write fails, it restores the original file or removes the partial new file.

## Manage Modules

- Use “Module Manager” to add, update, search, categorize, move, back up, roll back, or delete modules.
- Modules with the same name update the existing file. Categories are written to the module's `#!category=...` metadata and survive backup and reimport.
- Newly imported modules start disabled. Review their contents in Surge before enabling them.
- To remove hidden resources created by older versions, open “Settings” and choose “Clean Up Legacy Private Resources”. This cleanup preserves the current `Module`, `Script`, and root resources.

## Advanced Surge Controls

Open “Advanced Surge Controls” from “HTTP Remote Control”.

- Policy avoidance lets you view proxy policies and temporarily mark or clear policies to avoid in automatic policy groups. This applies only to `url-test`, `fallback`, `load-balance`, and `smart`. Surge clears the settings when it restarts.
- HTTP capture filters let you separately configure filters for in-memory requests and on-disk sessions. Options include `off`, keyword inclusion or exclusion, `pattern`, HTTP-only, and hiding Apple, UDP, or crash report requests.
- Capture sessions shows Surge's saved HTTP Capture sessions and request counts.

Advanced controls use the Surge HTTP API's `/v1` path. Authentication defaults to `X-Key`. You can switch to `Authorization: Bearer` on the remote control page. Starting or stopping HTTP Capture closes existing connections. Turn it off when you finish troubleshooting.

## Script-Hub Conversion

1. Open the “Script-Hub” tab.
2. Paste the HTTPS URL of a plugin, module, or rule set, or switch to “Local Text” and paste the content.
3. Detect the source format, then choose the target platform and output type.
4. Select Surge Module and tap “Convert and Write to Surge” to write directly to the authorized `Surge/Module/` folder.

For other clients, use the import link on the page or copy the conversion result. Use the generated link to avoid copying an unencoded conversion URL from the browser's address bar.

## File Sharing and Shortcuts

- Select one or more `.sgmodule` files in Files and share them with this script to import them into Surge.
- Each file is written individually by filename. A matching filename updates the existing module, and failures are reported individually.
- To share HTTPS links or text, enable `URLs` or `Text` in the Intent settings.
- In Shortcuts, pass `all` to update all remote modules, or pass a category or module name. Set up the Surge directory before running the shortcut.

## Troubleshooting

### Modules Are Missing in Surge

Confirm that `iCloud Drive/Surge` is selected in Settings and that the module is in `Surge/Module/`. Return to Module Manager and refresh. If Surge is slow to reflect the change, re-enable the module in Surge.

### `Invalid Local Resource`

After turning on offline resources, update the module or use “Make Scripts and Rule Sets Available Offline”. Confirm that scripts are in `Surge/Script/` and that the module references them as `Script/<filename>`. Rule sets and includes belong in the `Surge/` root.

### Module Download Failed

First check that the source URL is reachable. Script-Hub conversion modules require the Script-Hub module and rewrites to be enabled in Surge. When updating an installed converted module, the script first uses the existing module content for local repairs.

### Scripting Can't Receive Shared Files

Tap the project title, open Intent, and enable `File URLs`. Then share the `.sgmodule` file again.

## Repository

Source code and release history are available on <https://github.com/ranzhigg/Scripting-Scripts>.
