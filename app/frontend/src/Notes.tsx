import { useLayoutEffect, useRef, useState } from 'react'
import { api, newID, nextNoteName, Note } from './api'
import { Menu, MenuItem } from './Menu'
import { renderMarkdown } from './markdown'

type Props = {
  notes: Note[]
  // onChange takes an updater so edits always apply to the latest notes.
  onChange: (update: (notes: Note[]) => Note[]) => void
}

export function Notes({ notes, onChange }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Note>) =>
    onChange((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))

  const add = () => {
    const n: Note = { id: newID(), name: nextNoteName(notes), markdown: '', collapsed: false, updated: Date.now() }
    onChange((ns) => [...ns, n])
    setJustAdded(n.id)
  }

  const move = (i: number, by: number) => {
    onChange((ns) => {
      const j = i + by
      if (j < 0 || j >= ns.length) return ns
      const next = [...ns]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const remove = async (n: Note) => {
    if (await api.confirm('Delete note?', `"${n.name}" will be deleted.`, 'Delete'))
      onChange((ns) => ns.filter((x) => x.id !== n.id))
  }

  const allCollapsed = notes.length > 0 && notes.every((n) => n.collapsed)

  return (
    <section className="notes">
      <div className="section-head">
        <h2>Notes</h2>
        <span className="muted">({notes.length})</span>
        <span className="spacer" />
        {notes.length > 0 && (
          <button className="link" onClick={() => onChange((ns) => ns.map((n) => ({ ...n, collapsed: !allCollapsed })))}>
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        <button className="primary" onClick={add}>
          + Add note
        </button>
      </div>
      {notes.length === 0 && <div className="empty">No notes yet</div>}
      {notes.map((n, i) => (
        <div key={n.id} className="note">
          <div className="note-head" onClick={() => update(n.id, { collapsed: !n.collapsed })}>
            <span className={`twisty ${n.collapsed ? '' : 'open'}`}>›</span>
            {renaming === n.id ? (
              <input
                className="inline-input"
                autoFocus
                defaultValue={n.name}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== n.name) update(n.id, { name: v })
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <span
                className="note-name"
                title="Click to rename"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming(n.id)
                }}
              >
                {n.name}
              </span>
            )}
            <span className="spacer" />
            <span className="muted small">{ago(n.updated)}</span>
            <span onClick={(e) => e.stopPropagation()}>
              <Menu label="⋯">
                <MenuItem onClick={() => setRenaming(n.id)}>Rename</MenuItem>
                <MenuItem
                  onClick={() => {
                    const copy = { ...n, id: newID(), name: `${n.name} copy`, updated: Date.now() }
                    onChange((ns) => {
                      const at = ns.findIndex((x) => x.id === n.id) + 1
                      return [...ns.slice(0, at), copy, ...ns.slice(at)]
                    })
                  }}
                >
                  Duplicate
                </MenuItem>
                <MenuItem disabled={i === 0} onClick={() => move(i, -1)}>
                  Move up
                </MenuItem>
                <MenuItem disabled={i === notes.length - 1} onClick={() => move(i, 1)}>
                  Move down
                </MenuItem>
                <MenuItem danger onClick={() => remove(n)}>
                  Delete…
                </MenuItem>
              </Menu>
            </span>
          </div>
          {!n.collapsed && (
            <NoteEditor
              markdown={n.markdown}
              isNew={n.id === justAdded}
              onChange={(markdown) => markdown !== n.markdown && update(n.id, { markdown, updated: Date.now() })}
            />
          )}
        </div>
      ))}
    </section>
  )
}

type Mode = 'edit' | 'preview'

function NoteEditor({ markdown, isNew, onChange }: { markdown: string; isNew: boolean; onChange: (md: string) => void }) {
  const [mode, setMode] = useState<Mode>(isNew ? 'edit' : 'preview')
  const ta = useRef<HTMLTextAreaElement>(null)

  // Grow the textarea to fit its content (min height comes from CSS).
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [markdown, mode])

  const edit = () => {
    setMode('edit')
    requestAnimationFrame(() => ta.current?.focus())
  }

  // Replace the selection, keeping native undo (⌘Z) working.
  const insert = (text: string, selectFrom?: number, selectTo?: number) => {
    const el = ta.current!
    const start = el.selectionStart
    el.focus()
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
      onChange(el.value)
    }
    if (selectFrom !== undefined) el.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom))
  }

  const wrap = (before: string, after = before, placeholder = 'text') => {
    const el = ta.current!
    const sel = el.value.slice(el.selectionStart, el.selectionEnd) || placeholder
    insert(before + sel + after, before.length, before.length + sel.length)
  }

  // Prefix every selected line, e.g. "## " or "- ".
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = ta.current!
    const v = el.value
    const start = v.lastIndexOf('\n', el.selectionStart - 1) + 1
    let end = v.indexOf('\n', el.selectionEnd)
    if (end < 0) end = v.length
    el.setSelectionRange(start, end)
    const lines = v.slice(start, end).split('\n')
    insert(lines.map((l, i) => (typeof prefix === 'string' ? prefix : prefix(i)) + l.replace(/^(#{1,6} |[-*] |\d+\. |> )/, '')).join('\n'))
  }

  const block = (text: string) => {
    const el = ta.current!
    const atLineStart = el.selectionStart === 0 || el.value[el.selectionStart - 1] === '\n'
    insert((atLineStart ? '' : '\n') + text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey && e.key === 'b') (e.preventDefault(), wrap('**'))
    else if (e.metaKey && e.key === 'i') (e.preventDefault(), wrap('*'))
    else if (e.key === 'Tab') (e.preventDefault(), insert('  '))
    else if (e.key === 'Escape') (e.preventDefault(), setMode('preview'))
  }

  const tb = (label: React.ReactNode, title: string, run: () => void) => (
    <button
      className="tb"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault() // keep the textarea selection
        run()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="note-body">
      <div className="toolbar">
        {mode === 'edit' && (
          <>
            {tb('H1', 'Heading 1', () => prefixLines('# '))}
            {tb('H2', 'Heading 2', () => prefixLines('## '))}
            {tb('H3', 'Heading 3', () => prefixLines('### '))}
            <span className="sep" />
            {tb(<b>B</b>, 'Bold ⌘B', () => wrap('**'))}
            {tb(<i>I</i>, 'Italic ⌘I', () => wrap('*'))}
            {tb(<s>S</s>, 'Strikethrough', () => wrap('~~'))}
            {tb(<code>`</code>, 'Inline code', () => wrap('`', '`', 'code'))}
            <span className="sep" />
            {tb('• List', 'Bullet list', () => prefixLines('- '))}
            {tb('1. List', 'Numbered list', () => prefixLines((i) => `${i + 1}. `))}
            {tb('❝', 'Quote', () => prefixLines('> '))}
            {tb('```', 'Code block', () => wrap('```\n', '\n```', 'code'))}
            {tb('🔗', 'Link', () => wrap('[', '](https://)', 'link text'))}
            {tb('⊞ Table', 'Insert table', () =>
              block('| Column | Column |\n|---|---|\n| Cell | Cell |\n'),
            )}
          </>
        )}
        <span className="spacer" />
        <div className="segmented small-seg">
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
            Preview
          </button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={edit}>
            Edit
          </button>
        </div>
      </div>
      {mode === 'edit' ? (
        <textarea
          ref={ta}
          className="md-source"
          value={markdown}
          autoFocus={isNew}
          spellCheck={false}
          placeholder="Write or paste Markdown…  (Esc to preview)"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <Preview markdown={markdown} onEdit={edit} />
      )}
    </div>
  )
}

function Preview({ markdown, onEdit }: { markdown: string; onEdit: () => void }) {
  const html = markdown.trim() ? renderMarkdown(markdown) : ''
  return (
    <div
      className="md-preview"
      title="Double-click to edit"
      onDoubleClick={onEdit}
      onClick={(e) => {
        // Links open in the default browser, never inside the app window.
        const a = (e.target as HTMLElement).closest('a')
        if (a) {
          e.preventDefault()
          if (a.href.startsWith('http')) api.openURL(a.href)
        }
      }}
    >
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <span className="muted">Empty note — double-click to edit</span>}
    </div>
  )
}

function ago(ts: number) {
  if (!ts) return ''
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'edited just now'
  if (s < 3600) return `edited ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `edited ${Math.floor(s / 3600)}h ago`
  return `edited ${Math.floor(s / 86400)}d ago`
}
