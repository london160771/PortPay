const envValue = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

export function resolveRuntimeUrl(name: 'PUBLIC_APP_URL' | 'CORS_ORIGIN', value: string | undefined, production: boolean): string {
  const url = value?.trim();
  if (!url && production) throw new Error(`${name} is required in production.`);
  return (url || 'http://localhost:5173').replace(/\/$/, '');
}

export const runtimeConfig = {
  publicAppUrl: resolveRuntimeUrl('PUBLIC_APP_URL', envValue('PUBLIC_APP_URL'), process.env.NODE_ENV === 'production'),
  corsOrigin: resolveRuntimeUrl('CORS_ORIGIN', envValue('CORS_ORIGIN'), process.env.NODE_ENV === 'production'),
} as const;
