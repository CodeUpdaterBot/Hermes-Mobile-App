/**
 * A promise that cannot wait forever.
 *
 * Used for native answers the OS owns — an Android runtime-permission result, for instance —
 * where the reply can simply never arrive: a plugin callback that was never registered, or an
 * activity recreated while the dialog was up. An unbounded await then leaves the UI spinning
 * with no error and nothing to retry, which is worse than a definite "no answer". The deadline
 * turns that into a settled promise the caller can act on.
 */
export function withDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    const settle = (value: T | null) => { clearTimeout(timer); resolve(value) }
    // A rejected call is an absence of an answer, not a crash: the caller reads state instead.
    promise.then(settle, () => settle(null))
  })
}
