// PearPetal shell: hosts the Bare worklet (P2P backend) and the WebView UI, and
// bridges IPC between them. The one bit of custom native code is the iOS
// local-network prompt module (modules/local-network); the worklet and WebView
// are otherwise pure RN libraries. The shell stays minimal: worklet host,
// WebView, IPC bridge, a few shell actions, the local-network nudge, deep-link
// invite delivery, and opt-in to-self cycle reminders (OS-scheduled local
// notifications). Background sync and native QR scan land in later slices (see
// the wire proposal and TODO).

import { useEffect, useRef, useState } from 'react'
import { View, Platform, Share, StatusBar, BackHandler, AppState } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Worklet } from 'react-native-bare-kit'
import b4a from 'b4a'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import * as Haptics from 'expo-haptics'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { requestLocalNetworkPermission } from '../modules/local-network'

// Pre-paint background per theme, so a light-theme user does not flash the dark
// shell bg before the WebView's JS applies the palette. Must match theme.js
// --color-surface-base. The WebView persists its resolved theme (shell:theme) so
// the shell can read it here on the next boot.
const THEME_KEY = 'pearpetal:theme:resolved'
const SHELL_BG: Record<string, string> = { dark: '#140f11', light: '#faf4f5' }
const bgFor = (t: string) => SHELL_BG[t] || SHELL_BG.dark

// --- worklet + IPC (module-scoped so it survives remounts) -----------------
let _worklet: any = null
let _workletStarted = false
let _initError: string | null = null
let _webViewRef: { current: any } | null = null
const _pending = new Map<number, (msg: any) => void>()
let _nextId = 1

function sendToWorklet (msg: object) {
  _worklet?.IPC.write(b4a.from(JSON.stringify(msg) + '\n'))
}
function callRaw (method: string, args: any = {}): Promise<any> {
  return new Promise((resolve) => {
    const id = _nextId++
    _pending.set(id, (msg) => resolve(msg))
    sendToWorklet({ id, method, args })
  })
}
function emitEvent (event: string, data?: any) {
  _webViewRef?.current?.injectJavaScript(`window.__pearEvent(${JSON.stringify(event)}, ${JSON.stringify(data ?? null)}); true;`)
}

// --- local notifications (opt-in to-self cycle reminders) -------------------
// Design: proposals/2026-07-09-notifications.md. The worklet owns the prefs +
// the goal-aware/confidence-gated event computation (notifications:schedule);
// the shell is a thin scheduler - it fetches the events and hands them to the OS,
// which delivers them even when the app is closed (no background execution). A
// single neutral Android channel ("Reminders") so the channel label reveals
// nothing; discreet wording is handled per-notification in the worklet.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
})
const NOTIF_CHANNEL = 'reminders'
async function ensureNotifSetup (request: boolean): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIF_CHANNEL, {
      name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT,
      description: 'Cycle reminders you have turned on',
    }).catch(() => {})
  }
  let status = (await Notifications.getPermissionsAsync()).status
  // Only ever prompt when the user is actively opting in (request=true), so a
  // boot / foreground resync never surprises them with a permission dialog.
  if (status !== 'granted' && request) status = (await Notifications.requestPermissionsAsync()).status
  return status === 'granted'
}
// Cancel every PearPetal-scheduled notification (ids are prefixed "pp:"), leaving
// anything else untouched.
async function cancelOurNotifications () {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(all
      .filter((n) => String(n.identifier).startsWith('pp:'))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})))
  } catch {}
}
// Reconcile the OS-scheduled notifications with the worklet's current schedule.
// request=true is passed only from an explicit user opt-in so the OS prompt fires
// then and not on a background resync.
async function syncNotifications (opts: { request?: boolean } = {}): Promise<{ enabled: boolean; granted: boolean; scheduled: number }> {
  let prefs: any = {}
  try { prefs = (await callRaw('notifications:get'))?.result || {} } catch {}
  await cancelOurNotifications() // always clear ours first (a clean reschedule)
  if (!prefs.enabled) return { enabled: false, granted: false, scheduled: 0 }
  const granted = await ensureNotifSetup(!!opts.request)
  if (!granted) return { enabled: true, granted: false, scheduled: 0 }
  let events: any[] = []
  try { events = (await callRaw('notifications:schedule'))?.result?.events || [] } catch {}
  const now = Date.now()
  let scheduled = 0
  for (const e of events) {
    const [y, m, d] = String(e.dateIso).split('-').map(Number)
    if (!y || !m || !d) continue
    const when = new Date(y, m - 1, d, e.hour ?? 9, e.minute ?? 0, 0, 0) // local time on that date
    if (when.getTime() <= now) continue // drop any already-past time today
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: e.id,
        content: {
          title: e.title, body: e.body, data: { tag: 'pearpetal', category: e.category },
          ...(Platform.OS === 'android' ? { channelId: NOTIF_CHANNEL } : {}),
        },
        // For a DATE (scheduled) trigger, Android takes the channel from the
        // TRIGGER, not content - content.channelId is only honoured for immediate
        // notifications. Without this the OS routes it to expo's fallback channel.
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE, date: when,
          ...(Platform.OS === 'android' ? { channelId: NOTIF_CHANNEL } : {}),
        },
      })
      scheduled++
    } catch {}
  }
  return { enabled: true, granted: true, scheduled }
}

