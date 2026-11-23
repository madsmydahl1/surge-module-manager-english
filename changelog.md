# Changelog

## v4.2.24

- Updated remote control for new Surge HTTP API features, including `/v1` path normalization, X-Key and Bearer authentication, and clearer timeout and error reporting.
- Added Advanced Surge Controls to view and toggle temporary policy avoidance, configure in-memory and on-disk HTTP capture filters, and read saved capture sessions.
- Kept the Surge runtime notice on the capture toggle. Starting or stopping capture closes existing connections. Filter scope, match type, keywords, HTTP-only, and the options for hiding Apple or UDP requests use the official API fields.

## v4.2.23

- Module, script, rule set, and include writes all use the authorized `iCloud Drive/Surge` directory.
- Scripts go in `Surge/Script`, and the corresponding module paths use `Script/<filename>`.
- Rule sets and includes go in the Surge root, with filenames that match the module references.
- Failed updates, imports, resource localization, categorization, and rollbacks automatically restore the previous state to avoid leaving unusable local resources.
- Settings now lets you turn resource localization on or off. Turning it off restores remote references and keeps downloaded files.

## 2026-11-13

- Added `Magnet-MoviePilot-115.user.js`, a general-purpose magnet link submission script for Scripting Safari Browser Scripts.
- Calls the P115StrmHelper 115 offline task API directly, supports custom directories, and works across sites.
- Automatically strips frontend routes such as `#/login` and `/login` from MoviePilot addresses to avoid generating invalid API URLs.
- Added batch submission for pending magnet links, shared response parsing, and retries for failed items to reduce failures when submitting several links.
- Added two submission routes through MoviePilot and a 115 cookie. You can call the 115 offline download API directly without MoviePilot. A folder path can be resolved or created automatically, or you can enter a directory ID.
- Added playback options for Infuse, VLC, the browser, and custom URL schemes, using P115StrmHelper's anonymous 302 redirect when available. Direct 115 mode uses a one-time download URL.
- Added automatic script update URLs and local configuration instructions. The cookie is stored only on the device in Scripting's local storage.
- Some Scripting versions kept the local `0.2.0` entry under its old script identity. Renamed the release to Universal Magnet Links → MoviePilot 115 (Two Routes) and bumped the version to `0.3.2` so the old entry would not block reinstallation.
- `v0.4.0` removed player launching, pickcodes, and playback URL settings so unfinished offline tasks would not be treated as playable files. The MoviePilot and direct 115 cookie routes remain available.
