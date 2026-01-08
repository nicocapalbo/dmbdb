import { createProxyMiddleware } from 'http-proxy-middleware';

let apiProxy;
let uiServiceProxy;
// NOTE: WebSocket proxies (wsProxy, uiServiceWsProxy) have been moved to server/plugins/websocket.ts

const UI_SERVICE_COOKIE = 'dumb_ui_service';
const ARR_API_SERVICES = new Set(['radarr', 'sonarr', 'lidarr', 'whisparr', 'prowlarr']);
const WEB_UI_SERVICES = new Set(['emby', 'jellyfin']);
const SEERR_SERVICES = new Set(['seerr', 'jellyseerr', 'overseerr']);
const REACT_SPA_SERVICES = new Set(['nzbdav']);

// In-memory cache to track most recent service per session
// This helps handle the timing issue where cookie hasn't propagated to browser yet
const sessionServiceCache = new Map(); // Map<sessionId, serviceName>

// Service name to config_key mapping (e.g., "sonarr_nzbdav" -> "sonarr")
// This is loaded from the API and cached
let serviceTypeMap = {}; // Map<sanitizedServiceName, configKey>
let serviceTypeMapLoaded = false;

// Helper to get the service type (config_key) from a service name
const getServiceType = (serviceName) => {
  if (!serviceName) return null;
  // Direct lookup
  if (serviceTypeMap[serviceName]) {
    return serviceTypeMap[serviceName];
  }
  // Fallback: check if the service name itself is a known type
  if (ARR_API_SERVICES.has(serviceName) || WEB_UI_SERVICES.has(serviceName) || SEERR_SERVICES.has(serviceName)) {
    return serviceName;
  }
  return null;
};

// Async function to load service type mapping from API
const loadServiceTypeMap = async (apiUrl) => {
  if (serviceTypeMapLoaded) return;
  try {
    const response = await fetch(`${apiUrl}/config/service-ui-map`);
    if (response.ok) {
      serviceTypeMap = await response.json();
      serviceTypeMapLoaded = true;
      console.log('[Service Type Map] Loaded:', serviceTypeMap);
    } else {
      console.warn('[Service Type Map] Failed to load, using fallback logic');
      serviceTypeMapLoaded = true; // Mark as loaded to avoid repeated attempts
    }
  } catch (error) {
    console.warn('[Service Type Map] Error loading:', error.message);
    serviceTypeMapLoaded = true; // Mark as loaded to avoid repeated attempts
  }
};

