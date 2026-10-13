import { createContext, useContext, useEffect, useRef, useState } from 'react'

const CloseCtx = createContext<() => void>(() => {})

// Menu is a small popover menu opened by a button.
export function Menu({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [open])
  return (
    <span className="menu-anchor" ref={ref}>
      <button className={className ?? 'icon'} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <CloseCtx.Provider value={() => setOpen(false)}>
          <div className="menu">{children}</div>
        </CloseCtx.Provider>
      )}
    </span>
  )
}

export function MenuItem({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  const close = useContext(CloseCtx)
  return (
    <button
      className={`menu-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        close()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

// ContextMenu renders at a fixed position (for right-click menus).
export function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', f)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', f)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])
  return (
    <CloseCtx.Provider value={onClose}>
      <div ref={ref} className="menu" style={{ position: 'fixed', left: x, top: y }}>
        {children}
      </div>
    </CloseCtx.Provider>
  )
}
