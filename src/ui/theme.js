// PearPetal design tokens. Suite conventions (CSS variables under [data-theme],
// spacing/radius scales), with a soft floral palette (rose primary) instead of
// PearList's green. Dark is the default. Font is Manrope (embedded via fonts.js),
// matching the rest of the PeerLoom suite: body weight 300, headings 500/600.

import { FONT_CSS } from './fonts.js'

export const FONT = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif"
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const spacing = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 }
export const radius = { sm: 4, md: 8, lg: 10, xl: 14, sheet: 20, full: 9999 }

const v = (n) => `var(--color-${n})`
export const colors = {
  primary: v('primary'), primaryDark: v('primary-dark'), accent: v('accent'),
  error: v('error'), warn: v('warn'), success: v('success'),
  text: { primary: v('text-primary'), secondary: v('text-secondary'), muted: v('text-muted'), onPrimary: v('text-on-primary') },
  surface: { base: v('surface-base'), card: v('surface-card'), elevated: v('surface-elevated'), input: v('surface-input') },
  border: v('border'), divider: v('divider'), track: v('track'),
  // Flow intensity ramp (menstrual reds), reused by the day log dots.
  flow: { spotting: '#e8a0b0', light: '#e06377', medium: '#c8384f', heavy: '#96122b' },
}

const THEME_VARS = `
:root, :root[data-theme="dark"]{
  --color-primary:#e8859b; --color-primary-dark:#c85c74; --color-accent:#c9a0d8;
  --color-error:#ef5350; --color-warn:#ffb74d; --color-success:#7ec77a;
  --color-text-primary:#f4eef0; --color-text-secondary:#c6b8bd; --color-text-muted:#8f8288; --color-text-on-primary:#2a1119;
  --color-surface-base:#140f11; --color-surface-card:#211a1d; --color-surface-elevated:#2c2328; --color-surface-input:#241c20;
  --color-border:#42353a; --color-divider:#352a2e; --color-track:#4a3b41;
}
:root[data-theme="light"]{
  --color-primary:#c85c74; --color-primary-dark:#a63e57; --color-accent:#8a5aa0;
  --color-error:#c62828; --color-warn:#b8730f; --color-success:#2e7d32;
  --color-text-primary:#241a1d; --color-text-secondary:#5a4a4f; --color-text-muted:#8a7a80; --color-text-on-primary:#ffffff;
  --color-surface-base:#faf4f5; --color-surface-card:#ffffff; --color-surface-elevated:#f2e9eb; --color-surface-input:#f3eaec;
  --color-border:#e2d3d7; --color-divider:#ece0e3; --color-track:#d8c7cc;
}`

const RESET = `
:root{--pear-safe-top:env(safe-area-inset-top,0px);--pear-safe-bottom:env(safe-area-inset-bottom,0px);--pear-safe-left:env(safe-area-inset-left,0px);--pear-safe-right:env(safe-area-inset-right,0px)}
*,*::before,*::after{box-sizing:border-box}
*{-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
html,body,#root{height:100%;margin:0}
/* scrollIntoView keeps clear of the status bar (top) and the fixed bottom nav
   (bottom), so an expanded section is never tucked behind the nav bar. */
html,body,#root{scroll-padding-top:calc(var(--pear-safe-top) + 8px);scroll-padding-bottom:calc(76px + var(--pear-safe-bottom))}
body,#root{background:var(--color-surface-base)}
body{color:var(--color-text-primary);font-family:${FONT};font-weight:300;-webkit-font-smoothing:antialiased}
input,textarea{-webkit-user-select:text;user-select:text;font-size:16px;font-family:${FONT};font-weight:300}
button{font-family:${FONT};cursor:pointer;transition:transform 120ms cubic-bezier(0.2,0,0,1)}
button:active{transform:scale(0.97)}
@keyframes pearpetal-spin{to{transform:rotate(360deg)}}
@keyframes pearpetal-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

export function injectGlobalStyles () {
  if (typeof document === 'undefined') return
  if (document.getElementById('pearpetal-styles')) return
  const el = document.createElement('style')
  el.id = 'pearpetal-styles'
  el.textContent = FONT_CSS + THEME_VARS + RESET
  document.head.appendChild(el)
}

const THEME_KEY = 'pearpetal:theme'
export function setTheme (mode) {
  if (typeof document === 'undefined') return
  const m = mode === 'light' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', m)
  try { localStorage.setItem(THEME_KEY, m) } catch {}
}
export function loadTheme () {
  try { const s = localStorage.getItem(THEME_KEY); if (s === 'light' || s === 'dark') return s } catch {}
  return 'dark'
}
