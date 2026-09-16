export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = String((reason as { message?: unknown }).message || '').trim()
    if (message) return message
  }
  return fallback
}

export function selectRestoredEndpoint(nativeEndpoint: string | null | undefined, legacyEndpoint: string | null | undefined, localEndpoint: string): string {
  return (nativeEndpoint || legacyEndpoint || localEndpoint).replace(/\/$/, '')
}

export function supportsBasicAuth(providers: unknown[] | undefined): boolean {
  return providers?.some(provider => provider === 'basic' || (
    typeof provider === 'object' && provider !== null && 'name' in provider && (provider as { name?: unknown }).name === 'basic'
  )) === true
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
  if (host === 'localhost') return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '0::1') return true
  // Full IPv4 loopback range 127.0.0.0/8 (not just 127.0.0.1).
  const parts = host.split('.')
  if (parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return true
  // IPv4-mapped IPv6 loopback, e.g. ::ffff:127.0.0.1. Note: URL parsing
  // normalizes the dotted tail to hex (http://[::ffff:127.0.0.1]/ becomes
  // hostname "::ffff:7f00:1"), so handle both forms. 127/8 maps to
  // 0x7f000000-0x7fffffff, i.e. first embedded octet 0x7f.
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length).replace(/^\[(.*)\]$/, '$1')
    if (tail.includes('.')) {
      const tailParts = tail.split('.')
      if (tailParts.length === 4 && tailParts[0] === '127' && tailParts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return true
    } else if (tail) {
      const hexParts = tail.split(':').filter(part => part.length > 0)
      if (hexParts.length >= 1 && hexParts.length <= 2 && hexParts.every(part => /^[0-9a-f]{1,4}$/.test(part))) {
        const value = hexParts.length === 2
          ? (Number.parseInt(hexParts[0], 16) * 0x10000) + Number.parseInt(hexParts[1], 16)
          : Number.parseInt(hexParts[0], 16)
        if (Number.isSafeInteger(value) && ((value >>> 24) & 0xff) === 0x7f) return true
      }
    }
  }
  return false
}

export function gatewayNeedsHttps(url: string, secureContext: boolean): boolean {
  if (!secureContext) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Malformed URLs fail open to existing behavior (probe surfaces the error).
    return false
  }
  if (parsed.protocol.toLowerCase() !== 'http:') return false
  return !isLoopbackHost(parsed.hostname)
}

// Non-blocking advisory for plain-http remote gateways in a secure context.
// Probe and sign-in succeed over http, but the live chat WebSocket (ws:// to a
// non-loopback host) is blocked as mixed content in a secure WebView. This is
// a warning, not a block: the current Tailscale pairing flow uses
// http://100.x:9119 and must keep working until the Tauri Android WebView
// behavior is verified on-device (window.isSecureContext is true for
// https://tauri.localhost, but ws:// blocking there needs device confirmation).
export function insecureGatewayWarning(url: string, secureContext: boolean): string | null {
  if (!gatewayNeedsHttps(url, secureContext)) return null
  return 'Note: this gateway uses plain http://. Probe and sign-in may succeed, but live chat streaming needs an https:// gateway URL (e.g. via Tailscale Serve) in this secure app context — otherwise chat may fail to connect. HTTPS verification on the Tauri Android runtime is still pending, so http pairing remains allowed.'
}

export class RequestEpoch {
  private value = 0

  begin(): number {
    this.value += 1
    return this.value
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.value
  }
}
