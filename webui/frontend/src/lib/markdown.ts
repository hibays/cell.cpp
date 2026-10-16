// Markdown renderer for assistant output.
//
// Hand-rolled on purpose: the bundle is inlined into the binary, so a markdown
// library plus its plugins is a size decision, not a convenience one. The subset
// matches what the CLI's HTML exporter supports, and now covers what a coding
// agent actually emits: ordered lists, task lists, nested bullets, pipe tables
// and fenced code with highlighting.
//
// Two rules are ported from the reference harness's renderer:
//   * raw HTML stays literal text — no parser enters the pipeline;
//   * a table with four or more columns gets the wide treatment (overflow and
//     scroll) instead of being wrapped into unreadable columns.
//
// Everything is escaped before it is turned into markup: the text comes from an
// LLM and is untrusted.

import { highlightToHtml } from './highlight'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return out
}

/** `| a | b |` rows, with the `---` separator row dropped. */
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function tableHtml(header: string[], rows: string[][]): string {
  const wide = header.length >= 4 ? ' md-table-wide' : ' md-table-fill'
  const head = header.map((c) => `<th>${inline(c)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
  return `<div class="md-table${wide}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

interface ListItem {
  depth: number
  ordered: boolean
  text: string
}

function listHtml(items: ListItem[]): string {
  const out: string[] = []
  const stack: { ordered: boolean; depth: number }[] = []
  const open = (ordered: boolean): void => {
    out.push(ordered ? '<ol>' : '<ul>')
    stack.push({ ordered, depth: stack.length })
  }
  const closeTo = (depth: number): void => {
    while (stack.length > depth) out.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
  }
  for (const it of items) {
    const depth = Math.min(it.depth, 2)
    while (stack.length > depth + 1) closeTo(stack.length - 1)
    if (stack.length === depth + 1 && stack[stack.length - 1].ordered !== it.ordered) closeTo(depth)
    if (stack.length < depth + 1) open(it.ordered)
    const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/)
    if (task) {
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : ''
      out.push(
        `<li class="task"><input type="checkbox" disabled${checked} /><span>${inline(task[2])}</span></li>`,
      )
    } else {
      out.push(`<li>${inline(it.text)}</li>`)
    }
  }
  closeTo(0)
  return out.join('')
}

export function renderMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: ListItem[] = []
  let inFence = false
  let fenceLang = ''
  let fenceBuf: string[] = []

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`)
      para = []
    }
  }
  const flushList = (): void => {
    if (list.length) {
      out.push(listHtml(list))
      list = []
    }
  }
  const flushAll = (): void => {
    flushPara()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) {
        flushAll()
        inFence = true
        fenceLang = line.replace(/^\s*(```|~~~)/, '').trim()
        fenceBuf = []
      } else {
        const body = fenceBuf.join('\n')
        out.push(
          `<div class="code-block"><div class="code-head"><span>${escapeHtml(fenceLang || 'text')}</span>` +
            `<button class="code-copy" type="button" data-copy>复制</button></div>` +
            `<pre class="code" data-lang="${escapeHtml(fenceLang)}"><code>${highlightToHtml(body, fenceLang)}</code></pre></div>`,
        )
        inFence = false
      }
      continue
    }
    if (inFence) {
      fenceBuf.push(line)
      continue
    }
    if (/^\s*$/.test(line)) {
      flushAll()
      continue
    }
    // pipe table: a header row followed by a separator row
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushAll()
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      i--
      out.push(tableHtml(header, rows))
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flushAll()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      flushPara()
      list.push({
        depth: Math.floor(li[1].replace(/\t/g, '  ').length / 2),
        ordered: /\d/.test(li[2]),
        text: li[3],
      })
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushAll()
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll()
      out.push('<hr />')
      continue
    }
    flushList()
    para.push(line)
  }
  if (inFence && fenceBuf.length) {
    // an unterminated fence still renders (streaming shows this constantly)
    out.push(
      `<div class="code-block"><div class="code-head"><span>${escapeHtml(fenceLang || 'text')}</span></div>` +
        `<pre class="code" data-lang="${escapeHtml(fenceLang)}"><code>${highlightToHtml(fenceBuf.join('\n'), fenceLang)}</code></pre></div>`,
    )
  }
  flushAll()
  return out.join('')
}
