// Markdown-lite renderer: the same subset the CLI's HTML exporter supports
// (headings, lists, quotes, rules, pipe tables, code, bold, italic, links).
// HTML is escaped first — the text comes from an LLM and is untrusted.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return out
}

export function renderMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: string[] = []
  let inFence = false
  let fenceLang = ''
  let fenceBuf: string[] = []

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`)
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flushPara()
        flushList()
        inFence = true
        fenceLang = line.replace(/^\s*```/, '').trim()
        fenceBuf = []
      } else {
        out.push(
          `<pre class="code"${fenceLang ? ` data-lang="${escapeHtml(fenceLang)}"` : ''}><code>${escapeHtml(
            fenceBuf.join('\n'),
          )}</code></pre>`,
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
      flushPara()
      flushList()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flushPara()
      flushList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      flushPara()
      list.push(line.replace(/^\s*([-*+])\s+/, ''))
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      flushList()
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara()
      flushList()
      out.push('<hr />')
      continue
    }
    flushList()
    para.push(line)
  }
  if (inFence) out.push(`<pre class="code"><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`)
  flushPara()
  flushList()
  return out.join('')
}
