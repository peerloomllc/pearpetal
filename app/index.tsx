// PearPetal shell: hosts the Bare worklet (P2P backend) and the WebView UI, and
// bridges IPC between them. The one bit of custom native code is the iOS
// local-network prompt module (modules/local-network); the worklet and WebView
// are otherwise pure RN libraries. The shell stays minimal: worklet host,
// WebView, IPC bridge, a few shell actions, the local-network nudge, deep-link
// invite delivery, and opt-in to-self cycle reminders (OS-scheduled local
// notifications). Background sync and native QR scan land in later slices (see
// the wire proposal and TODO).

import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, Platform, Share, StatusBar, BackHandler, AppState, Appearance, NativeModules } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Worklet } from 'react-native-bare-kit'
import b4a from 'b4a'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import * as Haptics from 'expo-haptics'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { requestLocalNetworkPermission } from '../modules/local-network'
import { excludeFromBackup } from '../modules/backup-exclusion'
import { healthReadAvailable, requestHealthRead, readHealthSamples } from '../modules/health-read'

// The engine's storage root under the document directory: @peerloom/core opens
// `<dataDir>/<appId>/store`, and src/bare.js passes appId 'pearpetal'. Named here
// because the shell has to create it and mark it excluded from iCloud Backup
// before the worklet puts anything in it.
const APP_STORE_DIR = 'pearpetal'

// Pre-paint background per theme, so a light-theme user does not flash the dark
// shell bg before the WebView's JS applies the palette. Must match theme.js
// --color-surface-base. The WebView persists its resolved theme (shell:theme) so
// the shell can read it here on the next boot.
const THEME_KEY = 'pearpetal:theme:resolved'
const SHELL_BG: Record<string, string> = { dark: '#140f11', light: '#faf4f5' }

// Derive a human-readable folder path from a Storage Access Framework tree URI,
// e.g. content://.../tree/primary%3ADownload%2FKeet -> "Download/Keet". Returns ''
// when it can't be parsed, so the caller can fall back to a generic message.
function safFolderLabel (treeUri: string): string {
  try {
    const decoded = decodeURIComponent(treeUri)
    const afterTree = decoded.split('/tree/').pop() || ''
    const afterColon = afterTree.includes(':') ? afterTree.slice(afterTree.indexOf(':') + 1) : afterTree
    return afterColon.trim()
  } catch { return '' }
}