const getUiPrefix = (reqUrl) => {
  if (!reqUrl) return null;
  const match = reqUrl.match(/^\/(?:service\/ui|ui)\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return `/ui/${match[1]}`;
};

const getServiceFromRequestUrl = (reqUrl) => {
  if (!reqUrl) return null;
  const match = reqUrl.match(/^\/(?:service\/ui|ui)\/([^/]+)(?:\/|$)/);
  return match ? match[1].toLowerCase() : null;
};

const getSessionId = (req) => {
  // Try to get a session identifier from cookies
  const cookie = req?.headers?.cookie;
  if (!cookie) return null;
  const entries = cookie.split(';');
  for (const entry of entries) {
    const [rawKey, rawValue] = entry.split('=');
    if (!rawKey) continue;
    const key = rawKey.trim();
    // Look for common session cookie names
    if (key === '_session' || key.startsWith('session') || key === 'connect.sid') {
      return rawValue?.trim() || null;
    }
  }
  // Fallback: use a hash of all cookies as session identifier
  return cookie;
};

const getCookieService = (req) => {
  const cookie = req?.headers?.cookie;
  if (!cookie) return null;
  const entries = cookie.split(';');
  for (const entry of entries) {
    const [rawKey, rawValue] = entry.split('=');
    if (!rawKey) continue;
    const key = rawKey.trim();
    if (key !== UI_SERVICE_COOKIE) continue;
    const decoded = decodeURIComponent((rawValue || '').trim());
    return decoded.toLowerCase().replace(/\s+/g, '_') || null;
  }
  return null;
};

const rewriteUiLocation = (reqUrl, location) => {
  const prefix = getUiPrefix(reqUrl);
  if (!prefix || !location) return null;

  let path = location;
  if (/^https?:\/\//i.test(location)) {
    try {
      const url = new URL(location);
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      path = location;
    }
  }

  const service = prefix.slice('/ui/'.length);
  if (path.startsWith(`/service/ui/${service}`)) {
    path = path.slice(`/service/ui/${service}`.length);
  } else if (path.startsWith(`/ui/${service}`)) {
    path = path.slice(`/ui/${service}`.length);
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  return `${prefix}${path}`;
};

const setUiCookie = (res, service) => {
  if (!res?.setHeader || !service) return;
  // Normalize service name: decode URL encoding, lowercase, replace spaces with underscores
  const normalized = decodeURIComponent(service).toLowerCase().replace(/\s+/g, '_');
  const cookieValue = `${UI_SERVICE_COOKIE}=${normalized}; Path=/; SameSite=Lax`;
  const existing = res.getHeader('set-cookie');
  if (!existing) {
    res.setHeader('set-cookie', cookieValue);
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  const merged = Array.isArray(existing) ? [...existing, cookieValue] : [existing, cookieValue];
  res.setHeader('set-cookie', merged);
  res.setHeader('Set-Cookie', merged);
};

const getServiceFromRefererHeader = (req) => {
  const referer = req?.headers?.referer || req?.headers?.referrer;
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const uiMatch = url.pathname.match(/^\/ui\/([^/]+)(?:\/|$)/);
    if (uiMatch) {
      // Normalize: decode URL encoding, lowercase, replace spaces with underscores
      return decodeURIComponent(uiMatch[1]).toLowerCase().replace(/\s+/g, '_');
    }
    const pageMatch = url.pathname.match(/^\/services\/([^/]+)(?:\/|$)/);
    if (pageMatch) {
      return decodeURIComponent(pageMatch[1]).toLowerCase().replace(/\s+/g, '_');
    }
    return null;
  } catch {
    return null;
  }
};

const getUiServiceFromReferer = (req) => {
  const referer = req?.headers?.referer || req?.headers?.referrer;
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const uiMatch = url.pathname.match(/^\/ui\/([^/]+)(?:\/|$)/);
    if (uiMatch) {
      // Normalize: decode URL encoding, lowercase, replace spaces with underscores
      return decodeURIComponent(uiMatch[1]).toLowerCase().replace(/\s+/g, '_');
    }
    return null;
  } catch {
    return null;
  }
};

const getPageServiceFromReferer = (req) => {
  const referer = req?.headers?.referer || req?.headers?.referrer;
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const pageMatch = url.pathname.match(/^\/services\/([^/]+)(?:\/|$)/);
    if (pageMatch) {
      // Normalize: decode URL encoding, lowercase, replace spaces with underscores
      return decodeURIComponent(pageMatch[1]).toLowerCase().replace(/\s+/g, '_');
    }
    return null;
  } catch {
    return null;
  }
};

