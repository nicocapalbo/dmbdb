import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'

// Compile the actual Vue SFCs and application helpers for browser interaction;
// replace only Nuxt's useState registration in the fixture entry point.
export const buildVueComponentHarness = async (entry, { modules = {}, defines = {} } = {}) => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'component-fixture.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false', ...defines },
    plugins: [{ name: 'actual-vue-components', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(modules, args.path) ? { path: args.path, namespace: 'fixture-module' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'fixture-module' }, args => ({ contents: modules[args.path], loader: 'js', resolveDir: root }))
      builder.onResolve({ filter: /^~\// }, args => ({ path: path.join(root, args.path.slice(2)) }))
      builder.onLoad({ filter: /\.vue$/ }, async args => {
        const source = await readFile(args.path, 'utf8')
        const { descriptor, errors } = parse(source, { filename: args.path })
        if (errors.length) throw errors[0]
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'js', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  return result.outputFiles[0].text
}
