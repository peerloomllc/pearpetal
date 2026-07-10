// PearPetal UI - slice 1 (scaffold + private base + own-device linking).
// Screens:
//   - Onboarding: start tracking (create private base) OR link this device to
//     an existing cycle on another of the owner's devices.
//   - Log: pick a date, set flow + symptoms + notes, see recent days.
//   - Devices: the owner's linked devices + a copyable/scannable link invite.
//
// The petal dial and partner sharing are deliberately NOT here yet (later
// slices). This proves the data path end to end: log on device A, see on B.

import { useEffect, useState, useCallback, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { Flower, ShareNetwork, Gear, Info, CaretRight, CaretLeft, Camera, CalendarBlank, QrCode, Copy, Trash, Check, Pill, Database, Heart, CurrencyBtc, Code, EnvelopeSimple, Lightning, CheckCircle, ArrowSquareOut } from '@phosphor-icons/react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { call, on, haptic } from './ipc.js'
import { colors, spacing, radius, MONO, applyThemePref, loadThemePref, resolveTheme, onSystemThemeChange } from './theme.js'
import { projectCalendar } from '../prediction.js'
import PetalDial, { PregnancyDial, FlowerThumb, ThemeContext, isoDiff, addDaysIso } from './PetalDial.jsx'
import { FLOWER_KEYS, flowerLabel } from './flowers.js'

const FLOWS = [
  { key: 'spotting', label: 'Spotting' },
  { key: 'light', label: 'Light' },
  { key: 'medium', label: 'Medium' },
  { key: 'heavy', label: 'Heavy' },
]
const SYMPTOMS = ['cramps', 'headache', 'fatigue', 'bloating', 'tender-breasts', 'nausea', 'backache', 'acne']

// --- About + donation (suite config, shared across PeerLoom apps) ------------
const APP_VERSION = '0.1.0'
const LIGHTNING_ADDRESS = 'peerloomllc@strike.me'
// Hosted Strike tip page (Lightning invoice QR + web pay). Good for scanning
// from another device or paying on desktop.
const STRIKE_TIP_URL = 'https://strike.me/peerloomllc/'
// Static on-chain BTC address for donors who prefer L1 over Lightning. A Strike
// deposit address (custodial, derived from Strike's xpub, so reuse is fine).
// Empty string hides the on-chain row until set.
const BTC_ONCHAIN_ADDRESS = 'bc1q0kksenz3j4u9ppe6f4krclvzwxk7sjy00cc9cf'
const BUYMEACOFFEE_URL = 'https://buymeacoffee.com/peerloomllc'
const LIGHTNING_WALLETS = [
  { name: 'Strike', url: 'https://strike.me', desc: 'Simple Lightning payments' },
  { name: 'Cash App', url: 'https://cash.app', desc: 'Send Bitcoin via Lightning' },
  { name: 'Wallet of Satoshi', url: 'https://walletofsatoshi.com', desc: 'Beginner-friendly Lightning wallet' },
  { name: 'Phoenix', url: 'https://phoenix.acinq.co', desc: 'Self-custodial Lightning wallet' },
]
// Shared height for every option box in the donation sheet (primary buttons,
// copy fields, wallet rows) so the stack reads as one uniform column.
const DONATE_OPTION_MIN_H = 56
// The shell injects window.__pearPlatform ('ios'|'android') before the bundle.
// iOS hides the donation section per App Store guideline 3.1.1 (no external
// donation links), so the Support-development section is Android-only for now.
const isIOS = () => typeof window !== 'undefined' && window.__pearPlatform === 'ios'
const openUrl = (url) => { try { const p = call('shell:openUrl', { url }); if (p && p.catch) p.catch(() => {}) } catch {} }

const pad2 = (n) => String(n).padStart(2, '0')
const BLEEDING = new Set(['light', 'medium', 'heavy'])
function todayIso () {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
// ISO of the first day of the month containing `iso`, and month-shift by n months.
const monthStart = (iso) => `${iso.slice(0, 7)}-01`
function shiftMonthIso (iso, n) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`
}

// Re-run a loader whenever synced data changes. Every base view update - a local
// edit OR a replicated-then-applied remote change from another of your devices or a
// partner - emits group:updated. This loads once on mount and again on each such
// event, so any screen showing synced data refreshes in real time (no manual
// reload, no leave-and-return). `load` must be stable (useCallback) so the
// subscription is registered once and torn down on unmount.
// Android Back registry: any transient overlay (a bottom sheet, the QR scanner,
// an onboarding sub-mode) registers a dismiss handler while it is open; the App's
// 'back' handler calls the most-recently-registered one first (LIFO), so Back pops
// the deepest overlay rather than the whole screen. register() returns unregister.
const BackContext = createContext(null)
function useBackHandler (active, onBack) {
  const ctx = useContext(BackContext)
  const ref = useRef(onBack); ref.current = onBack
  useEffect(() => {
    if (!active || !ctx) return undefined
    return ctx.register(() => { const f = ref.current; if (f) { f(); return true } return false })
  }, [active, ctx])
}

function useSynced (load) {
  useEffect(() => {
    load()
    return on('group:updated', load)
  }, [load])
}

// --- small styled primitives ------------------------------------------------
const card = { background: colors.surface.card, borderRadius: radius.xl, padding: spacing.lg, border: `1px solid ${colors.border}` }
// Top padding that clears the status / notification bar so screen titles never clip
// under the clock. Prefers the shell-injected inset (--pear-safe-top from
// react-native-safe-area-context) and falls back to the CSS env() inset (available
// because the WebView viewport is viewport-fit=cover), so it holds even if the
// injected var lands late.
const screenPadTop = `calc(${spacing.xl}px + max(var(--pear-safe-top, 0px), env(safe-area-inset-top, 0px)))`
function Btn ({ children, onClick, kind = 'primary', style, disabled }) {
  const base = { border: 'none', borderRadius: radius.lg, padding: `${spacing.md}px ${spacing.base}px`, fontSize: 15, fontWeight: 500 }
  const kinds = {
    primary: { background: colors.primary, color: colors.text.onPrimary },
    ghost: { background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}` },
  }
  // A light tactile tick on every press, so all buttons feel responsive (existing
  // explicit haptic('success')/('warn') calls fire later, on completion - a natural
  // two-stage feel). Existing haptic('light') calls are on custom buttons/Chips, not
  // Btn, so nothing double-fires.
  return <button onClick={(e) => { haptic('light'); onClick && onClick(e) }} disabled={disabled} style={{ ...base, ...kinds[kind], cursor: disabled ? 'default' : 'pointer', ...style }}>{children}</button>
}
// Shared bottom-sheet chrome: slides up on open, slides down on dismiss (backdrop
// tap or the `close` passed to children). children is a render function receiving
// the animated close, so a sheet's own Cancel/Done buttons animate out too.
function BottomSheet ({ onClose, children, maxWidth = 460 }) {
  const [closing, setClosing] = useState(false)
  const done = useRef(false)
  const close = useCallback(() => {
    if (done.current) return
    done.current = true
    setClosing(true)
    setTimeout(onClose, 190)
  }, [onClose])
  useBackHandler(true, close) // Android Back animates the sheet closed
  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', animation: `pearpetal-overlay-${closing ? 'out' : 'in'} 200ms ease forwards` }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth, margin: '0 auto', background: colors.surface.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, border: `1px solid ${colors.border}`, padding: spacing.lg, paddingBottom: `calc(${spacing.lg}px + var(--pear-safe-bottom))`, display: 'flex', flexDirection: 'column', gap: spacing.md, animation: `pearpetal-sheet-${closing ? 'down' : 'up'} ${closing ? 190 : 260}ms cubic-bezier(0.32,0.72,0,1) forwards` }}>
        {children(close)}
      </div>
    </div>
  )
}
function Chip ({ active, onClick, children, color, style }) {
  return (
    <button onClick={(e) => { haptic('light'); onClick && onClick(e) }} style={{
      border: `1px solid ${active ? (color || colors.primary) : colors.border}`,
      background: active ? (color || colors.primary) : 'transparent',
      color: active ? colors.text.onPrimary : colors.text.secondary,
      borderRadius: radius.full, padding: `6px 12px`, fontSize: 13, fontWeight: 500,
      ...style,
    }}>{children}</button>
  )
}
// Compact icon-only action button (share row: QR / copy / revoke).
function IconBtn ({ children, onClick, label, color, active, disabled }) {
  return (
    <button onClick={(e) => { haptic('light'); onClick && onClick(e) }} aria-label={label} title={label} disabled={disabled} style={{
      width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      borderRadius: radius.full, cursor: disabled ? 'default' : 'pointer', padding: 0,
      background: active ? colors.primary : colors.surface.input,
      border: `1px solid ${active ? colors.primary : colors.border}`,
      color: active ? colors.text.onPrimary : (color || colors.text.secondary),
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  )
}
function flowColor (k) { return colors.flow[k] || colors.track }
// Width (in ch) of the longest flower name, so the picker tiles + the dial pill
// are all uniform (sized to the longest label) instead of varying by text length.
const FLOWER_NAME_CH = `${Math.max(...FLOWER_KEYS.map((k) => flowerLabel(k).length))}ch`
// A small on/off switch (for the birth-control toggle).
function Toggle ({ on, onClick, label }) {
  return (
    <button onClick={onClick} role='switch' aria-checked={on} aria-label={label} style={{ width: 46, height: 27, flexShrink: 0, borderRadius: radius.full, border: 'none', background: on ? colors.primary : colors.surface.input, boxShadow: on ? 'none' : `inset 0 0 0 1px ${colors.border}`, position: 'relative', cursor: 'pointer', transition: 'background 160ms', padding: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: '50%', background: '#fff', transition: 'left 160ms' }} />
    </button>
  )
}
// key, label, and a short explainer (what it is + how it shifts the estimates).
const CONDITION_OPTS = [
  ['pcos', 'PCOS', 'Polycystic ovary syndrome often makes cycles longer and irregular and ovulation hard to time, so the fertile window is widened and confidence is capped.'],
  ['endometriosis', 'Endometriosis', 'Endometriosis can bring painful, irregular periods; cycle timing varies more, so predictions are wider and less certain.'],
  ['irregular', 'Irregular cycles', 'Cycles that vary a lot in length make the fertile window and next-period date rougher estimates, so they are widened.'],
  ['thyroid', 'Thyroid condition', 'Thyroid conditions can lengthen, shorten, or skip cycles, so predictions are treated as less certain.'],
]
// Goal chips + a one-line explainer of what each mode does for the estimates.
const GOAL_OPTS = [
  ['track', 'General', 'Keeping an eye on your cycle. PearPetal shows your phase, next period, and fertile window.'],
  ['conceive', 'Trying to conceive', 'Your fertile window is highlighted as the best time to try.'],
  ['avoid', 'Avoiding pregnancy', 'The fertile window shows when pregnancy is most likely. PearPetal is not contraception - do not rely on it to avoid pregnancy.'],
  ['pregnant', 'Pregnant', ''], // reveals the pregnancy date setup instead of a one-liner
]
// A short explainer line (accent left border) used under the goal + health sections.
function Explainer ({ title, children }) {
  return (
    <div style={{ color: colors.text.muted, fontSize: 12, lineHeight: 1.45, borderLeft: `2px solid ${colors.primary}`, paddingLeft: spacing.md }}>
      {title && <span style={{ color: colors.text.secondary, fontWeight: 500 }}>{title} </span>}{children}
    </div>
  )
}
// Inline text link (e.g. "tracked conditions" -> the Settings health section).
function LinkSpan ({ onClick, children }) {
  return <button onClick={(e) => { haptic('light'); onClick && onClick(e) }} style={{ background: 'none', border: 'none', padding: 0, margin: 0, color: colors.primary, textDecoration: 'underline', fontSize: 'inherit', fontWeight: 'inherit', cursor: 'pointer' }}>{children}</button>
}

// Round avatar with an initial fallback. `src` is a data URL (own or a partner's
// replicated avatar), `name` supplies the fallback letter.
function Avatar ({ src, name, size = 36 }) {
  const initial = ((name || '').trim()[0] || '♥').toUpperCase()
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: colors.surface.elevated, color: colors.primary, fontSize: Math.round(size * 0.42), fontWeight: 600 }}>
      {src ? <img src={src} width={size} height={size} alt='' style={{ objectFit: 'cover', width: size, height: size }} /> : initial}
    </span>
  )
}

