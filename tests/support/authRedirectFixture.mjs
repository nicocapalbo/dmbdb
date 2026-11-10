import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'

const root = fileURLToPath(new URL('../../', import.meta.url))
const auth = [
  'const notify = async event => { await globalThis.__authEvent(event); globalThis.__authStarted = event.kind; await globalThis.__authWait() };',
  'export const useAuthStore = () => ({ _initialized: true, isAuthEnabled: true, localLoginEnabled: true, oidcLoginEnabled: true,',
  'login: async () => { await notify({ kind: "password" }); return true },',
  'exchangeOidcCode: async () => { await notify({ kind: "oidc", fragment: location.hash }); return true },',
  'startOidcLogin: async returnTo => { await notify({ kind: "start", returnTo }); return true } });',
].join('\n')

export const buildAuthRedirectFixture = async () => {
  const result = await build({
    stdin: { contents: "import { createApp } from 'vue'; import Login from '~/pages/login.vue'; globalThis.definePageMeta = () => {}; createApp(Login).mount('#app');", resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'actual-login', setup(builder) {
      builder.onResolve({ filter: new RegExp('^[@~]/') }, args => {
        const file = args.path.slice(2)
        if (file === 'stores/auth') return { path: 'auth', namespace: 'login-fixture' }
        if (file === 'stores/processes') return { path: 'processes', namespace: 'login-fixture' }
        return { path: path.join(root, file) }
      })
      builder.onResolve({ filter: /^vue-router$/ }, () => ({ path: 'router', namespace: 'login-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'login-fixture' }, args => ({ loader: 'js', contents: args.path === 'auth' ? auth
        : args.path === 'processes' ? 'export const useProcessesStore = () => ({ projectName: "DUMB", getProcesses: async () => [] });'
          : 'export const useRouter = () => ({ currentRoute: { value: { query: Object.fromEntries(new URLSearchParams(location.search)) } }, replace() {} });' }))
      builder.onLoad({ filter: /[.]vue$/ }, async args => {
        const { descriptor, errors } = parse(await fs.readFile(args.path, 'utf8'), { filename: args.path })
        if (errors.length) throw errors[0]
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'js', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  return result.outputFiles[0].text
}
