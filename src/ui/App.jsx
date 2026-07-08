// PearPetal UI - slice 1 (scaffold + private base + own-device linking).
// Screens:
//   - Onboarding: start tracking (create private base) OR link this device to
//     an existing cycle on another of the owner's devices.
//   - Log: pick a date, set flow + symptoms + notes, see recent days.
//   - Devices: the owner's linked devices + a copyable/scannable link invite.
//
// The petal dial and partner sharing are deliberately NOT here yet (later
// slices). This proves the data path end to end: log on device A, see on B.

import { useEffect, useState, useCallback, useRef } from 'react'
import { Flower, ShareNetwork, Gear, Info, CaretRight, Camera } from '@phosphor-icons/react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { call, on, haptic } from './ipc.js'
import { colors, spacing, radius } from './theme.js'
import PetalDial, { PregnancyDial, FlowerThumb, isoDiff, addDaysIso } from './PetalDial.jsx'
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
const BUYMEACOFFEE_URL = 'https://buymeacoffee.com/peerloomllc'
const LIGHTNING_WALLETS = [
  { name: 'Strike', url: 'https://strike.me', desc: 'Simple Lightning payments' },
  { name: 'Cash App', url: 'https://cash.app', desc: 'Send Bitcoin via Lightning' },
  { name: 'Wallet of Satoshi', url: 'https://walletofsatoshi.com', desc: 'Beginner-friendly Lightning wallet' },
  { name: 'Phoenix', url: 'https://phoenix.acinq.co', desc: 'Self-custodial Lightning wallet' },
]
// The shell injects window.__pearPlatform ('ios'|'android') before the bundle.
// iOS hides the donation section per App Store guideline 3.1.1 (no external
// donation links), so the Support-development section is Android-only for now.
const isIOS = () => typeof window !== 'undefined' && window.__pearPlatform === 'ios'
const openUrl = (url) => { try { const p = call('shell:openUrl', { url }); if (p && p.catch) p.catch(() => {}) } catch {} }

function todayIso () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Re-run a loader whenever synced data changes. Every base view update - a local
// edit OR a replicated-then-applied remote change from another of your devices or a
// partner - emits group:updated. This loads once on mount and again on each such
// event, so any screen showing synced data refreshes in real time (no manual
// reload, no leave-and-return). `load` must be stable (useCallback) so the
// subscription is registered once and torn down on unmount.
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
function Btn ({ children, onClick, kind = 'primary', style }) {
  const base = { border: 'none', borderRadius: radius.lg, padding: `${spacing.md}px ${spacing.base}px`, fontSize: 15, fontWeight: 500 }
  const kinds = {
    primary: { background: colors.primary, color: colors.text.onPrimary },
    ghost: { background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}` },
  }
  return <button onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>{children}</button>
}
function Chip ({ active, onClick, children, color }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${active ? (color || colors.primary) : colors.border}`,
      background: active ? (color || colors.primary) : 'transparent',
      color: active ? colors.text.onPrimary : colors.text.secondary,
      borderRadius: radius.full, padding: `6px 12px`, fontSize: 13, fontWeight: 500,
    }}>{children}</button>
  )
}
function flowColor (k) { return colors.flow[k] || colors.track }

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
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#000' }}>
      <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: 240, height: 240, border: `3px solid ${colors.primary}`, borderRadius: radius.lg }} />
      </div>
      <button onClick={onClose} aria-label='Close scanner' style={{ position: 'absolute', top: spacing.base, right: spacing.base, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}>✕</button>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 14, padding: `${spacing.xl}px ${spacing.base}px`, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
        {error || 'Point the camera at an invite QR code'}
      </div>
    </div>
  )
}

