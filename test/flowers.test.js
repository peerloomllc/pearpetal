const test = require('node:test')
const assert = require('node:assert/strict')
const { FLOWERS, FLOWER_KEYS, DEFAULT_FLOWER, flowerLabel, buildFlower } = require('../src/ui/flowers.js')

test('the five curated species are present with the required config', () => {
  assert.deepEqual(FLOWER_KEYS, ['rose', 'sakura', 'lotus', 'poppy', 'dahlia'])
  assert.equal(DEFAULT_FLOWER, 'rose')
  for (const k of FLOWER_KEYS) {
    const f = FLOWERS[k]
    assert.ok(typeof f.label === 'string' && f.label.length)
    assert.ok(Array.isArray(f.layers) && f.layers.length >= 1)
    assert.ok(Array.isArray(f.open) && f.open.length === 3)
  }
})

test('buildFlower returns valid SVG petals for every species', () => {
  for (const k of FLOWER_KEYS) {
    const fl = buildFlower(k, 0.8)
    const expected = FLOWERS[k].layers.reduce((n, L) => n + L.count, 0)
    assert.equal(fl.petals.length, expected, `${k} petal count`)
    for (const p of fl.petals) {
      assert.ok(p.d.startsWith('M'), `${k} path starts with M`)
      assert.ok(/^rgb\(/.test(p.fill), `${k} fill is rgb()`)
      assert.ok(/^rotate\(/.test(p.transform), `${k} transform is a rotate`)
    }
    assert.ok(fl.center.r >= 0 && /^rgb\(/.test(fl.center.fill))
  }
})

test('petals grow with bloom (furled < bloomed)', () => {
  // A furled rose petal path should describe a shorter petal than a bloomed one.
  const furled = buildFlower('rose', 0.06).petals[0].d
  const bloomed = buildFlower('rose', 1).petals[0].d
  const tipY = (d) => Math.min(...[...d.matchAll(/-?\d+\.?\d*/g)].map(Number))
  assert.ok(tipY(bloomed) < tipY(furled), 'bloomed petal reaches farther from center')
})

test('unknown species falls back to the default without throwing', () => {
  const fl = buildFlower('orchid-not-real', 0.5)
  assert.equal(fl.petals.length, buildFlower('rose', 0.5).petals.length)
  assert.equal(flowerLabel('orchid-not-real'), FLOWERS.rose.label)
})
