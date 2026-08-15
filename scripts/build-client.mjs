// Bundles src/client/index.ts into lib/client.js, wrapped in the exact contract
// deepseek-harness's dsh-client-modules loader expects: a single
// window.__ModuleLoader__.load({ id, factory }) call, where `factory` receives a
// `require` that resolves platform singletons (react, @deepseek-ai/cordis, ...)
// from the host shell's own module table. Verified against
// packages/client/modules/src/client/{system,manifest}.ts in the deepseek-harness
// checkout (see the plan/README for the exact citations) rather than against the
// harness's own (unpublished) tsdown.client.ts build preset.
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const PACKAGE_ID = 'dsh-xmemo'

// Platform singletons the host shell's module table supplies at runtime; bundling
// our own copies would break React/Cordis singleton assumptions across plugins.
const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis']

const result = await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: EXTERNALS,
  logLevel: 'info',
})

const [output] = result.outputFiles
if (!output) throw new Error('build-client: esbuild produced no output')

const wrapped = `(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) {
    throw new Error('${PACKAGE_ID}/client: window.__ModuleLoader__ is not installed yet')
  }
  window.__ModuleLoader__.load({
    id: '${PACKAGE_ID}',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
${output.text}
      return module.exports
    },
  })
})()
`

await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', wrapped, 'utf8')
console.log(`build-client: wrote lib/client.js (${wrapped.length} bytes)`)
