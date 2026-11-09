import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'))

describe('production CSP', () => {
  it('restricts bundled scripts and disables objects, base URLs and embedding', () => {
    const csp = config.app.security.csp
    expect(typeof csp).toBe('string')
    const directives = new Map<string, string[]>()
    for (const entry of (csp as string).split(';').map(value => value.trim()).filter(Boolean)) {
      const [name, ...sources] = entry.split(/\s+/)
      expect(directives.has(name), `duplicate ${name}`).toBe(false)
      directives.set(name, sources)
    }

    // Pin the complete policy so script-src-elem, a wildcard, or another
    // directive cannot silently bypass the script restriction. Tauri's default
    // CSP processing may add hashes/nonces for its injected bootstrap scripts.
    expect(Object.fromEntries(directives)).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'"],
      // React pull/resize/animation styles and noVNC's canvas layout use styles.
      // This exception is deliberately NOT granted to scripts.
      'style-src': ["'self'", "'unsafe-inline'"],
      // IPC plus user-selected gateway and noVNC sockets, including LAN HTTP.
      // REST/auth requests run in Rust, not browser fetch to arbitrary hosts.
      'connect-src': ["'self'", 'ipc:', 'http://ipc.localhost', 'ws:', 'wss:'],
      // Bundled art, SVG/PNG avatars, screen thumbnails and profile image URLs.
      'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
      'font-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'frame-src': ["'none'"],
      'form-action': ["'none'"],
    })
    // Microphone capture/recognition uses the native STT plugin via IPC, not
    // browser media playback. No media/worker/eval permission is needed here.
    expect(config.app.security.dangerousDisableAssetCspModification ?? false).toBe(false)
  })
})