// A safe, single-segment file base name (no path separators or NULs).
function sanitizeFilename (name: unknown): string {
  const s = typeof name === 'string' ? name : ''
  return s.replace(/[\\/\x00]/g, '').trim()
}
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
// Every worklet call is bounded. The worklet can stall silently - an Autobase
// waiting on a peer that is offline, a hypercore read for a block that never
// arrives (hypercore's default timeout is 0, i.e. never), or the worklet simply
// dying, which we cannot even observe. Without a bound, one stall left the app on
// a bare background forever with nothing to tap: the shell never got past
// `html === null` and the UI never got past `mode === null`. A timeout turns that
// into a visible, retryable error. Resolving with { error } rather than rejecting
// matches what a worklet-side failure already looks like to every caller.
const IPC_TIMEOUT_MS = 20_000
// Calls that legitimately wait on another device (pairing, joining) or grind
// through a large local import. A short bound here would break real pairing on a
// slow network, which is a worse bug than the one being fixed.
const IPC_TIMEOUT_SLOW_MS = 180_000
const SLOW_METHODS = new Set([
  'init', 'cycle:create', 'link:invite', 'link:join', 'partner:join', 'share:create',
  'export:data', 'import:data', 'health:importFile', 'health:import', 'recovery:getPhrase',
])
function callRaw (method: string, args: any = {}): Promise<any> {
  return new Promise((resolve) => {
    const id = _nextId++
    const ms = SLOW_METHODS.has(method) ? IPC_TIMEOUT_SLOW_MS : IPC_TIMEOUT_MS
    const timer = setTimeout(() => {
      if (!_pending.delete(id)) return
      resolve({ id, error: `the engine did not answer ${method} within ${Math.round(ms / 1000)}s` })
    }, ms)
    _pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
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
  // Keep the private cycle log out of iCloud Backup. iOS backs up Documents by
  // DEFAULT, so without this every logged day, flow, symptom, note and BBT is
  // eligible to leave the phone in the device backup - while onboarding promises
  // it does not. The store is `<dataDir>/pearpetal/store` (@peerloom/core
  // engine.js), so the flag goes on `<dataDir>/pearpetal` and covers everything
  // beneath it. Create the directory FIRST so the flag is set before any data
  // lands in it, and re-assert on every launch (the flag lives in the filesystem,
  // and a restore onto a new device starts it out unset). Android does the same
  // job declaratively - see plugins/with-android-backup-exclusion.js.
  try {
    await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory! + APP_STORE_DIR, { intermediates: true })
  } catch {} // already exists is the normal case
  await excludeFromBackup(`${dataDir}/${APP_STORE_DIR}`)
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
// silently no-ops every method, and not the bare background the app used to sit
// on forever). Written for the person holding the phone: a plain sentence and
// something to do, with the technical detail kept underneath so a support reply
// can quote it back to us.
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
function errorHtml (err: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head><body style="margin:0;background:#140f11;color:#f6eef0;font:15px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:32px 24px;-webkit-text-size-adjust:100%"><h2 style="color:#f2789f;font-size:20px;margin:0 0 12px">PearPetal could not start</h2><p style="margin:0 0 10px">Something went wrong while opening your cycle data, so there is nothing to show yet. Your data is still on this phone.</p><p style="margin:0 0 24px">Close the app completely (swipe it away) and open it again. If it keeps happening, send us the text below and we will fix it.</p><pre style="white-space:pre-wrap;word-break:break-word;background:#211a1d;border:1px solid #3a2e33;border-radius:12px;padding:12px;color:#c9a3ae;font:12px/1.5 ui-monospace,monospace;margin:0">${escapeHtml(err)}</pre></body></html>`
}

// --- UI html ---------------------------------------------------------------
function buildHtml (jsBundle: string, bg: string, screenshotScene?: number | null) {
  const platform = JSON.stringify(Platform.OS)
  const debug = JSON.stringify(__DEV__)
  // Hand the WebView the real OS colour scheme (Android's prefers-color-scheme is
  // unreliable), before the bundle runs, so 'system' resolves correctly on first paint.
  // Screenshot mode forces light (the fixtures palette was tuned for white).
  const scheme = JSON.stringify(screenshotScene != null ? 'light' : (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'))
  // Screenshot capture: inject the scene number so the UI runs from fixtures
  // (see src/ui/screenshot-fixtures.js) instead of the worklet bridge.
  const shot = screenshotScene != null ? `window.__PEARPETAL_SCREENSHOT_SCENE=${JSON.stringify(screenshotScene)};` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" /><style>html,body,#root{height:100%;margin:0;padding:0;background:${bg}}body{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}</style><script>window.__pearPlatform=${platform};window.__pearDebug=${debug};window.__pearColorScheme=${scheme};${shot}</script></head><body><div id="root"></div><script>${jsBundle}</script></body></html>`
}
async function loadUiHtml (bg: string, screenshotScene?: number | null) {
  const asset = Asset.fromModule(require('../assets/app-ui.bundle'))
  await asset.downloadAsync()
  const js = await FileSystem.readAsStringAsync(asset.localUri!, { encoding: FileSystem.EncodingType.UTF8 })
  return buildHtml(js, bg, screenshotScene)
}

// Screenshot capture: the store-screenshot scripts cold-launch with a
// pear://pearpetal/screenshot/<N> deep link (Android) or a Documents/screenshot-scene
// file (iOS - avoids simctl's "Open in ...?" scheme confirmation). Parse the scene so
// the shell can inject it before the UI bundle runs. No effect in normal use.
function parseScreenshotScene (url: string | null): number | null {
  if (!url) return null
  const m = url.match(/^pear:\/\/pearpetal\/screenshot\/(\d+)/i) || url.match(/[?&]__screenshotScene=(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
async function readScreenshotSceneFile (): Promise<number | null> {
  try {
    const txt = await FileSystem.readAsStringAsync(FileSystem.documentDirectory + 'screenshot-scene')
    const n = parseInt(String(txt).trim(), 10)
    return Number.isInteger(n) ? n : null
  } catch { return null }
}

// The invite payload rides in the URL fragment (#) or a query (?). Match either.
const INVITE_RE = /^(pear:\/\/pearpetal\/(link|join)|https:\/\/peerloomllc\.com\/petal\/(link|join))\/?[?#]/

// --- GrapheneOS/Vanadium WebView resume-freeze recovery (Android only) -------
// Android's cached-app freezer freezes the WebView's out-of-process Vanadium
// renderer while we are backgrounded, and since Vanadium 151 (2026-07-19) the
// thawed renderer never re-attaches its compositor to the new window surface we
// get on resume: taps and JS still work, the screen never repaints. Only a FRESH
// render process recovers it, so on a resume-after-background we deliberately
// terminate ours (plugins/with-android-webview-recovery.js) and let
// onRenderProcessGone reload into a new one. Trade-off: that return costs a ~1-2s
// WebView reload, so it is gated on a background long enough to have plausibly
// been frozen - short app-switches (the share sheet, the document picker, the
// camera permission dialog) fall under the gate and reload nothing.
// iOS/WKWebView is unaffected (no cached-app freezer). See
// /home/tim/peerloomllc/WEBVIEW_FREEZE_FIX_PORT.md.
const { WebViewRecovery } = NativeModules
const WEBVIEW_RECOVERY_MIN_BG_MS = 20_000
let _backgroundedAt = 0

// --- app lock ---------------------------------------------------------------
// Opt-in, off by default, and it lives HERE rather than in the WebView UI: the
// shell owns the first frame, so the cycle can be covered before it has ever been
// drawn, and the same cover hides the app-switcher snapshot on the way out.
//
// Device authentication (Face ID / fingerprint, falling back to the phone's own
// passcode), so there is no secret of ours to store and no way for PearPetal to
// lock somebody out of their own health data. Its limit is worth being honest
// about: whoever knows the phone's passcode still gets in.
const LOCK_KEY = 'pearpetal:appLock'
// Popping out to a share sheet, the camera or the document picker must not
// re-prompt. Closing the app and coming back later must.
const LOCK_GRACE_MS = 60_000

// Can this phone actually authenticate right now? Enrolment can disappear after
// the lock was turned on (a passcode removed, a face forgotten), and a lock that
// cannot be opened is data loss, so every path that would hold someone out checks
// this first and lets them through instead.
async function canAuthenticate (): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    return level !== LocalAuthentication.SecurityLevel.NONE
  } catch { return false }
}

// Returns the RESULT, not a boolean. A refusal has a reason - cancelled, no
// hardware, locked out after too many tries - and the person tapping the toggle
// is owed it. Swallowing it into `false` is what made the toggle look broken.
async function promptUnlock (): Promise<{ ok: boolean, why: string }> {
  try {
    const r: any = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock PearPetal',
      cancelLabel: 'Cancel',
      // false = the phone's passcode is offered when a face or finger fails,
      // which is what keeps this from ever being a permanent lockout.
      disableDeviceFallback: false,
    })
    return { ok: !!r?.success, why: String(r?.error || r?.warning || '') }
  } catch (e: any) { return { ok: false, why: String(e?.message || e || 'unknown') } }
}

// How long the shell will wait for the engine before it gives up and shows the
// failure page. Generous: a cold start on an old phone with a large store is
// slow, and a false alarm here is worse than a few extra seconds of splash. What
// changed is what fills those seconds - see BootSplash. It used to be a bare
// background with no words at all, which is why the person who reported the
// blank screen said he got no message: he was looking at the wait, not at the
// failure page, and nobody stares at nothing for 45 seconds.
const BOOT_WATCHDOG_MS = 45_000
// When the splash stops being silent and starts explaining itself.
const SPLASH_SLOW_MS = 6_000

// What the app shows while the engine is starting. Not a bare background: the
// wordmark from the first frame, a line of text once the wait stops being
// normal, and the reason it might be waiting - which for this app is usually the
// other person's phone not being nearby.
function BootSplash ({ theme }: { theme: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SPLASH_SLOW_MS)
    return () => clearTimeout(t)
  }, [])
  const fg = theme === 'light' ? '#5c4650' : '#f6eef0'
  const muted = theme === 'light' ? '#8a7480' : '#c6b8bd'
  return (
    <View style={{ flex: 1, backgroundColor: bgFor(theme), alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: fg, fontSize: 24, fontWeight: '600', letterSpacing: 0.3 }}>PearPetal</Text>
      <Text style={{ color: muted, fontSize: 14, marginTop: 10 }}>Opening your cycle…</Text>
      {slow && (
        <Text style={{ color: muted, fontSize: 13, marginTop: 24, textAlign: 'center', lineHeight: 20 }}>
          This is taking longer than usual. Nothing is lost - your data is on this phone.
          {'\n'}If it does not open, close the app fully and try again.
        </Text>
      )}
    </View>
  )
}

