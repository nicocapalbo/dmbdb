import { createProxyMiddleware } from 'http-proxy-middleware';
import { useRuntimeConfig } from '#imports';

let apiProxy;
let wsProxy;
let uiServiceProxy;

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiUrl = config.public.DMB_API_URL || 'http://localhost:8000';

  if (!apiProxy) {
    apiProxy = createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
      pathRewrite: { '^/api': '' },
    });
  }

  if (!wsProxy) {
    wsProxy = createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
      ws: true,
    });
  }

  if (!uiServiceProxy) {
    uiServiceProxy = createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
      pathRewrite: { '^/service/ui': '/service/ui' },
    });
  }

  const reqUrl = event.node.req.url;

  try {
    // Ignore unrelated requests
    if (!reqUrl.startsWith('/api') && !reqUrl.startsWith('/ws') && !reqUrl.startsWith('/service/ui/')) {
      return;
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

    // Handle WebSocket Handling
    if (reqUrl.startsWith('/ws') && event.node.req.headers.upgrade === 'websocket') {
      console.log('[Proxy] Handling WebSocket connection for:', reqUrl);
      return new Promise((resolve, reject) => {
        wsProxy(event.node.req, event.node.req.socket, event.node.req.head, (err) => {
          if (err) {
            console.error('[WebSocket Proxy Error]:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Handle UI service requests
    if (reqUrl.startsWith('/service/ui/')) {
      return new Promise((resolve, reject) => {
        uiServiceProxy(event.node.req, event.node.res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

  } catch (error) {
    console.error('[Proxy Middleware Error]:', error);
    throw error;
  }
});