// --- onboarding -------------------------------------------------------------
function Onboarding ({ onReady, onViewerReady }) {
  const [mode, setMode] = useState(null) // null | 'link' | 'partner'
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [scanning, setScanning] = useState(false)

  const start = async () => {
    setErr('')
    try { await call('cycle:create'); haptic('success'); onReady() } catch (e) { setErr(e.message) }
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

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg, minHeight: '100%', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 600, color: colors.primary, letterSpacing: 0.3 }}>PearPetal</div>
        <div style={{ color: colors.text.secondary, marginTop: spacing.sm }}>Private cycle tracking. No account, no server. Your data stays on your devices.</div>
      </div>
      {mode === null && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <Btn onClick={start}>Start tracking</Btn>
          <Btn kind='ghost' onClick={() => { setMode('link'); setErr('') }}>Link another device</Btn>
          <Btn kind='ghost' onClick={() => { setMode('partner'); setErr('') }}>View a partner's cycle</Btn>
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
  const load = useCallback(async () => {
    setShares(await call('share:list').catch(() => []))
    setPartners(await call('partner:list').catch(() => []))
  }, [])
  useSynced(load)
  const create = async () => {
    setErr('')
    try { await call('share:create', { scope }); haptic('success'); load() } catch (e) { setErr(e.message) }
  }
  const revoke = async (groupId) => { try { await call('share:revoke', { groupId }); haptic('warn'); load() } catch (e) { setErr(e.message) } }
  const copy = async (code) => { try { await navigator.clipboard.writeText(code); haptic('success') } catch { call('shell:share', { text: code }).catch(() => {}) } }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Sharing</div>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ fontSize: 15, fontWeight: 500 }}>Share with a partner</div>
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
        <div style={{ color: colors.text.muted, fontSize: 12 }}>Your full log and notes never leave your devices. Revoking stops future updates but cannot unsend what a partner already received.</div>
      </div>

      {shares.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>People you share with</div>
          {shares.map((s) => (
            <div key={s.groupId} style={{ ...card, padding: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: colors.text.primary, fontWeight: 500, textTransform: 'capitalize' }}>{s.scope}</span>
                <div style={{ display: 'flex', gap: spacing.sm }}>
                  <Btn kind='ghost' onClick={() => setQrFor(qrFor === s.groupId ? null : s.groupId)} style={{ padding: '6px 10px', fontSize: 13 }}>{qrFor === s.groupId ? 'Hide QR' : 'QR'}</Btn>
                  <Btn kind='ghost' onClick={() => copy(shareUrl(s.inviteKey))} style={{ padding: '6px 10px', fontSize: 13 }}>Copy link</Btn>
                  <Btn kind='ghost' onClick={() => revoke(s.groupId)} style={{ padding: '6px 10px', fontSize: 13, color: colors.error }}>Revoke</Btn>
                </div>
              </div>
              {qrFor === s.groupId && <QrImage text={shareUrl(s.inviteKey)} />}
            </div>
          ))}
        </div>
      )}

      {partners.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>Shared with you</div>
          {partners.map((p) => (
            <button key={p.groupId} onClick={() => onOpenPartner(p.groupId)} style={{ ...card, padding: spacing.md, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: spacing.md, minWidth: 0 }}>
                <Avatar src={p.ownerAvatar} name={p.ownerName} size={32} />
                <span style={{ color: colors.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.ownerName ? `${p.ownerName}'s cycle` : "A partner's cycle"}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, color: colors.text.muted, fontSize: 12, flexShrink: 0 }}>{p.scope || '...'}<CaretRight size={14} color={colors.text.muted} weight='regular' /></span>
            </button>
          ))}
        </div>
      )}
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
    </div>
  )
}

function PartnerView ({ groupId, onClose, onLeft }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const load = async () => { try { setData(await call('partner:view', { groupId })) } catch (e) { setErr(e.message) } }
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
  const synced = !!(data && (data.ownerPubkey || data.phase || data.predict)) && !pendingAvatar
  useEffect(() => {
    if (synced) return undefined
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [groupId, synced])
  const leave = async () => { try { await call('partner:leave', { groupId }); onLeft() } catch (e) { setErr(e.message) } }

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
      {data && (
        <>
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
          <Btn kind='ghost' onClick={leave} style={{ color: colors.error }}>Stop viewing</Btn>
        </>
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
    setRow({ ...row, flow }); haptic('light')
    await call('day:set', { date, flow }); flash()
  }
  const toggleSymptom = async (s) => {
    const has = (row.symptoms || []).includes(s)
    const symptoms = has ? row.symptoms.filter((x) => x !== s) : [...(row.symptoms || []), s]
    setRow({ ...row, symptoms }); haptic('light')
    await call('day:set', { date, symptoms }); flash()
  }
  const saveNotes = async () => { await call('day:set', { date, notes }); flash() }
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1200); onSaved && onSaved() }

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.base }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <input type='date' value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)}
          style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `6px 10px` }} />
        <span style={{ color: colors.success, fontSize: 13, opacity: saved ? 1 : 0, transition: 'opacity 200ms' }}>Saved</span>
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
          <span style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, color: colors.text.muted, fontSize: 12, flexShrink: 0 }}>{p.scope || '...'}<CaretRight size={14} color={colors.text.muted} weight='regular' /></span>
        </button>
      ))}
      <Btn kind='ghost' onClick={onBecomeOwner}>Start tracking my own cycle</Btn>
    </div>
  )
}

