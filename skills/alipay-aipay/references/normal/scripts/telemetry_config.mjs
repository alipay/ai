// Prefer public switches while preserving the pre-rename aliases and stop controls.
const disabled = value => ['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase());
export function collectionEnabled(env, suffix = 'TELEMETRY') {
  const current = env['ALIPAY_AIPAY_' + suffix];
  const legacy = env['ALIPAY_AIPAY_NEW_' + suffix];
  if (disabled(current) || disabled(legacy)) return false;
  // The public switch historically accepts any non-disabled value (including true).
  if (current !== undefined) return true;
  return legacy === undefined || String(legacy).trim().toLowerCase() === 'local';
}
export function uploadEnabled(env) {
  return !disabled(env.ALIPAY_AIPAY_TELEMETRY_UPLOAD)
    && !disabled(env.ALIPAY_AIPAY_NEW_TELEMETRY_UPLOAD)
    && ![env.ALIPAY_AIPAY_TELEMETRY_CAPTURE_ONLY, env.ALIPAY_AIPAY_NEW_TELEMETRY_CAPTURE_ONLY]
      .some(value => String(value ?? '').trim() === '1');
}
export function configuredPath(env, suffix) {
  return env['ALIPAY_AIPAY_' + suffix] || env['ALIPAY_AIPAY_NEW_' + suffix] || '';
}
