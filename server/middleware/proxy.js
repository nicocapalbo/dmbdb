import { createProxyMiddleware } from 'http-proxy-middleware';

const proxyOptions = {
  target: 'http://localhost:8000', // Backend server
  changeOrigin: true,
};

export default defineEventHandler(async (event) => {
  const reqUrl = event.node.req.url;

  try {
    // Handle API requests
    if (reqUrl.startsWith('/api')) {
      const apiProxy = createProxyMiddleware({
        ...proxyOptions,
        pathRewrite: { '^/api': '' }, // Remove '/api' prefix
      });

      return new Promise((resolve, reject) => {
        apiProxy(event.node.req, event.node.res, (err) => {
          if (err) {
            console.error('[API Proxy Error]:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Handle WebSocket requests
    if (reqUrl.startsWith('/ws')) {
      const wsProxy = createProxyMiddleware({
        ...proxyOptions,
        ws: true, // Enable WebSocket proxying
        pathRewrite: { '^/ws': '/ws' }, // Keep '/ws' prefix
      });

      return new Promise((resolve, reject) => {
        wsProxy(event.node.req, event.node.res, (err) => {
          if (err) {
            console.error('[WebSocket Proxy Error]:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  } catch (error) {
    console.error('[Proxy Middleware Error]:', error);
    throw error;
  }
});
