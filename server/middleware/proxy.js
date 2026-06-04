import { createProxyMiddleware } from 'http-proxy-middleware';

let apiProxy;
let uiServiceProxy;
// NOTE: WebSocket proxies (wsProxy, uiServiceWsProxy) have been moved to server/plugins/websocket.ts

const UI_SERVICE_COOKIE = 'dumb_ui_service';
const ARR_API_SERVICES = new Set(['radarr', 'sonarr', 'lidarr', 'whisparr', 'prowlarr']);
const ARR_CLIENT_HEADERS = new Set([
  'x-prowlarr-client',
  'x-sonarr-client',
  'x-radarr-client',
  'x-lidarr-client',
  'x-whisparr-client',
]);
const WEB_UI_SERVICES = new Set(['emby', 'jellyfin']);
const SEERR_SERVICES = new Set(['seerr', 'jellyseerr', 'overseerr']);
const ROOT_NAVIGATION_SERVICES = new Set(['tautulli', 'seerr', 'jellyseerr', 'overseerr']);
const ROOT_NAVIGATION_ENTRY_PATHS = new Set(['/home', '/login', '/logout', '/redirect', '/discover', '/movies', '/tv', '/requests', '/blocklist', '/issues', '/users', '/settings', '/setup', '/profile']);
const ROOT_NAVIGATION_PATH_PREFIXES = ['/auth/', '/discover/', '/movies/', '/movie/', '/tv/', '/series/', '/requests/', '/request/', '/blocklist/', '/issues/', '/users/', '/user/', '/settings/', '/setup/', '/profile/'];
const ROOT_API_SERVICES = new Set(['decypharr', 'neutarr', 'profilarr', 'pulsarr', 'altmount', 'traefik', 'traefik_proxy_admin']);
const ROOT_ROUTE_SERVICES = new Set(['pulsarr', 'altmount', 'traefik_proxy_admin']);
const ROOT_ROUTE_ENTRY_PATHS = new Set(['/dashboard', '/login', '/logout']);
const REACT_SPA_SERVICES = new Set(['pulsarr', 'altmount']);
const NEXT_ROOT_PATH_SERVICES = new Set(['traefik_proxy_admin', 'seerr', 'jellyseerr', 'overseerr']);
const SVELTEKIT_SPA_SERVICES = new Set(['riven_frontend']);
// Services that need base tag injection because they use absolute paths
// (neutarr uses /static/, nzbdav is a React SPA that needs base for assets)
const STATIC_PATH_SERVICES = new Set(['neutarr', 'nzbdav']);
const DUMB_AUTH_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/verify',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/skip-setup',
  '/api/auth/enable',
  '/api/auth/disable',
  '/api/auth/users',
]);
const DUMB_CONFIG_API_PATHS = new Set([
  '/api/config/',
  '/api/config/schema',
  '/api/config/service-config',
  '/api/config/onboarding-status',
  '/api/config/onboarding-completed',
  '/api/config/reset-onboarding',
  '/api/config/process-config/schema',
  '/api/config/service-ui',
  '/api/config/service-ui-map',
]);
const DUMB_PROCESS_API_PATHS = new Set([
  '/api/process/',
  '/api/process/service-status',
  '/api/process/processes',
  '/api/process/start-service',
  '/api/process/stop-service',
  '/api/process/restart-service',
  '/api/process/start-core-service',
  '/api/process/core-services',
  '/api/process/dependency-graph',
  '/api/process/optional-services',
  '/api/process/capabilities',
  '/api/process/update-status',
  '/api/process/update-notices',
  '/api/process/update-check',
  '/api/process/update-install',
  '/api/process/auto-update/reschedule',
  '/api/process/symlink-backup-status',
  '/api/process/symlink-backup-manifests',
  '/api/process/symlink-manifest-files',
  '/api/process/symlink-backup/reschedule',
  '/api/process/symlink-repair',
  '/api/process/symlink-repair-async',
  '/api/process/symlink-manifest/backup',
  '/api/process/symlink-manifest/backup-async',
  '/api/process/symlink-job-status',
  '/api/process/symlink-job-latest',
  '/api/process/symlink-manifest/restore',
  '/api/process/symlink-manifest/restore-async',
  '/api/process/symlink-manifest/compare',
]);
const DUMB_SEERR_SYNC_API_PATHS = new Set([
  '/api/seerr-sync/status',
  '/api/seerr-sync/failed',
  '/api/seerr-sync/state',
  '/api/seerr-sync/test',
]);

// Helper to check if a service name matches a static path service (supports partial matches like 'sonarr_nzbdav')
const isStaticPathService = (serviceName) => {
  if (!serviceName) return false;
  const normalized = serviceName.toLowerCase();
  if (STATIC_PATH_SERVICES.has(normalized)) return true;
  // Check for partial matches (e.g., 'sonarr_nzbdav' contains 'nzbdav')
  for (const staticService of STATIC_PATH_SERVICES) {
    if (normalized.includes(staticService)) return true;
  }
  return false;
};

const isDumbAuthApiPath = (pathname) => {
  return DUMB_AUTH_API_PATHS.has(pathname) || pathname.startsWith('/api/auth/users/');
};

const isDumbApiPath = (pathname) => {
  return pathname === '/api/health' ||
    pathname === '/api/logs' ||
    pathname === '/api/metrics' ||
    pathname === '/api/metrics/history_series' ||
    isDumbAuthApiPath(pathname) ||
    DUMB_CONFIG_API_PATHS.has(pathname) ||
    DUMB_PROCESS_API_PATHS.has(pathname) ||
    DUMB_SEERR_SYNC_API_PATHS.has(pathname);
};

const isRootNavigationServicePath = (pathname) => {
  if (!pathname) return false;
  return ROOT_NAVIGATION_ENTRY_PATHS.has(pathname) ||
    ROOT_NAVIGATION_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
};

const isDumbMainNavigationPath = (pathname) => {
  if (!pathname) return false;
  return pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/services/') ||
    pathname === '/services' ||
    pathname.startsWith('/_nuxt/') ||
    pathname.startsWith('/__nuxt') ||
    pathname.startsWith('/__vite');
};

const isRootRouteServiceType = (serviceType) => {
  if (!serviceType) return false;
  return ARR_API_SERVICES.has(serviceType) ||
    SEERR_SERVICES.has(serviceType) ||
    ROOT_API_SERVICES.has(serviceType) ||
    ROOT_ROUTE_SERVICES.has(serviceType) ||
    ROOT_NAVIGATION_SERVICES.has(serviceType) ||
    STATIC_PATH_SERVICES.has(serviceType) ||
    SVELTEKIT_SPA_SERVICES.has(serviceType) ||
    REACT_SPA_SERVICES.has(serviceType);
};

