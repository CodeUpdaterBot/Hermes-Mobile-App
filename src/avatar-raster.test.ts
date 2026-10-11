import { describe, expect, it } from 'vitest'

import { avatarSvgDataUrl, clearAvatarRasterCache, rasterizeAvatarPng, splitDataUrl } from './avatar-raster'

describe('avatarSvgDataUrl', () => {
  it('produces a data URL the canvas can load, with the SVG url-encoded', () => {
    const url = avatarSvgDataUrl('inbox-manager', 'blobatar')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    // Unencoded `<` would truncate the URL at the first tag.
    expect(url).not.toContain('<svg')
    expect(decodeURIComponent(url.split(',')[1])).toContain('<svg')
  })
})

describe('splitDataUrl', () => {
  it('splits the payload the native side decodes', () => {
    expect(splitDataUrl('data:image/png;base64,QUJD')).toEqual({ mime: 'image/png', base64: 'QUJD' })
  })

  it('rejects anything that is not a base64 data URL', () => {
    expect(splitDataUrl('https://example.com/a.png')).toBeNull()
    expect(splitDataUrl('data:image/png,notbase64')).toBeNull()
    expect(splitDataUrl('')).toBeNull()
  })
})

describe('rasterizeAvatarPng', () => {
  it('returns null instead of throwing where there is no DOM', async () => {
    // test runs in node: no document, so the notification simply has no large icon.
    clearAvatarRasterCache()
    await expect(rasterizeAvatarPng('inbox-manager', 'blobatar')).resolves.toBeNull()
  })
})
