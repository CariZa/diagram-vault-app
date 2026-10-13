import { useEffect, useRef, useState } from 'react'
import { OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime'
import { api, Diagram, Doc } from './api'
import { useAutosave, flushPendingSave } from './autosave'
import { DiagramContent, MermaidSVG, ZoomPane } from './DiagramView'
import { Notes } from './Notes'
import { migrateNote } from './markdown'
import { Menu, MenuItem } from './Menu'

type Props = {
  path: string
  focusTitle: boolean
  onRenamed: (newPath: string) => void
}

export function DocView({ path, focusTitle, onRenamed }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(0)
  const [idx, setIdx] = useState(0)
  const [adding, setAdding] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const status = useAutosave(path, doc, dirty)

  useEffect(() => {
    api.loadDoc(path).then((d) => setDoc({ ...d, notes: d.notes.map(migrateNote) }), (e) => setError(String(e)))
  }, [path])

  const edit = (f: (d: Doc) => Doc) => {
    setDoc((d) => (d ? f(d) : d))
    setDirty((n) => n + 1)
  }

  const addDiagrams = (ds: Diagram[]) => {
    if (!ds.length || !doc) return
    const at = doc.diagrams.length
    edit((d) => ({ ...d, diagrams: [...d.diagrams, ...ds] }))
    setIdx(at)
  }

  // Files dropped anywhere on the window are added to this doc.
  useEffect(() => {
    OnFileDrop((_x, _y, paths) => api.importFiles(path, paths).then(addDiagrams), false)
    return () => OnFileDropOff()
  })

  const diagrams = doc?.diagrams ?? []
  const cur = diagrams[Math.min(idx, diagrams.length - 1)]
  const step = (by: number) => diagrams.length && setIdx((i) => (i + by + diagrams.length) % diagrams.length)

  // ← → step through diagrams unless typing.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || adding) return
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  })

  if (error) return <div className="doc-error">{error}</div>
  if (!doc) return null

  const commitTitle = async (title: string) => {
    title = title.trim() || 'Untitled doc'
    if (title === doc.title) return
    await flushPendingSave()
    try {
      onRenamed(await api.rename(path, title))
    } catch (e) {
      console.error(e)
    }
  }

  const moveDiagram = (from: number, to: number) => {
    if (to < 0 || to >= diagrams.length || from === to) return
    edit((d) => {
      const ds = [...d.diagrams]
      const [x] = ds.splice(from, 1)
      ds.splice(to, 0, x)
      return { ...d, diagrams: ds }
    })
    setIdx(to)
  }

  const removeDiagram = async (d: Diagram) => {
    if (!(await api.confirm('Remove diagram?', `"${d.caption || d.file}" will be removed from this doc.`, 'Remove'))) return
    edit((doc) => ({ ...doc, diagrams: doc.diagrams.filter((x) => x.id !== d.id) }))
    setIdx((i) => Math.max(0, Math.min(i, diagrams.length - 2)))
    api.deleteAsset(path, d.file).catch(console.error)
  }

  const setCaption = (id: string, caption: string) =>
    edit((d) => ({ ...d, diagrams: d.diagrams.map((x) => (x.id === id ? { ...x, caption } : x)) }))

  return (
    <div className="doc">
      <div className="doc-head">
        <input
          className="doc-title"
          defaultValue={doc.title}
          placeholder="Untitled doc"
          autoFocus={focusTitle}
          onFocus={(e) => focusTitle && e.target.select()}
          onBlur={(e) => commitTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className={`save-status ${status}`}>
          {status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : '✓ Saved'}
        </span>
      </div>

      <div className="section-head">
        <h2>Diagrams</h2>
        {diagrams.length > 0 && (
          <span className="muted">
            {idx + 1} / {diagrams.length}
          </span>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>
          + Add diagram
        </button>
      </div>

      {cur ? (
        <>
          <div className="viewer">
            <ZoomPane key={cur.id} onDoubleClick={() => setFullscreen(true)}>
              <DiagramContent docPath={path} d={cur} />
            </ZoomPane>
            <span className="badge">{cur.kind === 'mermaid' ? 'MERMAID' : cur.file.split('.').pop()?.toUpperCase()}</span>
            <div className="viewer-tools">
              <button className="icon" title="Fullscreen" onClick={() => setFullscreen(true)}>
                ⤢
              </button>
              <Menu label="⋯">
                <MenuItem disabled={idx === 0} onClick={() => moveDiagram(idx, idx - 1)}>
                  Move left
                </MenuItem>
                <MenuItem disabled={idx === diagrams.length - 1} onClick={() => moveDiagram(idx, idx + 1)}>
                  Move right
                </MenuItem>
                <MenuItem onClick={() => api.reveal(`${path}/${cur.file}`)}>Reveal in Finder</MenuItem>
                <MenuItem danger onClick={() => removeDiagram(cur)}>
                  Remove…
                </MenuItem>
              </Menu>
            </div>
          </div>
          <input
            key={cur.id}
            className="caption"
            defaultValue={cur.caption}
            placeholder="Add a caption"
            onBlur={(e) => e.target.value !== cur.caption && setCaption(cur.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <Filmstrip
            path={path}
            diagrams={diagrams}
            current={idx}
            onSelect={setIdx}
            onMove={moveDiagram}
            onStep={step}
            onAdd={() => setAdding(true)}
          />
        </>
      ) : (
        <div className="dropzone" onClick={() => setAdding(true)}>
          <button className="primary big">+ Add diagram</button>
          <span className="muted">or drop files here</span>
          <span className="formats">
            <span>PNG</span>
            <span>JPG</span>
            <span>SVG</span>
            <span>Mermaid</span>
          </span>
        </div>
      )}

      <Notes notes={doc.notes} onChange={(f) => edit((d) => ({ ...d, notes: f(d.notes) }))} />

      {adding && (
        <AddDiagramSheet
          path={path}
          nextCaption={`Diagram ${diagrams.length + 1}`}
          onClose={() => setAdding(false)}
          onAdd={(ds) => {
            addDiagrams(ds)
            setAdding(false)
          }}
        />
      )}
      {fullscreen && cur && (
        <div className="fullscreen">
          <div className="fs-bar">
            <span>
              {idx + 1} / {diagrams.length} · {cur.caption}
            </span>
            <span className="spacer" />
            <span className="muted">⌘ + scroll to zoom · drag to pan · double-click or Esc to close</span>
            <button className="icon" onClick={() => setFullscreen(false)}>
              ✕ Esc
            </button>
          </div>
          <div className="fs-body">
            <button className="fs-arrow" onClick={() => step(-1)}>
              ‹
            </button>
            <ZoomPane
              key={cur.id}
              onDoubleClick={() => setFullscreen(false)}
              controls={({ zoom, zoomBy, reset }) => (
                <div className="zoom-controls" onMouseDown={(e) => e.stopPropagation()}>
                  <button className="icon" onClick={() => zoomBy(1 / 1.25)}>
                    −
                  </button>
                  <button className="icon" title="Reset zoom" onClick={reset}>
                    {Math.round(zoom * 100)}%
                  </button>
                  <button className="icon" onClick={() => zoomBy(1.25)}>
                    +
                  </button>
                </div>
              )}
            >
              <DiagramContent docPath={path} d={cur} />
            </ZoomPane>
            <button className="fs-arrow" onClick={() => step(1)}>
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Filmstrip(props: {
  path: string
  diagrams: Diagram[]
  current: number
  onSelect: (i: number) => void
  onMove: (from: number, to: number) => void
  onStep: (by: number) => void
  onAdd: () => void
}) {
  // Reorder with pointer events rather than HTML5 drag-and-drop: the app
  // disables the webview's own drop handling (so Finder file drops reach Go),
  // which also breaks HTML5 drag-and-drop inside the page.
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [insertAt, setInsertAt] = useState<number | null>(null) // gap index 0..n
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    strip.current?.children[props.current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.current])

  // Which gap between thumbnails the pointer is over.
  const gapAt = (clientX: number) => {
    const thumbs = [...(strip.current?.querySelectorAll<HTMLElement>('.thumb:not(.add)') ?? [])]
    const i = thumbs.findIndex((t) => {
      const r = t.getBoundingClientRect()
      return clientX < r.left + r.width / 2
    })
    return i < 0 ? thumbs.length : i
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { from: i, x: e.clientX, y: e.clientY, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
    d.moved = true
    setDragging(d.from)
    setInsertAt(gapAt(e.clientX))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    setInsertAt(null)
    if (!d) return
    if (!d.moved) return props.onSelect(d.from)
    const gap = gapAt(e.clientX)
    props.onMove(d.from, gap > d.from ? gap - 1 : gap)
  }

  const cancel = () => {
    drag.current = null
    setDragging(null)
    setInsertAt(null)
  }

  const n = props.diagrams.length
  return (
    <div className="filmstrip-row">
      <button className="icon arrow" onClick={() => props.onStep(-1)}>
        ‹
      </button>
      <div className="filmstrip" ref={strip}>
        {props.diagrams.map((d, i) => (
          <div
            key={d.id}
            className={[
              'thumb',
              i === props.current && 'current',
              i === dragging && 'dragging',
              insertAt === i && 'insert-before',
              insertAt === n && i === n - 1 && 'insert-after',
            ]
              .filter(Boolean)
              .join(' ')}
            title={d.caption}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancel}
            onLostPointerCapture={() => drag.current && cancel()}
          >
            <DiagramContent docPath={props.path} d={d} />
          </div>
        ))}
        <div className="thumb add" onClick={props.onAdd}>
          + Add
          <br />
          diagram
        </div>
      </div>
      <button className="icon arrow" onClick={() => props.onStep(1)}>
        ›
      </button>
      <span className="muted small">drag to reorder</span>
    </div>
  )
}

function AddDiagramSheet(props: {
  path: string
  nextCaption: string
  onClose: () => void
  onAdd: (ds: Diagram[]) => void
}) {
  const [tab, setTab] = useState<'file' | 'mermaid'>('file')
  const [src, setSrc] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const pick = async () => {
    setErr('')
    try {
      const paths = await api.pickDiagramFiles()
      if (!paths?.length) return
      setBusy(true)
      const ds = await api.importFiles(props.path, paths)
      if (caption.trim() && ds.length === 1) ds[0].caption = caption.trim()
      props.onAdd(ds)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const addMermaid = async () => {
    setBusy(true)
    try {
      props.onAdd([await api.addMermaid(props.path, src, caption.trim() || props.nextCaption)])
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>Add diagram</h3>
          <span className="spacer" />
          <button className="icon" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="segmented">
          <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>
            From file
          </button>
          <button className={tab === 'mermaid' ? 'on' : ''} onClick={() => setTab('mermaid')}>
            Paste Mermaid
          </button>
        </div>
        {tab === 'file' ? (
          <div className="pick-area">
            <button className="primary big" onClick={pick} disabled={busy}>
              Choose files…
            </button>
            <span className="muted">PNG, JPG, SVG or .mmd — you can select several. Files are copied into the doc.</span>
          </div>
        ) : (
          <div className="mermaid-edit">
            <textarea
              autoFocus
              spellCheck={false}
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder={'sequenceDiagram\n  App->>API: POST /pay\n  API->>PSP: charge\n  PSP-->>API: ok'}
            />
            <div className="preview">
              {src.trim() ? <MermaidSVG src={src} /> : <span className="muted">Live preview</span>}
            </div>
          </div>
        )}
        <label className="caption-row">
          Caption
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={props.nextCaption} />
        </label>
        {err && <div className="render-error">{err}</div>}
        <div className="sheet-foot">
          <button onClick={props.onClose}>Cancel</button>
          {tab === 'mermaid' && (
            <button className="primary" disabled={!src.trim() || busy} onClick={addMermaid}>
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