const isNextRootPath = (pathname) => {
  if (!pathname) return false;
  return pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/manifest.json' ||
    pathname === '/site.webmanifest' ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/apple-touch-icon') ||
    pathname.startsWith('/icon');
};

const isNextAppRoutePath = (pathname) => {
  if (!pathname) return false;
  return pathname === '/' ||
    pathname.startsWith('/services') ||
    pathname.startsWith('/domains') ||
    pathname.startsWith('/security') ||
    pathname.startsWith('/sessions') ||
    pathname.startsWith('/config') ||
    pathname.startsWith('/docs') ||
    pathname.startsWith('/traefik') ||
    pathname.startsWith('/auth');
};

const isNextAppIframeRefererPath = (pathname) => {
  if (!pathname) return false;
  if (pathname === '/services') return true;
  if (pathname === '/services/add') return true;
  if (/^\/services\/[^/]+\/(?:edit|security|sessions?|auth|advanced)(?:\/|$)/.test(pathname)) return true;
  if (pathname.startsWith('/services/')) return false;
  return isNextAppRoutePath(pathname);
};

const isNextRootPathService = (serviceName, serviceType) => {
  const normalizedName = normalizeServiceName(serviceName);
  return NEXT_ROOT_PATH_SERVICES.has(serviceType) || NEXT_ROOT_PATH_SERVICES.has(normalizedName);
};