async function startWorklet (): Promise<string | null> {
  if (_workletStarted) return _initError
  _workletStarted = true
  const asset = Asset.fromModule(
    Platform.OS === 'ios' ? require('../assets/bare-ios.bundle') : require('../assets/bare-universal.bundle')
  )
  await asset.downloadAsync()
  const bundle = await FileSystem.readAsStringAsync(asset.localUri!, { encoding: FileSystem.EncodingType.Base64 })

  _worklet = new Worklet()
  await _worklet.start('/app.bundle', b4a.from(bundle, 'base64'))

  let buffer = ''
  _worklet.IPC.on('data', (chunk: any) => {
    buffer += b4a.toString(chunk)
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id != null && _pending.has(msg.id)) { _pending.get(msg.id)!(msg); _pending.delete(msg.id) }
        else if (msg.event) emitEvent(msg.event, msg.data)
      } catch {}
    }
  })

  // Corestore lives under the app's document directory (file:// stripped).
  const dataDir = FileSystem.documentDirectory!.replace(/^file:\/\//, '').replace(/\/$/, '')
  const initRes = await callRaw('init', { dataDir })
  // DIAGNOSTIC (iOS engine-init bug 2026-07-07): callRaw never rejects, so an init
  // failure is otherwise swallowed. Persist it so it can be pulled off-device.
  if (initRes?.error) {
    _initError = `dataDir=${dataDir}\n${String(initRes.error)}`
    try {
      await FileSystem.writeAsStringAsync(
        FileSystem.documentDirectory! + 'init-error.txt',
        `platform=${Platform.OS}\n${_initError}\n`
      )
    } catch {}
  }
  return _initError
}
export async function ensureBackendStarted () { await startWorklet() }

// Full-screen init-failure page (so a broken engine is visible, not a UI that
// silently no-ops every method). DIAGNOSTIC for the iOS engine-init bug.
function errorHtml (err: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head><body style="margin:0;background:#140f11;color:#ff9db0;font:13px/1.5 ui-monospace,monospace;padding:24px;-webkit-text-size-adjust:100%"><h2 style="color:#f2789f">Engine failed to start</h2><pre style="white-space:pre-wrap;word-break:break-word">${err.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])}</pre></body></html>`
}

// --- UI html ---------------------------------------------------------------
function buildHtml (jsBundle: string, bg: string) {
  const platform = JSON.stringify(Platform.OS)
  const debug = JSON.stringify(__DEV__)
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" /><style>html,body,#root{height:100%;margin:0;padding:0;background:${bg}}body{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}</style><script>window.__pearPlatform=${platform};window.__pearDebug=${debug};</script></head><body><div id="root"></div><script>${jsBundle}</script></body></html>`
}
async function loadUiHtml (bg: string) {
  const asset = Asset.fromModule(require('../assets/app-ui.bundle'))
  await asset.downloadAsync()
  const js = await FileSystem.readAsStringAsync(asset.localUri!, { encoding: FileSystem.EncodingType.UTF8 })
  return buildHtml(js, bg)
}

