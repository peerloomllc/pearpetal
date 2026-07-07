// PearPetal's signature UI: a flower that furls and blooms across the cycle,
// driven entirely by the on-device projection (phase + predicted dates). The
// petals re-geometry with cycle position - peaking (full bloom) around ovulation
// and closing toward the next period - so the dial encodes where you are.
//
// Pure geometry, no deps. Bloom-in animates on mount (respects reduced motion).

import { useEffect, useRef, useState } from 'react'
import { colors, radius } from './theme.js'

const CX = 160, CY = 160, R = 132, N = 8, PERIOD_LEN = 5
const CLOSED = [122, 16, 36], OPEN = [236, 139, 163], INNER = [242, 176, 193]

const rad = (deg) => (deg * Math.PI) / 180
const polar = (r, deg) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))]
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`
const petalPath = (len, wid) => `M0 0 C ${wid} ${-len * 0.34}, ${wid} ${-len * 0.72}, 0 ${-len} C ${-wid} ${-len * 0.72}, ${-wid} ${-len * 0.34}, 0 0 Z`
function isoDiff (a, b) { const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }; return Math.round((p(b) - p(a)) / 86400000) }
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

export default function PetalDial ({ pred, today, onTap }) {
  const known = !!pred?.known
  const L = known ? (pred.cycleLen || 28) : 28
  const dayOfCycle = known ? (pred.dayOfCycle || 1) : 1
  const dayDeg = (d) => -90 + ((d - 1) / L) * 360

  // Ovulation as a day-of-cycle (from the predicted date when known), and the
  // fertile arc around it.
  const ovDay = known
    ? clamp(dayOfCycle + (pred.ovulationEst ? isoDiff(today, pred.ovulationEst) : (L - 14 - dayOfCycle)), 2, L - 1)
    : L - 14
  const target = known ? bloomFor(dayOfCycle, ovDay, L) : 0.1

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
  const petalCol = mix(CLOSED, OPEN, b)
  const innerCol = mix(CLOSED, INNER, Math.min(1, b * 1.1))
  const spin = b * 10
  const glow = Math.max(0, (b - 0.55) / 0.45) * 0.9
  const [px, py] = polar(R, dayDeg(dayOfCycle))
  const ticks = Array.from({ length: L }, (_, i) => i + 1)

  return (
    <button onClick={onTap} aria-label='Open today' style={{ background: 'none', border: 'none', padding: 0, width: '100%', maxWidth: 320, margin: '0 auto', display: 'block', cursor: onTap ? 'pointer' : 'default' }}>
      <svg viewBox='0 0 320 320' style={{ width: '100%', height: 'auto', overflow: 'visible' }} aria-hidden='true'>
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
            return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke='rgba(255,255,255,0.06)' strokeWidth={(d - 1) % 7 === 0 ? 1.4 : 0.7} />
          })}
        </g>
        <g transform={`translate(${CX},${CY})`}>
          {Array.from({ length: N }, (_, i) => (
            <path key={'o' + i} d={petalPath(26 + 64 * b, 8 + 27 * b)} fill={petalCol} transform={`rotate(${(i * 360) / N + spin})`} />
          ))}
          {Array.from({ length: N }, (_, i) => (
            <path key={'i' + i} d={petalPath(17 + 40 * b, 6 + 18 * b)} fill={innerCol} opacity={(0.35 + 0.65 * b).toFixed(2)} transform={`rotate(${(i * 360) / N + 180 / N - spin})`} />
          ))}
          <circle cx={0} cy={0} r={(19 - 9 * b).toFixed(1)} fill={mix([90, 12, 28], [201, 56, 79], b)} />
          <circle cx={0} cy={-2} r={(7 - 4 * b).toFixed(1)} fill='rgba(255,255,255,0.25)' />
        </g>
        {known && <circle cx={px} cy={py} r={7} fill={colors.surface.base} stroke={colors.accent} strokeWidth={2.5} />}
      </svg>
    </button>
  )
}

export { bloomFor }
