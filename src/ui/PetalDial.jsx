// PearPetal's signature UI: a flower that furls and blooms across the cycle,
// driven entirely by the on-device projection (phase + predicted dates). The
// petals re-geometry with cycle position - peaking (full bloom) around ovulation
// and closing toward the next period - so the dial encodes where you are.
//
// Pure geometry, no deps. Bloom-in animates on mount (respects reduced motion).

import { useEffect, useRef, useState } from 'react'
import { colors } from './theme.js'
import { buildFlower } from './flowers.js'

const CX = 160, CY = 160, R = 132, PERIOD_LEN = 5

const rad = (deg) => (deg * Math.PI) / 180
const polar = (r, deg) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))]
function isoDiff (a, b) { const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }; return Math.round((p(b) - p(a)) / 86400000) }
function addDaysIso (iso, n) { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); const p = (x) => String(x).padStart(2, '0'); return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// Bloom curve: rises to a peak at ovulation, falls toward the next period.
function bloomFor (d, ovDay, L) {
  const b = d <= ovDay ? 0.06 + 0.94 * ((d - 1) / Math.max(1, ovDay - 1)) : 1 - 0.82 * ((d - ovDay) / Math.max(1, L - ovDay))
  return clamp(b, 0.06, 1)
}

function arcPath (r, degA, degB) {
  const [x1, y1] = polar(r, degA), [x2, y2] = polar(r, degB)
  const large = ((degB - degA) % 360) > 180 ? 1 : 0
  return `M${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

export default function PetalDial ({ pred, today, flower = 'rose', onTap, onDayTap, selected }) {
  const known = !!pred?.known
  const L = known ? (pred.cycleLen || 28) : 28
  const dayOfCycle = known ? (pred.dayOfCycle || 1) : 1
  const dayDeg = (d) => -90 + ((d - 1) / L) * 360

  // Interaction. onDayTap(dateIso) fires when a day on the ring is tapped (the
  // angle of the tap maps to a cycle day -> its calendar date); a tap near the
  // center means today. onTap is the simpler "open today" fallback. Neither ->
  // the dial is display-only (e.g. the partner view).
  const interactive = !!(onTap || onDayTap)
  const dragging = useRef(false)
  const lastDay = useRef(null)
  // Map a pointer position on the dial to a cycle day: the angle picks the day
  // (near the center means today).
  const posToDay = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width * 320
    const y = (e.clientY - rect.top) / rect.height * 320
    const dx = x - CX; const dy = y - CY
    if (Math.hypot(dx, dy) < 46) return dayOfCycle
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    return clamp(Math.round((((ang + 90) % 360 + 360) % 360) / 360 * L) + 1, 1, L)
  }
  // Only fire when the day actually changes, so a fast drag does not spam the
  // editor's per-day fetch.
  const fire = (e) => {
    const day = posToDay(e)
    if (day === lastDay.current) return
    lastDay.current = day
    onDayTap(addDaysIso(today, day - dayOfCycle))
  }
  // Tap OR press-and-drag: pointerdown starts, moves scrub live (the marker + date
  // follow the finger), release commits wherever it ends. A plain tap is just a
  // down with no move.
  const onDown = (e) => {
    if (!interactive) return
    if (!onDayTap) { onTap && onTap(); return }
    dragging.current = true; lastDay.current = null
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    fire(e)
  }
  const onMove = (e) => { if (dragging.current && onDayTap) fire(e) }
  const endDrag = (e) => { dragging.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {} }

  // Ovulation as a day-of-cycle (from the predicted date when known), and the
  // fertile arc around it.
  const ovDay = known
    ? clamp(dayOfCycle + (pred.ovulationEst ? isoDiff(today, pred.ovulationEst) : (L - 14 - dayOfCycle)), 2, L - 1)
    : L - 14
  // The dial - marker AND bloom - reflects the SELECTED day (the one being viewed /
  // edited), defaulting to today. So scrubbing the ring furls and blooms the flower
  // across the cycle (peak bloom at ovulation), not just moving the marker.
  const selDay = (known && selected) ? clamp(dayOfCycle + isoDiff(today, selected), 1, L) : dayOfCycle
  const target = known ? bloomFor(selDay, ovDay, L) : 0.1

  const [bloom, setBloom] = useState(0.06)
  const raf = useRef(0)
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setBloom(target); return }
    const from = bloom, start = performance.now(), dur = 720
    cancelAnimationFrame(raf.current)
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - k, 3)
      setBloom(from + (target - from) * e)
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const b = bloom
  const fl = buildFlower(flower, b)
  const glow = Math.max(0, (b - 0.55) / 0.45) * 0.9
  // The prominent marker sits on the selected day; a small pip stays at today once
  // you have scrubbed away, to keep your bearings.
  const [px, py] = polar(R, dayDeg(selDay))
  const [tpx, tpy] = polar(R, dayDeg(dayOfCycle))
  const ticks = Array.from({ length: L }, (_, i) => i + 1)

  return (
    <div style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}>
      <svg onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} viewBox='0 0 320 320' role={interactive ? 'button' : 'img'} aria-label={onDayTap ? 'Tap or drag a day on the ring to log it' : (interactive ? 'Open today' : 'Cycle dial')} style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: interactive ? 'pointer' : 'default', touchAction: onDayTap ? 'none' : 'auto' }}>
        <defs>
          <radialGradient id='petalGlow' cx='50%' cy='50%' r='50%'>
            <stop offset='0%' stopColor={colors.primary} stopOpacity='0.55' />
            <stop offset='60%' stopColor={colors.primary} stopOpacity='0.10' />
            <stop offset='100%' stopColor={colors.primary} stopOpacity='0' />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={120} fill='url(#petalGlow)' opacity={glow} />
        <circle cx={CX} cy={CY} r={R} fill='none' stroke={colors.track} strokeWidth={10} />
        {known && <path d={arcPath(R, dayDeg(1), dayDeg(PERIOD_LEN))} fill='none' stroke={colors.flow.medium} strokeWidth={10} strokeLinecap='round' />}
        {known && <path d={arcPath(R, dayDeg(ovDay - 5), dayDeg(ovDay + 1))} fill='none' stroke={colors.primary} strokeWidth={10} strokeLinecap='round' opacity={0.9} />}
        <g>
          {ticks.map((d) => {
            const [x1, y1] = polar(R - 6, dayDeg(d)), [x2, y2] = polar(R + 6, dayDeg(d))
            return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={(d - 1) % 7 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)'} strokeWidth={(d - 1) % 7 === 0 ? 1.6 : 0.9} />
          })}
        </g>
        <g transform={`translate(${CX},${CY})`}>
          {fl.petals.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill} opacity={p.opacity} transform={p.transform} />
          ))}
          <circle cx={0} cy={0} r={fl.center.r} fill={fl.center.fill} />
          <circle cx={0} cy={-2} r={fl.centerHi.r} fill='rgba(255,255,255,0.25)' />
        </g>
        {known && selDay !== dayOfCycle && <circle cx={tpx} cy={tpy} r={3.5} fill={colors.primary} />}
        {known && <circle cx={px} cy={py} r={7} fill={colors.surface.base} stroke={colors.accent} strokeWidth={2.5} />}
      </svg>
    </div>
  )
}

// Gestational dial for pregnancy mode: a 40-week progress ring with the flower
// blooming as the pregnancy advances (full bloom near term), plus trimester marks.
// Display-only. Reuses the same geometry + species flowers as the cycle dial.
export function PregnancyDial ({ progress = 0, weeks = 0, days = 0, flower = 'rose' }) {
  const p = clamp(progress, 0, 1)
  const bloom = 0.12 + 0.88 * p
  const [bl, setBl] = useState(0.06)
  const raf = useRef(0)
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setBl(bloom); return undefined }
    const from = bl, start = performance.now(), dur = 720
    cancelAnimationFrame(raf.current)
    const step = (t) => { const k = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - k, 3); setBl(from + (bloom - from) * e); if (k < 1) raf.current = requestAnimationFrame(step) }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bloom])
  const fl = buildFlower(flower, bl)
  const glow = Math.max(0, (bl - 0.55) / 0.45) * 0.9
  const arcEnd = -90 + Math.min(0.9999, p) * 360
  const triDeg = (wk) => -90 + (wk / 40) * 360
  return (
    <div style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}>
      <svg viewBox='0 0 320 320' role='img' aria-label={`${weeks} weeks ${days} days pregnant`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          <radialGradient id='pregGlow' cx='50%' cy='50%' r='50%'>
            <stop offset='0%' stopColor={colors.primary} stopOpacity='0.55' />
            <stop offset='60%' stopColor={colors.primary} stopOpacity='0.10' />
            <stop offset='100%' stopColor={colors.primary} stopOpacity='0' />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={120} fill='url(#pregGlow)' opacity={glow} />
        <circle cx={CX} cy={CY} r={R} fill='none' stroke={colors.track} strokeWidth={10} />
        {p > 0.002 && <path d={arcPath(R, -90, arcEnd)} fill='none' stroke={colors.primary} strokeWidth={10} strokeLinecap='round' />}
        {[14, 28].map((wk) => { const [x1, y1] = polar(R - 7, triDeg(wk)), [x2, y2] = polar(R + 7, triDeg(wk)); return <line key={wk} x1={x1} y1={y1} x2={x2} y2={y2} stroke='rgba(255,255,255,0.5)' strokeWidth={1.6} /> })}
        <g transform={`translate(${CX},${CY})`}>
          {fl.petals.map((pt, i) => <path key={i} d={pt.d} fill={pt.fill} opacity={pt.opacity} transform={pt.transform} />)}
          <circle cx={0} cy={0} r={fl.center.r} fill={fl.center.fill} />
          <circle cx={0} cy={-2} r={fl.centerHi.r} fill='rgba(255,255,255,0.25)' />
        </g>
        <text x={CX} y={CY - 148} textAnchor='middle' fill={colors.text.muted} fontSize={11}>week {weeks}</text>
      </svg>
    </div>
  )
}

// A small static thumbnail of a species at a fixed bloom, for the flower picker.
export function FlowerThumb ({ flower, size = 56, bloom = 0.85 }) {
  const fl = buildFlower(flower, bloom, 0.62)
  return (
    <svg viewBox='0 0 100 100' width={size} height={size} aria-hidden='true'>
      <g transform='translate(50,50)'>
        {fl.petals.map((p, i) => <path key={i} d={p.d} fill={p.fill} opacity={p.opacity} transform={p.transform} />)}
        <circle cx={0} cy={0} r={fl.center.r} fill={fl.center.fill} />
      </g>
    </svg>
  )
}

export { bloomFor, isoDiff, addDaysIso }
