/**
 * Model labels on a phone are read at a glance, so the wire identifier is not
 * what should be shown. Hermes reports models as `provider/model` (for example
 * `deepseek/deepseek-v4.1-flash`), and the provider segment is both redundant
 * with the model name and long enough to be truncated in the composer.
 *
 * The provider is still kept alongside the model wherever the app needs it for
 * comparisons and RPC calls — this only affects what the user reads.
 */
export function formatModelName(value?: string | null): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const segments = raw.split('/').filter(Boolean)
  return segments.length ? segments[segments.length - 1] : raw
}

/** Falls back to a readable placeholder when no model has been resolved yet. */
export function modelLabel(value?: string | null, fallback = 'Hermes default'): string {
  return formatModelName(value) || fallback
}
