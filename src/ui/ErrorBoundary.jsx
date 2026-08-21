// Last line of defence for the UI bundle.
//
// React unmounts the whole tree when a render throws, which left #root empty and
// the app showing nothing but its background colour - the same blank screen a
// stalled engine produced, and just as impossible to report. Anything that gets
// here is a bug, but the person holding the phone should still see words, and we
// should get the message back.
//
// Also catches errors that never reach React at all (a throw in an async handler,
// an unhandled rejection), which would otherwise be completely invisible.

import { Component } from 'react'
import { colors, spacing, radius, FONT, MONO } from './theme.js'

export default class ErrorBoundary extends Component {
  constructor (props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  componentDidCatch (error, info) {
    // Console only. There is no crash reporter and there is not going to be one:
    // a cycle tracker that phones home about anything is the thing this app exists
    // not to be. The text on screen is how a report reaches us.
    console.error('[pearpetal] ui crashed', error, info && info.componentStack)
  }

  render () {
    const { error } = this.state
    if (!error) return this.props.children
    const detail = [error.message || String(error), error.stack].filter(Boolean).join('\n').slice(0, 1200)
    return (
      <div style={{ fontFamily: FONT, background: colors.surface.base, color: colors.text.primary, minHeight: '100%', padding: spacing.xl, paddingTop: `calc(${spacing.xl}px + var(--pear-safe-top, 0px))`, display: 'flex', flexDirection: 'column', gap: spacing.base }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ color: colors.text.secondary, fontSize: 14, lineHeight: 1.6 }}>
          PearPetal hit a problem drawing this screen. Your cycle data is safe on this phone and nothing has been deleted.
        </div>
        <button
          onClick={() => { try { window.location.reload() } catch { this.setState({ error: null }) } }}
          style={{ appearance: 'none', border: 'none', borderRadius: radius.xl, padding: `${spacing.md}px ${spacing.lg}px`, background: colors.primary, color: colors.text.onPrimary, fontSize: 15, fontWeight: 600, fontFamily: FONT }}
        >
          Reload the app
        </button>
        <div style={{ color: colors.text.muted, fontSize: 13, lineHeight: 1.6 }}>
          If reloading does not help, send us the text below and we will fix it.
        </div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: colors.surface.card, border: `1px solid ${colors.border}`, borderRadius: radius.lg, padding: spacing.md, color: colors.text.muted, font: `12px/1.5 ${MONO}` }}>{detail}</pre>
      </div>
    )
  }
}
