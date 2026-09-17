const envValue = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

export const runtimeConfig = {
  publicAppUrl: envValue('PUBLIC_APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigin: envValue('CORS_ORIGIN', 'http://localhost:5173'),
} as const;