const rewriteNextAssetReferences = (value, service) => {
  if (!value || !service) return value;
  const normalized = normalizeServiceName(service);
  if (!normalized || !NEXT_ROOT_PATH_SERVICES.has(normalized)) return value;
  const prefix = `/ui/${normalized}`;
  return String(value)
    .replace(/([\"'(<])\/_next\//g, `$1${prefix}/_next/`)
    .replace(/(href|src)=(['\"])\/_next\//gi, `$1=$2${prefix}/_next/`);
};

// In-memory cache to track most recent service per session
// This helps handle the timing issue where cookie hasn't propagated to browser yet
const sessionServiceCache = new Map(); // Map<sessionId, serviceName>

// Service name to config_key mapping (e.g., "sonarr_nzbdav" -> "sonarr")
// This is loaded from the API and cached
let serviceTypeMap = {}; // Map<sanitizedServiceName, configKey>
let serviceTypeMapLoaded = false;

const normalizeServiceName = (value) => {
  if (!value) return null;
  return String(value).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
};

// Helper to get the service type (config_key) from a service name
const getServiceType = (serviceName) => {
  if (!serviceName) return null;
  const normalized = normalizeServiceName(serviceName);
  // Direct lookup
  if (serviceTypeMap[normalized]) {
    return serviceTypeMap[normalized];
  }
  if (serviceTypeMap[serviceName]) {
    return serviceTypeMap[serviceName];
  }
  // Fallback: check if the service name itself is a known type
  if (
    ARR_API_SERVICES.has(normalized) ||
    WEB_UI_SERVICES.has(normalized) ||
    SEERR_SERVICES.has(normalized) ||
    ROOT_API_SERVICES.has(normalized) ||
    ROOT_ROUTE_SERVICES.has(normalized) ||
    ROOT_NAVIGATION_SERVICES.has(normalized)
  ) {
    return normalized;
  }
  // Fallback: handle names like "prowlarr_indexer" or "sonarr_main"
  for (const arrService of ARR_API_SERVICES) {
    if (normalized && normalized.includes(arrService)) {
      return arrService;
    }
  }
  for (const seerrService of SEERR_SERVICES) {
    if (normalized && normalized.includes(seerrService)) {
      return seerrService;
    }
  }
  for (const rootApiService of ROOT_API_SERVICES) {
    if (normalized && normalized.includes(rootApiService)) {
      return rootApiService;
    }
  }
  for (const rootNavigationService of ROOT_NAVIGATION_SERVICES) {
    if (normalized && normalized.includes(rootNavigationService)) {
      return rootNavigationService;
    }
  }
  for (const rootRouteService of ROOT_ROUTE_SERVICES) {
    if (normalized && normalized.includes(rootRouteService)) {
      return rootRouteService;
    }
  }
  return null;
};

// Async function to load service type mapping from API
const loadServiceTypeMap = async (apiUrl, event) => {
  if (serviceTypeMapLoaded) return;
  try {
    // Get auth token from request cookies if available
    const cookies = event?.node?.req?.headers?.cookie || '';
    const headers = {};

    // Extract access token from cookies
    const tokenMatch = cookies.match(/dumb_access_token=([^;]+)/);
    if (tokenMatch) {
      headers['Authorization'] = `Bearer ${tokenMatch[1]}`;
    }

    const response = await fetch(`${apiUrl}/config/service-ui-map`, { headers });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      serviceTypeMap = await response.json();
      serviceTypeMapLoaded = true;
      console.log('[Service Type Map] Loaded:', serviceTypeMap);
    } else if (response.ok) {
      console.warn('[Service Type Map] Expected JSON but received', contentType || 'unknown content type', 'from service-ui-map; using fallback logic');
      serviceTypeMapLoaded = true;
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

const hasCookie = (req, cookieName) => {
  const cookie = req?.headers?.cookie;
  if (!cookie || !cookieName) return false;
  return cookie.split(';').some((entry) => {
    const [rawKey] = entry.split('=');
    return rawKey?.trim() === cookieName;
  });
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
    return decoded.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_') || null;
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
  // Normalize service name: decode URL encoding, lowercase, replace spaces and forward slashes with underscores
  const normalized = decodeURIComponent(service).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
  // Use Path=/ so cookie is sent with all requests (needed for ARR API routing and subrequests)
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

const clearUiCookie = (res) => {
  if (!res?.setHeader) return;
  const clearCookie = UI_SERVICE_COOKIE + "=; Path=/; Max-Age=0; SameSite=Lax";
  const existing = res.getHeader("set-cookie");
  const merged = existing
    ? Array.isArray(existing)
      ? [...existing, clearCookie]
      : [existing, clearCookie]
    : clearCookie;
  res.setHeader("set-cookie", merged);
  res.setHeader("Set-Cookie", merged);
};

const getServiceFromRefererHeader = (req) => {
  const referer = req?.headers?.referer || req?.headers?.referrer;
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const uiMatch = url.pathname.match(/^\/(?:service\/ui|ui)\/([^/]+)(?:\/|$)/);
    if (uiMatch) {
      // Normalize: decode URL encoding, lowercase, replace spaces and forward slashes with underscores
      return decodeURIComponent(uiMatch[1]).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
    }
    const pageMatch = url.pathname.match(/^\/services\/([^/]+)(?:\/|$)/);
    if (pageMatch) {
      return decodeURIComponent(pageMatch[1]).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
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
    const uiMatch = url.pathname.match(/^\/(?:service\/ui|ui)\/([^/]+)(?:\/|$)/);
    if (uiMatch) {
      // Normalize: decode URL encoding, lowercase, replace spaces and forward slashes with underscores
      return decodeURIComponent(uiMatch[1]).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
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
      // Normalize: decode URL encoding, lowercase, replace spaces and forward slashes with underscores
      return decodeURIComponent(pageMatch[1]).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
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
    await loadServiceTypeMap(apiUrl, event);
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
      xfwd: true,  // Preserve X-Forwarded-* headers (Proto, Host, etc) from upstream reverse proxy
      autoRewrite: true,
      hostRewrite: '',
      protocolRewrite: '',
      pathRewrite: (path) => path.replace(/^\/ui\//, '/service/ui/'),
      onProxyReq: (proxyReq, req) => {
        // If request came via HTTPS (has X-Forwarded-Proto: https), add X-Forwarded-Ssl: on
        // This helps services like Tautulli recognize they're behind HTTPS reverse proxy
        const proto = req.headers['x-forwarded-proto'];
        if (proto === 'https') {
          proxyReq.setHeader('X-Forwarded-Ssl', 'on');
        }
      },
      onProxyRes: (proxyRes, req, res) => {
        const headers = proxyRes?.headers || {};
        let location = headers.location || headers.Location;
        const requestUrl = req?.originalUrl || req?.url || '';

        if (location) {
          const original = Array.isArray(location) ? location[0] : location;
          let updated = rewriteUiLocation(requestUrl, original);

          // CRITICAL FIX: If original request was HTTPS, rewrite HTTP Location headers to HTTPS
          // This fixes Tautulli generating HTTP redirects even when behind HTTPS reverse proxy
          const incomingProto = req.headers['x-forwarded-proto'];
          if (incomingProto === 'https' && updated) {
            const httpMatch = updated.match(/^http:\/\/([^/]+)(\/.*)?$/);
            if (httpMatch) {
              const host = httpMatch[1];
              const path = httpMatch[2] || '/';
              updated = `https://${host}${path}`;
              console.log('[HTTPS Rewrite] Converted HTTP redirect to HTTPS:', original, '->', updated);
            }
          }

          if (updated) {
            headers.location = updated;
            headers.Location = updated;
          }
        }

        const serviceFromUrl = getServiceFromRequestUrl(requestUrl);
        if (serviceFromUrl) {
          setUiCookie(res, serviceFromUrl);
          const linkHeader = headers.link || headers.Link;
          if (linkHeader && isNextRootPathService(serviceFromUrl, getServiceType(serviceFromUrl))) {
            const rewrittenLink = Array.isArray(linkHeader)
              ? linkHeader.map((value) => rewriteNextAssetReferences(value, serviceFromUrl))
              : rewriteNextAssetReferences(linkHeader, serviceFromUrl);
            headers.link = rewrittenLink;
            headers.Link = rewrittenLink;
          }
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

  // CRITICAL: Detect if we're in main app context to ignore UI cookie
  // Check referer header to see if request is from main app pages
  const referer = event.node.req.headers.referer || event.node.req.headers.referrer || '';
  const acceptHeader = (event.node.req.headers.accept || '').toString();
  const isHtmlRequest = acceptHeader.includes('text/html');
  const isMainAppContext =
    referer.includes('/services/') ||
    reqUrl.startsWith('/services/') ||
    reqUrl.startsWith('/_nuxt/') ||
    (isHtmlRequest && !reqUrl.startsWith('/ui/') && !reqUrl.startsWith('/service/ui/'));

  // Normalize /ui/{service} URLs early - decode and sanitize service names
  const uiPathMatch = reqUrl.match(/^\/ui\/([^/?]+)(.*)/);
  if (uiPathMatch) {
    const rawService = uiPathMatch[1];
    const pathRemainder = uiPathMatch[2];
    // Normalize: decode URL encoding, lowercase, replace spaces and forward slashes with underscores
    const normalized = decodeURIComponent(rawService).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
    if (normalized !== rawService) {
      const normalizedUrl = `/ui/${normalized}${pathRemainder}`;
      console.log('[URL Normalization]:', reqUrl, '->', normalizedUrl);
      reqUrl = normalizedUrl;
      event.node.req.url = normalizedUrl;
    }
  }

  const fetchDest = (event.node.req.headers['sec-fetch-dest'] || '').toString();
  const isNavigation =
    fetchDest === 'document' ||
    fetchDest === 'iframe' ||
    (!fetchDest && isHtmlRequest);
  const sessionId = getSessionId(event.node.req);

  // IMPORTANT: Set cookie early for /ui/{service} requests to ensure subrequests use correct service
  const urlServiceMatch = reqUrl.match(/^\/ui\/([^/?]+)/);
  if (urlServiceMatch) {
    const urlService = urlServiceMatch[1]; // Already normalized above

    // Prevent direct navigation to /ui/{service} URLs (should only be accessed in iframe)
    // If this is a document navigation (not iframe), redirect to home page
    const uiDocumentRefererPath = (() => {
      try {
        return referer ? new URL(referer).pathname : null;
      } catch {
        return null;
      }
    })();
    const urlServiceType = getServiceType(urlService);
    const cookieServiceForUiDocument = getCookieService(event.node.req);
    const pageRefererServiceForUiDocument = getPageServiceFromReferer(event.node.req);
    const isEmbeddedUiDocumentNavigation =
      Boolean(referer && /^https?:\/\/[^/]+\/(?:service\/ui|ui)\//.test(referer)) ||
      Boolean(pageRefererServiceForUiDocument === urlService) ||
      Boolean(
        referer &&
        cookieServiceForUiDocument === urlService &&
        urlServiceType &&
        ROOT_NAVIGATION_SERVICES.has(urlServiceType) &&
        isRootNavigationServicePath(uiDocumentRefererPath)
      );
    if (isNavigation && fetchDest === 'document' && !isEmbeddedUiDocumentNavigation) {
      console.log('[Direct UI Navigation] Redirecting to home:', reqUrl);
      clearUiCookie(event.node.res);
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
    const reqHeaders = event.node.req.headers || {};
    const hasArrClientHeader = Object.keys(reqHeaders).some((key) => ARR_CLIENT_HEADERS.has(key));
    const hasArrApiKeyHeader = Boolean(reqHeaders['x-api-key']);
    const hasArrApiHeaders = hasArrClientHeader || hasArrApiKeyHeader;

    // Get cached service for this session (helps with timing issue where cookie hasn't updated yet)
    const cachedService = sessionId ? sessionServiceCache.get(sessionId) : null;

    // Get service types for routing decisions
    const cookieServiceType = getServiceType(cookieService);
    const uiRefererServiceType = getServiceType(uiRefererService);
    const cachedServiceType = getServiceType(cachedService);

    const reqPathname = (() => {
      try {
        return new URL(reqUrl, 'http://local').pathname;
      } catch {
        return reqUrl.split('?')[0] || reqUrl;
      }
    })();

    const rootRouteUrl = (() => {
      try {
        return new URL(reqUrl, 'http://local');
      } catch {
        return null;
      }
    })();
    const refererUrl = (() => {
      try {
        return referer ? new URL(referer) : null;
      } catch {
        return null;
      }
    })();
    const refererPathname = refererUrl?.pathname || null;
    const isNextRscRequest = Boolean(rootRouteUrl?.searchParams?.has('_rsc'));
    const nextIframeContextService =
      cookieService && isNextRootPathService(cookieService, cookieServiceType)
        ? cookieService
        : cachedService && isNextRootPathService(cachedService, cachedServiceType)
          ? cachedService
          : null;
    const nextIframeContextServiceType = getServiceType(nextIframeContextService);
    const pageRefererLooksLikeDmbdbService = Boolean(pageRefererService && getServiceType(pageRefererService));
    const isAmbiguousRootReferer = refererPathname === '/';
    const isNextAppIframeContext = Boolean(
      nextIframeContextService &&
      refererPathname &&
      !isAmbiguousRootReferer &&
      isNextAppIframeRefererPath(refererPathname) &&
      !pageRefererLooksLikeDmbdbService
    );

    if (
      fetchDest !== 'document' &&
      uiRefererService &&
      isNextRootPathService(uiRefererService, uiRefererServiceType) &&
      isNextAppRoutePath(reqPathname) &&
      !reqUrl.startsWith('/ui/') &&
      !reqUrl.startsWith('/service/ui/')
    ) {
      const target = `/ui/${uiRefererService}${reqUrl}`;
      console.log('[Next App Route Referer] Rewriting:', reqUrl, '->', target, 'Service:', uiRefererService);
      setUiCookie(event.node.res, uiRefererService);
      if (sessionId) {
        sessionServiceCache.set(sessionId, uiRefererService);
      }
      event.node.req.url = target;
      reqUrl = target;
    } else if (
      fetchDest !== 'document' &&
      (isNextRscRequest || isNextAppIframeContext) &&
      nextIframeContextService &&
      isNextRootPathService(nextIframeContextService, nextIframeContextServiceType) &&
      isNextAppRoutePath(reqPathname) &&
      !reqUrl.startsWith('/ui/') &&
      !reqUrl.startsWith('/service/ui/')
    ) {
      const target = `/ui/${nextIframeContextService}${reqUrl}`;
      console.log('[Next RSC Cookie Route] Rewriting:', reqUrl, '->', target, 'Service:', nextIframeContextService);
      event.node.req.url = target;
      reqUrl = target;
    }

    const isRootRouteEntryPath = ROOT_ROUTE_ENTRY_PATHS.has(reqPathname);
    const isServiceLoginRedirect =
      reqPathname === '/login' &&
      (rootRouteUrl?.searchParams?.has('returnUrl') || rootRouteUrl?.searchParams?.has('returnUrl'.toLowerCase()));
    const isServiceLogoutRedirect = reqPathname === '/logout';
    const isIframeRootNavigation = reqPathname === '/' && fetchDest === 'iframe';
    const isRootDocumentServiceLoginReturn =
      reqPathname === '/' &&
      fetchDest === 'document' &&
      refererPathname === '/login' &&
      Boolean(refererUrl?.searchParams?.has('redirect_uri'));
    const isRootNavigationServiceDocumentPath =
      fetchDest === 'document' &&
      isRootNavigationServicePath(reqPathname);

    const rootRouteServiceFromReferer =
      uiRefererService &&
      (uiRefererServiceType ? isRootRouteServiceType(uiRefererServiceType) : true)
        ? uiRefererService
        : null;
    const rootRouteServiceFromCookie =
      (fetchDest !== 'document' || (cookieServiceType && ROOT_NAVIGATION_SERVICES.has(cookieServiceType) && isRootNavigationServiceDocumentPath)) &&
      !pageRefererService &&
      isNavigation &&
      cookieService &&
      cookieServiceType &&
      isRootRouteServiceType(cookieServiceType) &&
      (isServiceLoginRedirect || isServiceLogoutRedirect || isIframeRootNavigation || isRootDocumentServiceLoginReturn || isRootNavigationServiceDocumentPath || (ROOT_ROUTE_SERVICES.has(cookieServiceType) && isRootRouteEntryPath))
        ? cookieService
        : null;
    const rootRouteServiceFromCache =
      (fetchDest !== 'document' || (cachedServiceType && ROOT_NAVIGATION_SERVICES.has(cachedServiceType) && isRootNavigationServiceDocumentPath)) &&
      !pageRefererService &&
      isNavigation &&
      cachedService &&
      cachedServiceType &&
      isRootRouteServiceType(cachedServiceType) &&
      (isServiceLoginRedirect || isServiceLogoutRedirect || isIframeRootNavigation || isRootDocumentServiceLoginReturn || isRootNavigationServiceDocumentPath || (ROOT_ROUTE_SERVICES.has(cachedServiceType) && isRootRouteEntryPath))
        ? cachedService
        : null;
    const tautulliAuthService =
      cookieService &&
      normalizeServiceName(cookieService).includes("tautulli") &&
      reqPathname.startsWith("/auth/")
        ? cookieService
        : null;

    if (tautulliAuthService && !reqUrl.startsWith("/ui/")) {
      const target = "/ui/" + tautulliAuthService + reqUrl;
      console.log("[Tautulli Auth Route] Rewriting:", reqUrl, "->", target, "Service:", tautulliAuthService);
      event.node.req.url = target;
      reqUrl = target;
    }

    const rootRouteService = rootRouteServiceFromReferer || rootRouteServiceFromCookie || rootRouteServiceFromCache;
    const shouldRouteRootNavigation =
      rootRouteService &&
      (isNavigation || isHtmlRequest) &&
      reqUrl.startsWith('/') &&
      !reqUrl.startsWith('/api') &&
      !reqUrl.startsWith('/ws') &&
      !reqUrl.startsWith('/service/ui/') &&
      !reqUrl.startsWith('/ui/') &&
      !reqUrl.startsWith('/_nuxt/') &&
      !reqUrl.startsWith('/services/') &&
      !reqUrl.startsWith('/__nuxt') &&
      !reqUrl.startsWith('/__vite');

    if (shouldRouteRootNavigation) {
      const target = `/ui/${rootRouteService}${reqUrl}`;
      console.log('[Root Route UI Navigation] Redirecting:', reqUrl, '->', target, 'Service:', rootRouteService);
      setUiCookie(event.node.res, rootRouteService);
      if (sessionId) {
        sessionServiceCache.set(sessionId, rootRouteService);
      }
      event.node.res.statusCode = 307;
      event.node.res.setHeader('Location', target);
      event.node.res.end();
      return;
    }

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

    if (reqUrl.startsWith('/api')) {
      const arrApiPath = /^\/api\/v[0-9]+\//.test(reqUrl);
      const uiRefererServiceType = getServiceType(uiRefererService);
      const tpaApiPath = reqUrl.startsWith('/api/services') ||
        reqUrl.startsWith('/api/domains') ||
        reqUrl.startsWith('/api/security') ||
        reqUrl.startsWith('/api/sessions') ||
        reqUrl.startsWith('/api/traefik') ||
        reqUrl.startsWith('/api/backup') ||
        reqUrl.startsWith('/api/auth/admin') ||
        reqUrl.startsWith('/api/auth/sso') ||
        reqUrl.startsWith('/api/auth/shared-link');
      const dumbApiPath = isDumbApiPath(reqPathname);
      const embeddedApiContextService = uiRefererService || (nextIframeContextService && tpaApiPath ? nextIframeContextService : null);
      const apiRoutingService = embeddedApiContextService || (!isMainAppContext && !pageRefererService ? cookieService || cachedService : null);
      const apiRoutingServiceType = embeddedApiContextService
        ? getServiceType(embeddedApiContextService)
        : cookieService && apiRoutingService === cookieService
          ? cookieServiceType
          : cachedServiceType;
      const isTpaCookieApi =
        !isNavigation &&
        tpaApiPath &&
        apiRoutingService === 'traefik_proxy_admin' &&
        hasCookie(event.node.req, 'tpa-admin-session');
      const isEmbeddedServiceApiRequest =
        !isNavigation &&
        Boolean(embeddedApiContextService) &&
        (apiRoutingServiceType !== 'traefik_proxy_admin' || tpaApiPath);
      const isRootServiceApiRequest =
        !isNavigation &&
        !['/login', '/setup'].includes(refererPathname) &&
        apiRoutingServiceType &&
        ROOT_API_SERVICES.has(apiRoutingServiceType);
      const shouldRouteServiceApi =
        apiRoutingService &&
        (
          isEmbeddedServiceApiRequest ||
          isRootServiceApiRequest ||
          isTpaCookieApi ||
          (apiRoutingServiceType && arrApiPath && (SEERR_SERVICES.has(apiRoutingServiceType) || ARR_API_SERVICES.has(apiRoutingServiceType) || hasArrApiHeaders))
        );

      if (shouldRouteServiceApi) {
        const target = `/ui/${apiRoutingService}${reqUrl}`;
        event.node.req.url = target;
        reqUrl = target;
      } else if (dumbApiPath) {
        return new Promise((resolve, reject) => {
          apiProxy(event.node.req, event.node.res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    }

    const refererService = getServiceFromRefererHeader(event.node.req);

    // Determine which service context to use for subrequests
    // Priority order:
    // 1. Referer header (most reliable)
    // 2. Page referer (parent page context)
    // 3. Cached service (handles timing when cookie hasn't updated yet)
    // 4. Cookie service (fallback - but NOT if pageRefererService exists, as that indicates main app)
    let subrequestService = refererService;
    if (isNextAppIframeContext && subrequestService && !getServiceType(subrequestService)) {
      subrequestService = null;
    }
    if (!subrequestService && isNextAppIframeContext) {
      subrequestService = nextIframeContextService;
    }
    if (!subrequestService && pageRefererService) {
      // Use the parent page's service context (e.g., /services/pgAdmin4)
      subrequestService = pageRefererService;
    }
    if (!subrequestService && cachedService && (!isNavigation || isNextRootPath(reqPathname)) && (!isHtmlRequest || isNextRootPath(reqPathname))) {
      // Use cached service from session only for subrequests (not top-level navigations)
      subrequestService = cachedService;
      // Only log if this might actually be used for routing (not for /api or /ws paths)
      if (!reqUrl.startsWith('/api') && !reqUrl.startsWith('/ws')) {
        console.log('[Using Cached Service] Service:', cachedService, 'URL:', reqUrl);
      }
    }
    // Only use cookie for subrequests, not for top-level navigations.
    // pageRefererService indicates main app, and HTML navigations should not reuse iframe cookie.
    if (!subrequestService && !pageRefererService && (!isNavigation || isNextRootPath(reqPathname)) && (!isHtmlRequest || isNextRootPath(reqPathname)) && cookieService) {
      subrequestService = cookieService;
    }

    const subrequestServiceType = getServiceType(subrequestService);
    const nextRootPathService =
      subrequestService &&
      isNextRootPath(reqPathname) &&
      isNextRootPathService(subrequestService, subrequestServiceType)
        ? subrequestService
        : null;

    if (nextRootPathService && !reqUrl.startsWith('/ui/')) {
      const target = `/ui/${nextRootPathService}${reqUrl}`;
      console.log('[Next Root Asset] Rewriting:', reqUrl, '->', target, 'Service:', nextRootPathService);
      event.node.req.url = target;
      reqUrl = target;
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
      !reqUrl.startsWith('/ui/') &&
      !reqUrl.startsWith('/_nuxt/') &&  // Exclude Nuxt frontend assets
      !reqUrl.startsWith('/services/') &&  // Exclude main app service pages
      !reqUrl.startsWith('/__nuxt') &&  // Exclude Nuxt internal routes like __nuxt_devtools__
      !reqUrl.startsWith('/__vite');  // Exclude Vite internal routes

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
      // CRITICAL: Check if this is a Riven frontend API request
      // Riven frontend needs API calls routed to Riven backend, not DUMB backend
      if (cookieService === 'riven_frontend') {
        // Route to Riven backend via Traefik
        const rivenApiUrl = `/service/ui/riven_backend${reqUrl}`;
        console.log('[Riven API] Routing to Riven backend:', reqUrl, '->', rivenApiUrl);
        event.node.req.url = rivenApiUrl;
        reqUrl = rivenApiUrl;

        // CRITICAL: Rewrite Referer and Origin headers to bypass CSRF protection
        // Riven backend checks these headers for POST requests
        const originalReferer = event.node.req.headers['referer'];
        const originalOrigin = event.node.req.headers['origin'];

        if (originalReferer) {
          // Rewrite referer to appear as if coming from Riven frontend directly
          event.node.req.headers['referer'] = 'http://localhost:3000/';
          console.log('[Riven API] Rewriting Referer:', originalReferer, '->', event.node.req.headers['referer']);
        }

        if (originalOrigin) {
          // Rewrite origin to match Riven's expected origin
          event.node.req.headers['origin'] = 'http://localhost:3000';
          console.log('[Riven API] Rewriting Origin:', originalOrigin, '->', event.node.req.headers['origin']);
        }

        // Fall through to UI service proxy below instead of using apiProxy
      } else {
        // Normal DUMB backend API request
        return new Promise((resolve, reject) => {
          apiProxy(event.node.req, event.node.res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    }

    // NOTE: All WebSocket handling has been moved to server/plugins/websocket.ts
    // WebSocket upgrades happen at the HTTP server level and never reach this middleware

    // Ignore unrelated requests EXCEPT for navigation to clear cookies
    const isProxyRequest =
      reqUrl.startsWith('/api') ||
      reqUrl.startsWith('/ws') ||
      reqUrl.startsWith('/service/ui/') ||
      reqUrl.startsWith('/ui/');

    if (
      !isProxyRequest &&
      (isNavigation || isHtmlRequest) &&
      cookieService &&
      cookieServiceType &&
      ROOT_NAVIGATION_SERVICES.has(cookieServiceType) &&
      isRootNavigationServicePath(reqPathname)
    ) {
      const target = '/ui/' + cookieService + reqUrl;
      console.log('[Root Navigation Cookie Fallback] Redirecting:', reqUrl, '->', target, 'Service:', cookieService);
      setUiCookie(event.node.res, cookieService);
      if (sessionId) {
        sessionServiceCache.set(sessionId, cookieService);
      }
      event.node.res.statusCode = 307;
      event.node.res.setHeader('Location', target);
      event.node.res.end();
      return;
    }

    // Clear UI service cookie when navigating to non-UI pages (main app pages).
    // Never clear on root service asset paths; some embedded UIs preload them with HTML-like headers.
    if (!isProxyRequest && isDumbMainNavigationPath(reqPathname) && (isNavigation || isHtmlRequest) && cookieService) {
      // User is navigating to a main app page while having a UI service cookie set
      // Clear the cookie to prevent interference
      clearUiCookie(event.node.res);
      console.log('[Cookie Clear] Clearing UI service cookie for main app navigation:', reqUrl);
      if (sessionId) {
        sessionServiceCache.delete(sessionId);
      }
    }

    if (!isProxyRequest) {
      return;
    }

    if (reqUrl.startsWith('/service/ui/') || reqUrl.startsWith('/ui/')) {
      // CRITICAL FIX: Handle broken SvelteKit paths like /ui/_app/...
      // When SvelteKit apps dynamically load assets, they may use incorrect paths
      // If we detect /ui/_app/... and have a riven_frontend cookie, rewrite to correct path
      if (reqUrl.startsWith('/ui/_app/') && cookieService === 'riven_frontend') {
        const correctedUrl = reqUrl.replace('/ui/_app/', '/ui/riven_frontend/_app/');
        console.log('[SvelteKit Fix] Rewriting broken path:', reqUrl, '->', correctedUrl);
        reqUrl = correctedUrl;
        event.node.req.url = correctedUrl;
      }

      // Set cookie BEFORE proxying by calling the middleware
      // We need to wrap the call to ensure cookie is set first
      const serviceFromUrl = getServiceFromRequestUrl(reqUrl);
      const accept = event.node.req.headers.accept || '';
      console.log('[UI Service Request]:', reqUrl, 'Service:', serviceFromUrl, 'Accept:', accept);

      // Add X-Forwarded-Ssl header for Tautulli HTTPS detection
      // If request came via HTTPS (has X-Forwarded-Proto: https), add X-Forwarded-Ssl: on
      const proto = event.node.req.headers['x-forwarded-proto'];
      if (proto === 'https') {
        event.node.req.headers['x-forwarded-ssl'] = 'on';
      }

      if (serviceFromUrl) {
        setUiCookie(event.node.res, serviceFromUrl);
      }

      const reqPath = reqUrl.split('?')[0];
      // NeutArr: force stats loader kick-off for embedded UI if it never triggers
      const neutarrMainPath = '/static/js/new-main.js';
      if (serviceFromUrl && serviceFromUrl.toLowerCase().includes('neutarr') && reqPath.endsWith(neutarrMainPath)) {
        const proxyUrl = `${traefikUrl}${reqUrl.replace(/^\/ui\//, '/service/ui/')}`;
        try {
          const response = await fetch(proxyUrl, {
            method: event.node.req.method,
            headers: {
              ...event.node.req.headers,
              host: new URL(traefikUrl).host,
            },
          });

          if (response.ok) {
            let body = await response.text();
            body += `\n;(function(){\n  if (window.__dumbStatsKickoff) return;\n  window.__dumbStatsKickoff = true;\n  window.addEventListener('load', function(){\n    if (window.neutarrUI && typeof window.neutarrUI.loadMediaStats === 'function') {\n      try { window.neutarrUI.loadMediaStats(); } catch (_) {}\n    }\n  });\n})();\n`;
            event.node.res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              const lowerKey = key.toLowerCase();
              if (lowerKey !== 'content-length' &&
                  lowerKey !== 'content-encoding' &&
                  lowerKey !== 'transfer-encoding') {
                event.node.res.setHeader(key, value);
              }
            });
            event.node.res.end(body);
            return;
          }
        } catch (err) {
          console.error('[NeutArr Main Patch] Failed to intercept:', err?.message || err);
          // Fall through to normal proxy
        }
      }

      // CRITICAL FIX: For Tautulli, intercept navigation requests to rewrite HTTP redirects to HTTPS
      // This is necessary because Tautulli doesn't respect X-Forwarded-Proto/X-Forwarded-Ssl headers
      const incomingProto = event.node.req.headers['x-forwarded-proto'];
      if (serviceFromUrl === 'tautulli' && incomingProto === 'https' && !reqUrl.includes('.')) {
        // This looks like a navigation request (no file extension)
        const proxyUrl = `${traefikUrl}${reqUrl.replace(/^\/ui\//, '/service/ui/')}`;

        try {
          const response = await fetch(proxyUrl, {
            method: event.node.req.method,
            headers: {
              ...event.node.req.headers,
              host: new URL(traefikUrl).host,
            },
            redirect: 'manual', // Don't follow redirects, we need to rewrite them
          });

          // Check if it's a redirect response
          if (response.status >= 300 && response.status < 400) {
            let location = response.headers.get('location');
            if (location) {
              // Rewrite HTTP to HTTPS and replace internal host with external host
              const urlMatch = location.match(/^https?:\/\/([^/]+)(\/.*)?$/);
              if (urlMatch) {
                const path = urlMatch[2] || '/';
                const externalHost = event.node.req.headers['x-forwarded-host'] || event.node.req.headers['host'];
                location = `https://${externalHost}${path}`;
              }

              event.node.res.statusCode = response.status;
              event.node.res.setHeader('Location', location);
              response.headers.forEach((value, key) => {
                const lowerKey = key.toLowerCase();
                // Exclude headers that shouldn't be copied for redirect responses
                if (lowerKey !== 'location' &&
                    lowerKey !== 'content-length' &&
                    lowerKey !== 'content-encoding' &&
                    lowerKey !== 'transfer-encoding') {
                  event.node.res.setHeader(key, value);
                }
              });
              event.node.res.end();
              return; // Exit - don't call uiServiceProxy
            }
          }

          // Not a redirect, fall through to normal proxy
        } catch (err) {
          console.error('[Tautulli HTTPS Fix] Failed to intercept redirect:', err.message);
          // Fall through to normal proxy
        }
      }

      // ARR apps: strip /ui/{service} prefix before the SPA boots to avoid initial NotFound route
      // We only do this for HTML navigations; asset/API requests are unaffected.
      const serviceType = getServiceType(serviceFromUrl);
      const isArrService = serviceType && ARR_API_SERVICES.has(serviceType);
      if (isArrService) {
        const accept = event.node.req.headers.accept || '';
        const method = String(event.node.req.method || 'GET').toUpperCase();
        const isHtmlNavigation = accept.includes('text/html') && (method === 'GET' || method === 'HEAD');
        if (isHtmlNavigation) {
          const proxyUrl = `${traefikUrl}${reqUrl.replace(/^\/ui\//, '/service/ui/')}`;
          const proxyHeaders = {
            ...event.node.req.headers,
            host: new URL(traefikUrl).host,
            'accept-encoding': 'identity',
          };
          delete proxyHeaders['content-length'];

          try {
            const response = await fetch(proxyUrl, {
              method: event.node.req.method,
              headers: proxyHeaders,
              redirect: 'manual',
            });

            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get('location');
              if (location) {
                const rewritten = rewriteUiLocation(reqUrl, location) || location;
                event.node.res.statusCode = response.status;
                event.node.res.setHeader('Location', rewritten);
                response.headers.forEach((value, key) => {
                  const lowerKey = key.toLowerCase();
                  if (lowerKey !== 'location' &&
                      lowerKey !== 'content-length' &&
                      lowerKey !== 'content-encoding' &&
                      lowerKey !== 'transfer-encoding') {
                    event.node.res.setHeader(key, rewriteNextAssetReferences(value, serviceFromUrl));
                  }
                });
                event.node.res.end();
                return;
              }
            }

            if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
              let body = await response.text();
              const routerFixScript = `<script>
(function() {
  var path = window.location.pathname;
  if (path.indexOf("/ui/") === 0) {
    var rest = path.slice(4);
    var slashIndex = rest.indexOf("/");
    var newPath = slashIndex === -1 ? "/" : rest.slice(slashIndex);
    if (!newPath.startsWith("/")) newPath = "/" + newPath;
    window.history.replaceState(null, "", newPath + window.location.search + window.location.hash);
  }
})();
</script>`;

              const headMatch = body.match(/<head[^>]*>/i);
              if (headMatch) {
                const headTag = headMatch[0];
                const headEndPos = headMatch.index + headTag.length;
                body = body.substring(0, headEndPos) + routerFixScript + body.substring(headEndPos);
              } else if (/<html[^>]*>/i.test(body)) {
                body = body.replace(/<html[^>]*>/i, (match) => `${match}<head>${routerFixScript}</head>`);
              }

              event.node.res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                const lowerKey = key.toLowerCase();
                if (lowerKey !== 'content-length' &&
                    lowerKey !== 'content-encoding' &&
                    lowerKey !== 'transfer-encoding' &&
                    lowerKey !== 'content-security-policy' &&
                    lowerKey !== 'content-security-policy-report-only') {
                  event.node.res.setHeader(key, value);
                }
              });
              event.node.res.end(body);
              return;
            }
          } catch (err) {
            console.error('[ARR Router Fix] Failed to intercept:', err?.message || err);
          }
        }
      }

      // For React/SvelteKit SPA services and services with absolute /static/ paths,
      // intercept HTML responses and inject base tag
      // Only intercept if:
      // 1. It's a known SPA service or static-path service
      // 2. The request accepts HTML (navigation request)
      // 3. It's not a manifest file or other JSON resource
      const isNextRootPathApp = serviceFromUrl && isNextRootPathService(serviceFromUrl, serviceType);
      const shouldInterceptSPA = serviceFromUrl &&
        (isNextRootPathApp || REACT_SPA_SERVICES.has(serviceFromUrl) || SVELTEKIT_SPA_SERVICES.has(serviceFromUrl) ||
         isStaticPathService(serviceFromUrl) || isStaticPathService(serviceType));

      if (shouldInterceptSPA) {
        const accept = event.node.req.headers.accept || '';
        // Check if this is a manifest or data request (not HTML navigation)
        // React Router uses _manifest paths and __* query parameters
        const urlPath = reqUrl.split('?')[0]; // Path without query string
        const fullUrl = reqUrl; // Full URL with query string
        const isManifestOrDataRequest =
          urlPath.includes('manifest') ||
          urlPath.includes('__') ||  // Paths with __ like __manifestPatches
          urlPath.includes('/_') ||  // Paths starting with /ui/service/_manifest or /_app
          fullUrl.includes('__manifest') ||  // Query params like ?__manifestPatches=...
          accept.includes('application/json') ||
          accept === '*/*';  // React Router manifest fetches use Accept: */*
        const method = String(event.node.req.method || 'GET').toUpperCase();
        const isHtmlNavigation = accept.includes('text/html') && !isManifestOrDataRequest && (method === 'GET' || method === 'HEAD');

        // Debug logging for manifest requests
        if (isManifestOrDataRequest) {
          console.log('[SPA] Skipping interception for data request:', reqUrl, 'Accept:', accept);
        }

        if (isHtmlNavigation) {
          console.log('[SPA] Intercepting HTML for:', serviceFromUrl, reqUrl);

          // Proxy the request manually to intercept the response
          const proxyUrl = `${traefikUrl}${reqUrl.replace(/^\/ui\//, '/service/ui/')}`;
          const proxyHeaders = {
            ...event.node.req.headers,
            host: new URL(traefikUrl).host,
            'accept-encoding': 'identity',
          };
          delete proxyHeaders['content-length'];

          try {
            const response = await fetch(proxyUrl, {
              method: event.node.req.method,
              headers: proxyHeaders,
              redirect: 'manual',
            });

            console.log('[SPA] Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get('location');
              if (location) {
                const rewritten = rewriteUiLocation(reqUrl, location) || location;
                event.node.res.statusCode = response.status;
                event.node.res.setHeader('Location', rewritten);
                response.headers.forEach((value, key) => {
                  const lowerKey = key.toLowerCase();
                  if (lowerKey !== 'location' &&
                      lowerKey !== 'content-length' &&
                      lowerKey !== 'content-encoding' &&
                      lowerKey !== 'transfer-encoding') {
                    event.node.res.setHeader(key, value);
                  }
                });
                event.node.res.end();
                return;
              }
            }

            // Only inject base tag if we got HTML (2xx status and HTML content type)
            if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
              let body = await response.text();
              const basePath = `/ui/${serviceFromUrl}/`;
              const baseTag = isNextRootPathApp ? '' : `<base href="${basePath}">`;
              body = body.replace(/<base\b[^>]*>/gi, '');

              // For embedded SPAs, strip /ui/{service} before the client router hydrates.
              // Next apps otherwise render SSR HTML but leave click handlers dead because the client
              // route does not exist at the proxied /ui/{service}/... path.
              const isReactSPA = REACT_SPA_SERVICES.has(serviceFromUrl) ||
                REACT_SPA_SERVICES.has(serviceType) ||
                (isStaticPathService(serviceFromUrl) && serviceFromUrl.toLowerCase().includes('nzbdav'));
              const needsRouterPrefixStrip = isReactSPA || isNextRootPathApp;
              const routerFixScript = needsRouterPrefixStrip ? `<script>
(function() {
  var base = "${basePath.replace(/\/$/,'')}";
  var path = window.location.pathname;
  if (path === base || path.indexOf(base + "/") === 0) {
    var newPath = path.slice(base.length) || '/';
    if (newPath.charAt(0) !== '/') newPath = '/' + newPath;
    var newUrl = newPath + window.location.search + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }
})();
</script>` : '';

              const storageGuardScript = `<script>
(function() {
  var protectedPrefixes = ['dumb_', 'sidebar.', 'dashboard.', 'metrics.'];
  var protectedExact = ['theme'];
  function shouldProtect(key) {
    key = String(key || '');
    if (protectedExact.indexOf(key) !== -1) return true;
    for (var i = 0; i < protectedPrefixes.length; i += 1) {
      if (key.indexOf(protectedPrefixes[i]) === 0) return true;
    }
    return false;
  }
  try {
    var proto = window.Storage && window.Storage.prototype;
    if (!proto || proto.__dumbEmbeddedGuarded) return;
    var removeItem = proto.removeItem;
    var clear = proto.clear;
    proto.removeItem = function(key) {
      if (shouldProtect(key)) return;
      return removeItem.call(this, key);
    };
    proto.clear = function() {
      var kept = [];
      for (var i = 0; i < this.length; i += 1) {
        var key = this.key(i);
        if (shouldProtect(key)) kept.push([key, this.getItem(key)]);
      }
      clear.call(this);
      for (var j = 0; j < kept.length; j += 1) {
        try { this.setItem(kept[j][0], kept[j][1]); } catch (_) {}
      }
    };
    try { Object.defineProperty(proto, '__dumbEmbeddedGuarded', { value: true }); } catch (_) {}
  } catch (_) {}
})();
</script>`;

              console.log('[SPA] Injecting base tag:', baseTag, 'Router prefix strip:', needsRouterPrefixStrip);
              console.log('[SPA] Original HTML length:', body.length);

              // Inject base tag, storage guard, and router fix script right after <head> opening tag
              const injection = baseTag + storageGuardScript + routerFixScript;
              const headMatch = body.match(/<head[^>]*>/i);
              if (headMatch) {
                const headTag = headMatch[0];
                const headEndPos = headMatch.index + headTag.length;
                body = body.substring(0, headEndPos) + injection + body.substring(headEndPos);
                console.log('[SPA] Injected tags after <head>');
              } else if (/<html[^>]*>/i.test(body)) {
                body = body.replace(/<html[^>]*>/i, (match) => `${match}<head>${injection}</head>`);
                console.log('[SPA] Injected tags in new <head>');
              } else {
                console.log('[SPA] Could not find <head> or <html> tag');
              }

              console.log('[SPA] Modified HTML length:', body.length);
              console.log('[SPA] First 200 chars of modified HTML:', body.substring(0, 200));

              event.node.res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                const lowerKey = key.toLowerCase();
                // Exclude content-length, content-encoding, and transfer-encoding
                // because we're sending uncompressed modified HTML
                if (lowerKey !== 'content-length' &&
                    lowerKey !== 'content-encoding' &&
                    lowerKey !== 'transfer-encoding') {
                  event.node.res.setHeader(key, rewriteNextAssetReferences(value, serviceFromUrl));
                }
              });
              event.node.res.end(body);
              console.log('[SPA] Response sent and handler exiting, body length:', body.length);
              return; // Exit the handler - don't call uiServiceProxy
            } else {
              console.log('[SPA] Not HTML or non-OK status, falling through to normal proxy');
              // Fall through to normal proxy
            }
          } catch (err) {
            console.error('[SPA] Failed to intercept:', err);
            // Fall through to normal proxy
          }
        }
      }

      if (serviceFromUrl && isNextRootPathApp && reqUrl.includes('/_next/')) {
        const assetPath = reqUrl.replace(new RegExp(`^/ui/${serviceFromUrl}`), '');
        const candidates = [
          `${traefikUrl}/service/ui/${serviceFromUrl}${assetPath}`,
          `http://127.0.0.1:3004${assetPath}`,
        ];
        for (const assetUrl of candidates) {
          try {
            const response = await fetch(assetUrl, {
              method: event.node.req.method,
              headers: {
                ...event.node.req.headers,
                host: new URL(assetUrl).host,
              },
              redirect: 'manual',
            });
            if (response.ok) {
              event.node.res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                const lowerKey = key.toLowerCase();
                if (lowerKey !== 'content-length' &&
                    lowerKey !== 'content-encoding' &&
                    lowerKey !== 'transfer-encoding') {
                  event.node.res.setHeader(key, rewriteNextAssetReferences(value, serviceFromUrl));
                }
              });
              const buffer = Buffer.from(await response.arrayBuffer());
              event.node.res.end(buffer);
              return;
            }
          } catch (err) {
            console.error('[TPA Asset Fallback] Failed:', assetUrl, err?.message || err);
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