// Turn a picked image file into an avatar data URL. Animated formats (GIF, WebP)
// are kept RAW so the animation survives (matches PearList); static photos are
// downscaled to <=256px and re-encoded to JPEG to stay small. NEVER re-encode an
// animated file - that would flatten it to a single frame.
function fileToAvatarDataUrl (file) {
  const animated = file.type === 'image/gif' || file.type === 'image/webp'
  return new Promise((resolve, reject) => {
    const rd = new FileReader()
    rd.onerror = () => reject(new Error('Could not read that image'))
    rd.onload = () => {
      const dataUrl = String(rd.result)
      if (animated) { resolve(dataUrl); return } // keep raw base64, preserve animation
      const img = new Image()
      img.onload = () => {
        const max = 256
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        try { resolve(canvas.toDataURL('image/jpeg', 0.85)) } catch { resolve(dataUrl) }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    }
    rd.readAsDataURL(file)
  })
}

// --- invite links -----------------------------------------------------------
// Wrap the engine's base64 invite blob as a universal link matching the rest of
// the suite. The blob rides in the URL #fragment so it never reaches
// peerloomllc.com's server (it is the secret that grants access). Two kinds:
// device linking (/petal/link) and partner share (/petal/join).
const INVITE_BASE = 'https://peerloomllc.com/petal'
const linkUrl = (key) => (key ? `${INVITE_BASE}/link#${key}` : '')
const shareUrl = (key) => (key ? `${INVITE_BASE}/join#${key}` : '')
// Accept a pasted / scanned / deep-linked invite in any shape: a full https/pear
// URL (blob in the #fragment, an ?i= query, or after the /link|/join path) or a
// bare blob (backwards compatible). Returns just the invite blob.
function parseInvite (text) {
  const s = String(text || '').trim()
  if (/^(https?:|pear:)/i.test(s)) {
    const h = s.indexOf('#'); if (h !== -1) return s.slice(h + 1).trim()
    const m = s.match(/[?&]i=([^&#]+)/); if (m) return decodeURIComponent(m[1]).trim()
    const j = s.search(/\/(link|join)(?![a-z])/i); if (j !== -1) return s.slice(j).replace(/^\/(link|join)/i, '').replace(/^[/?#]+/, '').trim()
    return ''
  }
  return s
}
// Does this invite carry the device-link kind (vs a partner share)? Only a URL
// says which; a bare blob is ambiguous, so paste flows that already know the mode
// pass it through and this is used only for deep links.
const isLinkInvite = (text) => /(peerloomllc\.com\/petal|pearpetal)\/link(?![a-z])/i.test(String(text || ''))

// --- QR (render + scan, all in the WebView) ---------------------------------
// A QR of an invite link, always on a white quiet-zone box so it scans in dark mode.
function QrImage ({ text, size = 190 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    QRCode.toString(text || '', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => { if (alive) setUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)) })
      .catch(() => {})
    return () => { alive = false }
  }, [text])
  if (!text) return null
  return (
    <div style={{ alignSelf: 'center', width: size, height: size, background: '#fff', borderRadius: radius.md, padding: 8, boxSizing: 'content-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {url ? <img src={url} width={size} height={size} alt='Invite QR code' /> : null}
    </div>
  )
}

// In-WebView QR scanner: camera stream -> canvas frames -> jsQR decode. Works once
// the shell grants the WebView camera permission (see app/index.tsx). onDecode gets
// the raw decoded string; the caller runs it through parseInvite.
function ScannerView ({ open, onClose, onDecode }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  useBackHandler(open, onClose) // Android Back closes the camera first
  useEffect(() => {
    if (!open) return undefined
    setError(null)
    let stream = null; let raf = null; let cancelled = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const stop = () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()) }
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available on this device')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        const v = videoRef.current
        v.srcObject = stream; await v.play()
        const tick = () => {
          if (cancelled) return
          if (v.readyState >= 2 && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            let img = null
            try { img = ctx.getImageData(0, 0, canvas.width, canvas.height) } catch {}
            if (img) {
              const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
              if (found?.data) { stop(); haptic('success'); onDecode(found.data); return }
            }
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) { setError(e?.message || 'Could not open the camera') }
    })()
    return stop
  }, [open])
  if (!open) return null
  // Portal to <body>: when opened from inside a BottomSheet, the sheet's transform
  // makes position:fixed resolve against the sheet (bottom half) instead of the
  // viewport. Portaling escapes that so the camera is truly full-screen.
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#000' }}>
      <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: 240, height: 240, border: `3px solid ${colors.primary}`, borderRadius: radius.lg }} />
      </div>
      <button onClick={onClose} aria-label='Close scanner' style={{ position: 'absolute', top: `calc(${spacing.base}px + var(--pear-safe-top, 0px))`, right: spacing.base, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}>✕</button>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 14, padding: `${spacing.xl}px ${spacing.base}px calc(${spacing.xl}px + var(--pear-safe-bottom, 0px))`, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
        {error || 'Point the camera at an invite QR code'}
      </div>
    </div>,
    document.body
  )
}

// --- onboarding -------------------------------------------------------------
function Onboarding ({ onReady, onViewerReady, onStartSetup }) {
  const [intro, setIntro] = useState(true) // the blooming-dial welcome, shown before the chooser
  const [mode, setMode] = useState(null) // null | 'link' | 'partner'
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [scanning, setScanning] = useState(false)
  const [pendingImport, setPendingImport] = useState(null) // encrypted backup awaiting its password

  const start = async () => {
    setErr('')
    // Create the private base, then hand off to the guided setup wizard (name /
    // goal / last period / reminders) instead of dropping onto an empty dial.
    try { await call('cycle:create'); haptic('success'); onStartSetup() } catch (e) { setErr(e.message) }
  }
  // Recovery / migration: restore a JSON backup. import:data creates the private
  // base if this device has none (the all-devices-lost case), then boots into the
  // app. Encrypted backups route through the password sheet first.
  const restore = async () => {
    setErr('')
    const inShell = typeof window !== 'undefined' && !!window.ReactNativeWebView
    if (inShell) {
      let json = null
      try { const r = await call('shell:import'); json = r && r.json } catch { setErr('Could not open that file. Please try again.'); return }
      if (json) restoreJson(json)
      return
    }
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'
    input.onchange = () => { const f = input.files && input.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => restoreJson(String(rd.result)); rd.readAsText(f) }
    input.click()
  }
  const restoreJson = async (json) => {
    let parsed
    try { parsed = JSON.parse(json) } catch { setErr('That file could not be read. Choose a valid PearPetal backup.'); return }
    if (parsed && parsed.enc) { setPendingImport(parsed); return }
    try { await call('import:data', { data: parsed }); haptic('success'); onReady() } catch (e) { setErr(friendlyImportError(e)) }
  }
  const submitRestore = async (pw) => {
    await call('import:data', { data: pendingImport, password: pw }) // throws 'wrong password' -> sheet shows friendly error
    setPendingImport(null); haptic('success'); onReady()
  }
  const link = async (raw) => {
    setErr('')
    try { await call('link:join', { inviteKey: parseInvite(typeof raw === 'string' ? raw : code) }); haptic('success'); onReady() } catch (e) { setErr(e.message) }
  }
  const joinPartner = async (raw) => {
    setErr('')
    try { await call('partner:join', { inviteKey: parseInvite(typeof raw === 'string' ? raw : code) }); haptic('success'); onViewerReady() } catch (e) { setErr(e.message) }
  }
  const submit = () => (mode === 'link' ? link() : joinPartner())
  const onScanned = (txt) => { setScanning(false); (mode === 'link' ? link : joinPartner)(txt) }
  const back = () => { setMode(null); setErr(''); setCode(''); setScanning(false) }
  // Android Back: from a paste sub-mode -> the chooser; from the chooser -> the intro.
  useBackHandler(!intro || mode !== null, () => { if (mode !== null) back(); else setIntro(true) })

  // First-run intro: the blooming-dial welcome shown BEFORE the Start / Link / View
  // chooser, so the app introduces itself first. "Get started" reveals the chooser.
  const t0 = todayIso()
  const samplePred = { known: true, phase: 'fertile', dayOfCycle: 14, cycleLen: 28, ovulationEst: t0, nextPeriodStart: addDaysIso(t0, 14), fertileStart: addDaysIso(t0, -4), fertileEnd: addDaysIso(t0, 1) }
  if (intro) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', boxSizing: 'border-box', paddingLeft: spacing.xl, paddingRight: spacing.xl, paddingTop: screenPadTop, paddingBottom: `calc(${spacing.xl}px + var(--pear-safe-bottom, 0px))`, display: 'flex', flexDirection: 'column', gap: spacing.lg, minHeight: '100dvh', justifyContent: 'center' }}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          <PetalDial pred={samplePred} today={t0} flower='rose' />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, fontWeight: 600, color: colors.primary, letterSpacing: 0.3 }}>PearPetal</div>
          <div style={{ color: colors.text.secondary, marginTop: spacing.sm, lineHeight: 1.5 }}>Your flower furls and blooms across your cycle, so a glance shows your phase. Private tracking - no account, no server, your data stays on your devices.</div>
        </div>
        <Btn onClick={() => setIntro(false)}>Get started</Btn>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', boxSizing: 'border-box', paddingLeft: spacing.xl, paddingRight: spacing.xl, paddingTop: screenPadTop, paddingBottom: `calc(${spacing.xl}px + var(--pear-safe-bottom, 0px))`, display: 'flex', flexDirection: 'column', gap: spacing.lg, minHeight: '100dvh', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 600, color: colors.primary, letterSpacing: 0.3 }}>PearPetal</div>
        {mode === null && <div style={{ color: colors.text.secondary, marginTop: spacing.sm }}>How would you like to begin?</div>}
      </div>
      {mode === null && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <Btn onClick={start}>Start tracking</Btn>
          <Btn kind='ghost' onClick={() => { setMode('link'); setErr('') }}>Link another device</Btn>
          <Btn kind='ghost' onClick={() => { setMode('partner'); setErr('') }}>View a partner's cycle</Btn>
          <Btn kind='ghost' onClick={restore}>Restore from a backup</Btn>
        </div>
      )}
      {(mode === 'link' || mode === 'partner') && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div style={{ color: colors.text.secondary, fontSize: 14 }}>
            {mode === 'link'
              ? 'On your other device, open Devices and copy its link code. Paste it here.'
              : "Paste the share code your partner gave you. You'll see only what they chose to share."}
          </div>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder='Paste code' rows={3}
            style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, resize: 'none' }} />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn onClick={submit} style={{ flex: 1 }}>{mode === 'link' ? 'Link this device' : 'View their cycle'}</Btn>
            <Btn kind='ghost' onClick={() => { setErr(''); setScanning(true) }}>Scan QR</Btn>
          </div>
          <Btn kind='ghost' onClick={back}>Back</Btn>
        </div>
      )}
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
      <ScannerView open={scanning} onClose={() => setScanning(false)} onDecode={onScanned} />
      {pendingImport && <ImportPasswordSheet onSubmit={submitRestore} onClose={() => setPendingImport(null)} />}
    </div>
  )
}

// --- first-run setup wizard --------------------------------------------------
// Runs right after "Start tracking" (which created the private base). A short,
// fully skippable sequence sets up the essentials - name/photo, goal, last period,
// reminders - so the user lands on a MEANINGFUL dial instead of an empty "Learning
// your cycle". Reuses the same controls as Settings; T1, no wire change.
const SETUP_STEPS = ['name', 'goal', 'period', 'reminders', 'done']

function StepDots ({ n, i }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: n }).map((_, k) => (
        <span key={k} style={{ width: k === i ? 18 : 6, height: 6, borderRadius: radius.full, background: k === i ? colors.primary : colors.border, transition: 'width 160ms, background 160ms' }} />
      ))}
    </div>
  )
}

function SetupWizard ({ onDone }) {
  const [step, setStep] = useState(0)
  const [prefs, setPrefs] = useState({ goal: 'track' })
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(null) // avatar data URL
  const [periodStart, setPeriodStart] = useState('')
  const [notif, setNotif] = useState(null)
  const [busy, setBusy] = useState(false)

  const total = SETUP_STEPS.length
  const s = SETUP_STEPS[step]
  const go = (d) => setStep((v) => Math.max(0, Math.min(total - 1, v + d)))
  useBackHandler(step > 0, () => go(-1)) // Android Back steps back through the wizard

  const savePrefs = async (patch) => { setPrefs((p) => ({ ...p, ...patch })); await call('prefs:set', patch).catch(() => {}) }
  const saveName = async () => {
    const dn = name.trim()
    if (dn || avatar) { try { await call('profile:set', { displayName: dn, avatar: avatar || undefined }) } catch {} }
    go(1)
  }
  const logPeriod = async () => {
    if (periodStart) { setBusy(true); try { await call('period:log', { start: periodStart, end: null }) } catch {} setBusy(false) }
    go(1)
  }
  const enableReminders = async () => {
    setBusy(true)
    try { setNotif(await call('shell:notifications:set', { enabled: true })) } catch {}
    setBusy(false); go(1)
  }

  const field = { background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: '10px 12px', fontSize: 15 }

  const title = (t, sub) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{t}</div>
      {sub && <div style={{ color: colors.text.secondary, fontSize: 14, marginTop: spacing.sm, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
  const nextRow = (label, onPrimary, { skip = true, disabled = false } = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <Btn onClick={onPrimary} disabled={disabled} style={{ opacity: disabled ? 0.6 : 1 }}>{label}</Btn>
      {skip && <Btn kind='ghost' onClick={() => go(1)}>Skip</Btn>}
    </div>
  )

  let body
  if (s === 'name') {
    body = (
      <>
        {title('What should we call you?', 'Shown to partners you share with; otherwise it stays on your device. Optional.')}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: spacing.md }}>
          <label style={{ cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
            <Avatar src={avatar} name={name} size={56} />
            <span style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: '50%', background: colors.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Camera size={13} color={colors.text.onPrimary} /></span>
            <input type='file' accept='image/*' style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setAvatar(await fileToAvatarDataUrl(f)) } catch {} } }} />
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Your name' maxLength={64} style={{ ...field, flex: 1, minWidth: 0 }} />
        </div>
        {nextRow('Continue', saveName)}
      </>
    )
  } else if (s === 'goal') {
    body = (
      <>
        {title('What are you tracking for?', 'This tailors what PearPetal shows you. You can change it anytime.')}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
            {GOAL_OPTS.map(([k, l]) => (
              <Chip key={k} active={(prefs.goal || 'track') === k} onClick={() => savePrefs({ goal: k })} style={{ width: '100%' }}>{l}</Chip>
            ))}
          </div>
          {prefs.goal === 'pregnant'
            ? <PregnancySetup prefs={prefs} save={savePrefs} />
            : <Explainer>{(GOAL_OPTS.find(([k]) => k === (prefs.goal || 'track')) || [])[2]}</Explainer>}
        </div>
        {nextRow('Continue', () => go(1), { skip: false })}
      </>
    )
  } else if (s === 'period') {
    body = (
      <>
        {title('When did your last period start?', 'Pick the first day of your most recent period so your dial starts out accurate. Not sure? Skip it - PearPetal learns as you log.')}
        <div style={{ ...card }}>
          <input type='date' value={periodStart} max={todayIso()} onChange={(e) => setPeriodStart(e.target.value)} style={{ ...field, width: '100%', boxSizing: 'border-box' }} />
        </div>
        {nextRow(busy ? 'Saving...' : 'Continue', logPeriod, { disabled: busy })}
      </>
    )
  } else if (s === 'reminders') {
    body = (
      <>
        {title('Want reminders?', 'Gentle nudges on your own phone for your period and fertile window. Private to this device, never sent to anyone - fine-tune them anytime in Settings.')}
        {notif && notif.permissionDenied && <div style={{ color: colors.text.muted, fontSize: 12, textAlign: 'center' }}>Notifications are off in system settings - turn them on for PearPetal to receive reminders.</div>}
        {nextRow(busy ? '...' : 'Turn on reminders', enableReminders, { disabled: busy })}
      </>
    )
  } else {
    body = (
      <>
        {title("You're all set", 'Tap the flower or a past day to log flow and symptoms. Share a scoped view with a partner anytime from the Share tab. Your cycle lives only on your devices.')}
        <Btn onClick={onDone}>Open my cycle</Btn>
      </>
    )
  }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', boxSizing: 'border-box', paddingLeft: spacing.xl, paddingRight: spacing.xl, paddingTop: screenPadTop, paddingBottom: `calc(${spacing.xl}px + var(--pear-safe-bottom, 0px))`, minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ paddingTop: spacing.sm }}><StepDots n={total} i={step} /></div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: spacing.lg }}>{body}</div>
      </div>
    </div>
  )
}

