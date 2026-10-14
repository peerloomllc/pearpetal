// The partner's copy of the owner's day count moves on by itself between her
// writes (reported 2026-10-12: his screen sat days behind hers). See
// src/partnerFresh.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const { freshPartnerPhase } = require('../src/partnerFresh')
const { addDays } = require('../src/prediction')

// Noon local time on an ISO date, so the written-on date is unambiguous.
const at = (iso) => new Date(iso + 'T12:00:00').getTime()

test('the day count moves on by the days since she last wrote', () => {
  const phase = { phase: 'follicular', dayOfCycle: 12, updatedAt: at('2026-10-09') }
  const predict = { nextPeriodStart: '2026-10-26' }
  const r = freshPartnerPhase(phase, predict, '2026-10-12')
  assert.equal(r.phase.dayOfCycle, 15)
  assert.equal(r.phase.advancedBy, 3)
  assert.equal(r.phase.phase, 'follicular') // phase-only share: name stands
  assert.equal(r.predict.nextPeriodStart, '2026-10-26')
})

test('written today: returned as it is', () => {
  const phase = { phase: 'luteal', dayOfCycle: 20, updatedAt: at('2026-10-12') }
  const r = freshPartnerPhase(phase, null, '2026-10-12')
  assert.equal(r.phase, phase)
})

test('no timestamp or no day count: returned as it is', () => {
  const a = { phase: 'luteal', dayOfCycle: 20 }
  assert.equal(freshPartnerPhase(a, null, '2026-10-12').phase, a)
  const b = { phase: 'follicular', dayOfCycle: null, updatedAt: at('2026-10-01') }
  assert.equal(freshPartnerPhase(b, null, '2026-10-12').phase, b)
})

test('with the fertile window shared, the phase name is recomputed', () => {
  // Cycle started 2026-10-01 (day 1), 28 days: next 10-29, ovulation 10-15.
  const phase = { phase: 'follicular', dayOfCycle: 8, updatedAt: at('2026-10-08') }
  const predict = { nextPeriodStart: '2026-10-29', ovulationEst: '2026-10-15', fertileStart: '2026-10-10', fertileEnd: '2026-10-16' }
  assert.equal(freshPartnerPhase(phase, predict, '2026-10-12').phase.phase, 'fertile')
  assert.equal(freshPartnerPhase(phase, predict, '2026-10-20').phase.phase, 'luteal')
  assert.equal(freshPartnerPhase(phase, predict, '2026-10-09').phase.phase, 'follicular')
})

test('a period showing ends after the default length', () => {
  const phase = { phase: 'menstrual', dayOfCycle: 2, updatedAt: at('2026-10-02') }
  const predict = { nextPeriodStart: '2026-10-29', ovulationEst: '2026-10-15', fertileStart: '2026-10-10', fertileEnd: '2026-10-16' }
  assert.equal(freshPartnerPhase(phase, predict, '2026-10-04').phase.phase, 'menstrual')
  assert.equal(freshPartnerPhase(phase, predict, '2026-10-07').phase.phase, 'follicular')
})

test('past the predicted period it rolls into a new predicted cycle, like her own screen', () => {
  // Day 20 on 10-20 with the next period 10-29 means a 28-day cycle from 10-01.
  const phase = { phase: 'luteal', dayOfCycle: 20, updatedAt: at('2026-10-20') }
  const predict = { nextPeriodStart: '2026-10-29', ovulationEst: '2026-10-15', fertileStart: '2026-10-10', fertileEnd: '2026-10-16' }
  const r = freshPartnerPhase(phase, predict, '2026-10-31')
  assert.equal(r.phase.dayOfCycle, 3)
  assert.equal(r.phase.phase, 'menstrual')
  assert.equal(r.predict.nextPeriodStart, addDays('2026-10-29', 28))
  assert.equal(r.predict.ovulationEst, addDays('2026-10-15', 28))
  assert.equal(r.predict.rolled, undefined)
  // The stored copy is not changed.
  assert.equal(predict.nextPeriodStart, '2026-10-29')
})