export default defineEventHandler(async (event) => {
  const apiUrl = process.env.DMB_API_URL || process.env.DUMB_API_URL || 'http://localhost:8000';

  // Load service type mapping on first request
  if (!serviceTypeMapLoaded) {
    await loadServiceTypeMap(apiUrl);
  }

  const traefikUrl = (() => {
    const envUrl = process.env.DMB_TRAEFIK_URL || process.env.DUMB_TRAEFIK_URL;
    if (envUrl) return envUrl;
    try {
      const api = new URL(apiUrl);
      api.port = '18080';
      api.pathname = '/';
      api.search = '';
      api.hash = '';
      return api.toString().replace(/\/$/, '');
    } catch {
      return 'http://127.0.0.1:18080';
    }
  })();

  if (!apiProxy) {
    apiProxy = createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
      pathRewrite: { '^/api': '' },
    });
  }

  if (!uiServiceProxy) {
    uiServiceProxy = createProxyMiddleware({
      target: traefikUrl,
      changeOrigin: false,
      ws: false,  // WebSocket handling moved to server/plugins/websocket.ts
      autoRewrite: true,
      hostRewrite: '',
      protocolRewrite: '',
      pathRewrite: (path) => path.replace(/^\/ui\//, '/service/ui/'),
      onProxyReq: () => {
        // Request is being proxied to Traefik
      },
      onProxyRes: (proxyRes, req, res) => {
        const headers = proxyRes?.headers || {};
        const location = headers.location || headers.Location;
        const requestUrl = req?.originalUrl || req?.url || '';

        if (location) {
          const original = Array.isArray(location) ? location[0] : location;
          const updated = rewriteUiLocation(requestUrl, original);
          if (updated) {
            headers.location = updated;
            headers.Location = updated;
          }
        }

        const serviceFromUrl = getServiceFromRequestUrl(requestUrl);
        if (serviceFromUrl) {
          setUiCookie(res, serviceFromUrl);
        }

        // Note: React SPA base tag injection is now handled by the fetch-based interceptor
        // in the main handler, not in this onProxyRes callback
      },
      onError: (err, _req, res) => {
        console.error('[UI Proxy Error]:', err?.message || err);
        if (res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        if (res.end && !res.writableEnded) {
          res.end('UI proxy error: failed to reach Traefik.');
        }
      },
    });
  }

  let reqUrl = event.node.req.url || '';

  // NOTE: WebSocket upgrades are now handled in server/plugins/websocket.ts
  // They happen at the HTTP server level before reaching this middleware

  // Normalize /ui/{service} URLs early - decode and sanitize service names
  const uiPathMatch = reqUrl.match(/^\/ui\/([^/?]+)(.*)/);
  if (uiPathMatch) {
    const rawService = uiPathMatch[1];
    const pathRemainder = uiPathMatch[2];
    // Normalize: decode URL encoding, lowercase, replace spaces with underscores
    const normalized = decodeURIComponent(rawService).toLowerCase().replace(/\s+/g, '_');
    if (normalized !== rawService) {
      const normalizedUrl = `/ui/${normalized}${pathRemainder}`;
      console.log('[URL Normalization]:', reqUrl, '->', normalizedUrl);
      reqUrl = normalizedUrl;
      event.node.req.url = normalizedUrl;
    }
  }

  const fetchDest = (event.node.req.headers['sec-fetch-dest'] || '').toString();
  const isNavigation = fetchDest === 'document' || fetchDest === 'iframe';

  // IMPORTANT: Set cookie early for /ui/{service} requests to ensure subrequests use correct service
  const sessionId = getSessionId(event.node.req);
  const urlServiceMatch = reqUrl.match(/^\/ui\/([^/?]+)/);
  if (urlServiceMatch) {
    const urlService = urlServiceMatch[1]; // Already normalized above

    // Prevent direct navigation to /ui/{service} URLs (should only be accessed in iframe)
    // If this is a document navigation (not iframe), redirect to home page
    if (isNavigation && fetchDest === 'document') {
      console.log('[Direct UI Navigation] Redirecting to home:', reqUrl);
      // Clear the cached service to prevent redirect loop
      if (sessionId) {
        sessionServiceCache.delete(sessionId);
      }
      event.node.res.statusCode = 302;
      event.node.res.setHeader('Location', '/');
      event.node.res.end();
      return;
    }

    setUiCookie(event.node.res, urlService);
    // Also update session cache immediately
    if (sessionId) {
      sessionServiceCache.set(sessionId, urlService);
    }
    console.log('[Early Cookie Set] Service:', urlService, 'Session:', sessionId ? 'yes' : 'no', 'URL:', reqUrl);
  }

  try {

    const uiRefererService = getUiServiceFromReferer(event.node.req);
    const pageRefererService = getPageServiceFromReferer(event.node.req);
    const cookieService = getCookieService(event.node.req);

    // Get cached service for this session (helps with timing issue where cookie hasn't updated yet)
    const cachedService = sessionId ? sessionServiceCache.get(sessionId) : null;

    // Get service types for routing decisions
    const cookieServiceType = getServiceType(cookieService);
    const uiRefererServiceType = getServiceType(uiRefererService);
    const cachedServiceType = getServiceType(cachedService);

    const webUiService =
      uiRefererService ||
      (cookieService && cookieServiceType && WEB_UI_SERVICES.has(cookieServiceType) ? cookieService : null);

    if (webUiService && reqUrl.startsWith('/ui/web')) {
      const suffix = reqUrl.slice('/ui'.length);
      const target = `/ui/${webUiService}${suffix}`;
      event.node.req.url = target;
      reqUrl = target;
    } else if (
      webUiService &&
      reqUrl.startsWith('/web/') &&
      !reqUrl.startsWith(`/ui/${webUiService}/web/`)
    ) {
      const target = `/ui/${webUiService}${reqUrl}`;
      event.node.req.url = target;
      reqUrl = target;
    } else if (
      webUiService &&
      reqUrl.startsWith('/web') &&
      !reqUrl.startsWith(`/ui/${webUiService}/web`)
    ) {
      // Handle /web without trailing slash (e.g., /web?param=value or just /web)
      const target = `/ui/${webUiService}${reqUrl}`;
      event.node.req.url = target;
      reqUrl = target;
    }


    // Handle Emby/Jellyfin paths that need /web/ prefix
    // Paths like /ui/emby/apploader.js should become /ui/emby/web/apploader.js
    if (cookieService && cookieServiceType && WEB_UI_SERVICES.has(cookieServiceType)) {
      const servicePrefix = `/ui/${cookieService}/`;
      const webPrefix = `${servicePrefix}web/`;

      if (reqUrl.startsWith(servicePrefix) && !reqUrl.startsWith(webPrefix)) {
        // Extract the path after /ui/{service}/
        const pathAfterService = reqUrl.slice(servicePrefix.length);

        // Don't add /web/ if the path is already an API path (starts with service name like /emby/ or /jellyfin/)
        // or if it's already /web or empty
        if (pathAfterService &&
            !pathAfterService.startsWith('web') &&
            !pathAfterService.startsWith(`${cookieServiceType}/`)) {
          const target = `${servicePrefix}web/${pathAfterService}`;
          console.log('[Emby/Jellyfin Web Path] Rewriting:', reqUrl, '->', target);
          event.node.req.url = target;
          reqUrl = target;
        }
      }
    }

    // Handle Emby/Jellyfin WebSocket paths (e.g., /embywebsocket, /jellyfinwebsocket)
    // Only rewrite if it's actually a WebSocket request matching the expected pattern
    if (event.node.req.headers.upgrade === 'websocket') {
      if (reqUrl.startsWith('/embywebsocket') || reqUrl.startsWith('/jellyfinwebsocket')) {
        console.log('[Emby/Jellyfin WS Debug] reqUrl:', reqUrl, 'cookieService:', cookieService, 'cookieServiceType:', cookieServiceType, 'hasWS:', cookieServiceType && WEB_UI_SERVICES.has(cookieServiceType));
        if (cookieService && cookieServiceType && WEB_UI_SERVICES.has(cookieServiceType)) {
          const wsPath = `/${cookieServiceType}websocket`;
          if (reqUrl.startsWith(wsPath) && !reqUrl.startsWith(`/ui/${cookieService}/`)) {
            const target = `/ui/${cookieService}${reqUrl}`;
            console.log('[Emby/Jellyfin WebSocket] Rewriting:', reqUrl, '->', target, 'Service:', cookieService);
            event.node.req.url = target;
            reqUrl = target;
          }
        }
      }
    }

    // Handle Emby/Jellyfin API paths (e.g., /emby/*, /jellyfin/*)
    if (cookieService && cookieServiceType && WEB_UI_SERVICES.has(cookieServiceType)) {
      if (reqUrl.startsWith(`/${cookieServiceType}/`) && !reqUrl.startsWith(`/ui/${cookieService}/`)) {
        const target = `/ui/${cookieService}${reqUrl}`;
        console.log('[Web UI Service API] Rewriting:', reqUrl, '->', target, 'Service:', cookieService, 'Type:', cookieServiceType);
        event.node.req.url = target;
        reqUrl = target;
      }
    }

    if (reqUrl.startsWith('/api') && !pageRefererService) {
      const arrApiPath = /^\/api\/v[0-9]+\//.test(reqUrl);

      // Seerr uses /api/v1/* - always route these to the iframe service
      if (arrApiPath && cookieService && cookieServiceType && SEERR_SERVICES.has(cookieServiceType)) {
        const target = `/ui/${cookieService}${reqUrl}`;
        event.node.req.url = target;
        reqUrl = target;
      } else {
        const apiService =
          uiRefererService ||
          (!isNavigation && arrApiPath && cookieService && cookieServiceType && ARR_API_SERVICES.has(cookieServiceType)
            ? cookieService
            : null);
        if (apiService) {
          const target = `/ui/${apiService}${reqUrl}`;
          event.node.req.url = target;
          reqUrl = target;
        }
      }
    }

    const refererService = getServiceFromRefererHeader(event.node.req);
    const allowIframeCookie = fetchDest === 'iframe';

    // Determine which service context to use for subrequests
    // Priority order:
    // 1. Referer header (most reliable)
    // 2. Page referer (parent page context)
    // 3. Cached service (handles timing when cookie hasn't updated yet)
    // 4. Cookie service (fallback)
    let subrequestService = refererService;
    if (!subrequestService && pageRefererService) {
      // Use the parent page's service context (e.g., /services/pgAdmin4)
      subrequestService = pageRefererService;
    }
    if (!subrequestService && cachedService) {
      // Use cached service from session (helps when cookie hasn't propagated yet)
      subrequestService = cachedService;
      // Only log if this might actually be used for routing (not for /api or /ws paths)
      if (!reqUrl.startsWith('/api') && !reqUrl.startsWith('/ws')) {
        console.log('[Using Cached Service] Service:', cachedService, 'URL:', reqUrl);
      }
    }
    if (!subrequestService && (!isNavigation || allowIframeCookie) && cookieService) {
      subrequestService = cookieService;
    }

    const isSplitViewRequest = (() => {
      try {
        const url = new URL(reqUrl, 'http://local');
        return url.searchParams.get('split') === '1';
      } catch {
        return false;
      }
    })();
    const isUiSubrequest =
      !isSplitViewRequest &&
      subrequestService &&
      reqUrl.startsWith('/') &&
      !reqUrl.startsWith('/api') &&
      !reqUrl.startsWith('/ws') &&
      !reqUrl.startsWith('/service/ui/') &&
      !reqUrl.startsWith('/ui/');

    if (isUiSubrequest) {
      const target = `/ui/${subrequestService}${reqUrl}`;
      console.log('[UI Subrequest] Rewriting:', reqUrl, '->', target, 'Service:', subrequestService);
      if (isNavigation) {
        event.node.res.statusCode = 307;
        event.node.res.setHeader('Location', target);
        event.node.res.end();
        return;
      }
      event.node.req.url = target;
      reqUrl = target;
    } else if (reqUrl.startsWith('/assets/')) {
      console.log('[Assets Debug] Not rewriting:', reqUrl, 'Cookie:', cookieService, 'Referer:', refererService, 'Page:', pageRefererService, 'Subrequest:', subrequestService, 'isNav:', isNavigation, 'fetchDest:', fetchDest);
    }

    // Handle API requests
    if (reqUrl.startsWith('/api')) {
      return new Promise((resolve, reject) => {
        apiProxy(event.node.req, event.node.res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // NOTE: All WebSocket handling has been moved to server/plugins/websocket.ts
    // WebSocket upgrades happen at the HTTP server level and never reach this middleware

    // Ignore unrelated requests
    if (
      !reqUrl.startsWith('/api') &&
      !reqUrl.startsWith('/ws') &&
      !reqUrl.startsWith('/service/ui/') &&
      !reqUrl.startsWith('/ui/')
    ) {
      return;
    }

    if (reqUrl.startsWith('/service/ui/') || reqUrl.startsWith('/ui/')) {
      // Set cookie BEFORE proxying by calling the middleware
      // We need to wrap the call to ensure cookie is set first
      const serviceFromUrl = getServiceFromRequestUrl(reqUrl);
      console.log('[UI Service Request]:', reqUrl, 'Service:', serviceFromUrl);
      if (serviceFromUrl) {
        setUiCookie(event.node.res, serviceFromUrl);
      }

      // For React SPA services, intercept HTML responses and inject base tag
      if (serviceFromUrl && REACT_SPA_SERVICES.has(serviceFromUrl) && !reqUrl.includes('.') && !reqUrl.includes('__manifest')) {
        // This looks like a navigation request (no file extension)
        const accept = event.node.req.headers.accept || '';
        if (accept.includes('text/html')) {
          console.log('[React SPA] Intercepting HTML for:', serviceFromUrl, reqUrl);

          // Proxy the request manually to intercept the response
          const proxyUrl = `${traefikUrl}${reqUrl.replace(/^\/ui\//, '/service/ui/')}`;

          try {
            const response = await fetch(proxyUrl, {
              method: event.node.req.method,
              headers: {
                ...event.node.req.headers,
                host: new URL(traefikUrl).host,
              },
            });

            console.log('[React SPA] Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

            // Only inject base tag if we got HTML (2xx status and HTML content type)
            if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
              let body = await response.text();
              const basePath = `/ui/${serviceFromUrl}/`;
              const baseTag = `<base href="${basePath}">`;

              console.log('[React SPA] Injecting base tag:', baseTag);
              console.log('[React SPA] Original HTML length:', body.length);

              // Inject base tag right after <head> opening tag
              const headMatch = body.match(/<head[^>]*>/i);
              if (headMatch) {
                const headTag = headMatch[0];
                const headEndPos = headMatch.index + headTag.length;
                body = body.substring(0, headEndPos) + baseTag + body.substring(headEndPos);
                console.log('[React SPA] Injected base tag after <head>');
              } else if (/<html[^>]*>/i.test(body)) {
                body = body.replace(/<html[^>]*>/i, (match) => `${match}<head>${baseTag}</head>`);
                console.log('[React SPA] Injected base tag in new <head>');
              } else {
                console.log('[React SPA] Could not find <head> or <html> tag');
              }

              console.log('[React SPA] Modified HTML length:', body.length);
              console.log('[React SPA] First 200 chars of modified HTML:', body.substring(0, 200));

              event.node.res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'content-length') {
                  event.node.res.setHeader(key, value);
                }
              });
              event.node.res.end(body);
              console.log('[React SPA] Response sent and handler exiting, body length:', body.length);
              return; // Exit the handler - don't call uiServiceProxy
            } else {
              console.log('[React SPA] Not HTML or non-OK status, falling through to normal proxy');
              // Fall through to normal proxy
            }
          } catch (err) {
            console.error('[React SPA] Failed to intercept:', err);
            // Fall through to normal proxy
          }
        }
      }

      // Call the proxy middleware and wait for it to complete
      return new Promise((resolve, reject) => {
        const callback = (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        };

        try {
          uiServiceProxy(event.node.req, event.node.res, callback);
        } catch (err) {
          console.error('[Proxy invocation error]:', err);
          reject(err);
        }
      });
    }

  } catch (error) {
    console.error('[Proxy Middleware Error]:', error);
    throw error;
  }
});