// --- sharing (owner side) + partner view ------------------------------------
const SCOPE_OPTS = [
  { key: 'phase', label: 'Phase only', desc: 'Current phase + next period date' },
  { key: 'fertility', label: 'Fertility', desc: 'Adds the fertile window + ovulation estimate' },
  { key: 'full', label: 'Full', desc: 'Adds a redacted day summary (coarse symptoms, never notes)' },
]
const PHASE_LABEL = { menstrual: 'Menstrual', follicular: 'Follicular', fertile: 'Fertile', luteal: 'Luteal' }

function Sharing ({ onClose, onOpenPartner }) {
  const [scope, setScope] = useState('phase')
  const [shares, setShares] = useState([])
  const [partners, setPartners] = useState([])
  const [err, setErr] = useState('')
  const [qrFor, setQrFor] = useState(null)
  const [busyRevoke, setBusyRevoke] = useState(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const load = useCallback(async () => {
    setShares(await call('share:list').catch(() => []))
    setPartners(await call('partner:list').catch(() => []))
  }, [])
  useSynced(load)
  // Belt-and-suspenders live refresh: group:updated already fires when a joiner's
  // member row replicates in, but a join lands over a few seconds of writer-admission
  // churn, so also poll while this screen is open. This is what flips a share row
  // from "Not joined yet" to "Shared with X" in real time.
  useEffect(() => { const t = setInterval(() => load(), 3000); return () => clearInterval(t) }, [load])
  const create = async () => {
    setErr('')
    try { await call('share:create', { scope }); haptic('success'); load() } catch (e) { setErr(e.message) }
  }
  const revoke = async (groupId) => {
    if (busyRevoke) return // guard against a double-fire revoking an already-gone share
    setBusyRevoke(groupId)
    try { await call('share:revoke', { groupId }); haptic('warn'); await load() } catch (e) { setErr(e.message) } finally { setBusyRevoke(null) }
  }
  const remove = async (groupId) => {
    if (busyRevoke) return
    setBusyRevoke(groupId)
    try { await call('share:remove', { groupId }); haptic('warn'); await load() } catch (e) { setErr(e.message) } finally { setBusyRevoke(null) }
  }
  const activeShares = shares.filter((s) => !s.revoked)
  const endedShares = shares.filter((s) => s.revoked)
  const copy = async (code) => { try { await navigator.clipboard.writeText(code); haptic('success') } catch { call('shell:share', { text: code }).catch(() => {}) } }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Sharing</div>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ fontSize: 15, fontWeight: 500, textAlign: 'center' }}>Share with a partner</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          {SCOPE_OPTS.map((o) => (
            <button key={o.key} onClick={() => setScope(o.key)} style={{
              textAlign: 'left', borderRadius: radius.lg, padding: spacing.md, border: `1px solid ${scope === o.key ? colors.primary : colors.border}`,
              background: scope === o.key ? 'rgba(232,133,155,0.08)' : 'transparent',
            }}>
              <div style={{ color: colors.text.primary, fontWeight: 500, fontSize: 14 }}>{o.label}</div>
              <div style={{ color: colors.text.muted, fontSize: 12, marginTop: 2 }}>{o.desc}</div>
            </button>
          ))}
        </div>
        <Btn onClick={create}>Create a share link</Btn>
        <div style={{ color: colors.text.muted, fontSize: 12 }}>Anyone with the link can view what you choose to share, so send it only to people you trust. They can view but never edit, and cannot re-share access to anyone else. Your full log and notes never leave your devices. Revoking stops future updates, but cannot unsend what was already received.</div>
      </div>

      {activeShares.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ fontSize: 13, color: colors.text.muted, textAlign: 'center' }}>People you share with</div>
          {activeShares.map((s) => {
            const joiners = s.joiners || []
            const named = joiners.map((j) => j.name).filter(Boolean)
            // Just the joiner name(s): the section header ("People you share with")
            // already supplies "shared with", and dropping the prefix stops long
            // names from being truncated on narrow screens.
            const title = named.length ? named.join(', ')
              : joiners.length ? (joiners.length === 1 ? 'Someone joined' : `${joiners.length} people joined`)
                : 'Not joined yet'
            const on = qrFor === s.groupId
            return (
              <div key={s.groupId} style={{ ...card, padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
                  {joiners.length
                    ? <Avatar name={named[0] || '?'} size={32} />
                    : <span style={{ width: 32, height: 32, borderRadius: radius.full, background: colors.surface.elevated, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.text.muted, flexShrink: 0 }}><ShareNetwork size={16} /></span>}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: colors.text.primary, fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{title}</div>
                    <div style={{ color: colors.text.muted, fontSize: 12, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.scope} · shared {sharedOn(s.createdAt)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: spacing.xs, flexShrink: 0 }}>
                    <IconBtn label='Show QR' onClick={() => setQrFor(s.groupId)} active={on}><QrCode size={18} weight={on ? 'fill' : 'regular'} /></IconBtn>
                    <IconBtn label='Copy link' onClick={() => copy(shareUrl(s.inviteKey))}><Copy size={18} /></IconBtn>
                    <IconBtn label='Revoke share' onClick={() => revoke(s.groupId)} disabled={busyRevoke === s.groupId} color={colors.error}><Trash size={18} /></IconBtn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {endedShares.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ fontSize: 13, color: colors.text.muted, textAlign: 'center' }}>Sharing ended</div>
          {endedShares.map((s) => {
            const named = (s.joiners || []).map((j) => j.name).filter(Boolean)
            const who = named.length ? named.join(', ') : 'This share'
            return (
              <div key={s.groupId} style={{ ...card, padding: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.md }}>
                <span style={{ width: 32, height: 32, borderRadius: radius.full, background: colors.surface.elevated, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.text.muted, flexShrink: 0 }}><ShareNetwork size={16} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: colors.text.secondary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</div>
                  <div style={{ color: colors.text.muted, fontSize: 12 }}>Ended{s.revokedAt ? ` ${sharedOn(s.revokedAt)}` : ''} · no longer updating</div>
                </div>
                <IconBtn label='Remove permanently' onClick={() => remove(s.groupId)} disabled={busyRevoke === s.groupId} color={colors.error}><Trash size={18} /></IconBtn>
              </div>
            )
          })}
          <div style={{ color: colors.text.muted, fontSize: 11, textAlign: 'center' }}>They keep the last update they received. Remove permanently once they have opened the app to see the change.</div>
        </div>
      )}

      {/* Always available - an existing owner can also view a partner's cycle (paste
          / scan a share code), not only on a fresh install. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ fontSize: 13, color: colors.text.muted, textAlign: 'center' }}>Shared with you</div>
        {partners.map((p) => (
          <button key={p.groupId} onClick={() => onOpenPartner(p.groupId)} style={{ ...card, padding: spacing.md, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: spacing.md, minWidth: 0 }}>
              <Avatar src={p.ownerAvatar} name={p.ownerName} size={32} />
              <span style={{ color: colors.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.ownerName ? `${p.ownerName}'s cycle` : "A partner's cycle"}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, color: colors.text.muted, fontSize: 12, flexShrink: 0, textTransform: p.revoked ? 'none' : 'capitalize' }}>{p.revoked ? 'Sharing ended' : (p.scope || '...')}<CaretRight size={14} color={colors.text.muted} weight='regular' /></span>
          </button>
        ))}
        <Btn kind='ghost' onClick={() => setJoinOpen(true)}>View a partner's cycle</Btn>
      </div>
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
      {joinOpen && <JoinPartnerSheet onClose={() => setJoinOpen(false)} onJoined={(groupId) => { setJoinOpen(false); onOpenPartner(groupId) }} />}
      {qrFor && (() => { const sh = shares.find((s) => s.groupId === qrFor); return sh ? <ShareQrSheet share={sh} onClose={() => setQrFor(null)} /> : null })()}
    </div>
  )
}

// The invite QR as a bottom sheet, opened from a share row's QR button. It watches
// the (live, parent-polled) share for a NEW joiner - when the partner scans + joins,
// it flips to a "Connected" confirmation and auto-dismisses. Copy-link is offered as
// a fallback for when a scan is not possible.
function ShareQrSheet ({ share, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      {(close) => <ShareQrBody share={share} close={close} />}
    </BottomSheet>
  )
}
function ShareQrBody ({ share, close }) {
  const [connected, setConnected] = useState(false)
  const joinerName = (share.joiners || []).map((j) => j.name).filter(Boolean)[0]
  // Poll for a real peer connection to THIS shared base (share:connected). This
  // fires the moment the partner scans + reaches us - well before their identity
  // row replicates back (which lags), so the confirmation is prompt and reliable.
  useEffect(() => {
    if (connected) return undefined
    let alive = true; let timer = null
    const tick = async () => {
      if (!alive) return
      let ok = false
      try { ok = !!(await call('share:connected', { groupId: share.groupId }))?.connected } catch {}
      if (!alive) return
      if (ok) { setConnected(true); haptic('success') } else timer = setTimeout(tick, 1200)
    }
    timer = setTimeout(tick, 700)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [share.groupId, connected])
  // Show the "Connected" confirmation briefly, then slide the sheet away.
  useEffect(() => {
    if (!connected) return undefined
    const t = setTimeout(close, 1600)
    return () => clearTimeout(t)
  }, [connected, close])
  const link = shareUrl(share.inviteKey)
  const copy = async () => { try { await navigator.clipboard.writeText(link); haptic('success') } catch { call('shell:share', { text: link }).catch(() => {}) } }

  if (connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing.md, padding: `${spacing.lg}px 0`, animation: 'pearpetal-fade 260ms ease' }}>
        <span style={{ width: 60, height: 60, borderRadius: '50%', background: colors.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Check size={32} color={colors.text.onPrimary} weight='bold' /></span>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Connected</div>
        <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>{joinerName ? `You're now sharing with ${joinerName}.` : 'They can now see what you chose to share.'}</div>
      </div>
    )
  }
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>Scan to connect</div>
      <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center' }}>On their phone: PearPetal → View a partner's cycle → Scan QR.</div>
      <QrImage text={link} size={220} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, color: colors.text.secondary, fontSize: 13 }}>
        <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${colors.border}`, borderTopColor: colors.primary, animation: 'pearpetal-spin 0.8s linear infinite' }} />
        Waiting for them to scan…
      </div>
      <Btn kind='ghost' onClick={copy}>Copy link instead</Btn>
      <Btn kind='ghost' onClick={close}>Done</Btn>
    </>
  )
}

// Join a partner's share from within the app (paste code or scan QR), so an
// existing owner - not just a fresh install - can view a partner's cycle.
function JoinPartnerSheet ({ onClose, onJoined }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  // Enable "View cycle" only once the box holds something that parses to a
  // plausible invite key (long base64/base64url blob). Real validation still
  // happens on join; this just stops taps on an empty/garbage box.
  const parsed = parseInvite(code)
  const valid = parsed.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(parsed)
  const join = async (raw) => {
    setErr(''); setBusy(true)
    try {
      const r = await call('partner:join', { inviteKey: parseInvite(typeof raw === 'string' ? raw : code) })
      haptic('success'); onJoined(r.groupId)
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <BottomSheet onClose={onClose}>
      {(close) => (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>View a partner's cycle</div>
          <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center' }}>Paste the share code your partner gave you. You'll see only what they chose to share.</div>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder='Paste code' rows={3}
            style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, resize: 'none' }} />
          {err && <div style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{err}</div>}
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn onClick={() => join()} disabled={!valid || busy} style={{ flex: 1, opacity: (!valid || busy) ? 0.5 : 1 }}>{busy ? 'Joining…' : 'View cycle'}</Btn>
            <Btn kind='ghost' onClick={() => { setErr(''); setScanning(true) }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}><QrCode size={18} />Scan QR</Btn>
          </div>
          <Btn kind='ghost' onClick={close}>Cancel</Btn>
          <ScannerView open={scanning} onClose={() => setScanning(false)} onDecode={(txt) => { setScanning(false); join(txt) }} />
        </>
      )}
    </BottomSheet>
  )
}

function PartnerView ({ groupId, onClose, onLeft }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  // Once we've started leaving, the base is torn down, so a racing poll /
  // group:updated must not flash a "partner share not found" error on the way out.
  const leaving = useRef(false)
  const load = async () => {
    if (leaving.current) return
    try { setData(await call('partner:view', { groupId })) } catch (e) { if (!leaving.current) setErr(e.message) }
  }
  useEffect(() => { load() }, [groupId])
  useEffect(() => on('group:updated', (d) => { if (d?.groupId === groupId) load() }), [groupId])
  // The owner's projection may still be replicating when this view first opens:
  // partner:view returns nulls until share:meta/phase apply, and the group:updated
  // that would refresh us can fire in the gap before this view mounts (it is then
  // consumed by the owner-mode listener without being buffered). Without this, the
  // view sits blank until the user leaves and re-enters. Poll until the projection
  // lands, then stop and rely on the live group:updated subscription above. Keep
  // polling a bit longer if an avatar is announced but its blob has not replicated
  // yet (partner:view is non-blocking on the avatar), so the photo pops in.
  const pendingAvatar = !!(data?.ownerHasAvatar && !data?.ownerAvatar)
  // Once the share is revoked, no more updates are coming - stop polling.
  const synced = !!data?.revoked || (!!(data && (data.ownerPubkey || data.phase || data.predict)) && !pendingAvatar)
  useEffect(() => {
    if (synced) return undefined
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [groupId, synced])
  const leave = async () => {
    leaving.current = true; setErr('')
    try { await call('partner:leave', { groupId }) } catch {}
    onLeft()
  }

  const phase = data?.phase
  const predict = data?.predict
  // Build a dial projection from the partner's scoped view. cycleLen is derived
  // from the shared next-period date (partner never receives it directly). Fertile
  // window / ovulation only arrive on fertility/full scope; the dial estimates them
  // when absent. The owner's flower species is a device-local pref (never shared),
  // so the partner dial uses the default.
  const partnerPred = phase ? {
    known: true,
    phase: phase.phase,
    dayOfCycle: phase.dayOfCycle,
    cycleLen: (phase.dayOfCycle || 1) + (predict?.nextPeriodStart ? isoDiff(todayIso(), predict.nextPeriodStart) : 14),
    ovulationEst: predict?.ovulationEst,
    nextPeriodStart: predict?.nextPeriodStart,
    fertileStart: predict?.fertileStart,
    fertileEnd: predict?.fertileEnd,
  } : { known: false }
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
          <Avatar src={data?.ownerAvatar} name={data?.ownerName} size={32} />
          <div style={{ fontSize: 20, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data?.ownerName ? `${data.ownerName}'s cycle` : "Partner's cycle"}</div>
        </div>
        <Btn kind='ghost' onClick={onClose}>Back</Btn>
      </div>
      {!data && !err && <div style={{ color: colors.text.muted, textAlign: 'center', padding: spacing.lg }}>Waiting for their device to sync...</div>}
      {data?.revoked && (
        <div style={{ ...card, borderLeft: `3px solid ${colors.primary}`, display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Sharing ended</div>
          <div style={{ color: colors.text.secondary, fontSize: 13, lineHeight: 1.45 }}>
            {data.ownerName ? `${data.ownerName} stopped sharing their cycle` : 'This person stopped sharing their cycle'}{data.revokedAt ? ` on ${sharedOn(data.revokedAt)}` : ''}. What you see below is the last update you received.
          </div>
          <Btn kind='ghost' onClick={leave} style={{ color: colors.error, marginTop: spacing.xs }}>Remove</Btn>
        </div>
      )}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, opacity: data.revoked ? 0.5 : 1 }}>
          {phase && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
              <PetalDial pred={partnerPred} today={todayIso()} flower='rose' />
            </div>
          )}
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            <div style={{ fontSize: 13, color: colors.text.muted }}>Current phase</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: colors.primary }}>{phase ? (PHASE_LABEL[phase.phase] || phase.phase) : 'Not shared yet'}</div>
            {phase?.dayOfCycle != null && <div style={{ color: colors.text.secondary, fontSize: 14 }}>Day {phase.dayOfCycle} of cycle</div>}
          </div>
          {predict && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {predict.nextPeriodStart && <Row label='Next period' value={predict.nextPeriodStart} />}
              {predict.fertileStart && <Row label='Fertile window' value={`${predict.fertileStart} - ${predict.fertileEnd}`} />}
              {predict.ovulationEst && <Row label='Ovulation (est.)' value={predict.ovulationEst} />}
            </div>
          )}
          {data.scope === 'full' && (data.summary || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>Recent days</div>
              {data.summary.map((s) => (
                <div key={s.date} style={{ ...card, padding: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.md }}>
                  <span style={{ width: 12, height: 12, borderRadius: radius.full, background: s.flow ? colors.flow.medium : colors.track, flexShrink: 0 }} />
                  <span style={{ color: colors.text.primary, fontWeight: 500, width: 104 }}>{s.date}</span>
                  <span style={{ color: colors.text.secondary, fontSize: 13, flex: 1 }}>{(s.symptomTags || []).join(' · ') || '-'}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ color: colors.text.muted, fontSize: 12, textAlign: 'center' }}>They chose to share {data.scope || 'this'}. You cannot see their full log.</div>
          {!data.revoked && <Btn kind='ghost' onClick={leave} style={{ color: colors.error }}>Stop viewing</Btn>}
        </div>
      )}
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
    </div>
  )
}
function Row ({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: accent ? colors.primary : colors.text.secondary, fontSize: 14 }}>{label}</span>
      <span style={{ color: accent ? colors.primary : colors.text.primary, fontWeight: accent ? 600 : 500 }}>{value}</span>
    </div>
  )
}

// --- day editor -------------------------------------------------------------
function DayEditor ({ date, setDate, onSaved }) {
  const [row, setRow] = useState(null)
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const r = await call('day:get', { date }).catch(() => null)
    setRow(r || { date, flow: null, symptoms: [] })
    setNotes(r?.notes || '')
  }, [date])
  useEffect(() => { load() }, [load])
  // Live-refresh the open day when another of your devices edits it. Reload flow +
  // symptoms always, but only adopt the remote note when the notes field is not
  // focused, so a sync never yanks text you are mid-typing (it saves on blur, LWW).
  useEffect(() => on('group:updated', async () => {
    const r = await call('day:get', { date }).catch(() => null)
    setRow(r || { date, flow: null, symptoms: [] })
    const typingNote = typeof document !== 'undefined' && document.activeElement && document.activeElement.tagName === 'TEXTAREA'
    if (!typingNote) setNotes(r?.notes || '')
  }), [date])

  if (!row) return null
  const setFlow = async (k) => {
    const flow = row.flow === k ? null : k
    setRow({ ...row, flow }) // Chip fires the haptic tick on tap
    await call('day:set', { date, flow }); flash()
  }
  const toggleSymptom = async (s) => {
    const has = (row.symptoms || []).includes(s)
    const symptoms = has ? row.symptoms.filter((x) => x !== s) : [...(row.symptoms || []), s]
    setRow({ ...row, symptoms }) // Chip fires the haptic tick on tap
    await call('day:set', { date, symptoms }); flash()
  }
  const saveNotes = async () => { await call('day:set', { date, notes }); flash() }
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1200); onSaved && onSaved() }

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.base }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input type='date' value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)}
          style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `6px 10px` }} />
        <span style={{ position: 'absolute', right: 0, color: colors.success, fontSize: 13, opacity: saved ? 1 : 0, transition: 'opacity 200ms' }}>Saved</span>
      </div>
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, marginBottom: spacing.sm }}>Flow</div>
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          {FLOWS.map((f) => <Chip key={f.key} active={row.flow === f.key} color={flowColor(f.key)} onClick={() => setFlow(f.key)}>{f.label}</Chip>)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, marginBottom: spacing.sm }}>Symptoms</div>
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          {SYMPTOMS.map((s) => <Chip key={s} active={(row.symptoms || []).includes(s)} onClick={() => toggleSymptom(s)}>{s}</Chip>)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, marginBottom: spacing.sm }}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} rows={2} placeholder='Private to your devices'
          style={{ width: '100%', background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, resize: 'none' }} />
      </div>
    </div>
  )
}

// --- recent days ------------------------------------------------------------
function RecentDays ({ days, onPick }) {
  if (!days.length) return <div style={{ color: colors.text.muted, textAlign: 'center', padding: spacing.lg }}>No entries yet. Log your first day above.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      {days.map((d) => (
        <button key={d.date} onClick={() => onPick(d.date)} style={{ ...card, padding: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.md, textAlign: 'left' }}>
          <span style={{ width: 12, height: 12, borderRadius: radius.full, background: d.flow ? flowColor(d.flow) : colors.track, flexShrink: 0 }} />
          <span style={{ color: colors.text.primary, fontWeight: 500, width: 104 }}>{d.date}</span>
          <span style={{ color: colors.text.secondary, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[d.flow, ...(d.symptoms || [])].filter(Boolean).join(' · ') || '-'}
          </span>
        </button>
      ))}
    </div>
  )
}

// --- devices ----------------------------------------------------------------
function Devices ({ onClose }) {
  const [devices, setDevices] = useState([])
  const [invite, setInvite] = useState('')
  const load = useCallback(async () => {
    setDevices(await call('device:getAll').catch(() => []))
    try { const r = await call('link:invite'); setInvite(r.inviteKey) } catch {}
  }, [])
  useSynced(load)
  const inviteLink = linkUrl(invite)
  const share = () => call('shell:share', { title: 'Link a device to PearPetal', text: inviteLink }).catch(() => {})
  const copy = async () => { try { await navigator.clipboard.writeText(inviteLink); haptic('success') } catch { share() } }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Your devices</div>
        <Btn kind='ghost' onClick={onClose}>Done</Btn>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {devices.map((d) => (
          <div key={d.pubkey} style={{ ...card, padding: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.md }}>
            <span style={{ color: colors.text.primary, fontWeight: 500 }}>{d.label}</span>
            {d.self && <span style={{ color: colors.text.muted, fontSize: 12 }}>this device</span>}
          </div>
        ))}
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ fontSize: 14, color: colors.text.secondary }}>Link another of your devices: scan this QR on it, open this link on it, or paste it into "Link another device".</div>
        <QrImage text={inviteLink} />
        <div style={{ background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: colors.text.secondary, wordBreak: 'break-all', maxHeight: 96, overflow: 'auto' }}>{inviteLink || '...'}</div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn onClick={copy} style={{ flex: 1 }}>Copy link</Btn>
          <Btn kind='ghost' onClick={share}>Share</Btn>
        </div>
      </div>
    </div>
  )
}

// --- viewer-only home (a device that only watches partners, no own cycle) ---
function ViewerHome ({ onOpenPartner, onBecomeOwner }) {
  const [partners, setPartners] = useState([])
  const load = useCallback(async () => setPartners(await call('partner:list').catch(() => [])), [])
  useSynced(load)
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: colors.primary }}>PearPetal</div>
      <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>Shared with you</div>
      {partners.map((p) => (
        <button key={p.groupId} onClick={() => onOpenPartner(p.groupId)} style={{ ...card, padding: spacing.md, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: spacing.md, minWidth: 0 }}>
            <Avatar src={p.ownerAvatar} name={p.ownerName} size={32} />
            <span style={{ color: colors.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.ownerName ? `${p.ownerName}'s cycle` : "A partner's cycle"}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, color: p.revoked ? colors.text.secondary : colors.text.muted, fontSize: 12, flexShrink: 0 }}>{p.revoked ? 'Sharing ended' : (p.scope || '...')}<CaretRight size={14} color={colors.text.muted} weight='regular' /></span>
        </button>
      ))}
      <Btn kind='ghost' onClick={onBecomeOwner}>Start tracking my own cycle</Btn>
    </div>
  )
}

// --- cycle summary (owner's own prediction) ---------------------------------
const PHASE_COLOR = { menstrual: '#c8384f', follicular: '#c9a0d8', fertile: '#e8859b', luteal: '#8f8288' }
function fmtDate (iso) { try { return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }
function sharedOn (ms) { try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' } }

// Pregnancy (gestational) hero: replaces the cycle summary when the goal is
// Pregnant. Shows the bloom-by-gestation dial + weeks/trimester/due-date.
const TRIMESTER_LABEL = { 1: 'First trimester', 2: 'Second trimester', 3: 'Third trimester' }
function PregnancyView ({ preg, flower, onSettings }) {
  if (!preg?.active) return null
  const { weeks, days, trimester, dueDate, daysUntilDue, progress } = preg
  const dueLabel = daysUntilDue > 0 ? `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}` : daysUntilDue === 0 ? 'today' : `${-daysUntilDue} day${daysUntilDue === -1 ? '' : 's'} ago`
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md, alignItems: 'stretch' }}>
      <PregnancyDial progress={progress} weeks={weeks} days={days} flower={flower} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm, marginTop: `-${spacing.sm}px` }}>
        <span style={{ fontSize: 26, fontWeight: 600, color: colors.primary }}>{weeks}w {days}d</span>
        <span style={{ color: colors.text.muted, fontSize: 14 }}>· {TRIMESTER_LABEL[trimester]}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
        <Row label='Due date' value={`${fmtDate(dueDate)} · ${dueLabel}`} />
        <Row label='Progress' value={`${Math.round(progress * 100)}% of ~40 weeks`} />
      </div>
      <div style={{ color: colors.text.muted, fontSize: 11, textAlign: 'center' }}>A calendar estimate. Follow your provider's dates.</div>
    </div>
  )
}

function CycleSummary ({ pred, today, flower, onSettings, onConditions, onScrub, selected, onEditPeriod, onInfo, onFlowerTap }) {
  if (!pred) return null
  const days = pred.daysUntilNextPeriod
  const nextLabel = days <= 0 ? 'expected now' : days === 1 ? 'in 1 day' : `in ${days} days`
  return (
    <div style={{ ...card, position: 'relative', display: 'flex', flexDirection: 'column', gap: spacing.md, alignItems: 'stretch' }}>
      <button onClick={() => { haptic('light'); onFlowerTap && onFlowerTap() }} aria-label='Change flower' style={{ position: 'absolute', top: spacing.md, left: spacing.md, zIndex: 1, background: 'none', border: 'none', padding: spacing.xs, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><FlowerThumb flower={flower} size={26} /></button>
      <button onClick={() => { haptic('light'); onInfo && onInfo() }} aria-label='How to read the dial' style={{ position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 1, background: 'none', border: 'none', padding: spacing.xs, color: colors.text.muted, cursor: 'pointer', display: 'flex' }}><Info size={20} /></button>
      <PetalDial pred={pred} today={today} flower={flower} onDayTap={onScrub} selected={selected} hideFertile={pred.birthControl} />
      {!pred.known ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Learning your cycle</div>
          <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>Log a period start or two and the flower will track your phase, next period, and fertile window. Everything is computed on this device.</div>
          <Btn onClick={onEditPeriod} style={{ alignSelf: 'center', padding: `8px 20px` }}>Add period</Btn>
          <button onClick={() => { haptic('light'); onSettings && onSettings() }} style={{ alignSelf: 'center', background: 'none', border: 'none', color: colors.primary, fontSize: 13, padding: 0 }}>Set your average cycle length ›</button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm, marginTop: `-${spacing.sm}px` }}>
            <span style={{ fontSize: 26, fontWeight: 600, color: PHASE_COLOR[pred.phase] || colors.text.primary }}>{PHASE_LABEL[pred.phase] || pred.phase}</span>
            <span style={{ color: colors.text.muted, fontSize: 14 }}>· day {pred.dayOfCycle}</span>
          </div>
          {!pred.birthControl && pred.goal === 'conceive' && <div style={{ textAlign: 'center', color: colors.primary, fontSize: 12 }}>Your fertile window is your best chance to conceive.</div>}
          {!pred.birthControl && pred.goal === 'avoid' && <div style={{ textAlign: 'center', color: colors.warn, fontSize: 12, fontWeight: 500 }}>Not contraception. Do not rely on this to avoid pregnancy.</div>}
          <Btn kind='ghost' onClick={onEditPeriod} style={{ alignSelf: 'center', padding: `7px 18px`, fontSize: 14 }}>{pred.phase === 'menstrual' ? 'Adjust period' : 'Add period'}</Btn>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
            <Row label='Next period' value={`${fmtDate(pred.nextPeriodStart)} · ${nextLabel}`} />
            {!pred.birthControl && <Row label='Fertile window' value={`${fmtDate(pred.fertileStart)} - ${fmtDate(pred.fertileEnd)}`} accent={pred.goal === 'conceive'} />}
            {!pred.birthControl && <Row label={pred.ovulationSource === 'bbt' ? 'Ovulation (from BBT)' : 'Ovulation (est.)'} value={fmtDate(pred.ovulationEst)} />}
          </div>
          {pred.birthControl
            ? <div style={{ color: colors.text.muted, fontSize: 11, textAlign: 'center' }}>On hormonal birth control, ovulation is usually suppressed, so fertile-window estimates are hidden.</div>
            : <div style={{ color: colors.text.muted, fontSize: 11, textAlign: 'center', lineHeight: 1.45 }}>
                {pred.uncertain
                  ? <>Your fertile window is estimated to be wider than normal due to your <LinkSpan onClick={onConditions}>tracked conditions</LinkSpan>.</>
                  : pred.confidence === 'high' ? 'Based on your recent cycles.' : pred.confidence === 'medium' ? 'Sharpens as you log more cycles.' : 'Early estimate.'}
              </div>}
        </>
      )}
    </div>
  )
}

// Toggle between the dial ("today at a glance") and the calendar ("the month").
function ViewToggle ({ value, onChange }) {
  const opts = [['dial', 'Dial', Flower], ['calendar', 'Month', CalendarBlank]]
  return (
    <div style={{ display: 'flex', alignSelf: 'center', width: 240, background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.full, padding: 3, gap: 2 }}>
      {opts.map(([k, l, Icon]) => {
        const on = value === k
        return (
          <button key={k} onClick={() => { haptic('light'); onChange(k) }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none', borderRadius: radius.full, padding: '7px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: on ? colors.primary : 'transparent', color: on ? colors.text.onPrimary : colors.text.secondary }}>
            <Icon size={16} weight={on ? 'fill' : 'regular'} />{l}
          </button>
        )
      })}
    </div>
  )
}

// Month grid: color-coded period / fertile / ovulation / logged days. Tap a past or
// today cell to select it for the day editor. Predicted marks come from
// projectCalendar; logged bleeding days are period too (the log is authoritative
// for the past).
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const CAL_PERIOD_BG = 'rgba(200,56,79,0.38)'
const CAL_FERTILE_BG = 'rgba(232,133,155,0.20)'
function LegendSwatch ({ color, ring, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: colors.text.muted, fontSize: 11 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color || 'transparent', border: ring ? `1.5px solid ${ring}` : 'none', boxSizing: 'border-box' }} />{label}
    </span>
  )
}
function MonthCalendar ({ monthIso, pred, daysByIso, selected, today, onPick, onPrev, onNext, onToday, dir }) {
  const [y, m] = monthIso.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const isCurrentMonth = monthIso.slice(0, 7) === today.slice(0, 7)
  const marks = projectCalendar(pred, `${monthIso.slice(0, 7)}-01`, `${monthIso.slice(0, 7)}-${pad2(daysInMonth)}`)
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // Always render 6 week rows (42 cells) so the grid - and the whole calendar
  // container - is the same height every month (some months span 5 rows, some 6);
  // otherwise the content below shifts when you change month.
  while (cells.length < 42) cells.push(null)
  const navBtn = { background: 'none', border: 'none', color: colors.text.secondary, cursor: 'pointer', padding: spacing.xs, display: 'flex', alignItems: 'center' }
  // Swipe left/right to change month. A tap on a day has near-zero travel, so it
  // never trips the swipe; a real swipe sets `swiped` so the day's click is ignored.
  const touch = useRef(null); const swiped = useRef(false)
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; swiped.current = false }
  const onTouchEnd = (e) => {
    if (!touch.current) return
    const t = e.changedTouches[0]; const dx = t.clientX - touch.current.x; const dy = t.clientY - touch.current.y
    touch.current = null
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped.current = true; if (dx < 0) onNext(); else onPrev()
      setTimeout(() => { swiped.current = false }, 400)
    }
  }
  const slide = (dir >= 0 ? 'pearpetal-slide-r' : 'pearpetal-slide-l')
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => { haptic('light'); onPrev() }} aria-label='Previous month' style={navBtn}><CaretLeft size={20} /></button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing.sm }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{monthLabel}</div>
          {/* Always in layout (reserves height) so the header does not jump; fades in
              only when off the current month. */}
          <button onClick={() => { haptic('light'); onToday() }} aria-hidden={isCurrentMonth} style={{ background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.full, padding: '2px 12px', fontSize: 11, fontWeight: 500, color: colors.primary, cursor: 'pointer', opacity: isCurrentMonth ? 0 : 1, pointerEvents: isCurrentMonth ? 'none' : 'auto', transition: 'opacity 200ms' }}>Today</button>
        </div>
        <button onClick={() => { haptic('light'); onNext() }} aria-label='Next month' style={navBtn}><CaretRight size={20} /></button>
      </div>
      <div key={monthIso} style={{ animation: `${slide} 240ms ease` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, color: colors.text.muted, paddingBottom: 2 }}>{w}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div key={`b${i}`} style={{ minHeight: 42 }} />
            const iso = `${y}-${pad2(m)}-${pad2(d)}`
            const logged = daysByIso[iso]
            const bleeding = logged && BLEEDING.has(logged.flow)
            const isPeriod = marks.period.has(iso) || bleeding
            const isFertile = !isPeriod && marks.fertile.has(iso)
            const isOvul = marks.ovulation.has(iso)
            const isToday = iso === today
            const isSel = iso === selected
            const isFuture = iso > today
            const bg = isPeriod ? CAL_PERIOD_BG : isFertile ? CAL_FERTILE_BG : 'transparent'
            const border = isSel ? `2px solid ${colors.primary}` : isToday ? `1px solid ${colors.text.secondary}` : '1px solid transparent'
            return (
              <button key={iso} onClick={() => { if (swiped.current || isFuture) return; haptic('light'); onPick(iso) }} disabled={isFuture} style={{
                position: 'relative', minHeight: 42, borderRadius: radius.md, background: bg, border, padding: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                color: isFuture ? colors.text.muted : colors.text.primary, opacity: isFuture ? 0.45 : 1, cursor: isFuture ? 'default' : 'pointer',
              }}>
                <span style={{ fontSize: 13, fontWeight: isToday || isSel ? 700 : 400 }}>{d}</span>
                <span style={{ height: 6, display: 'flex', alignItems: 'center', gap: 3 }}>
                  {isOvul && <span style={{ width: 6, height: 6, borderRadius: '50%', border: `1.5px solid ${colors.accent}`, boxSizing: 'border-box' }} />}
                  {logged && !isPeriod && !isOvul && <span style={{ width: 5, height: 5, borderRadius: '50%', background: colors.text.muted }} />}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${spacing.xs}px ${spacing.md}px`, justifyContent: 'center', borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.sm }}>
        <LegendSwatch color={CAL_PERIOD_BG} label='Period' />
        <LegendSwatch color={CAL_FERTILE_BG} label='Fertile' />
        <LegendSwatch ring={colors.accent} label='Ovulation' />
        <LegendSwatch color={colors.text.muted} label='Logged' />
      </div>
    </div>
  )
}

// Profile card (top of Cycle settings): name + avatar. The name and avatar are
// shown to partners you share with (owner-written into share:meta); otherwise
// they stay on your devices. See proposals/2026-07-08-user-profile.md.
function ProfileCard () {
  const [profile, setProfile] = useState(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)
  useEffect(() => { call('profile:get').then((p) => { setProfile(p || {}); setName(p?.displayName || '') }).catch(() => setProfile({})) }, [])
  if (!profile) return null
  const saveName = async () => {
    const dn = name.trim(); if (dn === (profile.displayName || '')) return
    try { const p = await call('profile:set', { displayName: dn }); setProfile(p); haptic('light') } catch (e) { setMsg(e.message) }
  }
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''
    if (!f) return
    setMsg('')
    try {
      const dataUrl = await fileToAvatarDataUrl(f)
      const p = await call('profile:set', { displayName: name.trim(), avatar: dataUrl }); setProfile(p); haptic('success')
    } catch (err) { setMsg(err?.message || 'Could not set that photo') }
  }
  const clearPhoto = async () => { try { const p = await call('profile:set', { displayName: name.trim(), avatar: null }); setProfile(p); haptic('light') } catch (e) { setMsg(e.message) } }
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.base }}>
        {/* Avatar column: the picker, with Remove bounded directly beneath it. */}
        <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing.xs }}>
          <button onClick={() => fileRef.current?.click()} aria-label='Change your photo' style={{ padding: 0, border: 'none', background: 'none', borderRadius: '50%', position: 'relative' }}>
            <Avatar src={profile.avatar} name={name} size={56} />
            <span style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%', background: colors.primary, color: colors.text.onPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Camera size={12} weight='fill' />
            </span>
          </button>
          {profile.avatar && <button onClick={clearPhoto} style={{ marginTop: spacing.sm, background: colors.surface.input, border: `1px solid ${colors.border}`, color: colors.text.secondary, fontSize: 11, padding: '4px 12px', borderRadius: radius.full, lineHeight: 1.2, cursor: 'pointer' }}>Remove</button>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder='Your name' maxLength={64}
            style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `8px 10px`, fontSize: 15 }} />
          <span style={{ color: colors.text.muted, fontSize: 11 }}>Shown to partners you share with. Otherwise stays on your devices.</span>
        </div>
      </div>
      {msg && <div style={{ color: colors.error, fontSize: 12 }}>{msg}</div>}
      <input ref={fileRef} type='file' accept='image/*' onChange={onFile} style={{ display: 'none' }} />
    </div>
  )
}

// Pregnancy date setup, revealed under the goal chips when goal is Pregnant.
// The user enters the first day of their last period (LMP); the due date is the
// standard 40 weeks (280 days) later. All device-local; never shared.
function PregnancySetup ({ prefs, save }) {
  const lmp = prefs.pregnancy?.lmp || ''
  const due = lmp ? addDaysIso(lmp, 280) : (prefs.pregnancy?.dueDate || '')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <span style={{ color: colors.text.secondary, fontSize: 14 }}>First day of your last period</span>
        <input type='date' value={lmp} max={todayIso()} onChange={(e) => save({ pregnancy: { lmp: e.target.value } })}
          style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `6px 10px` }} />
      </div>
      {due
        ? <div style={{ color: colors.text.secondary, fontSize: 13 }}>Estimated due date: <span style={{ color: colors.text.primary, fontWeight: 500 }}>{fmtDate(due)}</span> (about 40 weeks). The dial now tracks your pregnancy.</div>
        : <div style={{ color: colors.text.muted, fontSize: 12 }}>Enter the first day of your last period to see how far along you are and your estimated due date.</div>}
      <div style={{ color: colors.text.muted, fontSize: 11 }}>A calendar estimate. Your provider's dating is what counts.</div>
      <button onClick={() => save({ goal: 'track', pregnancy: null })} style={{ alignSelf: 'center', marginTop: spacing.xs, background: colors.surface.input, border: `1px solid ${colors.border}`, color: colors.text.secondary, fontSize: 13, fontWeight: 500, padding: `8px 16px`, borderRadius: radius.lg, cursor: 'pointer' }}>No longer pregnant</button>
    </div>
  )
}

// Horizontal flower picker with edge fades that appear only when there is content
// scrolled off that side, so a fade never covers the first or last flower.
function FlowerPicker ({ value, onPick }) {
  const scrollRef = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const update = () => {
    const el = scrollRef.current; if (!el) return
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 2 })
  }
  useEffect(() => { update() }, [])
  const fade = { position: 'absolute', top: 0, bottom: spacing.xs, width: 32, pointerEvents: 'none', transition: 'opacity 150ms' }
  return (
    <div style={{ position: 'relative' }}>
      <div ref={scrollRef} onScroll={update} style={{ display: 'flex', gap: spacing.sm, overflowX: 'auto', paddingBottom: spacing.xs }}>
        {FLOWER_KEYS.map((key) => {
          const active = (value || 'rose') === key
          return (
            <button key={key} onClick={() => onPick(key)} aria-pressed={active} style={{
              flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              background: active ? 'rgba(232,133,155,0.10)' : 'transparent',
              border: `1px solid ${active ? colors.primary : colors.border}`, borderRadius: radius.lg, padding: `${spacing.sm}px ${spacing.md}px`,
            }}>
              <FlowerThumb flower={key} size={52} />
              <span style={{ fontSize: 11, color: active ? colors.text.primary : colors.text.muted, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', width: FLOWER_NAME_CH, textAlign: 'center' }}>{flowerLabel(key)}</span>
            </button>
          )
        })}
      </div>
      <div style={{ ...fade, left: 0, opacity: edges.left ? 1 : 0, background: `linear-gradient(to left, transparent, ${colors.surface.card})` }} />
      <div style={{ ...fade, right: 0, opacity: edges.right ? 1 : 0, background: `linear-gradient(to right, transparent, ${colors.surface.card})` }} />
    </div>
  )
}

// Collapsible settings card for the occasional / advanced sections. A left-aligned
// phosphor icon + title with a caret on the right, matching PearCircle's Settings
// list; independent open/close (not one-at-a-time, unlike About) since you may
// adjust several. `icon` is optional so non-settings uses (e.g. Recent days) can
// omit the glyph.
function CollapsibleCard ({ title, open, onToggle, children, id, icon: Icon }) {
  const ref = useRef(null)
  // When a section opens, once the expand has finished, scroll it into view so its
  // content clears the fixed bottom nav (block:'nearest' + the root's scroll-padding
  // does the minimum needed; a no-op if it is already fully visible).
  useEffect(() => {
    if (!open || !ref.current) return undefined
    const t = setTimeout(() => { ref.current && ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 380)
    return () => clearTimeout(t)
  }, [open])
  return (
    <div id={id} ref={ref} style={{ ...card, padding: 0, overflow: 'hidden', scrollMarginTop: screenPadTop }}>
      <button onClick={() => { haptic('light'); onToggle() }} aria-expanded={open} style={{ width: '100%', background: 'none', border: 'none', padding: `${spacing.md}px ${spacing.base}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: colors.text.secondary }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: 13, fontWeight: 400 }}>
          {Icon ? <Icon size={17} weight='regular' color={colors.text.muted} /> : null}
          {title}
        </span>
        <CaretRight size={15} color={colors.text.muted} weight='regular' style={{ transition: 'transform 0.3s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
      </button>
      <div style={{ maxHeight: open ? 2500 : 0, overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ padding: `0 ${spacing.lg}px ${spacing.lg}px`, display: 'flex', flexDirection: 'column', gap: spacing.md }}>{children}</div>
      </div>
    </div>
  )
}

// One reminder-category row (label + description + toggle).
function NotifRow ({ label, desc, on, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: colors.text.secondary, fontSize: 14 }}>{label}</div>
        <div style={{ color: colors.text.muted, fontSize: 12 }}>{desc}</div>
      </div>
      <Toggle on={on} label={label} onClick={onClick} />
    </div>
  )
}

