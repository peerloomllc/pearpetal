// Build the WebView UI bundle, and also emit a single self-contained
// assets/index.html (JS inlined) so the design preview opens from anywhere over
// file:// with no separate-file or MIME pitfalls. The shell inlines
// assets/app-ui.bundle itself (see app/index.tsx); this index.html is only the
// browser preview.

import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'

await build({
  entryPoints: ['src/ui/main.jsx'],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: 'assets/app-ui.bundle',
  legalComments: 'none',
})

const js = readFileSync('assets/app-ui.bundle', 'utf8').replace(/<\/script>/g, '<\\/script>')
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#140f11">
  <title>PearPetal preview</title>
  <style>html,body,#root{height:100%;margin:0;background:#140f11}</style>
</head>
<body>
  <div id="root"></div>
  <script>${js}</script>
</body>
</html>
`
writeFileSync('assets/index.html', html)
console.log('built assets/app-ui.bundle + self-contained assets/index.html')