// The invite payload rides in the URL fragment (#) or a query (?). Match either.
const INVITE_RE = /^(pear:\/\/pearpetal\/(link|join)|https:\/\/peerloomllc\.com\/petal\/(link|join))\/?[?#]/

export default function Shell () {
  const webViewRef = useRef<any>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [shellTheme, setShellTheme] = useState('dark') // pre-paint bg; the WebView corrects it via shell:theme
  const webViewLoaded = useRef(false)
  const pendingDeeplink = useRef<string | null>(null)
  const canBackRef = useRef(false)
  const insets = useSafeAreaInsets()

  useEffect(() => { _webViewRef = webViewRef })

  const injectInsets = () => {
    webViewRef.current?.injectJavaScript(
      `(function(){var d=document.documentElement.style;` +
      `d.setProperty('--pear-safe-top','${insets.top}px');` +
      `d.setProperty('--pear-safe-bottom','${insets.bottom}px');` +
      `d.setProperty('--pear-safe-left','${insets.left}px');` +
      `d.setProperty('--pear-safe-right','${insets.right}px');})(); true;`
    )
  }
  useEffect(() => { if (webViewLoaded.current) injectInsets() }, [insets.top, insets.bottom, insets.left, insets.right])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Nudge iOS to show the Local Network prompt so same-WiFi peers (own
      // devices + partner) connect directly instead of via a relay (see
      // modules/local-network). Fire-and-forget; no-op off iOS.
      requestLocalNetworkPermission()
      // Read the persisted resolved theme first so the WebView wrapper + container
      // paint in the right colour from the first frame (no dark flash for light users).
      const saved = await AsyncStorage.getItem(THEME_KEY).catch(() => null)
      const boot = saved === 'light' ? 'light' : 'dark'
      if (!cancelled) setShellTheme(boot)
      const initErr = await startWorklet()
      if (cancelled) return
      setHtml(initErr ? errorHtml(initErr) : await loadUiHtml(bgFor(boot)))
      // Re-arm scheduled cycle reminders from the current prediction (no OS
      // prompt here - request=false). No-op unless the user has opted in.
      if (!initErr) syncNotifications({ request: false }).catch(() => {})
    })().catch((e) => { if (!cancelled) setHtml(errorHtml('shell boot failed: ' + (e?.message ?? String(e)))) })
    return () => { cancelled = true }
  }, [])

  // Predictions drift as the user logs; re-arm on every foreground so the
  // scheduled reminders track the latest projection (never prompts).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncNotifications({ request: false }).catch(() => {})
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canBackRef.current) { emitEvent('back'); return true }
      return false
    })
    return () => sub.remove()
  }, [])

  // Deep-link invite delivery (buffer until the WebView has mounted).
  useEffect(() => {
    const deliver = (url: string) => {
      if (webViewLoaded.current) emitEvent('deeplink:invite', { url })
      else pendingDeeplink.current = url
    }
    Linking.getInitialURL().then((url) => { if (url && INVITE_RE.test(url)) deliver(url) })
    const sub = Linking.addEventListener('url', ({ url }) => { if (INVITE_RE.test(url)) deliver(url) })
    return () => sub.remove()
  }, [])

  const reply = (id: number, result: any) =>
    webViewRef.current?.injectJavaScript(`window.__pearResponse(${JSON.stringify({ id, result: result ?? null })}); true;`)
  const replyError = (id: number, error: any) =>
    webViewRef.current?.injectJavaScript(`window.__pearResponse(${JSON.stringify({ id, error: String(error) })}); true;`)

  const onMessage = async (e: any) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    const { id, method, args } = msg
    try {
      switch (method) {
        case 'shell:share': {
          const res = await Share.share({ message: args?.text ?? '', title: args?.title ?? '' })
          return reply(id, { ok: res.action !== Share.dismissedAction })
        }
        case 'shell:openUrl': {
          if (!args?.url) return replyError(id, 'url required')
          await Linking.openURL(args.url); return reply(id, { ok: true })
        }
        case 'shell:canOpenURL': {
          // Used by the donation flow to detect a Lightning wallet (open the
          // lightning: address if one is installed, else show the wallet sheet).
          try { const can = await Linking.canOpenURL(String(args?.url ?? '')); return reply(id, { can: !!can }) } catch { return reply(id, { can: false }) }
        }
        case 'shell:haptic': {
          const k = args?.kind
          try {
            if (k === 'light') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            else if (k === 'medium') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            else if (k === 'heavy') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
            else if (k === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            else if (k === 'warn') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          } catch {}
          return reply(id, { ok: true })
        }
        case 'shell:scanQr': {
          // Native camera QR scan is a later slice; the UI falls back to paste.
          return reply(id, { code: null })
        }
        case 'shell:export': {
          // Write the JSON to a file and open the share sheet so the user saves it
          // wherever they want (Files, Drive, etc). Nothing is uploaded by us.
          const name = (args?.filename && String(args.filename)) || 'pearpetal-backup.json'
          const path = FileSystem.cacheDirectory + name
          await FileSystem.writeAsStringAsync(path, String(args?.json ?? ''), { encoding: FileSystem.EncodingType.UTF8 })
          if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Save your PearPetal backup' })
          return reply(id, { ok: true })
        }
        case 'shell:import': {
          const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true })
          if (res.canceled || !res.assets?.[0]?.uri) return reply(id, { json: null })
          const json = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 })
          return reply(id, { json })
        }
        case 'shell:navState': {
          canBackRef.current = !!args?.canBack
          return reply(id, { ok: true })
        }
        case 'shell:notifications:get': {
          // Worklet prefs + the actual OS grant (so the UI can show a
          // "turn on in system settings" hint if the app-level toggle is on but
          // the OS permission was denied).
          let prefs: any = {}
          try { prefs = (await callRaw('notifications:get'))?.result || {} } catch {}
          const granted = (await Notifications.getPermissionsAsync()).status === 'granted'
          return reply(id, { ...prefs, osGranted: granted })
        }
        case 'shell:notifications:set': {
          // Persist the prefs in the worklet, then reschedule. Request the OS
          // permission only when the user is turning notifications ON.
          const enabling = args?.enabled === true
          let prefs: any = {}
          try { prefs = (await callRaw('notifications:set', args))?.result || {} } catch {}
          const res = await syncNotifications({ request: enabling })
          return reply(id, { ...prefs, osGranted: res.granted, permissionDenied: enabling && !res.granted })
        }
        case 'shell:notifications:sync': {
          // Called by the UI after a log / prefs change so the schedule tracks
          // the fresh prediction without waiting for a foreground.
          await syncNotifications({ request: false })
          return reply(id, { ok: true })
        }
        case 'shell:theme': {
          // The WebView reports its resolved theme; follow it live (status bar +
          // container bg) and persist so the next cold start paints correctly.
          const t = args?.theme === 'light' ? 'light' : 'dark'
          setShellTheme(t)
          AsyncStorage.setItem(THEME_KEY, t).catch(() => {})
          return reply(id, { ok: true })
        }
        default: {
          const wm = await callRaw(method, args)
          if (wm && wm.error != null) return replyError(id, wm.error)
          return reply(id, wm ? wm.result : null)
        }
      }
    } catch (err: any) {
      replyError(id, err?.message ?? String(err))
    }
  }

  const onLoad = () => {
    webViewLoaded.current = true
    injectInsets()
    if (pendingDeeplink.current) {
      emitEvent('deeplink:invite', { url: pendingDeeplink.current })
      pendingDeeplink.current = null
    }
  }

  if (!html) return <View style={{ flex: 1, backgroundColor: bgFor(shellTheme) }} />
  return (
    <>
      <StatusBar barStyle={shellTheme === 'light' ? 'dark-content' : 'light-content'} translucent backgroundColor='transparent' />
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: 'https://localhost/' }}
        onMessage={onMessage}
        onLoad={onLoad}
        style={{ flex: 1, backgroundColor: bgFor(shellTheme) }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        // In-WebView camera for the QR scanner (getUserMedia). The scanner runs in
        // the UI bundle; the shell just grants the WebView's camera request.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType='grant'
        onPermissionRequest={(ev: any) => { try { ev?.grant?.(ev.resources) } catch {} }}
      />
    </>
  )
}
