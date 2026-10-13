import * as Go from '../wailsjs/go/main/App'

export type Kind = 'image' | 'mermaid'

export interface Diagram {
  id: string
  file: string // relative to the doc folder
  kind: Kind
  caption: string
}

export interface Note {
  id: string
  name: string
  markdown: string
  html?: string // legacy notes from before Markdown; converted on load
  collapsed: boolean
  updated: number
}

export interface Doc {
  version: number
  title: string
  diagrams: Diagram[]
  notes: Note[]
}

export interface TreeNode {
  name: string
  path: string // library-relative; '' or '.' is the root
  kind: 'folder' | 'doc'
  children?: TreeNode[]
}

// Cast away Wails' generated model classes; the JSON shape is identical.
export const api = {
  listTree: () => Go.ListTree() as unknown as Promise<TreeNode>,
  createFolder: Go.CreateFolder,
  createDoc: Go.CreateDoc,
  rename: Go.Rename,
  trash: Go.Trash,
  reveal: Go.Reveal,
  loadDoc: (p: string) => Go.LoadDoc(p) as unknown as Promise<Doc>,
  saveDoc: (p: string, d: Doc) => Go.SaveDoc(p, d as any),
  pickDiagramFiles: Go.PickDiagramFiles,
  importFiles: (doc: string, paths: string[]) => Go.ImportFiles(doc, paths) as unknown as Promise<Diagram[]>,
  addMermaid: (doc: string, src: string, caption: string) =>
    Go.AddMermaid(doc, src, caption) as unknown as Promise<Diagram>,
  deleteAsset: Go.DeleteAsset,
  confirm: Go.Confirm,
  openURL: Go.OpenURL,
}

export function assetURL(docPath: string, file: string) {
  const rel = `${docPath}/${file}`.split('/').map(encodeURIComponent).join('/')
  return `/vault/${rel}`
}

export function parentOf(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function newID() {
  return Math.random().toString(16).slice(2, 14)
}

export function nextNoteName(notes: Note[]) {
  let max = 0
  for (const n of notes) {
    const m = /^Note (\d+)$/.exec(n.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `Note ${Math.max(max, notes.length) + 1}`
}
