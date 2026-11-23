// ==UserScript==
// @name         Universal Magnet Links → MoviePilot 115 (Two Routes)
// @namespace    https://github.com/ranzhigg/scripting-scripts/dual-route
// @version      0.4.0
// @description  Detects BitTorrent magnet links on any resource page and submits them for offline downloads through MoviePilot or a 115 cookie.
// @author       ranzhi
// @updateURL    https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
// @downloadURL  https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
// @match        http://*/*
// @match        https://*/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.addStyle
// @grant        GM.registerMenuCommand
// @grant        GM.xmlHttpRequest
// @grant        GM.notification
// @grant        GM.setClipboard
// @connect      *
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @run-at       document-end
// @inject-into  content
// ==/UserScript==

(async () => {
  'use strict'

  const STORE = {
    mpUrl: 'generic_magnet_mp_url',
    apiKey: 'generic_magnet_mp_api_key',
    cookie: 'generic_magnet_115_cookie',
    offlinePath: 'generic_magnet_mp_offline_path',
    route: 'generic_magnet_route',
  }
  // The public script does not use any private directory by default. If left blank, P115StrmHelper uses its own default directory.
  const DEFAULT_OFFLINE_PATH = ''
  const DEFAULT_ROUTE = 'auto'
  const MP_PLUGIN_ID = 'P115StrmHelper'
  const MAGNET_PREFIX = 'magnet:?xt=urn:btih:'

  const state = {
    config: {
      mpUrl: '',
      apiKey: '',
      cookie: '',
      offlinePath: DEFAULT_OFFLINE_PATH,
      route: DEFAULT_ROUTE,
    },
    magnets: [],
    pushState: new Map(),
    panel: null,
    list: null,
    fab: null,
    scanTimer: null,
    observer: null,
    batchWorking: false,
    p115: { uid: '', sign: '', time: '', path: '', pathId: '' },
  }

  const $ = (selector, root = document) => root.querySelector(selector)

  function normalizeMpUrl(value) {
    let raw = String(value || '').trim()
    if (!raw) return ''
    try {
      const parsed = new URL(raw)
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http:// and https:// addresses are supported')
      parsed.search = ''
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/\/(?:login|home|dashboard)\/?$/i, '/')
      return parsed.toString().replace(/\/+$/, '')
    } catch (_) {
      throw new Error('Enter a MoviePilot API base URL such as http://10.0.200.10:3000')
    }
  }

  function cleanMagnet(value) {
    let text = String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .trim()
    if (!text) return ''
    try {
      if (/^magnet%3A%3F/i.test(text)) text = decodeURIComponent(text)
    } catch (_) {}
    const match = text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)
    if (!match) return ''
    return match[0].replace(/[)\]}>,.;，。；！？]+$/g, '')
  }

  function shortText(value, limit = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  }

  function sourceLabel(node) {
    if (!node) return shortText(document.title || location.hostname, 90)
    const container = node.closest('tr, li, article, section, p, dd, .card, .item, .resource, .torrent')
    return shortText(container?.innerText || node.textContent || document.title || location.hostname, 90)
  }

  function addMagnet(value, node = null, label = '') {
    const magnet = cleanMagnet(value)
    if (!magnet || !magnet.toLowerCase().startsWith(MAGNET_PREFIX.toLowerCase())) return
    if (state.magnets.some(item => item.magnet === magnet)) return
    state.magnets.push({ magnet, label: label || sourceLabel(node) })
  }

  function scanMagnets() {
    const previous = state.magnets
    state.magnets = []

    document.querySelectorAll('a[href], [data-magnet], [data-url], [data-link]').forEach(node => {
      const candidates = [
        node.getAttribute('href'),
        node.getAttribute('data-magnet'),
        node.getAttribute('data-url'),
        node.getAttribute('data-link'),
        node.textContent,
      ]
      candidates.forEach(value => addMagnet(value, node))
    })

    const bodyText = document.body?.innerText || ''
    const bodyMatches = bodyText.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/gi) || []
    bodyMatches.forEach(value => addMagnet(value, null, document.title || location.hostname))

    if (!state.magnets.length) {
      state.magnets = previous.filter(item => document.body?.innerText?.includes(item.magnet))
    }

    state.magnets.sort((left, right) => left.magnet.localeCompare(right.magnet))
    updateFab()
    renderList()
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer)
    state.scanTimer = setTimeout(scanMagnets, 350)
  }

  function notify(title, text) {
    try {
      GM.notification({ title, text })
    } catch (_) {}
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = callback => value => {
        if (settled) return
        settled = true
        callback(value)
      }
      try {
        GM.xmlHttpRequest({
          ...options,
          onload: done(resolve),
          onerror: done(reject),
          ontimeout: done(reject),
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function responseBody(response) {
    if (response?.response && typeof response.response === 'object') return response.response
    try {
      return JSON.parse(response?.responseText || '{}')
    } catch (_) {
      return {}
    }
  }

  function responseMessage(body, fallback = 'MoviePilot request failed') {
    return String(body?.msg || body?.message || body?.detail || body?.error_msg || body?.error || fallback)
  }

  function errorMessage(error, fallback = 'Network request failed') {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error) return error
    return String(error?.error || error?.message || error?.responseText || fallback)
  }

  function apiEnvelope(body) {
    return body?.data && typeof body.data === 'object' && body.data.code !== undefined
      ? body.data
      : body
  }

  async function requestMoviePilot(path, options = {}) {
    const { apiKey } = state.config
    const baseUrl = normalizeMpUrl(state.config.mpUrl)
    if (!baseUrl || !apiKey) throw new Error('Configure the MoviePilot address and API key first')
    const response = await gmRequest({
      method: options.method || 'GET',
      url: `${baseUrl}${path}`,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      data: options.body ? JSON.stringify(options.body) : undefined,
      responseType: 'json',
      timeout: options.timeout || 30000,
    })
    const body = responseBody(response)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${response.status || 'Network'}: ${responseMessage(body)}`)
    }
    return body
  }

  function formBody(values) {
    const params = new URLSearchParams()
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
    })
    return params.toString()
  }

  async function request115(url, options = {}) {
    const cookie = String(state.config.cookie || '').trim()
    if (!cookie) throw new Error('Configure your 115 cookie first')
    const response = await gmRequest({
      method: options.method || 'GET',
      url,
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        Cookie: cookie,
        ...(options.headers || {}),
      },
      data: options.body ? formBody(options.body) : undefined,
      withCredentials: true,
      responseType: 'json',
      timeout: options.timeout || 30000,
    })
    const body = responseBody(response)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${response.status || 'Network'}: ${responseMessage(body, '115 request failed')}`)
    }
    return body
  }

  function is115Success(body) {
    return body?.state === true || body?.state === 1 || body?.code === 0 || body?.code === '0'
  }

  async function get115Session() {
    if (state.p115.uid && state.p115.sign && state.p115.time) return state.p115
    const uidBody = await request115('https://my.115.com/?ct=ajax&ac=get_user_aq', { timeout: 15000 })
    const uid = uidBody?.data?.uid || uidBody?.uid
    if (!uid) throw new Error(responseMessage(uidBody, 'Could not retrieve the UID. The 115 cookie is invalid or has expired.'))
    const signBody = await request115('https://115.com/?ct=offline&ac=space', { timeout: 15000 })
    const sign = signBody?.sign || signBody?.data?.sign
    const time = signBody?.time || signBody?.data?.time
    if (!sign || !time) throw new Error(responseMessage(signBody, 'Could not retrieve the offline download signature. The 115 cookie is invalid or has expired.'))
    state.p115 = { uid: String(uid), sign: String(sign), time: String(time), path: '', pathId: '' }
    return state.p115
  }

  function folderItems(body) {
    const data = Array.isArray(body?.data) ? body.data : body?.data?.data
    return Array.isArray(data) ? data : []
  }

  function folderName(item) {
    return String(item?.n || item?.name || item?.file_name || '').trim()
  }

  function folderId(item) {
    return String(item?.cid || item?.fid || item?.file_id || item?.id || '').trim()
  }

  function isFolder(item) {
    return item && !item.sha && !item.sha1 && (item.is_dir === undefined || item.is_dir === true || !item.type)
  }

  async function get115FolderItems(cid) {
    const query = new URLSearchParams({
      aid: '1',
      cid: String(cid || '0'),
      o: 'user_ptime',
      asc: '0',
      offset: '0',
      show_dir: '1',
      limit: '500',
      snap: '0',
      natsort: '1',
    })
    return folderItems(await request115(`https://webapi.115.com/files?${query}`, { timeout: 30000 }))
  }

  async function create115Folder(parentId, name) {
    const body = await request115('https://webapi.115.com/files/add', {
      method: 'POST',
      body: { pid: parentId, cname: name },
      timeout: 30000,
    })
    const createdId = folderId(body) || folderId(body?.data)
    if (createdId) return createdId
    const created = (await get115FolderItems(parentId)).find(item => isFolder(item) && folderName(item) === name)
    if (created && folderId(created)) return folderId(created)
    throw new Error(responseMessage(body, `Could not create the 115 directory: ${name}`))
  }

  async function resolve115Path(path) {
    const raw = String(path || '').trim()
    if (!raw || raw === '/') return ''
    if (/^\d+$/.test(raw)) return raw
    const parts = raw.split(/[\\/]+/).map(item => item.trim()).filter(Boolean)
    if (!parts.length) return ''
    if (parts.length > 25) throw new Error('115 directory paths can be at most 25 levels deep')
    let currentId = '0'
    for (const part of parts) {
      if (part === '.' || part === '..') throw new Error('115 directory paths cannot contain . or ..')
      const existing = (await get115FolderItems(currentId)).find(item => isFolder(item) && folderName(item) === part)
      currentId = existing ? folderId(existing) : await create115Folder(currentId, part)
      if (!currentId) throw new Error(`Could not resolve the 115 directory: ${part}`)
    }
    return currentId
  }

  async function add115OfflineTask(magnet) {
    const session = await get115Session()
    if (state.p115.path !== state.config.offlinePath) {
      state.p115.path = state.config.offlinePath
      state.p115.pathId = await resolve115Path(state.config.offlinePath)
    }
    const payload = {
      url: magnet,
      savepath: '',
      ...(state.p115.pathId ? { wp_path_id: state.p115.pathId } : {}),
      uid: session.uid,
      sign: session.sign,
      time: session.time,
    }
    const body = await request115('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', {
      method: 'POST',
      body: payload,
      timeout: 60000,
    })
    if (!is115Success(body)) throw new Error(responseMessage(body, '115 offline download failed'))
    return body
  }

  async function submit115Links(links) {
    const results = []
    const completed = []
    try {
      for (const link of links) {
        results.push(await add115OfflineTask(link))
        completed.push(link)
      }
    } catch (error) {
      error.completed = completed
      throw error
    }
    return {
      source: '115',
      body: { state: true, msg: `${results.length} tasks submitted to 115` },
      results,
    }
  }

  async function submitMoviePilotLinks(links) {
    const body = await requestMoviePilot(`/api/v1/plugin/${MP_PLUGIN_ID}/add_offline_task`, {
      method: 'POST',
      body: {
        links,
        path: state.config.offlinePath || null,
      },
      timeout: 60000,
    })
    const envelope = apiEnvelope(body)
    if (typeof envelope?.code === 'number' && envelope.code !== 0) {
      throw new Error(responseMessage(envelope, '115 offline download failed'))
    }
    return { source: 'mp', body: envelope }
  }

  async function verifyMoviePilot() {
    const body = await requestMoviePilot('/api/v1/user/current', { timeout: 10000 })
    const user = body?.data && typeof body.data === 'object' ? body.data : body
    return user?.username || user?.name || 'Connection successful'
  }

  async function submitOfflineLinks(links) {
    const uniqueLinks = [...new Set(links.map(cleanMagnet).filter(Boolean))]
    if (!uniqueLinks.length) throw new Error('No magnet links to submit')
    const canMoviePilot = Boolean(state.config.mpUrl && state.config.apiKey)
    const can115 = Boolean(state.config.cookie)
    if (state.config.route === '115') {
      if (!can115) throw new Error('The 115 route requires a 115 cookie')
      return submit115Links(uniqueLinks)
    }
    if (state.config.route === 'mp') {
      if (!canMoviePilot) throw new Error('The MoviePilot route requires an address and API key')
      return submitMoviePilotLinks(uniqueLinks)
    }
    if (canMoviePilot) {
      try {
        return await submitMoviePilotLinks(uniqueLinks)
      } catch (error) {
        if (!can115) throw error
        notify('MoviePilot Submission Failed. Switching to 115', 'This batch will be retried using the 115 cookie stored on this device.')
      }
    }
    if (can115) return submit115Links(uniqueLinks)
    throw new Error('Configure a MoviePilot address and API key, or a 115 cookie')
  }

  function submissionMessage(result, fallback) {
    const directResult = result?.results?.[0]
    return responseMessage(result?.body || directResult || result, fallback)
  }

  function hasSubmissionRoute() {
    return Boolean(
      (state.config.mpUrl && state.config.apiKey) ||
      state.config.cookie,
    )
  }

  async function pushMagnet(item) {
    const current = state.pushState.get(item.magnet) || 'idle'
    if (current === 'working' || state.batchWorking) return
    if (!hasSubmissionRoute()) {
      await openSettings()
      if (!hasSubmissionRoute()) return
    }

    state.pushState.set(item.magnet, 'working')
    renderList()
    try {
      const result = await submitOfflineLinks([item.magnet])
      const duplicate = /已存在|重复|already/i.test(submissionMessage(result, ''))
      state.pushState.set(item.magnet, duplicate ? 'duplicate' : 'success')
      const title = duplicate ? '115 Task Already Exists' : 'Submitted to 115'
      notify(title, `${shortText(item.label, 50)}\nFolder: ${state.config.offlinePath || 'P115StrmHelper default folder'}`)
    } catch (error) {
      state.pushState.set(item.magnet, 'error')
      notify('115 Submission Failed', errorMessage(error))
    } finally {
      renderList()
    }
  }

  async function pushPendingMagnets() {
    if (state.batchWorking) return
    const pending = state.magnets.filter(item => {
      const status = state.pushState.get(item.magnet) || 'idle'
      return status !== 'success' && status !== 'duplicate' && status !== 'working'
    })
    if (!pending.length) {
      notify('No Pending Magnet Links', 'All magnet links on this page have been submitted or are in progress.')
      return
    }
    if (!hasSubmissionRoute()) {
      await openSettings()
      if (!hasSubmissionRoute()) return
    }

    state.batchWorking = true
    pending.forEach(item => state.pushState.set(item.magnet, 'working'))
    renderList()
    try {
      const result = await submitOfflineLinks(pending.map(item => item.magnet))
      const message = submissionMessage(result, `${pending.length} tasks submitted`)
      const duplicate = /已存在|重复|already/i.test(message)
      pending.forEach(item => state.pushState.set(item.magnet, duplicate ? 'duplicate' : 'success'))
      notify(duplicate ? '115 Tasks Already Exist' : '115 Batch Submitted', `${message}\nMagnet links processed: ${pending.length}`)
    } catch (error) {
      const completed = new Set(error?.completed || [])
      pending.forEach(item => state.pushState.set(item.magnet, completed.has(item.magnet) ? 'success' : 'error'))
      notify('115 Batch Submission Failed', errorMessage(error))
    } finally {
      state.batchWorking = false
      renderList()
    }
  }

  async function openSettings() {
    const current = state.config
    const url = window.prompt('MoviePilot address (leave blank to connect directly with a 115 cookie)', current.mpUrl)
    if (url === null) return
    const apiKey = window.prompt('MoviePilot API key (leave blank to keep it or enter - to clear it. The current value is hidden.)', '')
    if (apiKey === null) return
    const cookie = window.prompt('115 cookie (optional and stored on this device. Leave blank to keep it or enter - to clear it.)', '')
    if (cookie === null) return
    const path = window.prompt('115 offline download folder (enter a path such as /影视/待整理 or a directory ID. Leave blank to use the default.)', current.offlinePath || '')
    if (path === null) return
    const route = window.prompt('Submission route: auto=MoviePilot with 115 fallback, mp=MoviePilot only, 115=direct with a cookie only', current.route || DEFAULT_ROUTE)
    if (route === null) return

    try {
      state.config.mpUrl = normalizeMpUrl(url)
    } catch (error) {
      notify('Invalid MoviePilot address', error?.message || String(error))
      return
    }
    if (apiKey.trim() === '-') state.config.apiKey = ''
    else if (apiKey.trim()) state.config.apiKey = apiKey.trim()
    if (cookie.trim() === '-') state.config.cookie = ''
    else if (cookie.trim()) state.config.cookie = cookie.trim()
    state.config.offlinePath = path.trim() || DEFAULT_OFFLINE_PATH
    state.config.route = /^(auto|mp|115)$/i.test(route.trim()) ? route.trim().toLowerCase() : DEFAULT_ROUTE
    state.p115 = { uid: '', sign: '', time: '', path: '', pathId: '' }
    await Promise.all([
      GM.setValue(STORE.mpUrl, state.config.mpUrl),
      GM.setValue(STORE.apiKey, state.config.apiKey),
      GM.setValue(STORE.cookie, state.config.cookie),
      GM.setValue(STORE.offlinePath, state.config.offlinePath),
      GM.setValue(STORE.route, state.config.route),
    ])
    if (state.config.mpUrl && state.config.apiKey) {
      try {
        const user = await verifyMoviePilot()
        notify('Settings Saved', `MoviePilot: ${user}\n115 folder: ${state.config.offlinePath || 'Default folder'}`)
      } catch (error) {
        notify('Settings Saved. MoviePilot Connection Test Failed', error?.message || String(error))
      }
    } else if (state.config.cookie) {
      try {
        await get115Session()
        notify('Settings Saved', `115 cookie verified\nFolder: ${state.config.offlinePath || '115 default folder'}`)
      } catch (error) {
        notify('Settings Saved. 115 Cookie Test Failed', error?.message || String(error))
      }
    } else {
      notify('Settings Saved', 'Configure MoviePilot or a 115 cookie before submitting tasks.')
    }
    updateFab()
  }

  function addStyle() {
    GM.addStyle(`
      #mp115-magnet-fab { position: fixed; right: 16px; bottom: 22px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 10px 14px; color: #fff; background: #5b5ce2; box-shadow: 0 6px 24px rgba(48, 51, 140, .32); font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
      #mp115-magnet-panel { position: fixed; right: 16px; bottom: 70px; z-index: 2147483647; display: none; width: min(420px, calc(100vw - 32px)); max-height: min(70vh, 620px); overflow: hidden; border: 1px solid rgba(120, 120, 180, .24); border-radius: 18px; color: #202033; background: rgba(255, 255, 255, .98); box-shadow: 0 18px 60px rgba(20, 20, 70, .24); font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
      #mp115-magnet-panel.open { display: flex; flex-direction: column; }
      #mp115-magnet-panel .mp115-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid #ececf4; }
      #mp115-magnet-panel .mp115-title { flex: 1; font-size: 15px; font-weight: 700; }
      #mp115-magnet-panel button { border: 0; cursor: pointer; font: inherit; }
      #mp115-magnet-panel .mp115-icon { width: 28px; height: 28px; border-radius: 8px; color: #5556d5; background: #f0f0ff; }
      #mp115-magnet-panel .mp115-body { overflow: auto; padding: 10px; }
      #mp115-magnet-panel .mp115-empty { padding: 24px 12px; color: #707084; text-align: center; line-height: 1.6; }
      #mp115-magnet-panel .mp115-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 12px; background: #f7f7fb; }
      #mp115-magnet-panel .mp115-label { overflow: hidden; color: #4f4f64; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      #mp115-magnet-panel .mp115-magnet { overflow: hidden; margin-top: 4px; color: #8b8b9b; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      #mp115-magnet-panel .mp115-actions { display: flex; gap: 5px; }
      #mp115-magnet-panel .mp115-push { padding: 7px 9px; border-radius: 9px; color: #fff; background: #5b5ce2; white-space: nowrap; }
      #mp115-magnet-panel .mp115-push.success { background: #2caa70; }
      #mp115-magnet-panel .mp115-push.duplicate { color: #946c00; background: #fff0bf; }
      #mp115-magnet-panel .mp115-push.error { color: #a62f3b; background: #ffe3e5; }
      #mp115-magnet-panel .mp115-copy { padding: 7px 8px; border-radius: 9px; color: #5a5a70; background: #e9e9f2; }
      #mp115-magnet-panel .mp115-foot { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #ececf4; }
      #mp115-magnet-panel .mp115-foot button { flex: 1; padding: 9px; border-radius: 10px; color: #5556d5; background: #f0f0ff; }
      @media (prefers-color-scheme: dark) {
        #mp115-magnet-panel { color: #f4f4fa; background: rgba(35, 35, 43, .98); }
        #mp115-magnet-panel .mp115-head, #mp115-magnet-panel .mp115-foot { border-color: #4a4a55; }
        #mp115-magnet-panel .mp115-row { background: #2c2c35; }
        #mp115-magnet-panel .mp115-label { color: #e5e5ef; }
        #mp115-magnet-panel .mp115-magnet { color: #9f9faf; }
        #mp115-magnet-panel .mp115-icon, #mp115-magnet-panel .mp115-foot button { color: #c9c9ff; background: #41415f; }
        #mp115-magnet-panel .mp115-copy { color: #dedeee; background: #4a4a55; }
      }
    `)
  }

  function updateFab() {
    if (!state.fab) return
    const count = state.magnets.length
    state.fab.textContent = count ? `MP / 115 · ${count}` : 'MP / 115'
    state.fab.title = hasSubmissionRoute() ? `Found ${count} magnet links` : 'Configure MoviePilot or a 115 cookie first'
    state.fab.style.display = count ? 'block' : 'none'
  }

  function renderList() {
    if (!state.list) return
    state.list.replaceChildren()
    if (!state.magnets.length) {
      const empty = document.createElement('div')
      empty.className = 'mp115-empty'
      empty.textContent = 'No BitTorrent magnet links found on this page.'
      state.list.appendChild(empty)
      return
    }
    state.magnets.forEach(item => {
      const row = document.createElement('div')
      row.className = 'mp115-row'
      const info = document.createElement('div')
      const label = document.createElement('div')
      label.className = 'mp115-label'
      label.textContent = item.label || document.title || location.hostname
      const magnet = document.createElement('div')
      magnet.className = 'mp115-magnet'
      magnet.textContent = item.magnet
      info.append(label, magnet)
      const actions = document.createElement('div')
      actions.className = 'mp115-actions'
      const status = state.pushState.get(item.magnet) || 'idle'
      const push = document.createElement('button')
      push.className = `mp115-push ${status === 'success' || status === 'duplicate' || status === 'error' ? status : ''}`
      push.textContent = status === 'working'
        ? 'Submitting…'
        : status === 'success'
          ? 'Submitted'
          : status === 'duplicate'
            ? 'Already Exists'
            : status === 'error'
              ? 'Retry'
              : 'Send to 115'
      push.disabled = status === 'working' || state.batchWorking
      push.addEventListener('click', () => pushMagnet(item))
      const copy = document.createElement('button')
      copy.className = 'mp115-copy'
      copy.textContent = 'Copy'
      copy.addEventListener('click', async () => {
        try {
          await GM.setClipboard(item.magnet)
          notify('Magnet Link Copied', 'Copied to the clipboard')
        } catch (_) {
          window.prompt('Copy Magnet Link', item.magnet)
        }
      })
      actions.append(push, copy)
      row.append(info, actions)
      state.list.appendChild(row)
    })
  }

  function createPanel() {
    addStyle()
    const fab = document.createElement('button')
    fab.id = 'mp115-magnet-fab'
    fab.addEventListener('click', () => {
      state.panel.classList.toggle('open')
      renderList()
    })
    document.body.appendChild(fab)
    state.fab = fab

    const panel = document.createElement('div')
    panel.id = 'mp115-magnet-panel'
    panel.innerHTML = `
      <div class="mp115-head">
        <div class="mp115-title">Magnet Links · MoviePilot 115</div>
        <button class="mp115-icon" data-action="settings" title="Settings">⚙</button>
        <button class="mp115-icon" data-action="close" title="Close">×</button>
      </div>
      <div class="mp115-body" data-role="list"></div>
      <div class="mp115-foot">
        <button data-action="refresh">Rescan</button>
        <button data-action="batch">Send All</button>
        <button data-action="settings">Settings</button>
      </div>
    `
    document.body.appendChild(panel)
    state.panel = panel
    state.list = $('[data-role="list"]', panel)
    panel.querySelectorAll('[data-action="settings"]').forEach(button => button.addEventListener('click', openSettings))
    $('[data-action="close"]', panel).addEventListener('click', () => panel.classList.remove('open'))
    $('[data-action="refresh"]', panel).addEventListener('click', scanMagnets)
    $('[data-action="batch"]', panel).addEventListener('click', pushPendingMagnets)
    updateFab()
  }

  async function loadConfig() {
    const savedUrl = String(await GM.getValue(STORE.mpUrl, '') || '').trim()
    try {
      state.config.mpUrl = normalizeMpUrl(savedUrl)
    } catch (_) {
      state.config.mpUrl = savedUrl
    }
    state.config.apiKey = String(await GM.getValue(STORE.apiKey, '') || '').trim()
    state.config.cookie = String(await GM.getValue(STORE.cookie, '') || '').trim()
    state.config.offlinePath = String(await GM.getValue(STORE.offlinePath, DEFAULT_OFFLINE_PATH) || DEFAULT_OFFLINE_PATH).trim()
    const savedRoute = String(await GM.getValue(STORE.route, DEFAULT_ROUTE) || DEFAULT_ROUTE).trim().toLowerCase()
    state.config.route = /^(auto|mp|115)$/.test(savedRoute) ? savedRoute : DEFAULT_ROUTE
  }

  await loadConfig()
  if (!document.body) return
  createPanel()
  GM.registerMenuCommand('Configure MoviePilot 115', openSettings)
  scanMagnets()
  state.observer = new MutationObserver(scheduleScan)
  state.observer.observe(document.body, { childList: true, subtree: true })
})().catch(error => {
  try { GM.log('Could not initialize the magnet link userscript', error) } catch (_) {}
})
