import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { parseMarkdown, type InlineToken } from './markdown-parser'

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return tokens.map((token, index): ReactNode => {
    const key = `${token.type}-${index}`
    if (token.type === 'text') {
      const lines = token.value.split('\n')
      return <Fragment key={key}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{line}</Fragment>)}</Fragment>
    }
    if (token.type === 'code') return <code key={key}>{token.value}</code>
    if (token.type === 'strong') return <strong key={key}><Inline tokens={token.children} /></strong>
    if (token.type === 'emphasis') return <em key={key}><Inline tokens={token.children} /></em>
    return <a key={key} href={token.href} target="_blank" rel="noreferrer"><Inline tokens={token.children} /></a>
  })
}

function CodeBlock({ language, value }: { language: string | null; value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return <div className="code-block">
    <div className="code-toolbar">
      <span>{language ?? 'text'}</span>
      <button type="button" onClick={copy} aria-label={copied ? 'Code copied' : 'Copy code'}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <pre><code className={language ? `language-${language}` : undefined}>{value}</code></pre>
  </div>
}

export default function Markdown({ content }: { content: string }) {
  const blocks = parseMarkdown(content)

  return <div className="markdown">{blocks.map((block, index) => {
    const key = `${block.type}-${index}`
    if (block.type === 'paragraph') return <p key={key}><Inline tokens={block.content} /></p>
    if (block.type === 'heading') {
      const children = <Inline tokens={block.content} />
      if (block.level === 1) return <h1 key={key}>{children}</h1>
      if (block.level === 2) return <h2 key={key}>{children}</h2>
      if (block.level === 3) return <h3 key={key}>{children}</h3>
      return <h4 key={key}>{children}</h4>
    }
    if (block.type === 'code') return <CodeBlock key={key} language={block.language} value={block.value} />
    if (block.type === 'list') {
      const List = block.ordered ? 'ol' : 'ul'
      return <List key={key}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline tokens={item} /></li>)}</List>
    }
    if (block.type === 'quote') return <blockquote key={key}><Inline tokens={block.content} /></blockquote>
    if (block.type === 'rule') return <hr key={key} />
    return <div className="table-scroll" key={key}><table>
      <thead><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex} scope="col"><Inline tokens={cell} /></th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline tokens={cell} /></td>)}</tr>)}</tbody>
    </table></div>
  })}</div>
}
