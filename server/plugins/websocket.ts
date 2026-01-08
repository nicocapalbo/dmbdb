import { createProxyMiddleware } from 'http-proxy-middleware';

// Helper to extract cookie value
const getCookieValue = (req: any, cookieName: string): string | null => {
  const cookie = req?.headers?.cookie;
  if (!cookie) return null;
  const entries = cookie.split(';');
  for (const entry of entries) {
    const [rawKey, rawValue] = entry.split('=');
    if (!rawKey) continue;
    const key = rawKey.trim();
    if (key !== cookieName) continue;
    return (rawValue || '').trim().toLowerCase() || null;
  }
  return null;
};

export default defineNitroPlugin((nitroApp) => {
  const apiUrl = process.env.DMB_API_URL || process.env.DUMB_API_URL || 'http://localhost:8000';
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

  const UI_SERVICE_COOKIE = 'dumb_ui_service';
  const WEB_UI_SERVICES = new Set(['emby', 'jellyfin']);
  const ARR_API_SERVICES = new Set(['radarr', 'sonarr', 'lidarr', 'whisparr', 'prowlarr']);

  // Create WebSocket proxy for DUMB's own endpoints
  const dumbWsProxy = createProxyMiddleware({
    target: apiUrl,
    changeOrigin: true,
    ws: true,
  });

  // Create WebSocket proxy for UI services via Traefik
  const uiWsProxy = createProxyMiddleware({
    target: traefikUrl,
    changeOrigin: false,
    ws: true,
    pathRewrite: (path: string) => path.replace(/^\/ui\//, '/service/ui/'),
  });

  // Hook into the Node.js server's upgrade event
  nitroApp.hooks.hook('request', (event) => {
    const server = (event.node.req.socket as any)?.server;

    if (server && !(server as any).__wsHandlerAttached) {
      console.log('[WebSocket Plugin] Attaching upgrade handler to server');
      (server as any).__wsHandlerAttached = true;

      server.on('upgrade', (req: any, socket: any, head: any) => {
        const url = req.url || '';
        console.log('[WebSocket Upgrade] URL:', url);

        // CRITICAL: Handle DUMB's own WebSocket endpoints FIRST
        // These are /ws/status, /ws/metrics, /ws/logs
        if (url.startsWith('/ws')) {
          console.log('[DUMB WebSocket] Routing to DUMB API:', url);
          (dumbWsProxy as any).upgrade(req, socket, head);
          return;
        }

        // Handle UI service WebSockets that already have /ui/ prefix
        if (url.startsWith('/ui/')) {
          console.log('[UI WebSocket] Routing to Traefik:', url);
          (uiWsProxy as any).upgrade(req, socket, head);
          return;
        }

        // Handle service WebSocket paths that need /ui/ prefix based on cookie
        // Examples: /socket (Jellyfin), /embywebsocket (Emby), /signalr (Servarr)
        const cookieService = getCookieValue(req, UI_SERVICE_COOKIE);
        console.log('[WebSocket] Cookie service:', cookieService, 'URL:', url);

        if (cookieService) {
          // Check if this is a service-specific WebSocket path
          let shouldRoute = false;

          // Jellyfin uses /socket
          if (url.startsWith('/socket') && WEB_UI_SERVICES.has(cookieService)) {
            shouldRoute = true;
          }
          // Emby uses /embywebsocket
          else if (url.startsWith(`/${cookieService}websocket`)) {
            shouldRoute = true;
          }
          // Servarr apps use /signalr
          else if (url.startsWith('/signalr') && ARR_API_SERVICES.has(cookieService)) {
            shouldRoute = true;
          }

          if (shouldRoute) {
            // Rewrite the URL to include /ui/{service} prefix
            req.url = `/ui/${cookieService}${url}`;
            console.log('[Service WebSocket] Rewriting:', url, '->', req.url, 'Service:', cookieService);
            (uiWsProxy as any).upgrade(req, socket, head);
            return;
          }
        }

        // If we get here, it's an unknown WebSocket path
        console.log('[WebSocket] Unknown path, destroying socket:', url);
        socket.destroy();
      });
    }
  });
});
