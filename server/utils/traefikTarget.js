export const resolveTraefikTarget = ({ env = process.env, apiUrl } = {}) => {
  const configured = env.DMB_TRAEFIK_URL || env.DUMB_TRAEFIK_URL;
  if (configured) return String(configured).replace(/\/$/, '');

  try {
    const api = new URL(apiUrl || 'http://localhost:8000');
    api.port = '18080';
    api.pathname = '/';
    api.search = '';
    api.hash = '';
    return api.toString().replace(/\/$/, '');
  } catch {
    return 'http://127.0.0.1:18080';
  }
};
