import { canonicalProfileAvatarSvg } from './avatar-render'

/**
 * Turns a Bot's avatar into a PNG for the notification's large icon.
 *
 * Android's `BitmapFactory` cannot decode SVG, so the WebView rasterises the same
 * avatar artwork the app already renders and hands the plugin a PNG data URL. The
 * result is the Bot's real Blobatar rather than a generic bell icon, which is what
 * makes several working Bots distinguishable at a glance on the lockscreen.
 */

/** Android expects roughly 64dp; this covers an xxxhdpi screen without waste. */
export const NOTIFICATION_ICON_PX = 192

export function avatarSvgDataUrl(profileName: string, shape?: string, color?: string): string {
  const svg = canonicalProfileAvatarSvg(profileName, shape, color)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const cache = new Map<string, string | null>()

/**
 * Returns a PNG data URL, or null when the avatar cannot be rasterised. A null
 * simply means the notification falls back to its small icon — it must never
 * block or fail the notification itself.
 */
export async function rasterizeAvatarPng(profileName: string, shape?: string, color?: string, size = NOTIFICATION_ICON_PX): Promise<string | null> {
  const key = `${profileName}|${shape ?? ''}|${color ?? ''}|${size}`
  if (cache.has(key)) return cache.get(key) ?? null
  if (typeof document === 'undefined') return null

  try {
    const image = new Image()
    const loaded = await new Promise<boolean>(resolve => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = avatarSvgDataUrl(profileName, shape, color)
    })
    if (!loaded) {
      cache.set(key, null)
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) {
      cache.set(key, null)
      return null
    }
    context.drawImage(image, 0, 0, size, size)
    // Throws if the canvas was tainted by the SVG; treat as "no icon".
    const png = canvas.toDataURL('image/png')
    cache.set(key, png)
    return png
  } catch {
    cache.set(key, null)
    return null
  }
}

/** Exposed for tests and for clearing between profiles. */
export function clearAvatarRasterCache(): void {
  cache.clear()
}

/** Splits an image data URL into the payload the native side decodes. */
export function splitDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  return match ? { mime: match[1], base64: match[2] } : null
}
