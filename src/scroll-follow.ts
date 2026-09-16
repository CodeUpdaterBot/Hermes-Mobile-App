export const SCROLL_FOLLOW_THRESHOLD = 120

export function shouldStickToBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = SCROLL_FOLLOW_THRESHOLD,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold
}
