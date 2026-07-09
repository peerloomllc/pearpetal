import { createRoot } from 'react-dom/client'
import { injectGlobalStyles, applyThemePref, loadThemePref } from './theme.js'
import App from './App.jsx'

// Inject theme variables and apply the saved theme preference (resolving 'system'
// via matchMedia) before first paint so there is no flash.
injectGlobalStyles()
applyThemePref(loadThemePref())

createRoot(document.getElementById('root')).render(<App />)
