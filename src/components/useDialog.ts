import { useEffect, useRef } from 'react'

export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const previous = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const focusable = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
      )
    focusable()?.[0]?.focus()
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close.current()
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items?.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!ref.current?.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      if (previous.current?.isConnected) previous.current.focus()
    }
  }, [])
  return ref
}