// --- cycle summary (owner's own prediction) ---------------------------------
const PHASE_COLOR = { menstrual: '#c8384f', follicular: '#c9a0d8', fertile: '#e8859b', luteal: '#8f8288' }
function fmtDate (iso) { try { return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: colors.text.muted, fontSize: 11 }}>A calendar estimate, not medical advice. Follow your provider's dates.</span>
        <button onClick={onSettings} style={{ background: 'none', border: 'none', color: colors.text.muted, fontSize: 13, padding: 0 }}>Settings</button>
      </div>
    </div>
  )
}

function CycleSummary ({ pred, today, flower, onSettings, onScrub, selected }) {
  if (!pred) return null
  const days = pred.daysUntilNextPeriod
  const nextLabel = days <= 0 ? 'expected now' : days === 1 ? 'in 1 day' : `in ${days} days`
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md, alignItems: 'stretch' }}>
      <PetalDial pred={pred} today={today} flower={flower} onDayTap={onScrub} selected={selected} />
      {!pred.known ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Learning your cycle</div>
          <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center' }}>Log a period start or two and the flower will track your phase, next period, and fertile window. Everything is computed on this device.</div>
          <button onClick={onSettings} style={{ alignSelf: 'center', background: 'none', border: 'none', color: colors.primary, fontSize: 13, padding: 0 }}>Set your average cycle length ›</button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm, marginTop: `-${spacing.sm}px` }}>
            <span style={{ fontSize: 26, fontWeight: 600, color: PHASE_COLOR[pred.phase] || colors.text.primary }}>{PHASE_LABEL[pred.phase] || pred.phase}</span>
            <span style={{ color: colors.text.muted, fontSize: 14 }}>· day {pred.dayOfCycle}</span>
          </div>
          {pred.goal === 'conceive' && <div style={{ textAlign: 'center', color: colors.primary, fontSize: 12 }}>Your fertile window is your best chance to conceive.</div>}
          {pred.goal === 'avoid' && <div style={{ textAlign: 'center', color: colors.warn, fontSize: 12, fontWeight: 500 }}>Not contraception. Do not rely on this to avoid pregnancy.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
            <Row label='Next period' value={`${fmtDate(pred.nextPeriodStart)} · ${nextLabel}`} />
            <Row label='Fertile window' value={`${fmtDate(pred.fertileStart)} - ${fmtDate(pred.fertileEnd)}`} accent={pred.goal === 'conceive'} />
            <Row label={pred.ovulationSource === 'bbt' ? 'Ovulation (from BBT)' : 'Ovulation (est.)'} value={fmtDate(pred.ovulationEst)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: colors.text.muted, fontSize: 11 }}>
              {pred.confidence === 'high' ? 'Based on your recent cycles.' : pred.confidence === 'medium' ? 'Sharpens as you log more cycles.' : 'Early estimate. Not medical advice.'}
            </span>
            <button onClick={onSettings} style={{ background: 'none', border: 'none', color: colors.text.muted, fontSize: 13, padding: 0 }}>Settings</button>
          </div>
        </>
      )}
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
      <div style={{ color: colors.text.muted, fontSize: 11 }}>A calendar estimate, not medical advice. Your provider's dating is what counts.</div>
      <button onClick={() => save({ goal: 'track', pregnancy: null })} style={{ alignSelf: 'flex-start', marginTop: spacing.xs, background: 'none', border: 'none', color: colors.text.muted, fontSize: 12, padding: 0 }}>No longer pregnant</button>
    </div>
  )
}

