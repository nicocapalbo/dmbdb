import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware'
import * as routes from '../../server/utils/embeddedServiceRoutes.js'
import * as cookies from '../../server/utils/proxyCookies.js'
import * as targets from '../../server/utils/traefikTarget.js'
import * as context from '../../server/utils/embeddedRequestContext.js'
import * as adapter from '../../server/utils/embeddedBrowserAdapter.js'

// Execute the actual Nitro handlers with only framework registration replaced.
// Real HTTP/WS proxy middleware remains in use in browser integration tests.
export async function loadProxyHarness({ apiUrl, traefikUrl, proxy = createProxyMiddleware, fetchImpl = fetch } = {}) {
  const errors = []
  const sandbox = vm.createContext({
    ...routes, ...cookies, ...targets, ...context, ...adapter,
    URL, Buffer, setTimeout, clearTimeout, responseInterceptor,
    process: { env: { DUMB_API_URL: apiUrl, DUMB_TRAEFIK_URL: traefikUrl } },
    resolveTraefikTarget: () => traefikUrl || 'http://traefik.invalid',
    fetch: fetchImpl,
    console: { log() {}, warn() {}, error(...args) { errors.push(args) } },
    createProxyMiddleware: proxy,
    defineEventHandler: (fn) => fn,
    defineNitroPlugin: (fn) => fn,
  })
  const load = async (file, name, typescript = false) => {
    let source = await readFile(new URL(file, import.meta.url), 'utf8')
    source = source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '')
      .replace('export default ', `globalThis.${name} = `)
    if (typescript) source = (await transform(source, { loader: 'ts' })).code
    // Separate script scopes match separate ESM module scopes.
    vm.runInContext(`{\n${source}\n}`, sandbox)
    return sandbox[name]
  }
  const handler = await load('../../server/middleware/proxy.js', 'handler')
  const plugin = await load('../../server/plugins/websocket.ts', 'plugin', true)
  return { handler, plugin, errors }
}
