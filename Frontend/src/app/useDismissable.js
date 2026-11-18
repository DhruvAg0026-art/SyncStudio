import { useEffect, useRef } from "react"

export default function useDismissable(ref, open, onDismiss) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (!ref.current?.contains(event.target)) dismissRef.current()
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") dismissRef.current()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, ref])
}