function CycleSettings ({ onClose, onSaved, onFlower, onDevices }) {
  const [prefs, setPrefs] = useState(null)
  const [dataMsg, setDataMsg] = useState('')
  useEffect(() => { call('prefs:get').then(setPrefs).catch(() => setPrefs({})) }, [])
  if (!prefs) return null
  const save = async (patch) => { const next = { ...prefs, ...patch }; setPrefs(next); await call('prefs:set', patch).catch(() => {}); onSaved && onSaved() }
  const pickFlower = (key) => { save({ flower: key }); onFlower && onFlower(key); haptic('light') }

  const inShell = typeof window !== 'undefined' && !!window.ReactNativeWebView
  const doExport = async () => {
    try {
      const data = await call('export:data')
      const json = JSON.stringify(data, null, 2)
      if (inShell) { await call('shell:export', { filename: 'pearpetal-backup.json', json }); setDataMsg('Backup ready to save.') } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = 'pearpetal-backup.json'; a.click(); URL.revokeObjectURL(url)
        setDataMsg(`Exported ${data.days.length} days.`)
      }
      haptic('success')
    } catch (e) { setDataMsg(e.message) }
  }
  const applyImport = async (json) => {
    try { const r = await call('import:data', { data: JSON.parse(json) }); setDataMsg(`Imported ${r.days} days and ${r.periods} periods.`); haptic('success'); onSaved && onSaved() } catch (e) { setDataMsg('Import failed. ' + e.message) }
  }
  const doImport = async () => {
    if (inShell) { try { const r = await call('shell:import'); if (r && r.json) applyImport(r.json) } catch (e) { setDataMsg(e.message) } return }
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
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>Cycle settings</div>
      <ProfileCard />
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ color: colors.text.secondary, fontSize: 14 }}>Your flower</div>
        <div style={{ display: 'flex', gap: spacing.sm, overflowX: 'auto', paddingBottom: spacing.xs }}>
          {FLOWER_KEYS.map((key) => {
            const active = (prefs.flower || 'rose') === key
            return (
              <button key={key} onClick={() => pickFlower(key)} aria-pressed={active} style={{
                flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: active ? 'rgba(232,133,155,0.10)' : 'transparent',
                border: `1px solid ${active ? colors.primary : colors.border}`, borderRadius: radius.lg, padding: `${spacing.sm}px ${spacing.md}px`,
              }}>
                <FlowerThumb flower={key} size={52} />
                <span style={{ fontSize: 11, color: active ? colors.text.primary : colors.text.muted, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{flowerLabel(key)}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.base }}>
        <Stepper label='Average cycle length' value={prefs.avgCycleLength} def={28} min={21} max={45} field='avgCycleLength' />
        <Stepper label='Average period length' value={prefs.avgPeriodLength} def={5} min={2} max={10} field='avgPeriodLength' />
        <Stepper label='Luteal phase length' value={prefs.lutealLength} def={14} min={9} max={18} field='lutealLength' />
        <div style={{ color: colors.text.muted, fontSize: 12 }}>These help predictions before you have logged many cycles. Once you have history, PearPetal learns your real numbers.</div>
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ color: colors.text.secondary, fontSize: 14 }}>What are you tracking for?</div>
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          {[['track', 'General'], ['conceive', 'Trying to conceive'], ['avoid', 'Avoiding pregnancy'], ['pregnant', 'Pregnant']].map(([k, l]) => (
            <Chip key={k} active={(prefs.goal || 'track') === k} onClick={() => save({ goal: k })}>{l}</Chip>
          ))}
        </div>
        {prefs.goal === 'pregnant'
          ? <PregnancySetup prefs={prefs} save={save} />
          : <div style={{ color: colors.text.muted, fontSize: 11 }}>PearPetal is not contraception. Do not rely on it to avoid pregnancy.</div>}
      </div>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <div style={{ color: colors.text.secondary, fontSize: 14 }}>Your data</div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn onClick={doExport} style={{ flex: 1 }}>Export backup</Btn>
          <Btn kind='ghost' onClick={doImport} style={{ flex: 1 }}>Import</Btn>
        </div>
        <div style={{ color: colors.text.muted, fontSize: 11 }}>Export saves a plain file to your device. It is not encrypted and never leaves your device on its own, so keep it somewhere private. Import merges a backup into your log.</div>
        {dataMsg && <div style={{ color: colors.success, fontSize: 13 }}>{dataMsg}</div>}
      </div>
    </div>
  )
}

