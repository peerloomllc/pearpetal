import { createRoot } from 'react-dom/client'
import { injectGlobalStyles, applyThemePref, loadThemePref } from './theme.js'
import ErrorBoundary from './ErrorBoundary.jsx'
import App from './App.jsx'

// Inject theme variables and apply the saved theme preference (resolving 'system'
// via matchMedia) before first paint so there is no flash.
injectGlobalStyles()
applyThemePref(loadThemePref())

// If the bundle itself fails to evaluate or the very first render throws, React
// never mounts and #root stays empty, which paints as a blank screen with no
// clue what happened. Put something readable on it instead. ErrorBoundary covers
// every render after this one.
const BOOT_AT = Date.now()
function fatal (what, err) {
  const msg = (err && (err.message || err.reason || err)) || 'unknown error'
  const root = document.getElementById('root')
  if (!root || root.firstChild) return // React mounted fine; leave the UI alone
  // Only ever in the boot window. A stray rejection much later (a background call
  // giving up while a sheet happens to be mid-transition) must not be allowed to
  // replace a working app with an error page.
  if (Date.now() - BOOT_AT > 15_000) return
  root.innerHTML =
    '<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#f4eef0;padding:32px 24px">' +
    '<div style="font-size:20px;font-weight:600;margin-bottom:12px">PearPetal could not open</div>' +
    '<div style="color:#c6b8bd">Your data is still on this phone. Close the app completely and open it again. If it keeps happening, send us this: </div>' +
    '<pre style="white-space:pre-wrap;word-break:break-word;background:#211a1d;border-radius:12px;padding:12px;color:#8f8288;font:12px/1.5 ui-monospace,monospace">' +
    String(what) + ': ' + String(msg).replace(/[&<>]/g, '') + '</pre></div>'
}
window.addEventListener('error', (e) => fatal('error', e && (e.error || e.message)))
window.addEventListener('unhandledrejection', (e) => fatal('unhandledrejection', e && e.reason))

try {
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
} catch (e) {
  fatal('mount', e)
}