// Opt-in to-self cycle reminders (period due + fertile window / ovulation). The
// prefs + scheduling live in the shell/worklet (proposals/2026-07-09-notifications.md);
// this card drives shell:notifications:get/set. Enabling prompts the OS once; the
// OS then delivers the reminders even when the app is closed. Inert in a browser
// preview. Default OFF (opt-in). Discreet mode hides cycle wording on the lock
// screen; period/fertility are goal-aware + confidence-gated downstream.
function NotificationsCard () {
  const [n, setN] = useState(null)
  useEffect(() => { call('shell:notifications:get').then(setN).catch(() => setN({ enabled: false })) }, [])
  if (!n) return null
  const set = async (patch) => {
    setN((p) => ({ ...p, ...patch })) // optimistic
    const next = await call('shell:notifications:set', patch).catch(() => null)
    if (next) setN(next)
    haptic('light')
  }
  const denied = n.enabled && n.osGranted === false
  const input = { background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: '6px 10px', fontSize: 15 }
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: colors.text.primary, fontSize: 15, fontWeight: 500 }}>Reminders</div>
          <div style={{ color: colors.text.muted, fontSize: 12 }}>Gentle nudges on your own phone. Private to this device, never sent to anyone.</div>
        </div>
        <Toggle on={!!n.enabled} label='Reminders' onClick={() => set({ enabled: !n.enabled })} />
      </div>
      {denied && <Explainer title='Notifications are off in system settings.'>Turn notifications on for PearPetal in your phone settings to start receiving reminders.</Explainer>}
      {n.enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
          <NotifRow label='Period approaching' desc='The day before and the day your period is predicted.' on={n.period !== false} onClick={() => set({ period: !(n.period !== false) })} />
          <NotifRow label='Fertile window' desc='When your fertile window opens and on your predicted ovulation day.' on={n.fertility !== false} onClick={() => set({ fertility: !(n.fertility !== false) })} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
            <span style={{ color: colors.text.secondary, fontSize: 14 }}>Time of day</span>
            <input type='time' value={n.time || '09:00'} onChange={(e) => set({ time: e.target.value })} style={input} />
          </div>
          <NotifRow label='Discreet' desc='Hide cycle details on the lock screen - reminders just read "PearPetal".' on={!!n.discreet} onClick={() => set({ discreet: !n.discreet })} />
          <div style={{ color: colors.text.muted, fontSize: 11 }}>Reminders only appear once PearPetal is confident in your prediction, and pause while you are pregnant or on birth control.</div>
        </div>
      )}
    </div>
  )
}

