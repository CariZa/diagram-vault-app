import { marked } from 'marked'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { Note } from './api'

// renderMarkdown turns note Markdown into sanitized HTML for the preview.
// Sanitizing matters: the webview can call the Go backend.
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true, async: false }) as string)
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.use(gfm)
// Default list items are "-   item"; use the usual single space.
turndown.addRule('listItem', {
  filter: 'li',
  replacement(content, node) {
    content = content.trim().replace(/\n/gm, '\n  ')
    const parent = node.parentNode as HTMLElement
    let prefix = '- '
    if (parent.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start') ?? 1)
      prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `
    }
    return prefix + content + (node.nextSibling ? '\n' : '')
  },
})

function htmlToMarkdown(html: string): string {
  // The old editor's tables had <colgroup> and <p>-wrapped cells, which stop
  // turndown from producing GFM tables.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('colgroup').forEach((c) => c.remove())
  doc.querySelectorAll('td > p, th > p').forEach((p) => p.replaceWith(...p.childNodes))
  return turndown.turndown(doc.body.innerHTML)
}

// migrateNote converts notes saved by the old WYSIWYG editor (HTML) to Markdown.
export function migrateNote(n: Note): Note {
  if (n.markdown || !n.html) return { ...n, markdown: n.markdown ?? '' }
  const { html, ...rest } = n
  return { ...rest, markdown: htmlToMarkdown(html) }
}
