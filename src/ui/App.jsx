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
import PetalDial, { FlowerThumb } from './PetalDial.jsx'
import { FLOWER_KEYS, flowerLabel } from './flowers.js'

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
function Onboarding ({ onReady, onViewerReady }) {
  const [mode, setMode] = useState(null) // null | 'link' | 'partner'
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
  const joinPartner = async () => {
    setErr('')
    try { await call('partner:join', { inviteKey: code.trim() }); haptic('success'); onViewerReady() } catch (e) { setErr(e.message) }
  }
  const scan = async () => {
    try { const r = await call('shell:scanQr'); if (r?.code) setCode(r.code) } catch {}
  }
  const back = () => { setMode(null); setErr(''); setCode('') }

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
            <Btn onClick={mode === 'link' ? link : joinPartner} style={{ flex: 1 }}>{mode === 'link' ? 'Link this device' : 'View their cycle'}</Btn>
            <Btn kind='ghost' onClick={scan}>Scan</Btn>
          </div>
          <Btn kind='ghost' onClick={back}>Back</Btn>
        </div>
      )}
      {err && <div style={{ color: colors.error, textAlign: 'center', fontSize: 14 }}>{err}</div>}
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
  const load = async () => {
    setShares(await call('share:list').catch(() => []))
    setPartners(await call('partner:list').catch(() => []))
  }
  useEffect(() => { load() }, [])
  const create = async () => {
    setErr('')
    try { await call('share:create', { scope }); haptic('success'); load() } catch (e) { setErr(e.message) }
  }
  const revoke = async (groupId) => { try { await call('share:revoke', { groupId }); haptic('warn'); load() } catch (e) { setErr(e.message) } }
  const copy = async (code) => { try { await navigator.clipboard.writeText(code); haptic('success') } catch { call('shell:share', { text: code }).catch(() => {}) } }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Sharing</div>
        <Btn kind='ghost' onClick={onClose}>Done</Btn>
      </div>

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
                  <Btn kind='ghost' onClick={() => copy(s.inviteKey)} style={{ padding: '6px 10px', fontSize: 13 }}>Copy code</Btn>
                  <Btn kind='ghost' onClick={() => revoke(s.groupId)} style={{ padding: '6px 10px', fontSize: 13, color: colors.error }}>Revoke</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {partners.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>Shared with you</div>
          {partners.map((p) => (
            <button key={p.groupId} onClick={() => onOpenPartner(p.groupId)} style={{ ...card, padding: spacing.md, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: colors.text.primary, fontWeight: 500 }}>A partner's cycle</span>
              <span style={{ color: colors.text.muted, fontSize: 12 }}>{p.scope || '...'} ›</span>
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
  const leave = async () => { try { await call('partner:leave', { groupId }); onLeft() } catch (e) { setErr(e.message) } }

  const phase = data?.phase
  const predict = data?.predict
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Partner's cycle</div>
        <Btn kind='ghost' onClick={onClose}>Back</Btn>
      </div>
      {!data && !err && <div style={{ color: colors.text.muted, textAlign: 'center', padding: spacing.lg }}>Waiting for their device to sync...</div>}
      {data && (
        <>
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
function Row ({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: colors.text.secondary, fontSize: 14 }}>{label}</span>
      <span style={{ color: colors.text.primary, fontWeight: 500 }}>{value}</span>
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

// --- viewer-only home (a device that only watches partners, no own cycle) ---
function ViewerHome ({ onOpenPartner, onBecomeOwner }) {
  const [partners, setPartners] = useState([])
  const load = async () => setPartners(await call('partner:list').catch(() => []))
  useEffect(() => { load() }, [])
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: `calc(${spacing.xl}px + var(--pear-safe-top))`, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: colors.primary }}>PearPetal</div>
      <div style={{ fontSize: 13, color: colors.text.muted, marginLeft: spacing.xs }}>Shared with you</div>
      {partners.map((p) => (
        <button key={p.groupId} onClick={() => onOpenPartner(p.groupId)} style={{ ...card, padding: spacing.md, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: colors.text.primary, fontWeight: 500 }}>A partner's cycle</span>
          <span style={{ color: colors.text.muted, fontSize: 12 }}>{p.scope || '...'} ›</span>
        </button>
      ))}
      <Btn kind='ghost' onClick={onBecomeOwner}>Start tracking my own cycle</Btn>
    </div>
  )
}

// --- cycle summary (owner's own prediction) ---------------------------------
const PHASE_COLOR = { menstrual: '#c8384f', follicular: '#c9a0d8', fertile: '#e8859b', luteal: '#8f8288' }
function fmtDate (iso) { try { return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }

function CycleSummary ({ pred, today, flower, onSettings, onTapDial }) {
  if (!pred) return null
  const days = pred.daysUntilNextPeriod
  const nextLabel = days <= 0 ? 'expected now' : days === 1 ? 'in 1 day' : `in ${days} days`
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: spacing.md, alignItems: 'stretch' }}>
      <PetalDial pred={pred} today={today} flower={flower} onTap={onTapDial} />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, borderTop: `1px solid ${colors.divider}`, paddingTop: spacing.md }}>
            <Row label='Next period' value={`${fmtDate(pred.nextPeriodStart)} · ${nextLabel}`} />
            <Row label='Fertile window' value={`${fmtDate(pred.fertileStart)} - ${fmtDate(pred.fertileEnd)}`} />
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

function CycleSettings ({ onClose, onSaved, onFlower }) {
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
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Cycle settings</div>
        <Btn kind='ghost' onClick={onClose}>Done</Btn>
      </div>
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
          {[['track', 'General'], ['conceive', 'Trying to conceive'], ['avoid', 'Avoiding pregnancy']].map(([k, l]) => (
            <Chip key={k} active={(prefs.goal || 'track') === k} onClick={() => save({ goal: k })}>{l}</Chip>
          ))}
        </div>
        <div style={{ color: colors.text.muted, fontSize: 11 }}>PearPetal is not contraception. Do not rely on it to avoid pregnancy.</div>
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
export default function App () {
  const [mode, setMode] = useState(null) // null (loading) | 'onboard' | 'owner' | 'viewer'
  const [screen, setScreen] = useState('main') // 'main' | 'devices' | 'share'
  const [partnerGroup, setPartnerGroup] = useState(null)
  const [date, setDate] = useState(todayIso())
  const [days, setDays] = useState([])
  const [pred, setPred] = useState(null)
  const [flower, setFlower] = useState('rose')

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

  if (mode === null) return <div style={{ height: '100%' }} />
  if (mode === 'onboard') return <Onboarding onReady={boot} onViewerReady={boot} />

  if (partnerGroup) return <PartnerView groupId={partnerGroup} onClose={() => setPartnerGroup(null)} onLeft={() => { setPartnerGroup(null); boot() }} />

  if (mode === 'viewer') return <ViewerHome onOpenPartner={setPartnerGroup} onBecomeOwner={async () => { await call('cycle:create').catch(() => {}); boot() }} />

  // owner
  if (screen === 'devices') return <Devices onClose={() => setScreen('main')} />
  if (screen === 'share') return <Sharing onClose={() => setScreen('main')} onOpenPartner={setPartnerGroup} />
  if (screen === 'settings') return <CycleSettings onClose={() => setScreen('main')} onSaved={refresh} onFlower={setFlower} />

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: spacing.xl, paddingTop: `calc(${spacing.xl}px + var(--pear-safe-top))`, display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: colors.primary }}>PearPetal</div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Btn kind='ghost' onClick={() => setScreen('share')}>Share</Btn>
          <Btn kind='ghost' onClick={() => setScreen('devices')}>Devices</Btn>
        </div>
      </div>
      <CycleSummary pred={pred} today={todayIso()} flower={flower} onSettings={() => setScreen('settings')} onTapDial={() => setDate(todayIso())} />
      <DayEditor date={date} setDate={setDate} onSaved={refresh} />
      <div>
        <div style={{ fontSize: 13, color: colors.text.muted, margin: `0 0 ${spacing.sm}px ${spacing.xs}px` }}>Recent</div>
        <RecentDays days={days} onPick={setDate} />
      </div>
    </div>
  )
}
