// Flower species for the petal dial. Each is a parametric petal PROFILE plugged
// into the same furl-and-bloom engine, not an image - so every species animates
// across the cycle the same way. Shape varies per species; color still follows
// the phase (deep crimson closed -> the species' rose when open), tinted toward
// each flower's natural hue, so the dial keeps encoding the phase. Which flower
// is a device-local pref (prefs.flower); it never crosses the wire.

const CLOSED = [122, 16, 36] // shared "furled / menstrual" crimson

const lerp = (a, b, t) => a + (b - a) * t
const rgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`
const mix = (c1, c2, t) => rgb([lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)])
const lighten = (c, t) => [lerp(c[0], 255, t), lerp(c[1], 255, t), lerp(c[2], 255, t)]

// Petal silhouettes, all pointing "up" from the origin (tip at 0,-len).
const SHAPES = {
  round: (len, wid) => `M0 0 C ${wid} ${-len * 0.34}, ${wid} ${-len * 0.72}, 0 ${-len} C ${-wid} ${-len * 0.72}, ${-wid} ${-len * 0.34}, 0 0 Z`,
  broad: (len, wid) => `M0 0 C ${wid * 1.35} ${-len * 0.28}, ${wid * 1.2} ${-len * 0.78}, 0 ${-len} C ${-wid * 1.2} ${-len * 0.78}, ${-wid * 1.35} ${-len * 0.28}, 0 0 Z`,
  pointed: (len, wid) => `M0 0 C ${wid} ${-len * 0.42}, ${wid * 0.45} ${-len * 0.86}, 0 ${-len} C ${-wid * 0.45} ${-len * 0.86}, ${-wid} ${-len * 0.42}, 0 0 Z`,
  // Heart-notched tip (cherry blossom): two lobes with a dip in the middle.
  notched: (len, wid) => `M0 0 C ${wid} ${-len * 0.3}, ${wid} ${-len * 0.78}, ${wid * 0.42} ${-len * 0.96} C ${wid * 0.22} ${-len * 1.03}, ${wid * 0.08} ${-len * 0.92}, 0 ${-len * 0.82} C ${-wid * 0.08} ${-len * 0.92}, ${-wid * 0.22} ${-len * 1.03}, ${-wid * 0.42} ${-len * 0.96} C ${-wid} ${-len * 0.78}, ${-wid} ${-len * 0.3}, 0 0 Z`,
}

// Each species: petal shape, one or more radial layers (count + size scale +
// angular offset), the open-state color, and center styling. Curated to the
// warm pink-to-red family so the phase color-gradient still reads.
const FLOWERS = {
  rose: {
    label: 'Rose', shape: 'round', open: [236, 139, 163], center: [201, 56, 79],
    layers: [{ count: 8, len: 1, wid: 1 }, { count: 8, len: 0.72, wid: 0.78, off: 0.5 }, { count: 6, len: 0.5, wid: 0.62, off: 0.25 }],
  },
  sakura: {
    label: 'Cherry blossom', shape: 'notched', open: [245, 194, 209], center: [232, 150, 172], centerScale: 0.7,
    layers: [{ count: 5, len: 1, wid: 1.05 }],
  },
  lotus: {
    label: 'Lotus', shape: 'pointed', open: [236, 168, 200], center: [236, 120, 152],
    layers: [{ count: 8, len: 1, wid: 0.92 }, { count: 8, len: 0.68, wid: 0.7, off: 0.5 }],
  },
  poppy: {
    label: 'Poppy', shape: 'broad', open: [226, 66, 66], closed: [120, 18, 20], center: [26, 18, 22], centerFixed: true, centerScale: 0.85,
    layers: [{ count: 4, len: 1, wid: 1.5 }],
  },
  dahlia: {
    label: 'Dahlia', shape: 'pointed', open: [214, 96, 142], center: [190, 60, 112], centerScale: 0.7,
    layers: [{ count: 14, len: 1, wid: 0.5 }, { count: 14, len: 0.72, wid: 0.44, off: 0.5 }, { count: 10, len: 0.5, wid: 0.42, off: 0.25 }],
  },
}

const FLOWER_KEYS = Object.keys(FLOWERS)
const DEFAULT_FLOWER = 'rose'
const flowerLabel = (key) => (FLOWERS[key] || FLOWERS[DEFAULT_FLOWER]).label

// Build the flower's render data at a given bloom (0..1). `base` scales the whole
// flower (petal length/width baseline) so thumbnails can render smaller.
function buildFlower (key, b, base = 1) {
  const f = FLOWERS[key] || FLOWERS[DEFAULT_FLOWER]
  const closed = f.closed || CLOSED
  const innerTint = lighten(f.open, 0.18)
  const shape = SHAPES[f.shape] || SHAPES.round
  const spin = b * 10
  const petals = []
  f.layers.forEach((L, li) => {
    const step = 360 / L.count
    const len = (26 + 64 * b) * (L.len ?? 1) * base
    const wid = (8 + 27 * b) * (L.wid ?? 1) * base
    const d = shape(len, wid)
    const isInner = li > 0
    const fill = mix(closed, isInner ? innerTint : f.open, b)
    const opacity = isInner ? Number((0.35 + 0.65 * b).toFixed(2)) : 1
    for (let i = 0; i < L.count; i++) {
      const ang = i * step + (L.off || 0) * step + (isInner ? -spin : spin)
      petals.push({ d, fill, opacity, transform: `rotate(${ang})` })
    }
  })
  const center = {
    r: Number(((19 - 9 * b) * (f.centerScale || 1) * base).toFixed(1)),
    fill: f.centerFixed ? rgb(f.center) : mix([90, 12, 28], f.center, b),
  }
  const centerHi = { r: Number(((7 - 4 * b) * base).toFixed(1)) }
  return { petals, center, centerHi }
}

module.exports = { FLOWERS, FLOWER_KEYS, DEFAULT_FLOWER, flowerLabel, buildFlower }