// --- root -------------------------------------------------------------------
// --- About + Bitcoin donation -----------------------------------------------
// Collapsible card: centered title + caret, tap to expand. Accordion (one open at
// a time) is managed by AboutScreen.
function AboutSection ({ title, open, onToggle, children }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button onClick={onToggle} aria-expanded={open} style={{ width: '100%', background: 'none', border: 'none', padding: `${spacing.base}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: colors.text.primary }}>
        <span style={{ fontSize: 16, fontWeight: 400 }}>{title}</span>
        <CaretRight size={18} color={colors.text.muted} weight='regular' style={{ flexShrink: 0, transition: 'transform 0.3s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
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

function WalletSheet ({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, margin: '0 auto', background: colors.surface.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, border: `1px solid ${colors.border}`, padding: spacing.lg, paddingBottom: `calc(${spacing.lg}px + var(--pear-safe-bottom))`, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>⚡ Bitcoin Lightning ⚡</div>
        <div style={{ color: colors.text.secondary, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm }}>No Lightning wallet was detected. To send a tip, install one:</div>
        {LIGHTNING_WALLETS.map((w) => (
          <button key={w.name} onClick={() => openUrl(w.url)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: colors.text.primary, fontSize: 15 }}>{w.name}</span>
              <span style={{ color: colors.text.muted, fontSize: 13 }}>{w.desc}</span>
            </span>
            <span style={{ color: colors.text.muted }}>↗</span>
          </button>
        ))}
        <div style={{ textAlign: 'center', color: colors.text.muted, fontSize: 13, marginTop: spacing.sm }}>After installing, come back and tap Bitcoin again.</div>
        <Btn kind='ghost' onClick={onClose}>Close</Btn>
      </div>
    </div>
  )
}

// Two-week donation nudge (suite pattern). Shown once ever; the caller gates it
// off on iOS (App Store 3.1.1) and marks it shown as soon as it surfaces.
function DonationReminderModal ({ open, onDonate, onDismiss }) {
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
  const [walletOpen, setWalletOpen] = useState(false)
  const [open, setOpen] = useState(null)
  const toggle = (id) => setOpen((o) => (o === id ? null : id))
  const ios = isIOS()
  const donateBTC = async () => {
    try { const r = await call('shell:canOpenURL', { url: 'lightning:test' }); if (r?.can) openUrl('lightning:' + LIGHTNING_ADDRESS); else setWalletOpen(true) } catch { setWalletOpen(true) }
  }
  const share = () => { const p = call('shell:share', { title: 'PearPetal', text: 'PearPetal - a private, peer-to-peer cycle tracker. No account, no server.\n\nhttps://peerloomllc.com/pearpetal/' }); if (p && p.catch) p.catch(() => {}) }
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>About</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: colors.primary }}>PearPetal</div>
        <div style={{ color: colors.text.muted, fontSize: 14, marginTop: spacing.xs }}>Private cycle tracking. No account, no server.</div>
      </div>

      <AboutSection title='How it works' open={open === 'how'} onToggle={() => toggle('how')}>
        <AboutText>PearPetal keeps your cycle on your own devices and syncs it peer-to-peer over the Hypercore Protocol - no account, no server, no cloud, no data collection. You choose exactly what a partner sees; your full log and notes never leave your devices.</AboutText>
        <AboutLink onClick={() => openUrl('https://pears.com/')}>Learn about P2P ↗</AboutLink>
      </AboutSection>

      {!ios && (
        <AboutSection title='Support development' open={open === 'support'} onToggle={() => toggle('support')}>
          <AboutText>PearPetal is free and open source. If it brings you value, consider sending a little back.</AboutText>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <AboutLink primary onClick={donateBTC}>⚡ Bitcoin ⚡</AboutLink>
            <AboutLink onClick={() => openUrl(BUYMEACOFFEE_URL)}>$ USD $</AboutLink>
          </div>
        </AboutSection>
      )}

      <AboutSection title='Learn about Bitcoin' open={open === 'btc'} onToggle={() => toggle('btc')}>
        <AboutText>New to Bitcoin? The Satoshi Nakamoto Institute has a free, concise crash course on how it works and why it matters.</AboutText>
        <AboutLink onClick={() => openUrl('https://nakamotoinstitute.org/crash-course/')}>Bitcoin Crash Course ↗</AboutLink>
      </AboutSection>

      <AboutSection title='Open source' open={open === 'oss'} onToggle={() => toggle('oss')}>
        <AboutText>PearPetal is open source under the MIT license. Read the code, file an issue, or contribute.</AboutText>
        <AboutLink onClick={() => openUrl('https://github.com/peerloomllc/pearpetal')}>View on GitHub ↗</AboutLink>
      </AboutSection>

      <AboutSection title='Share the app' open={open === 'share'} onToggle={() => toggle('share')}>
        <AboutText>Know someone who'd want a private, serverless cycle tracker? Share PearPetal.</AboutText>
        <AboutLink onClick={share}>Share PearPetal</AboutLink>
      </AboutSection>

      <AboutSection title='Contact' open={open === 'contact'} onToggle={() => toggle('contact')}>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <AboutLink onClick={() => openUrl('mailto:peerloomllc@proton.me?subject=%5BPearPetal%5D%20Feedback')}>Email</AboutLink>
          <AboutLink onClick={() => openUrl('https://github.com/peerloomllc/pearpetal/issues')}>Issue</AboutLink>
        </div>
      </AboutSection>

      <div style={{ textAlign: 'center', color: colors.text.muted, fontSize: 13 }}>v{APP_VERSION}</div>

      {walletOpen && <WalletSheet onClose={() => setWalletOpen(false)} />}
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
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, display: 'flex', background: 'rgba(20,15,17,0.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: `1px solid ${colors.border}`, paddingBottom: 'var(--pear-safe-bottom)' }}>
      {NAV_TABS.map((t) => {
        const on = active === t.key
        const tint = on ? colors.primary : colors.text.muted
        const Icon = t.Icon
        return (
          <button key={t.key} onClick={() => onTab(t.key)} aria-current={on ? 'page' : undefined} style={{ flex: 1, background: 'none', border: 'none', padding: `${spacing.sm}px 0 ${spacing.sm}px`, cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ position: 'absolute', top: 0, width: 26, height: 2, borderRadius: 2, background: on ? colors.primary : 'transparent' }} />
            <Icon size={22} color={tint} weight={on ? 'fill' : 'regular'} />
            <span style={{ fontSize: 11, fontWeight: on ? 600 : 400, color: tint }}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function App () {
  const [mode, setMode] = useState(null) // null (loading) | 'onboard' | 'owner' | 'viewer'
  const [screen, setScreen] = useState('main') // 'main' | 'devices' | 'share'
  const [partnerGroup, setPartnerGroup] = useState(null)
  const [date, setDate] = useState(todayIso())
  const [days, setDays] = useState([])
  const [pred, setPred] = useState(null)
  const [flower, setFlower] = useState('rose')
  const [notice, setNotice] = useState('')
  const [donateReminder, setDonateReminder] = useState(false)

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
  else if (mode === 'onboard') content = <Onboarding onReady={boot} onViewerReady={boot} />
  else if (partnerGroup) content = <PartnerView groupId={partnerGroup} onClose={() => setPartnerGroup(null)} onLeft={() => { setPartnerGroup(null); boot() }} />
  else if (mode === 'viewer') content = <ViewerHome onOpenPartner={setPartnerGroup} onBecomeOwner={async () => { await call('cycle:create').catch(() => {}); boot() }} />
  else if (screen === 'devices') content = <Devices onClose={() => setScreen('main')} />
  else if (screen === 'share') content = <Sharing onClose={() => setScreen('main')} onOpenPartner={setPartnerGroup} />
  else if (screen === 'settings') content = <CycleSettings onClose={() => setScreen('main')} onSaved={refresh} onFlower={setFlower} onDevices={() => setScreen('devices')} />
  else if (screen === 'about') content = <AboutScreen onClose={() => setScreen('main')} />
  else content = (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: screenPadTop, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {pred?.pregnancy?.active
        ? <PregnancyView preg={pred.pregnancy} flower={flower} onSettings={() => setScreen('settings')} />
        : <CycleSummary pred={pred} today={todayIso()} flower={flower} onSettings={() => setScreen('settings')} onScrub={(date) => { if (date <= todayIso()) setDate(date) }} selected={date} />}
      <DayEditor date={date} setDate={setDate} onSaved={refresh} />
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, margin: `0 0 ${spacing.sm}px ${spacing.xs}px` }}>Recent</div>
        <RecentDays days={days} onPick={setDate} />
      </div>
    </div>
  )

  const showNav = mode === 'owner' && !partnerGroup
  const navActive = ['share', 'settings', 'about'].includes(screen) ? screen : 'main'
  return (
    <>
      <div style={showNav ? { paddingBottom: 'calc(64px + var(--pear-safe-bottom))' } : undefined}>{content}</div>
      {showNav && <BottomNav active={navActive} onTab={setScreen} />}
      <DonationReminderModal open={donateReminder} onDonate={() => { setDonateReminder(false); setScreen('about') }} onDismiss={() => setDonateReminder(false)} />
      {notice && (
        <div onClick={() => setNotice('')} style={{ position: 'fixed', left: 12, right: 12, bottom: `calc(16px + 64px + var(--pear-safe-bottom))`, zIndex: 50, background: colors.surface.card, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, color: colors.text.primary, fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
          {notice}
        </div>
      )}
    </>
  )
}
