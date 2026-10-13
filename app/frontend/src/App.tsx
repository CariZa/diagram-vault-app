import { useCallback, useEffect, useState } from 'react'
import { api, TreeNode } from './api'
import { flushPendingSave } from './autosave'
import { DocView } from './DocView'
import { Sidebar } from './Sidebar'

const LAST_DOC_KEY = 'dv.lastDoc'

export default function App() {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_DOC_KEY)
    } catch {
      return null
    }
  })
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const refresh = useCallback(() => api.listTree().then(setTree).catch(console.error), [])
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh) // pick up changes made in Finder
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  useEffect(() => {
    try {
      selected ? localStorage.setItem(LAST_DOC_KEY, selected) : localStorage.removeItem(LAST_DOC_KEY)
    } catch {}
  }, [selected])

  // Drop a remembered selection that no longer exists on disk.
  useEffect(() => {
    if (tree && selected && !findNode(tree, selected)) setSelected(null)
  }, [tree])

  const open = async (path: string) => {
    await flushPendingSave()
    setJustCreated(null)
    setSelected(path)
  }

  const actions = {
    open,
    newDoc: async (parent: string) => {
      await flushPendingSave()
      const p = await api.createDoc(parent, 'Untitled doc')
      await refresh()
      setJustCreated(p)
      setSelected(p)
    },
    newFolder: async (parent: string) => {
      const p = await api.createFolder(parent, 'New folder')
      await refresh()
      setRenaming(p)
    },
    rename: async (path: string, name: string) => {
      await flushPendingSave()
      const np = await api.rename(path, name)
      if (selected && (selected === path || selected.startsWith(path + '/'))) setSelected(np + selected.slice(path.length))
      refresh()
    },
    trash: async (node: TreeNode) => {
      const what = node.kind === 'doc' ? 'doc' : 'folder and everything in it'
      if (!(await api.confirm('Move to Trash?', `"${node.name}" ${what} will be moved to the Trash.`, 'Move to Trash')))
        return
      await flushPendingSave()
      await api.trash(node.path)
      if (selected && (selected === node.path || selected.startsWith(node.path + '/'))) setSelected(null)
      refresh()
    },
    reveal: (path: string) => api.reveal(path),
  }

  return (
    <div className="app">
      <Sidebar tree={tree} selected={selected} renaming={renaming} setRenaming={setRenaming} actions={actions} />
      <main className="main">
        {selected ? (
          <DocView
            key={selected}
            path={selected}
            focusTitle={justCreated === selected}
            onRenamed={(np) => {
              setJustCreated(null)
              setSelected(np)
              refresh()
            }}
          />
        ) : (
          <div className="welcome">
            <h1>Diagram Vault</h1>
            <p className="muted">Pick a doc from the sidebar, or create a new one.</p>
            <button className="primary big" onClick={() => actions.newDoc('')}>
              + New doc
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function findNode(n: TreeNode, path: string): TreeNode | null {
  if (n.path === path) return n
  for (const c of n.children ?? []) {
    const f = findNode(c, path)
    if (f) return f
  }
  return null
}