// What covers the app while it is locked. Deliberately says nothing about the
// person's cycle: it is also what the app-switcher screenshots.
function LockCover ({ theme, onUnlock, busy }: { theme: string, onUnlock: () => void, busy: boolean }) {
  const fg = theme === 'light' ? '#5c4650' : '#f6eef0'
  const muted = theme === 'light' ? '#8a7480' : '#c6b8bd'
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bgFor(theme), alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: fg, fontSize: 24, fontWeight: '600', letterSpacing: 0.3 }}>PearPetal</Text>
      <Text style={{ color: muted, fontSize: 14, marginTop: 10, textAlign: 'center' }}>Locked</Text>
      <Pressable
        onPress={onUnlock}
        disabled={busy}
        style={{ marginTop: 28, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 14, backgroundColor: '#f2789f', opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: '#2a1119', fontSize: 15, fontWeight: '600' }}>{busy ? 'Unlocking…' : 'Unlock'}</Text>
      </Pressable>
    </View>
  )
}

export default function Shell () {
  const webViewRef = useRef<any>(null)
  const [html, setHtml] = useState<string | null>(null)
  // Bumping this remounts the WebView, which is the only way to recover an
  // inline-html source. See onContentProcessDidTerminate below.
  const [webViewGen, setWebViewGen] = useState(0)
  // App lock. `lockOn` is the preference, `locked` is whether the cover is up.
  // Both start unknown/false so an app with the lock off is never delayed by it.
  const [lockOn, setLockOn] = useState(false)
  const [locked, setLocked] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const lockOnRef = useRef(false)
  const leftAt = useRef(0)
  const [shellTheme, setShellTheme] = useState('dark') // pre-paint bg; the WebView corrects it via shell:theme
  const webViewLoaded = useRef(false)
  const pendingDeeplink = useRef<string | null>(null)
  const canBackRef = useRef(false)
  const insets = useSafeAreaInsets()

  useEffect(() => { _webViewRef = webViewRef })

  // Read the lock preference first thing. If it is on, the cover goes up before
  // the WebView has drawn a single frame, and the prompt follows.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const on = (await AsyncStorage.getItem(LOCK_KEY).catch(() => null)) === '1'
      if (cancelled || !on) return
      // Enrolment can have gone away since it was switched on. A lock nobody can
      // open is data loss, so turn it off rather than hold the person out.
      if (!(await canAuthenticate())) {
        await AsyncStorage.setItem(LOCK_KEY, '0').catch(() => {})
        return
      }
      if (cancelled) return
      setLockOn(true); lockOnRef.current = true; setLocked(true)
      const r = await promptUnlock()
      if (!cancelled && r.ok) setLocked(false)
    })()
    return () => { cancelled = true }
  }, [])

  const tryUnlock = async () => {
    if (unlocking) return
    setUnlocking(true)
    try {
      // Same safety valve: if the phone can no longer authenticate at all, let
      // them in and switch the lock off rather than strand them.
      if (!(await canAuthenticate())) {
        await AsyncStorage.setItem(LOCK_KEY, '0').catch(() => {})
        setLockOn(false); lockOnRef.current = false; setLocked(false)
        return
      }
      if ((await promptUnlock()).ok) setLocked(false)
    } finally { setUnlocking(false) }
  }

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

  // Push OS light/dark changes into the WebView so a 'system' user's theme flips
  // live when they toggle the phone's dark-mode setting (no relaunch needed).
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      const s = colorScheme === 'dark' ? 'dark' : 'light'
      webViewRef.current?.injectJavaScript(`window.__pearColorScheme=${JSON.stringify(s)};window.dispatchEvent(new Event('pearcolorscheme'));true;`)
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Screenshot capture: if launched via pear://pearpetal/screenshot/<N> or a
      // Documents/screenshot-scene file, run the UI from fixtures (see
      // src/ui/screenshot-fixtures.js) and skip the worklet + every permission
      // prompt (Local Network, notifications), which would cover the frame.
      const initialUrl = await Linking.getInitialURL().catch(() => null)
      const scene = (await readScreenshotSceneFile()) ?? parseScreenshotScene(initialUrl)
      if (scene != null) {
        if (!cancelled) { setShellTheme('light'); setHtml(await loadUiHtml(bgFor('light'), scene)) }
        return
      }
      // Nudge iOS to show the Local Network prompt so same-WiFi peers (own
      // devices + partner) connect directly instead of via a relay (see
      // modules/local-network). Fire-and-forget; no-op off iOS.
      requestLocalNetworkPermission()
      // Read the persisted resolved theme first so the WebView wrapper + container
      // paint in the right colour from the first frame (no dark flash for light users).
      const saved = await AsyncStorage.getItem(THEME_KEY).catch(() => null)
      // No stored resolved theme yet (first run, default pref is 'system') -> follow
      // the OS so the pre-paint background matches what the WebView will resolve.
      const boot = (saved === 'light' || saved === 'dark') ? saved : (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light')
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

  // Last-resort boot watchdog. Everything upstream of setHtml is awaited - the
  // asset reads, Worklet.start, engine init - and a hang in any of them left the
  // shell rendering nothing but its background colour, with no message, no retry
  // and no bottom nav. callRaw now bounds the init call, but this covers the rest
  // of the chain too: if nothing has painted by now, say so.
  useEffect(() => {
    if (html) return undefined
    const t = setTimeout(() => {
      setHtml((cur) => cur || errorHtml('the app did not finish starting within ' + Math.round(BOOT_WATCHDOG_MS / 1000) + 's'))
    }, BOOT_WATCHDOG_MS)
    return () => clearTimeout(t)
  }, [html])

  // Predictions drift as the user logs; re-arm on every foreground so the
  // scheduled reminders track the latest projection (never prompts).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncNotifications({ request: false }).catch(() => {})
      // App lock, both platforms. The cover goes up the INSTANT the app stops
      // being frontmost, not on the way back, because the screenshot the OS takes
      // for the app switcher is taken right about here - waiting would put the
      // cycle in the switcher for anyone thumbing through it.
      if (lockOnRef.current) {
        if (s === 'background' || s === 'inactive') {
          if (leftAt.current === 0) leftAt.current = Date.now()
          setLocked(true)
        } else if (s === 'active') {
          const awayMs = leftAt.current ? Date.now() - leftAt.current : 0
          leftAt.current = 0
          // Under the grace period this was a share sheet or a photo picker, not
          // the person putting the phone down. Drop the cover without a prompt.
          if (awayMs < LOCK_GRACE_MS) setLocked(false)
          else tryUnlock()
        }
      }
      if (Platform.OS !== 'android') return
      if (s === 'background' || s === 'inactive') {
        // 'inactive' can precede 'background', so keep the FIRST timestamp.
        if (_backgroundedAt === 0) _backgroundedAt = Date.now()
      } else if (s === 'active') {
        const bgMs = _backgroundedAt ? Date.now() - _backgroundedAt : 0
        _backgroundedAt = 0
        if (bgMs >= WEBVIEW_RECOVERY_MIN_BG_MS && WebViewRecovery?.terminateRenderer) {
          WebViewRecovery.terminateRenderer().catch(() => {})
        }
      }
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
        case 'shell:export': {
          // Save the backup JSON to a real, user-visible file. Nothing is uploaded.
          //   Android: prompt for a destination folder every time via the Storage
          //   Access Framework, then write into it. We deliberately do NOT persist
          //   the grant - the user asked to choose the location on every export.
          //   The share sheet is skipped on purpose: on scoped-storage / GrapheneOS
          //   it does not offer the Files app, so a user could not save to Downloads.
          //   iOS: no Downloads folder; route through the share sheet ("Save to
          //   Files").
          const filename = sanitizeFilename(args?.filename) || 'pearpetal-backup.json'
          const contents = String(args?.json ?? '')
          if (Platform.OS === 'android') {
            const SAF = (FileSystem as any).StorageAccessFramework
            if (SAF) {
              const baseName = filename.replace(/\.json$/i, '')
              const perm = await SAF.requestDirectoryPermissionsAsync()
              if (!perm.granted) return reply(id, { ok: false, canceled: true })
              // Overwrite an existing same-name backup in the chosen folder rather
              // than piling up "pearpetal-backup (1).json"; createFileAsync always
              // mints a new numbered doc, so look for the file first.
              let fileUri: string | null = null
              try {
                const entries: string[] = await SAF.readDirectoryAsync(perm.directoryUri)
                fileUri = entries.find((u) => decodeURIComponent(u).endsWith('/' + baseName + '.json')) ?? null
              } catch {}
              if (!fileUri) fileUri = await SAF.createFileAsync(perm.directoryUri, baseName, 'application/json')
              await FileSystem.writeAsStringAsync(fileUri, contents, { encoding: FileSystem.EncodingType.UTF8 })
              return reply(id, { ok: true, savedToFolder: true, folder: safFolderLabel(perm.directoryUri) })
            }
            // SAF unavailable (should not happen on Android): fall through to share.
          }
          const path = FileSystem.cacheDirectory + filename
          await FileSystem.writeAsStringAsync(path, contents, { encoding: FileSystem.EncodingType.UTF8 })
          if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Save your PearPetal backup' })
          return reply(id, { ok: true })
        }
        case 'shell:import': {
          const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true })
          if (res.canceled || !res.assets?.[0]?.uri) return reply(id, { json: null })
          const json = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 })
          return reply(id, { json })
        }
        case 'shell:health:appleAvailable': {
          return reply(id, { available: healthReadAvailable() })
        }
        case 'shell:health:importApple': {
          // iOS only, and READ authorization only - the native side asks with
          // toShare: nil, so no write-back path to Apple Health exists.
          if (!healthReadAvailable()) return reply(id, { ok: false, reason: 'unsupported' })
          const days = Math.max(1, Math.min(730, Number(args?.days) || 180))
          await requestHealthRead()
          // A DENIED read is indistinguishable from "no such data" on iOS - Apple
          // hides it deliberately, because the refusal itself leaks health
          // information. So an empty result is reported as "nothing found", never
          // as "you denied us".
          const samples = await readHealthSamples(days)
          if (!samples.length) return reply(id, { ok: true, read: 0, added: 0, updated: 0, keptManual: 0 })
          const out = await callRaw('health:import', { samples, source: 'healthkit' })
          if (out?.error) return reply(id, { ok: false, reason: String(out.error) })
          return reply(id, { ok: true, read: samples.length, ...(out?.result || {}) })
        }
        case 'shell:health:importFile': {
          // Files are the PRIMARY health-import path (DECISIONS.md 2026-07-30):
          // a file the user picked needs no permission, no vendor and no network,
          // so it works on every store and every ROM.
          const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
          if (res.canceled || !res.assets?.[0]?.uri) return reply(id, { ok: false, reason: 'cancelled' })
          const asset = res.assets[0]
          // Apple's export.xml routinely runs to hundreds of megabytes, nearly all
          // of it record types we do not import. Read it, then keep only the lines
          // that matter before handing anything to the worklet - the parser is
          // line-oriented precisely so this pre-filter is safe.
          let text: string
          try {
            text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 })
          } catch {
            return reply(id, { ok: false, reason: 'unreadable' })
          }
          if (text.length > 2_000_000 && text.indexOf('<Record') !== -1) {
            const kept = text.split('\n').filter((l) =>
              l.indexOf('HKQuantityTypeIdentifierBasalBodyTemperature') !== -1 ||
              l.indexOf('HKCategoryTypeIdentifierMenstrualFlow') !== -1)
            text = '<HealthData>\n' + kept.join('\n') + '\n</HealthData>'
          }
          const out = await callRaw('health:importFile', { text })
          if (out?.error) return reply(id, { ok: false, reason: String(out.error) })
          return reply(id, { name: asset.name || '', ...(out?.result || {}) })
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
        case 'shell:lock:get': {
          // `available` says whether this phone can authenticate at all, so the
          // Settings toggle can explain itself instead of just failing.
          return reply(id, { enabled: lockOnRef.current, available: await canAuthenticate() })
        }
        case 'shell:lock:set': {
          const want = args?.enabled === true
          if (want) {
            if (!(await canAuthenticate())) {
              return reply(id, { enabled: false, available: false, reason: 'no-auth' })
            }
            // Prove they can get back in BEFORE the lock is armed. Switching on a
            // lock that will not open is the one failure this must never allow.
            const r = await promptUnlock()
            if (!r.ok) {
              return reply(id, { enabled: lockOnRef.current, available: true, reason: 'refused', why: r.why })
            }
          }
          await AsyncStorage.setItem(LOCK_KEY, want ? '1' : '0').catch(() => {})
          lockOnRef.current = want
          setLockOn(want)
          if (!want) { setLocked(false); leftAt.current = 0 }
          return reply(id, { enabled: want, available: true })
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

  if (!html) return (
    <View style={{ flex: 1 }}>
      <BootSplash theme={shellTheme} />
      {locked && <LockCover theme={shellTheme} onUnlock={tryUnlock} busy={unlocking} />}
    </View>
  )
  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle={shellTheme === 'light' ? 'dark-content' : 'light-content'} translucent backgroundColor='transparent' />
      <WebView
        key={webViewGen}
        ref={webViewRef}
        source={{ html, baseUrl: 'https://localhost/' }}
        onMessage={onMessage}
        onLoad={onLoad}
        // The renderer is gone: either we terminated it on resume (didCrash=false,
        // the freeze recovery above) or it genuinely crashed. Either way the view
        // is dead until a fresh render process is bound, and reload() is what binds
        // one - without this the app is a permanently blank screen. Returning
        // nothing (undefined) lets the WebView survive; the default is to tear the
        // whole view down.
        onRenderProcessGone={(e: any) => {
          console.warn('[webview] render process gone, didCrash=' + e?.nativeEvent?.didCrash + ' -> reload')
          webViewLoaded.current = false // onLoad re-arms insets + any pending deeplink
          webViewRef.current?.reload()
        }}
        // The iOS twin of the above, and it was missing. When iOS jettisons
        // WKWebView's web content process under memory pressure the view goes
        // BLANK and stays blank - it shows the container colour, which is our own
        // background, so it reads as "the app opened to nothing". WKWebView does
        // not reload itself, and our source is an inline html string, so without
        // this the only way out was force-quitting the app.
        //
        // REMOUNT, NOT reload(). Android's recovery above calls reload() and that
        // works there, but on iOS it does not: our source is an html STRING with
        // baseUrl https://localhost/, and WKWebView's reload re-requests that URL,
        // which nothing serves. The view then sits on the loading spinner forever -
        // a different permanent dead end, not a fix. Caught on the Simulator by
        // killing com.apple.WebKit.WebContent under a running build. Changing the
        // key drops the old view and mounts a fresh one, which loads the html
        // string again from scratch.
        onContentProcessDidTerminate={() => {
          console.warn('[webview] ios content process terminated -> remount')
          webViewLoaded.current = false
          setWebViewGen((g) => g + 1)
        }}
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
      {/* Last in the tree, so it is on top of the WebView. The WebView stays
          mounted underneath: unmounting it would reboot the whole UI on every
          unlock and lose whatever screen the person was on. */}
      {locked && <LockCover theme={shellTheme} onUnlock={tryUnlock} busy={unlocking} />}
    </View>
  )
}