function CycleSettings ({ onClose, onSaved, onFlower, onDevices, scrollTo, onScrolled, themePref = 'dark', onTheme }) {
  const [prefs, setPrefs] = useState(null)
  const [dataMsg, setDataMsg] = useState(null) // { text, tone: 'success'|'error'|'muted' }
  const [exportPw, setExportPw] = useState('') // optional backup password (blank = plaintext)
  const [pendingImport, setPendingImport] = useState(null) // encrypted wrapper awaiting its password
  const [successModal, setSuccessModal] = useState(null) // { title, message } -> export/import result popup
  // The advanced/occasional sections collapse independently (collapsed by default).
  const [openSection, setOpenSection] = useState({})
  const toggleSection = (id) => setOpenSection((s) => ({ ...s, [id]: !s[id] }))
  useEffect(() => { call('prefs:get').then(setPrefs).catch(() => setPrefs({})) }, [])
  // Deep-link: when opened via the "tracked conditions" link, expand the health
  // section and scroll to it once prefs have rendered, then clear the request. The
  // scroll is delayed so the expand has committed first - scrolling mid-animation
  // (while the section grows from 0) lands short.
  useEffect(() => {
    if (!prefs || scrollTo !== 'health') return
    setOpenSection((s) => ({ ...s, health: true }))
    const t = setTimeout(() => { document.getElementById('health-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); onScrolled && onScrolled() }, 140)
    return () => clearTimeout(t)
  }, [prefs, scrollTo])
  if (!prefs) return null
  const save = async (patch) => { const next = { ...prefs, ...patch }; setPrefs(next); await call('prefs:set', patch).catch(() => {}); onSaved && onSaved() }
  const pickFlower = (key) => { save({ flower: key }); onFlower && onFlower(key); haptic('light') }

  const inShell = typeof window !== 'undefined' && !!window.ReactNativeWebView
  const doExport = async () => {
    try {
      const pw = exportPw.trim()
      const data = await call('export:data', pw ? { password: pw } : {})
      const json = JSON.stringify(data, null, 2)
      const encrypted = !!data.enc
      const fname = encrypted ? 'pearpetal-backup-encrypted.json' : 'pearpetal-backup.json'
      if (inShell) {
        const r = await call('shell:export', { filename: fname, json })
        if (r && r.canceled) { setDataMsg({ text: 'Export canceled.', tone: 'muted' }); return }
        setDataMsg(null)
        const dest = r && r.folder ? ` to ${r.folder}` : ''
        setSuccessModal({
          title: encrypted ? 'Encrypted backup saved' : 'Backup saved',
          message: encrypted
            ? `Your encrypted backup was saved${dest || ' successfully'}. Keep its password safe: it cannot be recovered.`
            : (dest ? `Your backup was saved${dest}.` : 'Your backup was saved successfully.'),
        })
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url)
        setDataMsg(null)
        setSuccessModal({
          title: encrypted ? 'Encrypted backup exported' : 'Backup exported',
          message: encrypted ? 'Your encrypted backup file was downloaded.' : `Your backup with ${data.days.length} ${data.days.length === 1 ? 'day' : 'days'} was downloaded.`,
        })
      }
      haptic('success')
    } catch { setDataMsg({ text: 'Export failed. Please try again.', tone: 'error' }) }
  }
  // Import succeeded: clear any stale message, surface the success modal, refresh.
  const finishImport = (r) => {
    const dayN = r.days === 1 ? '1 day' : `${r.days} days`
    const perN = r.periods === 1 ? '1 period' : `${r.periods} periods`
    setDataMsg(null); setSuccessModal({ title: 'Backup imported', message: `${dayN} and ${perN} were merged into your log.` }); haptic('success'); onSaved && onSaved()
  }
  const applyImport = async (json) => {
    let parsed
    try { parsed = JSON.parse(json) } catch { setDataMsg({ text: 'That file could not be read. Choose a valid PearPetal backup.', tone: 'error' }); return }
    // Encrypted backups need a password: stash the wrapper and prompt for it.
    if (parsed && parsed.enc) { setPendingImport(parsed); return }
    try { const r = await call('import:data', { data: parsed }); finishImport(r) } catch (e) { setDataMsg({ text: friendlyImportError(e), tone: 'error' }) }
  }
  // Decrypt + import a stashed encrypted backup once the user enters its password.
  // Wrong password keeps the sheet open (throws so the sheet shows a friendly error).
  const submitEncryptedImport = async (pw) => {
    const r = await call('import:data', { data: pendingImport, password: pw })
    setPendingImport(null); finishImport(r)
  }
  const doImport = async () => {
    if (inShell) { try { const r = await call('shell:import'); if (r && r.json) applyImport(r.json) } catch { setDataMsg({ text: 'Could not open that file. Please try again.', tone: 'error' }) } return }
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'
    input.onchange = () => { const f = input.files && input.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => applyImport(String(rd.result)); rd.readAsText(f) }
    input.click()
  }
  const Stepper = ({ label, value, def, min, max, field }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: colors.text.secondary, fontSize: 14 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        <Btn kind='ghost' style={{ padding: '4px 12px' }} onClick={() => save({ [field]: Math.max(min, (value ?? def) - 1) })}>-</Btn>
        <span style={{ width: 28, textAlign: 'center', color: colors.text.primary, fontWeight: 500 }}>{value ?? def}</span>
        <Btn kind='ghost' style={{ padding: '4px 12px' }} onClick={() => save({ [field]: Math.min(max, (value ?? def) + 1) })}>+</Btn>
      </div>
    </div>
  )
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Cycle settings</div>
      <ProfileCard />
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>Your flower</div>
        <FlowerPicker value={prefs.flower} onPick={pickFlower} />
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>Appearance</div>
        <div style={{ display: 'flex', background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.full, padding: 3, gap: 2 }}>
          {[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']].map(([k, l]) => {
            const on = (themePref || 'dark') === k
            return (
              <button key={k} onClick={() => onTheme && onTheme(k)} aria-pressed={on} style={{ flex: 1, border: 'none', borderRadius: radius.full, padding: '8px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: on ? colors.primary : 'transparent', color: on ? colors.text.onPrimary : colors.text.secondary }}>{l}</button>
            )
          })}
        </div>
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>What are you tracking for?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
          {GOAL_OPTS.map(([k, l]) => (
            <Chip key={k} active={(prefs.goal || 'track') === k} onClick={() => save({ goal: k })} style={{ width: '100%' }}>{l}</Chip>
          ))}
        </div>
        {prefs.goal === 'pregnant'
          ? <PregnancySetup prefs={prefs} save={save} />
          : <Explainer>{(GOAL_OPTS.find(([k]) => k === (prefs.goal || 'track')) || [])[2]}</Explainer>}
      </div>
      <NotificationsCard />
      <CollapsibleCard title='Cycle lengths' icon={CalendarBlank} open={openSection.lengths} onToggle={() => toggleSection('lengths')}>
        <Stepper label='Average cycle length' value={prefs.avgCycleLength} def={28} min={21} max={45} field='avgCycleLength' />
        <Stepper label='Average period length' value={prefs.avgPeriodLength} def={5} min={2} max={10} field='avgPeriodLength' />
        <Stepper label='Luteal phase length' value={prefs.lutealLength} def={14} min={9} max={18} field='lutealLength' />
        <div style={{ color: colors.text.muted, fontSize: 12 }}>These help predictions before you have logged many cycles. Once you have history, PearPetal learns your real numbers.</div>
      </CollapsibleCard>
      <CollapsibleCard id='health-section' title='Health & birth control' icon={Pill} open={openSection.health} onToggle={() => toggleSection('health')}>
        <div style={{ color: colors.text.muted, fontSize: 12 }}>Conditions that affect your cycle. These stay on your device and are never shared. They widen prediction estimates and tailor the guidance you see. Tap one to see how it changes your estimates.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
          {CONDITION_OPTS.map(([k, l]) => {
            const on = (prefs.conditions || []).includes(k)
            return <Chip key={k} active={on} onClick={() => { const cur = prefs.conditions || []; save({ conditions: on ? cur.filter((x) => x !== k) : [...cur, k] }) }} style={{ width: '100%' }}>{l}</Chip>
          })}
        </div>
        {CONDITION_OPTS.filter(([k]) => (prefs.conditions || []).includes(k)).map(([k, l, explain]) => (
          <Explainer key={k} title={`${l}.`}>{explain}</Explainer>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
          <span style={{ color: colors.text.secondary, fontSize: 14 }}>On hormonal birth control</span>
          <Toggle on={!!prefs.birthControl} label='On hormonal birth control' onClick={() => save({ birthControl: !prefs.birthControl })} />
        </div>
        {prefs.birthControl && <Explainer>On hormonal birth control, ovulation is usually suppressed, so the fertile-window and ovulation estimates may not apply. PearPetal hides them and leads with your period dates.</Explainer>}
      </CollapsibleCard>
      <CollapsibleCard title='Your data' icon={Database} open={openSection.data} onToggle={() => toggleSection('data')}>
        <input
          type='password'
          value={exportPw}
          onChange={(e) => setExportPw(e.target.value)}
          placeholder='Backup password (optional)'
          autoComplete='new-password'
          style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: '8px 12px', fontSize: 14 }}
        />
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn onClick={doExport} style={{ flex: 1 }}>Export</Btn>
          <Btn kind='ghost' onClick={doImport} style={{ flex: 1 }}>Import</Btn>
        </div>
        <div style={{ color: colors.text.muted, fontSize: 11 }}>Set a password to save an <strong style={{ color: colors.text.secondary, fontWeight: 500 }}>encrypted</strong> backup; leave it blank for a plain file. Either way the file only leaves your device if you share it, so keep it somewhere private. Import merges a backup into your log and will ask for the password if the file is encrypted. A forgotten password cannot be recovered.</div>
        {dataMsg && <div style={{ color: dataMsg.tone === 'error' ? colors.error : dataMsg.tone === 'muted' ? colors.text.muted : colors.success, fontSize: 13 }}>{dataMsg.text}</div>}
      </CollapsibleCard>
      {pendingImport && <ImportPasswordSheet onSubmit={submitEncryptedImport} onClose={() => setPendingImport(null)} />}
      {successModal && <BackupSuccessModal title={successModal.title} message={successModal.message} onClose={() => setSuccessModal(null)} />}
    </div>
  )
}

// Map the worklet's terse import errors to friendly, non-technical copy. The
// error arrives as a full stack string (the engine serializes err.stack over
// IPC), so match on substrings, and always fall back to a generic line rather
// than surfacing any raw/technical text.
function friendlyImportError (e) {
  const m = (e && e.message) || String(e || '')
  if (m.includes('wrong password')) return "That password didn't work. Please try again."
  if (m.includes('password required')) return 'This backup is encrypted. Enter its password to import.'
  if (m.includes('corrupt backup') || m.includes('unsupported backup format')) return "This file couldn't be read. It may be damaged or not a PearPetal backup."
  if (m.includes('not a PearPetal export')) return "This doesn't look like a PearPetal backup file."
  return 'Import failed. Please try again with a valid backup file.'
}

// Prominent confirmation for a successful backup export or import. A centered
// modal (not the small inline line) so the user clearly sees the result.
function BackupSuccessModal ({ title, message, onClose }) {
  useBackHandler(true, onClose)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <div style={{ background: colors.surface.card, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: spacing.xl, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: spacing.sm, alignItems: 'center' }}>
        <CheckCircle size={48} weight='fill' color={colors.success} />
        <div style={{ fontSize: 20, fontWeight: 600, color: colors.text.primary }}>{title}</div>
        <div style={{ color: colors.text.secondary, fontSize: 14, lineHeight: 1.5, marginBottom: spacing.sm }}>{message}</div>
        <Btn onClick={onClose} style={{ width: '100%' }}>Done</Btn>
      </div>
    </div>
  )
}

// Password prompt for importing an encrypted backup. Kept open on a wrong
// password (onSubmit throws), showing the error inline, so no partial import.
function ImportPasswordSheet ({ onSubmit, onClose }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!pw || busy) return
    setBusy(true); setErr('')
    try { await onSubmit(pw) } catch (e) { setErr(friendlyImportError(e)); haptic('warn') } finally { setBusy(false) }
  }
  return (
    <BottomSheet onClose={onClose}>
      {(close) => (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>Encrypted backup</div>
          <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>Enter the password this backup was saved with.</div>
          <input
            type='password'
            value={pw}
            autoFocus
            onChange={(e) => { setPw(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') go() }}
            placeholder='Backup password'
            style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${err ? colors.error : colors.border}`, borderRadius: radius.md, padding: '10px 12px', fontSize: 15 }}
          />
          {err && <div style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{err}</div>}
          <Btn onClick={go} disabled={!pw || busy}>{busy ? 'Decrypting…' : 'Import'}</Btn>
          <Btn kind='ghost' onClick={close}>Cancel</Btn>
        </>
      )}
    </BottomSheet>
  )
}

// --- root -------------------------------------------------------------------
// --- About + Bitcoin donation -----------------------------------------------
// Collapsible card: left-aligned phosphor icon + title with a caret, tap to expand.
// Matches PearCircle's Settings list (same treatment as CycleSettings's
// CollapsibleCard). Accordion (one open at a time) is managed by AboutScreen.
function AboutSection ({ title, open, onToggle, children, icon: Icon }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button onClick={() => { haptic('light'); onToggle() }} aria-expanded={open} style={{ width: '100%', background: 'none', border: 'none', padding: `${spacing.md}px ${spacing.base}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: colors.text.secondary }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: 13, fontWeight: 400 }}>
          {Icon ? <Icon size={17} weight='regular' color={colors.text.muted} /> : null}
          {title}
        </span>
        <CaretRight size={15} color={colors.text.muted} weight='regular' style={{ flexShrink: 0, transition: 'transform 0.3s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
      </button>
      <div style={{ maxHeight: open ? 640 : 0, overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ padding: `0 ${spacing.base}px ${spacing.base}px`, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>{children}</div>
      </div>
    </div>
  )
}
function AboutText ({ children }) {
  return <div style={{ color: colors.text.secondary, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
}
function AboutLink ({ onClick, children, primary }) {
  return <Btn kind={primary ? 'primary' : 'ghost'} onClick={onClick} style={{ flex: 1, fontSize: 14 }}>{children}</Btn>
}

// Flower species picker as a bottom sheet, reached from the pill under the dial so
// choosing a flower is not buried in Settings. Same picker widget as Settings.
function FlowerPickerSheet ({ value, onPick, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      {(close) => (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>Your flower</div>
          <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center' }}>The species that blooms on your dial. Private to this device.</div>
          <FlowerPicker value={value} onPick={onPick} />
          <Btn kind='ghost' onClick={close}>Done</Btn>
        </>
      )}
    </BottomSheet>
  )
}

// Explains what the petal dial represents. The dial is a single-cycle, forward-
// looking view (not a whole-history scrubber), which is not self-evident; this is
// reached from a small info icon on the dial card.
function DialInfoSheet ({ onClose }) {
  const Line = ({ children }) => <div style={{ color: colors.text.secondary, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
  return (
    <BottomSheet onClose={onClose}>
      {(close) => (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>How to read your flower</div>
          <Line>One lap of the ring is <b>one cycle</b>. The top is <b>day 1</b> - your last period start - and the highlighted marker is <b>today</b>.</Line>
          <Line>The flower <b>furls and blooms</b> across the cycle, fullest around <b>ovulation</b>, so a glance tells you roughly where you are.</Line>
          <Line><b>Tap or drag</b> a past day on the ring to open and edit it.</Line>
          <Line>The dial shows your <b>current</b> cycle only. To browse other months or your history, switch to <b>Month</b> view.</Line>
          <Btn kind='ghost' onClick={close}>Got it</Btn>
        </>
      )}
    </BottomSheet>
  )
}

// Add / adjust a period span (start + optional end) via native date pickers.
// Calls the existing period:set; the projection (dial, next-period, calendar) then
// recomputes on refresh. A period start also anchors the cycle, so setting the last
// period here is the direct way to correct "day N" without logging flow day-by-day.
function PeriodSheet ({ defaultStart, onClose, onSaved }) {
  const [start, setStart] = useState(defaultStart || todayIso())
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const field = { background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `8px 10px`, fontSize: 15 }
  return (
    <BottomSheet onClose={onClose}>
      {(close) => {
        const save = async () => {
          if (!start) { setErr('Pick a start date.'); return }
          if (end && end < start) { setErr('End date is before the start date.'); return }
          setBusy(true); setErr('')
          try {
            await call('period:log', { start, end: end || null })
            haptic('success'); onSaved && onSaved(start); close()
          } catch (e) { setErr(e.message || 'Could not save.'); setBusy(false) }
        }
        return (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>Period dates</div>
            <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center' }}>When did your last period start? Leave the end blank if it is ongoing. Those days are logged with a medium flow - tap any day afterward to adjust the amount.</div>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <span style={{ color: colors.text.secondary, fontSize: 14 }}>Start</span>
              <input type='date' value={start} max={todayIso()} onChange={(e) => setStart(e.target.value)} style={field} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <span style={{ color: colors.text.secondary, fontSize: 14 }}>End <span style={{ color: colors.text.muted }}>(optional)</span></span>
              <input type='date' value={end} min={start} max={todayIso()} onChange={(e) => setEnd(e.target.value)} style={field} />
            </label>
            {err && <div style={{ color: colors.warn, fontSize: 13, textAlign: 'center' }}>{err}</div>}
            <Btn onClick={save} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</Btn>
            <Btn kind='ghost' onClick={close}>Cancel</Btn>
          </>
        )
      }}
    </BottomSheet>
  )
}

// A tap-to-copy address row that flashes "Copied" for 1.6s. Copies via the
// WebView clipboard (same path as the invite-code copy elsewhere), falling back
// to the share sheet if the clipboard API is unavailable.
function CopyField ({ value, hint }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      haptic('light'); setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { call('shell:share', { text: value }).catch(() => {}) }
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: `${spacing.sm + 2}px ${spacing.md}px`, minHeight: DONATE_OPTION_MIN_H, boxSizing: 'border-box' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 13, color: colors.text.primary }}>{value}</span>
        <button onClick={copy} style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: copied ? colors.success : colors.primary, display: 'flex', alignItems: 'center', gap: 4 }}>
          {copied ? <><CheckCircle size={14} weight='fill' /> Copied</> : 'Copy'}
        </button>
      </div>
      {hint && <p style={{ color: colors.text.muted, fontSize: 12, margin: `${spacing.xs}px 0 0`, lineHeight: 1.5, textAlign: 'center' }}>{hint}</p>}
    </div>
  )
}

// BTC donation sheet (always a chooser). `detected` reflects whether an installed
// app claims the lightning: scheme. When true the hero is a one-tap handoff to that
// wallet; either way the sheet offers copy-to-paste addresses (Lightning + optional
// on-chain) and the Strike QR/browser page, plus an install list when no wallet was
// detected. Fiat is handled by the separate USD button, so this stays BTC-only.
function DonationSheet ({ detected = false, onClose }) {
  const primaryBtn = { width: '100%', padding: `${spacing.md}px ${spacing.base}px`, minHeight: DONATE_OPTION_MIN_H, boxSizing: 'border-box', background: colors.primary, color: colors.text.onPrimary, border: 'none', borderRadius: radius.lg, cursor: 'pointer', fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }
  const secLabel = { color: colors.text.secondary, fontSize: 13, fontWeight: 500, margin: `${spacing.lg}px 0 ${spacing.sm}px`, textAlign: 'center' }
  const body = { color: colors.text.secondary, fontSize: 14, lineHeight: 1.6 }
  return (
    <BottomSheet onClose={onClose}>
      {(close) => (
        <div style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: colors.text.primary, marginBottom: spacing.xs, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
            <Lightning size={18} weight='fill' /> Bitcoin Lightning <Lightning size={18} weight='fill' />
          </div>
          <p style={{ ...body, marginBottom: spacing.base, textAlign: 'center' }}>
            Support PearPetal with Bitcoin over Lightning (fast and low-fee){BTC_ONCHAIN_ADDRESS ? ' or on-chain' : ''}.
          </p>

          {detected && (
            <>
              <button onClick={() => { haptic('light'); openUrl('lightning:' + LIGHTNING_ADDRESS); close() }} style={primaryBtn}>
                <Lightning size={16} weight='fill' /> Open in your Lightning wallet <Lightning size={16} weight='fill' />
              </button>
              <p style={{ ...body, textAlign: 'center', margin: `${spacing.base}px 0 0` }}>or use another method:</p>
            </>
          )}

          <p style={{ ...secLabel, marginTop: detected ? spacing.base : spacing.md }}>Lightning address</p>
          <CopyField value={LIGHTNING_ADDRESS} hint='Paste into any Lightning, ecash or web wallet.' />

          <div style={{ marginTop: spacing.base }}>
            <button onClick={() => { haptic('light'); openUrl(STRIKE_TIP_URL); close() }} style={primaryBtn}>
              <Lightning size={16} weight='fill' /> Show a QR / pay in a browser <Lightning size={16} weight='fill' />
            </button>
            <p style={{ color: colors.text.muted, fontSize: 12, margin: `${spacing.xs}px 0 0`, textAlign: 'center', lineHeight: 1.5 }}>Scan from another device or on desktop.</p>
          </div>

          {BTC_ONCHAIN_ADDRESS && (
            <>
              <p style={secLabel}>On-chain Bitcoin</p>
              <CopyField value={BTC_ONCHAIN_ADDRESS} hint='On-chain BTC. Higher fees, so Lightning is cheaper for small tips.' />
            </>
          )}

          {!detected && (
            <>
              <p style={{ ...body, textAlign: 'center', margin: `${spacing.lg}px 0 ${spacing.sm}px` }}>Don't have a Lightning wallet?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm + 2 }}>
                {LIGHTNING_WALLETS.map((w) => (
                  <button key={w.name} onClick={() => { haptic('light'); openUrl(w.url) }} style={{ background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: `${spacing.sm + 2}px ${spacing.base}px`, minHeight: DONATE_OPTION_MIN_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: spacing.md, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: colors.text.primary }}>{w.name}</div>
                      <div style={{ fontSize: 12, color: colors.text.muted }}>{w.desc}</div>
                    </div>
                    <ArrowSquareOut size={14} weight='regular' color={colors.text.muted} />
                  </button>
                ))}
              </div>
              <p style={{ ...body, textAlign: 'center', marginTop: spacing.base, marginBottom: 0 }}>After installing, return here and tap Bitcoin again.</p>
            </>
          )}

          <Btn kind='ghost' onClick={close} style={{ marginTop: spacing.lg, width: '100%' }}>Close</Btn>
        </div>
      )}
    </BottomSheet>
  )
}

// Two-week donation nudge (suite pattern). Shown once ever; the caller gates it
// off on iOS (App Store 3.1.1) and marks it shown as soon as it surfaces.
function DonationReminderModal ({ open, onDonate, onDismiss }) {
  useBackHandler(open, onDismiss)
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <div style={{ background: colors.surface.card, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: spacing.xl, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ fontSize: 40 }}>⚡</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: colors.text.primary }}>Enjoying PearPetal?</div>
        <div style={{ color: colors.text.secondary, fontSize: 14, lineHeight: 1.5, marginBottom: spacing.sm }}>PearPetal is free and open source, with no ads, accounts, or subscriptions. If it has brought you value, consider sending a little back to support development.</div>
        <Btn onClick={onDonate}>Support development</Btn>
        <Btn kind='ghost' onClick={onDismiss}>Maybe later</Btn>
        <button onClick={onDismiss} style={{ marginTop: spacing.xs, background: 'none', border: 'none', color: colors.text.muted, fontSize: 14, cursor: 'pointer' }}>Already donated ✓</button>
      </div>
    </div>
  )
}

function AboutScreen ({ onClose }) {
  // The BTC button always opens the donation chooser (never auto-fires into an
  // installed wallet), so a donor who prefers on-chain, or whose web/ecash wallet
  // the scheme probe missed, always has a path. `detected` only decides whether the
  // sheet leads with a one-tap wallet handoff or the install list.
  const [donateSheet, setDonateSheet] = useState(null) // null | { detected }
  const [open, setOpen] = useState(null)
  const toggle = (id) => setOpen((o) => (o === id ? null : id))
  const ios = isIOS()
  const donateBTC = async () => {
    let detected = false
    try { const r = await call('shell:canOpenURL', { url: 'lightning:test' }); detected = !!r?.can } catch {}
    setDonateSheet({ detected })
  }
  const share = () => { const p = call('shell:share', { title: 'PearPetal', text: 'PearPetal - a private, peer-to-peer cycle tracker. No account, no server.\n\nhttps://peerloomllc.com/pearpetal/' }); if (p && p.catch) p.catch(() => {}) }
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>About</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: colors.primary }}>PearPetal</div>
        <div style={{ color: colors.text.muted, fontSize: 14, marginTop: spacing.xs }}>Private cycle tracking. No account, no server.</div>
      </div>

      <div style={{ background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.base, color: colors.text.secondary, fontSize: 13, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600, color: colors.text.primary }}>Not medical advice.</span> PearPetal gives calendar-based estimates for your information only. It is not a medical device and not contraception. Do not rely on it to prevent pregnancy, and talk to a healthcare provider for medical decisions.
      </div>

      <AboutSection title='How it works' icon={Info} open={open === 'how'} onToggle={() => toggle('how')}>
        <AboutText>PearPetal keeps your cycle on your own devices and syncs it peer-to-peer over the Hypercore Protocol - no account, no server, no cloud, no data collection. You choose exactly what a partner sees; your full log and notes never leave your devices.</AboutText>
        <AboutLink onClick={() => openUrl('https://pears.com/')}>Learn about P2P ↗</AboutLink>
      </AboutSection>

      {!ios && (
        <AboutSection title='Support development' icon={Heart} open={open === 'support'} onToggle={() => toggle('support')}>
          <AboutText>PearPetal is free and open source. If it brings you value, consider sending a little back.</AboutText>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <AboutLink primary onClick={donateBTC}>⚡ Bitcoin ⚡</AboutLink>
            <AboutLink onClick={() => openUrl(BUYMEACOFFEE_URL)}>$ USD $</AboutLink>
          </div>
        </AboutSection>
      )}

      <AboutSection title='Learn about Bitcoin' icon={CurrencyBtc} open={open === 'btc'} onToggle={() => toggle('btc')}>
        <AboutText>New to Bitcoin? The Satoshi Nakamoto Institute has a free, concise crash course on how it works and why it matters.</AboutText>
        <AboutLink onClick={() => openUrl('https://nakamotoinstitute.org/crash-course/')}>Bitcoin Crash Course ↗</AboutLink>
      </AboutSection>

      <AboutSection title='Open source' icon={Code} open={open === 'oss'} onToggle={() => toggle('oss')}>
        <AboutText>PearPetal is open source under the MIT license. Read the code, file an issue, or contribute.</AboutText>
        <AboutLink onClick={() => openUrl('https://github.com/peerloomllc/pearpetal')}>View on GitHub ↗</AboutLink>
      </AboutSection>

      <AboutSection title='Share the app' icon={ShareNetwork} open={open === 'share'} onToggle={() => toggle('share')}>
        <AboutText>Know someone who'd want a private, serverless cycle tracker? Share PearPetal.</AboutText>
        <AboutLink onClick={share}>Share PearPetal</AboutLink>
      </AboutSection>

      <AboutSection title='Contact' icon={EnvelopeSimple} open={open === 'contact'} onToggle={() => toggle('contact')}>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <AboutLink onClick={() => openUrl('mailto:peerloomllc@proton.me?subject=%5BPearPetal%5D%20Feedback')}>Email</AboutLink>
          <AboutLink onClick={() => openUrl('https://github.com/peerloomllc/pearpetal/issues')}>Issue</AboutLink>
        </div>
      </AboutSection>

      <div style={{ textAlign: 'center', color: colors.text.muted, fontSize: 13 }}>v{APP_VERSION}</div>

      {donateSheet && <DonationSheet detected={donateSheet.detected} onClose={() => setDonateSheet(null)} />}
    </div>
  )
}

