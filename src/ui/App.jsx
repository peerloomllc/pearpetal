// PearPetal UI - slice 1 (scaffold + private base + own-device linking).
// Screens:
//   - Onboarding: start tracking (create private base) OR link this device to
//     an existing cycle on another of the owner's devices.
//   - Log: pick a date, set flow + symptoms + notes, see recent days.
//   - Devices: the owner's linked devices + a copyable/scannable link invite.
//
// The petal dial and partner sharing are deliberately NOT here yet (later
// slices). This proves the data path end to end: log on device A, see on B.

import { useEffect, useState, useCallback } from 'react'
import { call, on, haptic } from './ipc.js'
import { colors, spacing, radius } from './theme.js'

const FLOWS = [
  { key: 'spotting', label: 'Spotting' },
  { key: 'light', label: 'Light' },
  { key: 'medium', label: 'Medium' },
  { key: 'heavy', label: 'Heavy' },
]
const SYMPTOMS = ['cramps', 'headache', 'fatigue', 'bloating', 'tender-breasts', 'nausea', 'backache', 'acne']

function todayIso () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// --- small styled primitives ------------------------------------------------
const card = { background: colors.surface.card, borderRadius: radius.xl, padding: spacing.lg, border: `1px solid ${colors.border}` }
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

// --- onboarding -------------------------------------------------------------
function Onboarding ({ onReady }) {
  const [mode, setMode] = useState(null) // null | 'link'
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')

  const start = async () => {
    setErr('')
    try { await call('cycle:create'); haptic('success'); onReady() } catch (e) { setErr(e.message) }
  }
  const link = async () => {
    setErr('')
    try { await call('link:join', { inviteKey: code.trim() }); haptic('success'); onReady() } catch (e) { setErr(e.message) }
  }
  const scan = async () => {
    try { const r = await call('shell:scanQr'); if (r?.code) setCode(r.code) } catch {}
  }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg, minHeight: '100%', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 600, color: colors.primary, letterSpacing: 0.3 }}>PearPetal</div>
        <div style={{ color: colors.text.secondary, marginTop: spacing.sm }}>Private cycle tracking. No account, no server. Your data stays on your devices.</div>
      </div>
      {mode !== 'link' && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <Btn onClick={start}>Start tracking</Btn>
          <Btn kind='ghost' onClick={() => { setMode('link'); setErr('') }}>Link another device</Btn>
        </div>
      )}
      {mode === 'link' && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div style={{ color: colors.text.secondary, fontSize: 14 }}>On your other device, open Devices and copy its link code. Paste it here.</div>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder='Paste link code' rows={3}
            style={{ background: colors.surface.input, color: colors.text.primary, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, resize: 'none' }} />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn onClick={link} style={{ flex: 1 }}>Link this device</Btn>
            <Btn kind='ghost' onClick={scan}>Scan</Btn>
          </div>
          <Btn kind='ghost' onClick={() => { setMode(null); setErr('') }}>Back</Btn>
        </div>
      )}
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
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
  const load = async () => {
    setDevices(await call('device:getAll').catch(() => []))
    try { const r = await call('link:invite'); setInvite(r.inviteKey) } catch {}
  }
  useEffect(() => { load() }, [])
  const share = () => call('shell:share', { title: 'Link a device to PearPetal', text: invite }).catch(() => {})
  const copy = async () => { try { await navigator.clipboard.writeText(invite); haptic('success') } catch { share() } }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
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
        <div style={{ fontSize: 14, color: colors.text.secondary }}>Link another of your devices: open PearPetal on it, tap "Link another device", and paste this code.</div>
        <div style={{ background: colors.surface.input, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: colors.text.secondary, wordBreak: 'break-all', maxHeight: 96, overflow: 'auto' }}>{invite || '...'}</div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn onClick={copy} style={{ flex: 1 }}>Copy code</Btn>
          <Btn kind='ghost' onClick={share}>Share</Btn>
        </div>
      </div>
    </div>
  )
}

// --- root -------------------------------------------------------------------
export default function App () {
  const [ready, setReady] = useState(null) // null (loading) | false (onboard) | true
  const [date, setDate] = useState(todayIso())
  const [days, setDays] = useState([])
  const [showDevices, setShowDevices] = useState(false)

  const refresh = useCallback(async () => { setDays(await call('day:getAll').catch(() => [])) }, [])

  const boot = useCallback(async () => {
    const s = await call('cycle:status').catch(() => ({ hasBase: false }))
    setReady(!!s.hasBase)
    if (s.hasBase) { await call('device:publish').catch(() => {}); refresh() }
  }, [refresh])

  useEffect(() => { boot() }, [boot])
  // Re-fetch when the worklet signals the view changed (a peer device synced).
  useEffect(() => on('group:updated', () => { if (ready) refresh() }), [ready, refresh])

  if (ready === null) return <div style={{ height: '100%' }} />
  if (!ready) return <Onboarding onReady={boot} />
  if (showDevices) return <Devices onClose={() => setShowDevices(false)} />

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: `calc(${spacing.xl}px + var(--pear-safe-top))`, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: colors.primary }}>PearPetal</div>
        <Btn kind='ghost' onClick={() => setShowDevices(true)}>Devices</Btn>
      </div>
      <DayEditor date={date} setDate={setDate} onSaved={refresh} />
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, margin: `0 0 ${spacing.sm}px ${spacing.xs}px` }}>Recent</div>
        <RecentDays days={days} onPick={setDate} />
      </div>
    </div>
  )
}
