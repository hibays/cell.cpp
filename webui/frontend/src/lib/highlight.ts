// A small, dependency-free syntax highlighter.
//
// The reference harness uses shiki with a CSS-variable theme, lazy grammar
// loading and a long-line guard. Two thirds of that does not survive the trip:
// our bundle is inlined into the binary as *text* (no lazily fetched chunks, and
// every kilobyte is a kilobyte of binary), so a WASM grammar engine or a
// 100-language grammar set is out of budget. What does survive is the shape of
// the problem: tokenize one line at a time with a little cross-line state, cap
// the work on pathological lines, and let CSS do the theming.

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'func' | 'type' | 'punct'

export interface Token {
  kind: TokenKind
  text: string
}

/** Lines longer than this are emitted verbatim: a minified bundle must not stall the renderer. */
export const MAX_HIGHLIGHT_LINE = 1000

const KEYWORDS: Record<string, string[]> = {
  ts: 'abstract as async await break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of package private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield satisfies keyof infer is never unknown any string number boolean object symbol bigint'.split(' '),
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self'.split(' '),
  sh: 'case do done elif else esac fi for function if in local return then until while export readonly source echo cd set unset exit trap'.split(' '),
  json: 'true false null'.split(' '),
  cpp: 'alignas alignof auto bool break case catch class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long namespace new noexcept nullptr operator private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while include define ifdef ifndef endif pragma consteval constinit concept requires co_await co_return co_yield'.split(' '),
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' '),
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(' '),
}

/** Normalise a fence info string to one of the grammar keys above. */
export function grammarOf(lang: string): string | null {
  const l = (lang || '').trim().toLowerCase().split(/[\s:{]/)[0]
  if (!l) return null
  if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript', 'mjs', 'cjs', 'vue'].includes(l)) return 'ts'
  if (['py', 'python'].includes(l)) return 'py'
  if (['sh', 'bash', 'shell', 'zsh', 'console'].includes(l)) return 'sh'
  if (l === 'json') return 'json'
  if (['c', 'cc', 'cpp', 'c++', 'h', 'hpp', 'cxx'].includes(l)) return 'cpp'
  if (['rs', 'rust'].includes(l)) return 'rust'
  if (['go', 'golang'].includes(l)) return 'go'
  return null
}

const LINE_COMMENT: Record<string, string[]> = {
  ts: ['//'], py: ['#'], sh: ['#'], json: [], cpp: ['//'], rust: ['//'], go: ['//'],
}

const ID_START = /[A-Za-z_$]/
const ID_BODY = /[A-Za-z0-9_$]/

/**
 * Tokenize one line. `inBlockComment` is threaded through by the caller so an
 * unterminated `/* …` keeps colouring the following lines — which is what a
 * streaming code fence looks like for most of its life.
 */
export function tokenizeLine(
  line: string,
  grammar: string,
  inBlockComment = false,
): { tokens: Token[]; inBlockComment: boolean } {
  const tokens: Token[] = []
  if (line.length > MAX_HIGHLIGHT_LINE)
    return { tokens: [{ kind: 'plain', text: line }], inBlockComment }
  const keywords = new Set(KEYWORDS[grammar] ?? [])
  const lineComments = LINE_COMMENT[grammar] ?? []
  let i = 0
  let block = inBlockComment
  const push = (kind: TokenKind, text: string): void => {
    if (text) tokens.push({ kind, text })
  }

  while (i < line.length) {
    const ch = line[i]
    if (block) {
      const end = line.indexOf('*/', i)
      if (end < 0) {
        push('comment', line.slice(i))
        i = line.length
      } else {
        push('comment', line.slice(i, end + 2))
        i = end + 2
        block = false
      }
      continue
    }
    // comments
    if (ch === '/' && line[i + 1] === '*' && grammar !== 'py' && grammar !== 'sh' && grammar !== 'json') {
      block = true
      continue
    }
    const lc = lineComments.find((c) => line.startsWith(c, i))
    if (lc) {
      push('comment', line.slice(i))
      break
    }
    // strings
    if (ch === '"' || ch === "'" || (ch === '`' && grammar === 'ts')) {
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2
          continue
        }
        if (line[j] === ch) {
          j++
          break
        }
        j++
      }
      push('string', line.slice(i, j))
      i = j
      continue
    }
    // numbers
    if (/[0-9]/.test(ch) && !ID_BODY.test(line[i - 1] ?? ' ')) {
      let j = i
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j++
      push('number', line.slice(i, j))
      i = j
      continue
    }
    // identifiers
    if (ID_START.test(ch)) {
      let j = i
      while (j < line.length && ID_BODY.test(line[j])) j++
      const word = line.slice(i, j)
      let k = j
      while (k < line.length && line[k] === ' ') k++
      const kind: TokenKind = keywords.has(word)
        ? 'keyword'
        : line[k] === '('
          ? 'func'
          : /^[A-Z]/.test(word)
            ? 'type'
            : 'plain'
      push(kind, word)
      i = j
      continue
    }
    // punctuation, two-character operators kept together
    const two = line.slice(i, i + 2)
    if (['=>', '->', '::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '**'].includes(two)) {
      push('punct', two)
      i += 2
      continue
    }
    push('punct', ch)
    i++
  }
  return { tokens, inBlockComment: block }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tokenize a whole snippet. Unknown languages come back as a single plain token. */
export function tokenize(code: string, lang: string): Token[] {
  const grammar = grammarOf(lang)
  if (!grammar) return [{ kind: 'plain', text: code }]
  const out: Token[] = []
  let block = false
  const lines = code.split('\n')
  lines.forEach((line, idx) => {
    const r = tokenizeLine(line, grammar, block)
    block = r.inBlockComment
    out.push(...r.tokens)
    if (idx < lines.length - 1) out.push({ kind: 'plain', text: '\n' })
  })
  return out
}

/** Highlighted HTML for a `<pre><code>` body; every token wrapped in `<span class="tok-…">`. */
export function highlightToHtml(code: string, lang: string): string {
  return tokenize(code, lang)
    .map((t) => (t.kind === 'plain' ? escapeHtml(t.text) : `<span class="tok-${t.kind}">${escapeHtml(t.text)}</span>`))
    .join('')
}
