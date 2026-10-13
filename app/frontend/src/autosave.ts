import { useEffect, useRef, useState } from 'react'
import { api, Doc } from './api'

export type SaveStatus = 'saved' | 'saving' | 'error'

// The one pending save, so the sidebar can flush it before renaming/trashing.
let pending: (() => Promise<void>) | null = null
// Saves run one at a time, in order, so an older snapshot can never land last.
let chain: Promise<unknown> = Promise.resolve()
export async function flushPendingSave() {
  if (pending) await pending()
  await chain.catch(() => {})
}

// useAutosave writes `doc` to disk ~500ms after the last change. Bump `dirty`
// on every edit. The component should be keyed by path.
export function useAutosave(path: string, doc: Doc | null, dirty: number) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const timer = useRef<number>()

  useEffect(() => {
    if (!dirty || !doc) return
    setStatus('saving')
    const snapshot = doc
    const save = async () => {
      window.clearTimeout(timer.current)
      if (pending === save) pending = null
      try {
        await (chain = chain.catch(() => {}).then(() => api.saveDoc(path, snapshot)))
        setStatus('saved')
      } catch (e) {
        console.error(e)
        setStatus('error')
      }
    }
    pending = save
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 500)
  }, [dirty])

  useEffect(() => () => void flushPendingSave(), [])

  return status
}
