function normalized(name) {
  return String(process.env[name] || '').trim().toLowerCase();
}

export function isProductionRuntime() {
  if (normalized('RAILWAY_ENVIRONMENT') === 'production') return true;
  if (normalized('RAILWAY_ENVIRONMENT_NAME') === 'production') return true;
  if (normalized('NODE_ENV') === 'production') return true;
  return false;
}

export function devApiBypassEnabled() {
  if (isProductionRuntime()) return false;
  const nodeEnv = normalized('NODE_ENV');
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return false;
  return String(process.env.DEV_API_SECRET || '').trim().length > 0;
}

export function readDevApiSecret() {
  if (!devApiBypassEnabled()) return '';
  return String(process.env.DEV_API_SECRET || '').trim();
}
