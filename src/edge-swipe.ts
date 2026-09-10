import { useEffect, type RefObject } from 'react'

export const EDGE_SWIPE_START_RATIO = .5
export const EDGE_SWIPE_COMMIT_PX = 88
export const EDGE_SWIPE_MAX_OFFSET_PX = 140

export function shouldCommitEdgeSwipe(deltaX: number, deltaY: number): boolean {
  return deltaX >= EDGE_SWIPE_COMMIT_PX && deltaX > Math.abs(deltaY) * 1.2
}

export function useEdgeSwipeBack<T extends HTMLElement>(ref: RefObject<T | null>, onBack: () => void, enabled = true) {
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    let startX = 0
    let startY = 0
    let tracking = false
    let committed = false
    let resetTimer: number | undefined

    const clearMotion = () => {
      element.classList.remove('edge-swipe-active', 'edge-swipe-committed')
      element.style.removeProperty('--edge-swipe-offset')
      tracking = false
      committed = false
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || event.touches[0].clientX > window.innerWidth * EDGE_SWIPE_START_RATIO) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,button,[data-no-edge-swipe]')) return
      window.clearTimeout(resetTimer)
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
      tracking = true
      committed = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return
      const deltaX = event.touches[0].clientX - startX
      const deltaY = event.touches[0].clientY - startY
      if (deltaX < 0 || Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        tracking = false
        return
      }
      event.preventDefault()
      const offset = Math.min(EDGE_SWIPE_MAX_OFFSET_PX, Math.max(0, deltaX * .55))
      element.classList.add('edge-swipe-active')
      element.style.setProperty('--edge-swipe-offset', `${offset}px`)
      committed = shouldCommitEdgeSwipe(deltaX, deltaY)
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return
      const deltaX = (event.changedTouches[0]?.clientX || startX) - startX
      const deltaY = (event.changedTouches[0]?.clientY || startY) - startY
      tracking = false
      if (committed || shouldCommitEdgeSwipe(deltaX, deltaY)) {
        element.classList.add('edge-swipe-committed')
        element.style.setProperty('--edge-swipe-offset', '100vw')
        resetTimer = window.setTimeout(() => { clearMotion(); onBack() }, 170)
      } else {
        resetTimer = window.setTimeout(clearMotion, 170)
      }
    }
    const onTouchCancel = () => { if (tracking) resetTimer = window.setTimeout(clearMotion, 170) }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      window.clearTimeout(resetTimer)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
      clearMotion()
    }
  }, [enabled, onBack, ref])
}