// Persistent bottom navigation (owner mode). Phosphor glyph + label per tab, with a
// top accent line on the active tab. Sits above the home-indicator via the
// safe-bottom inset. The active tab fills its glyph for extra weight.
const NAV_TABS = [
  { key: 'main', label: 'Cycle', Icon: Flower },
  { key: 'share', label: 'Share', Icon: ShareNetwork },
  { key: 'settings', label: 'Settings', Icon: Gear },
  { key: 'about', label: 'About', Icon: Info },
]
function BottomNav ({ active, onTab }) {
  const activeIndex = Math.max(0, NAV_TABS.findIndex((t) => t.key === active))
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, display: 'flex', background: 'rgba(20,15,17,0.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: `1px solid ${colors.border}`, paddingBottom: 'var(--pear-safe-bottom)' }}>
      {/* A single accent that slides to the active tab. */}
      <div style={{ position: 'absolute', top: 0, height: 2, width: 26, borderRadius: 2, background: colors.primary, left: `calc(${activeIndex * 25 + 12.5}% - 13px)`, transition: 'left 280ms cubic-bezier(0.4,0,0.2,1)' }} />
      {NAV_TABS.map((t) => {
        const on = active === t.key
        const Icon = t.Icon
        return (
          <button key={t.key} onClick={() => { haptic('light'); onTab(t.key) }} aria-current={on ? 'page' : undefined} style={{ flex: 1, background: 'none', border: 'none', padding: `${spacing.sm}px 0`, cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? colors.primary : colors.text.muted, transition: 'color 240ms' }}>
            <span style={{ display: 'flex', transform: on ? 'scale(1.12)' : 'scale(1)', transition: 'transform 220ms cubic-bezier(0.2,0.8,0.2,1)' }}>
              <Icon size={22} weight={on ? 'fill' : 'regular'} />
            </span>
            <span style={{ fontSize: 11, fontWeight: on ? 600 : 400 }}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function App () {
  const [mode, setMode] = useState(null) // null (loading) | 'onboard' | 'setup' | 'owner' | 'viewer'
  const [screen, setScreen] = useState('main') // 'main' | 'devices' | 'share'
  const [partnerGroup, setPartnerGroup] = useState(null)
  const [date, setDate] = useState(todayIso())
  const [days, setDays] = useState([])
  const [pred, setPred] = useState(null)
  const [flower, setFlower] = useState('rose')
  const [notice, setNotice] = useState('')
  const [donateReminder, setDonateReminder] = useState(false)
  const [periodSheet, setPeriodSheet] = useState(false)
  const [dialInfo, setDialInfo] = useState(false)
  const [flowerSheet, setFlowerSheet] = useState(false)
  const [recentsOpen, setRecentsOpen] = useState(false) // Recents is collapsed by default (declutter the main page)
  // Theme: `themePref` is the user's choice (dark/light/system), `theme` the
  // resolved dark|light that drives CSS + the flower palette. main.jsx already
  // applied the saved pref pre-paint; keep React in sync so flowers re-render.
  const [themePref, setThemePref] = useState(() => loadThemePref())
  const [theme, setThemeResolved] = useState(() => resolveTheme(loadThemePref()))
  const changeTheme = (pref) => { setThemePref(pref); setThemeResolved(applyThemePref(pref)); haptic('light') }
  useEffect(() => {
    if (themePref !== 'system') return undefined
    return onSystemThemeChange((resolved) => setThemeResolved(resolved))
  }, [themePref])
  // Tell the shell our resolved theme so it persists it and paints the pre-JS
  // background to match on the next cold start (no dark flash for light users).
  useEffect(() => { call('shell:theme', { theme }).catch(() => {}) }, [theme])
  // Android hardware/gesture Back: pop the in-app stack instead of exiting. The
  // shell consumes Back only while canBack is true (shell:navState) and emits a
  // 'back' event we handle here, closing the topmost overlay / walking screens ->
  // main; at the root (main, nothing open) canBack is false so Back exits normally.
  // Overlays (bottom sheets, scanner, onboarding sub-mode) self-register a dismiss
  // handler; App handles the rest (partner view, owner sub-screen -> main).
  const backHandlers = useRef([])
  const [backCount, setBackCount] = useState(0)
  const registerBack = useCallback((fn) => {
    backHandlers.current.push(fn); setBackCount(backHandlers.current.length)
    return () => { const i = backHandlers.current.indexOf(fn); if (i >= 0) backHandlers.current.splice(i, 1); setBackCount(backHandlers.current.length) }
  }, [])
  const backCtx = useMemo(() => ({ register: registerBack }), [registerBack])
  const canBack = !!(backCount > 0 || partnerGroup || (mode === 'owner' && screen !== 'main'))
  useEffect(() => { call('shell:navState', { canBack }).catch(() => {}) }, [canBack])
  useEffect(() => on('back', () => {
    for (let i = backHandlers.current.length - 1; i >= 0; i--) { if (backHandlers.current[i]()) return } // deepest overlay first
    if (partnerGroup) return setPartnerGroup(null)
    if (mode === 'owner' && screen !== 'main') return setScreen('main')
  }), [partnerGroup, mode, screen])
  const [settingsAnchor, setSettingsAnchor] = useState(null) // e.g. 'health' -> scroll there on open
  const [cycleView, setCycleView] = useState(() => { try { return localStorage.getItem('pearpetal:cycleView') === 'calendar' ? 'calendar' : 'dial' } catch { return 'dial' } })
  const setView = (v) => { setCycleView(v); try { localStorage.setItem('pearpetal:cycleView', v) } catch {} }
  const [calMonth, setCalMonth] = useState(() => monthStart(todayIso()))
  const [calDir, setCalDir] = useState(1) // slide direction for the month transition
  const goMonth = (n) => { setCalDir(n); setCalMonth((cur) => shiftMonthIso(cur, n)) }
  const goToday = () => { const t = monthStart(todayIso()); setCalDir(t < calMonth ? -1 : 1); setCalMonth(t); setDate(todayIso()) }

  const refresh = useCallback(async () => {
    const [d, pr] = await Promise.all([call('day:getAll').catch(() => []), call('cycle:prediction').catch(() => null)])
    setDays(d); setPred(pr)
  }, [])

  const boot = useCallback(async () => {
    const s = await call('cycle:status').catch(() => ({ hasBase: false }))
    if (s.hasBase) {
      setMode('owner')
      call('prefs:get').then((p) => setFlower(p.flower || 'rose')).catch(() => {})
      await call('device:publish').catch(() => {}); refresh(); return
    }
    const partners = await call('partner:list').catch(() => [])
    setMode(partners.length ? 'viewer' : 'onboard')
  }, [refresh])

  useEffect(() => { boot() }, [boot])
  useEffect(() => on('group:updated', () => { if (mode === 'owner') refresh() }), [mode, refresh])

  // Invite deep link: the shell forwards the opened URL (https://peerloomllc.com/
  // petal/link|join#<blob> or pear://pearpetal/link|join?...). Route by path -
  // /link adds THIS device to a cycle, /join opens a partner's shared cycle - then
  // re-boot into the right mode. Errors (e.g. already tracking) surface as a notice.
  useEffect(() => on('deeplink:invite', async ({ url }) => {
    const key = parseInvite(url)
    if (!key) { setNotice('That invite link looks empty or malformed.'); return }
    try {
      if (isLinkInvite(url)) await call('link:join', { inviteKey: key })
      else await call('partner:join', { inviteKey: key })
      haptic('success'); await boot()
    } catch (e) { setNotice(e?.message || 'Could not open that invite.') }
  }), [boot])
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t) }, [notice])

  // Two-week donation nudge: once the owner is set up, check the device-local due
  // flag once, skip on iOS, and show the modal a single time ever (mark shown as
  // soon as it surfaces). Never crosses the wire.
  useEffect(() => {
    if (mode !== 'owner' || isIOS()) return undefined
    let done = false
    call('donation:status', {}).then((s) => {
      if (!done && s?.due) { setDonateReminder(true); call('donation:dismiss', {}).catch(() => {}) }
    }).catch(() => {})
    return () => { done = true }
  }, [mode])

  let content
  if (mode === null) content = <div style={{ height: '100%' }} />
  else if (mode === 'onboard') content = <Onboarding onReady={boot} onViewerReady={boot} onStartSetup={() => setMode('setup')} />
  else if (mode === 'setup') content = <SetupWizard onDone={boot} />
  else if (partnerGroup) content = <PartnerView groupId={partnerGroup} onClose={() => setPartnerGroup(null)} onLeft={() => { setPartnerGroup(null); boot() }} />
  else if (mode === 'viewer') content = <ViewerHome onOpenPartner={setPartnerGroup} onBecomeOwner={async () => { await call('cycle:create').catch(() => {}); setMode('setup') }} />
  else if (screen === 'devices') content = <Devices onClose={() => setScreen('main')} />
  else if (screen === 'share') content = <Sharing onClose={() => setScreen('main')} onOpenPartner={setPartnerGroup} />
  else if (screen === 'settings') content = <CycleSettings onClose={() => setScreen('main')} onSaved={refresh} onFlower={setFlower} onDevices={() => setScreen('devices')} scrollTo={settingsAnchor} onScrolled={() => setSettingsAnchor(null)} themePref={themePref} onTheme={changeTheme} />
  else if (screen === 'about') content = <AboutScreen onClose={() => setScreen('main')} />
  else content = (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {pred?.pregnancy?.active ? (
        <PregnancyView preg={pred.pregnancy} flower={flower} onSettings={() => setScreen('settings')} />
      ) : (
        <>
          <ViewToggle value={cycleView} onChange={setView} />
          {/* key forces a remount so the fade replays on each toggle, softening the
              height change between the (taller) dial and the calendar. */}
          <div key={cycleView} style={{ animation: 'pearpetal-fade 220ms ease' }}>
            {cycleView === 'calendar'
              ? <MonthCalendar monthIso={calMonth} dir={calDir} pred={pred} daysByIso={Object.fromEntries(days.map((d) => [d.date, d]))} selected={date} today={todayIso()} onPick={setDate} onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} onToday={goToday} />
              : <CycleSummary pred={pred} today={todayIso()} flower={flower} onSettings={() => setScreen('settings')} onConditions={() => { setSettingsAnchor('health'); setScreen('settings') }} onScrub={(date) => { if (date <= todayIso()) setDate(date) }} selected={date} onEditPeriod={() => setPeriodSheet(true)} onInfo={() => setDialInfo(true)} onFlowerTap={() => setFlowerSheet(true)} />}
          </div>
        </>
      )}
      <DayEditor date={date} setDate={setDate} onSaved={refresh} />
      {((!pred?.pregnancy?.active && cycleView === 'calendar') || !days.length) ? null : (
        <CollapsibleCard title={`Recent days (${days.length})`} open={recentsOpen} onToggle={() => setRecentsOpen((o) => !o)}>
          <RecentDays days={days} onPick={setDate} />
        </CollapsibleCard>
      )}
    </div>
  )

  const showNav = mode === 'owner' && !partnerGroup
  const navActive = ['share', 'settings', 'about'].includes(screen) ? screen : 'main'
  return (
    <ThemeContext.Provider value={theme}>
     <BackContext.Provider value={backCtx}>
      <div style={showNav ? { paddingBottom: 'calc(64px + var(--pear-safe-bottom))' } : undefined}>{content}</div>
      {showNav && <BottomNav active={navActive} onTab={setScreen} />}
      <DonationReminderModal open={donateReminder} onDonate={() => { setDonateReminder(false); setScreen('about') }} onDismiss={() => setDonateReminder(false)} />
      {periodSheet && <PeriodSheet defaultStart={pred?.known ? addDaysIso(todayIso(), -((pred.dayOfCycle || 1) - 1)) : todayIso()} onClose={() => setPeriodSheet(false)} onSaved={(start) => { setView('dial'); setDate(start <= todayIso() ? start : todayIso()); refresh() }} />}
      {dialInfo && <DialInfoSheet onClose={() => setDialInfo(false)} />}
      {flowerSheet && <FlowerPickerSheet value={flower} onPick={(key) => { setFlower(key); call('prefs:set', { flower: key }).catch(() => {}); haptic('light') }} onClose={() => setFlowerSheet(false)} />}
      {notice && (
        <div onClick={() => setNotice('')} style={{ position: 'fixed', left: 12, right: 12, bottom: `calc(16px + 64px + var(--pear-safe-bottom))`, zIndex: 50, background: colors.surface.card, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, color: colors.text.primary, fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
          {notice}
        </div>
      )}
     </BackContext.Provider>
    </ThemeContext.Provider>
  )
}
