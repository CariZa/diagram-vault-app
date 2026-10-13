import { useEffect, useMemo, useState } from 'react'
import { TreeNode } from './api'
import { ContextMenu, MenuItem } from './Menu'

export type SidebarActions = {
  open: (path: string) => void
  newDoc: (parent: string) => void
  newFolder: (parent: string) => void
  rename: (path: string, name: string) => void
  trash: (node: TreeNode) => void
  reveal: (path: string) => void
}

type Props = {
  tree: TreeNode | null
  selected: string | null
  renaming: string | null
  setRenaming: (p: string | null) => void
  actions: SidebarActions
}

const EXPANDED_KEY = 'dv.expanded'

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function Sidebar({ tree, selected, renaming, setRenaming, actions }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(loadExpanded)
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {}
  }, [expanded])

  // Keep the selected doc's ancestors open (e.g. after creating a doc in a folder).
  useEffect(() => {
    if (!selected) return
    const parts = selected.split('/')
    setExpanded((s) => {
      const next = new Set(s)
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [selected])

  const filtered = useMemo(() => (tree && query.trim() ? filter(tree, query.trim().toLowerCase()) : tree), [tree, query])

  const toggle = (p: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })

  // Where "+ Doc" / "+ Folder" create things: the selected doc's folder, else root.
  const currentFolder = selected ? selected.split('/').slice(0, -1).join('/') : ''

  const render = (n: TreeNode, depth: number): React.ReactNode => {
    const isOpen = !!query.trim() || expanded.has(n.path)
    const row = (
      <div
        className={`row kind-${n.kind} ${selected === n.path ? 'selected' : ''} ${menu?.node.path === n.path ? 'menu-target' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (n.kind === 'doc' ? actions.open(n.path) : toggle(n.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, node: n })
        }}
      >
        <span className={`twisty ${isOpen ? 'open' : ''}`}>{n.kind === 'folder' ? '›' : ''}</span>
        <span className="glyph">{n.kind === 'folder' ? '📁' : '📄'}</span>
        {renaming === n.path ? (
          <input
            className="inline-input"
            autoFocus
            defaultValue={n.name}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const v = e.target.value.trim()
              setRenaming(null)
              if (v && v !== n.name) actions.rename(n.path, v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = n.name
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <span className="label">{n.name}</span>
        )}
      </div>
    )
    return (
      <div key={n.path}>
        {row}
        {n.kind === 'folder' && isOpen && n.children?.map((c) => render(c, depth + 1))}
      </div>
    )
  }

  const rootMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (tree) setMenu({ x: e.clientX, y: e.clientY, node: tree })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="primary grow" onClick={() => actions.newDoc(currentFolder)}>
          + New doc
        </button>
        <button title="New folder" onClick={() => actions.newFolder(currentFolder)}>
          + Folder
        </button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tree" onContextMenu={rootMenu}>
        {filtered?.children?.map((c) => render(c, 0))}
        {tree && !tree.children?.length && (
          <div className="empty small">
            Your library is empty.
            <br />
            Create a doc to get started.
          </div>
        )}
        {query && !filtered?.children?.length && <div className="empty small">No matches</div>}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.node.kind === 'folder' && (
            <>
              <MenuItem onClick={() => actions.newDoc(folderPath(menu.node))}>New doc here</MenuItem>
              <MenuItem onClick={() => actions.newFolder(folderPath(menu.node))}>New folder</MenuItem>
            </>
          )}
          {menu.node !== tree && <MenuItem onClick={() => setRenaming(menu.node.path)}>Rename</MenuItem>}
          <MenuItem onClick={() => actions.reveal(folderPath(menu.node))}>Reveal in Finder</MenuItem>
          {menu.node !== tree && (
            <MenuItem danger onClick={() => actions.trash(menu.node)}>
              Move to Trash
            </MenuItem>
          )}
        </ContextMenu>
      )}
    </aside>
  )
}

function folderPath(n: TreeNode) {
  return n.path === '.' ? '' : n.path
}

// filter keeps docs whose title matches, plus the folders containing them.
function filter(n: TreeNode, q: string): TreeNode | null {
  if (n.kind === 'doc') return n.name.toLowerCase().includes(q) ? n : null
  const children = (n.children ?? []).map((c) => filter(c, q)).filter(Boolean) as TreeNode[]
  if (!children.length && n.path !== '.') return n.name.toLowerCase().includes(q) ? { ...n, children: [] } : null
  return { ...n, children }
}
