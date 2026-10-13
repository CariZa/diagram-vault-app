import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { assetURL, Diagram } from './api'

const dark = window.matchMedia('(prefers-color-scheme: dark)')
let renderSeq = 0

function useDarkMode() {
  const [isDark, setDark] = useState(dark.matches)
  useEffect(() => {
    const f = () => setDark(dark.matches)
    dark.addEventListener('change', f)
    return () => dark.removeEventListener('change', f)
  }, [])
  return isDark
}

export async function renderMermaid(src: string, isDark: boolean): Promise<string> {
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'strict' })
  const { svg } = await mermaid.render(`mmd-${++renderSeq}`, src)
  return svg
}

export function MermaidSVG({ src, className }: { src: string; className?: string }) {
  const isDark = useDarkMode()
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    if (!src.trim()) {
      setSvg('')
      setErr('')
      return
    }
    renderMermaid(src, isDark)
      .then((s) => live && (setSvg(s), setErr('')))
      .catch((e) => live && setErr(String(e?.message ?? e)))
    return () => {
      live = false
    }
  }, [src, isDark])
  if (err) return <div className="render-error">{err}</div>
  return <div className={`mermaid-svg ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
}

function useText(url: string) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!url) return
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} loading ${url}`))))
      .then((t) => live && setText(t))
      .catch((e) => live && setText(`%% ${e.message}`))
    return () => {
      live = false
    }
  }, [url])
  return text
}

// DiagramContent renders a diagram at its natural size (images) or as SVG (mermaid).
export function DiagramContent({ docPath, d }: { docPath: string; d: Diagram }) {
  const url = assetURL(docPath, d.file)
  const text = useText(d.kind === 'mermaid' ? url : '')
  if (d.kind === 'image') return <img src={url} alt={d.caption} draggable={false} />
  if (text === null) return null
  return <MermaidSVG src={text} />
}

// ZoomPane: fit-to-box by default; zoom with buttons, ⌘+scroll or pinch; drag to pan.
export function ZoomPane({
  children,
  controls,
  onDoubleClick,
}: {
  children: React.ReactNode
  onDoubleClick?: () => void
  controls?: (api: { zoom: number; zoomBy: (f: number) => void; reset: () => void }) => React.ReactNode
}) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const zoomBy = (f: number) => setZoom((z) => Math.min(8, Math.max(0.2, z * f)))
  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    const el = box.current!
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomBy(Math.exp(-e.deltaY / 200))
      } else if (zoom !== 1) {
        e.preventDefault()
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  return (
    <div
      ref={box}
      className="zoom-pane"
      onMouseDown={(e) => (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })}
      onMouseMove={(e) => drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
      onMouseUp={() => (drag.current = null)}
      onMouseLeave={() => (drag.current = null)}
      onDoubleClick={onDoubleClick ?? reset}
    >
      <div className="zoom-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {children}
      </div>
      {controls?.({ zoom, zoomBy, reset })}
    </div>
  )
}
