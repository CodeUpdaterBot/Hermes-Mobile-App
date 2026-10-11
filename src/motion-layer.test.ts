import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const motionCss = readFileSync(resolve(process.cwd(), 'src/motion.css'), 'utf8')
const entrySource = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')

describe('motion layer contract', () => {
  it('loads last so it refines component styles instead of being overridden by them', () => {
    const motionImport = entrySource.indexOf("import './motion.css'")
    const componentImports = ["import './styles.css'", "import './chat.css'", "import './theme.css'", "import './edge-swipe.css'"]
      .map(entry => entrySource.indexOf(entry))
    expect(motionImport).toBeGreaterThan(-1)
    for (const index of componentImports) {
      expect(index).toBeGreaterThan(-1)
      expect(motionImport).toBeGreaterThan(index)
    }
  })

  it('installs the global tactile feedback listener at startup', () => {
    expect(entrySource).toContain("import { installHapticFeedback } from './haptics'")
    expect(entrySource).toContain('installHapticFeedback()')
  })

  it('neutralises the platform tap highlight and double-tap zoom', () => {
    expect(motionCss).toContain('-webkit-tap-highlight-color:rgba(0,0,0,0)')
    expect(motionCss).toContain('touch-action:manipulation')
  })

  it('drives press feedback with the independent scale property so it composes with existing transforms', () => {
    expect(motionCss).toContain('scale:var(--press-scale)')
    expect(motionCss).toContain('transition:scale var(--motion-fast)')
    // A press rule must never clobber an element's own transform.
    const pressBlocks = motionCss.split('}').filter(block => block.includes(':active:not(:disabled)'))
    expect(pressBlocks.length).toBeGreaterThan(0)
    for (const block of pressBlocks) expect(block).not.toContain('transform:scale(')
  })

  it('releases screen transitions instead of retaining a transform', () => {
    // A retained translate/scale would make the screen root a containing block
    // for position:fixed action bars and modal backdrops.
    const start = motionCss.indexOf('.app,.panel.connection-screen')
    expect(start).toBeGreaterThan(-1)
    const rule = motionCss.slice(start, motionCss.indexOf('}', start))
    expect(rule).toContain('backwards')
    expect(rule).not.toContain('both')
  })

  it('defines directional push and pop transitions', () => {
    expect(motionCss).toContain("html[data-nav='forward']")
    expect(motionCss).toContain("html[data-nav='back']")
    expect(motionCss).toContain('@keyframes nav-push-in')
    expect(motionCss).toContain('@keyframes nav-pop-in')
  })

  it('keeps a global reduced-motion kill switch', () => {
    expect(motionCss).toContain('@media (prefers-reduced-motion:reduce)')
    const reduced = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion:reduce)'))
    expect(reduced).toContain('animation-duration:1ms!important')
    expect(reduced).toContain('transition-duration:1ms!important')
    expect(reduced).toContain('scale:1')
  })

  it('never hides a scroll surface by turning it into overflow:hidden', () => {
    // `overflow:hidden` is legitimate for clipping and unavoidable for
    // single-line `text-overflow:ellipsis`, so the invariant is narrower than
    // the property itself: a surface the user must be able to scroll must never
    // be switched to `overflow:hidden`, which silently removes that scrolling.
    const scrollSurfaces = [
      '.roster-list-scroll', '.thread-scroll', '.profile-sheet', '.management-sheet',
      '.tasks-sheet', '.task-detail', '.task-create-scroll', '.capability-list',
      '.profile-model-picker', '.task-delivery-list', '.model-list',
      '.slash-popover', '.mention-popover',
    ]
    // Canary: if these selectors are ever renamed, fail loudly rather than
    // letting this check quietly pass over nothing.
    expect(scrollSurfaces.some(surface => motionCss.includes(surface))).toBe(true)
    for (const block of motionCss.split('}')) {
      const brace = block.indexOf('{')
      if (brace === -1) continue
      const body = block.slice(brace)
      if (!body.includes('overflow:hidden')) continue
      // Compare whole selector parts. A descendant rule such as
      // `.activity-steps b` may legitimately truncate text, while
      // `.thread-scroll{…overflow:hidden}` is the scroll surface itself losing
      // its scrolling and must fail.
      const parts = block.slice(0, brace).split(',').map(part => part.trim())
      for (const surface of scrollSurfaces) {
        if (parts.includes(surface)) expect(body, surface).not.toContain('overflow:hidden')
      }
    }
  })

  it('gives every full-screen surface a real height so it owns its scrolling', () => {
    // A `min-height`-only page grows to fit its content and never scrolls, which
    // hands scrolling to the document scroller (where the scrollbar chrome is
    // hidden) and leaves wheel/touch input with nothing to move.
    const surfaces = ['.profile-sheet,.management-sheet,.tasks-sheet,.task-detail{', '.app.panel,.app.wizard{']
    for (const selector of surfaces) {
      const start = motionCss.indexOf(selector)
      expect(start, selector).toBeGreaterThan(-1)
      const rule = motionCss.slice(start, motionCss.indexOf('}', start))
      expect(rule, selector).toContain('height:100vh')
      expect(rule, selector).toContain('height:100dvh')
      expect(rule, selector).toContain('min-height:0')
      expect(rule, selector).toContain('overflow-y:auto')
    }
  })

  it('keeps overscroll containment off the root scroller', () => {
    // A root-level overscroll declaration sits between the pointer and the page
    // content; containment belongs on the individual scroll surfaces.
    expect(motionCss).not.toMatch(/html\s*,\s*body\s*\{[^}]*overscroll/)
    expect(motionCss).not.toMatch(/body\s*,\s*html\s*\{[^}]*overscroll/)
    expect(motionCss).toContain('overscroll-behavior:contain')
  })

  it('does not rely on the Safari-only overflow-scrolling property', () => {
    // `-webkit-overflow-scrolling` is a no-op in the Chromium WebViews this app
    // ships in, so it only risks changing input handling for no benefit.
    expect(motionCss).not.toContain('-webkit-overflow-scrolling')
  })

  it('presents sheets with a specificity that survives the directional rules', () => {
    // `:is()` adopts its most specific argument, and the directional lists hold
    // a two-class selector (`.panel.connection-screen`), so a single-class sheet
    // selector silently loses and sheets slide instead of rising.
    const start = motionCss.indexOf('html[data-nav] .app.wizard,')
    expect(start).toBeGreaterThan(-1)
    const rule = motionCss.slice(start, motionCss.indexOf('}', start))
    expect(rule).toContain('animation:sheet-rise')
  })
})
