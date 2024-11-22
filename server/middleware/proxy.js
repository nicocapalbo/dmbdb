import { createProxyMiddleware } from 'http-proxy-middleware';

export default defineEventHandler(async (event) => {
  const reqUrl = event.req.url;

  // Apply the proxy only for specific routes (e.g., /api and /ws)
  if (reqUrl.startsWith('/api') || reqUrl.startsWith('/ws')) {
    const proxy = createProxyMiddleware({
      target: 'http://localhost:8000', // Backend server
      changeOrigin: true,
      ws: true, // Enable WebSocket proxying
      pathRewrite: {
        '^/api': '', // Remove '/api' prefix when forwarding
        '^/ws': '/ws', // Keep '/ws' prefix
      },
    });

    return new Promise((resolve, reject) => {
      proxy(event.req, event.res, (err) => {
        if (err) {
          console.error('[Proxy Error]:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
});
