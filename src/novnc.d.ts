/**
 * noVNC's RFB client, as `@novnc/novnc` publishes it.
 *
 * The package ships ES modules without types and its `exports` map only exposes the
 * root specifier, so it is declared here rather than imported by deep path. Only the
 * surface this app actually touches is described.
 */
declare module '@novnc/novnc' {
  export type RfbEvent = { detail?: { clean?: boolean; code?: number; reason?: string } }

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: { credentials?: { username?: string; password?: string; target?: string }; shared?: boolean })

    /** Input is refused by the host unless this viewer holds the lease; this is UX, not the gate. */
    viewOnly: boolean
    /** Fit the remote framebuffer to the element instead of scrolling a fixed-size canvas. */
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    /** Touch drag pans the viewport when the screen is larger than the pane. */
    dragViewport: boolean
    background: string

    disconnect(): void
    addEventListener(type: string, listener: (event: RfbEvent) => void): void
    removeEventListener(type: string, listener: (event: RfbEvent) => void): void
  }
}
