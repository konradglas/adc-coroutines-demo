import { createHighlighter, type HighlighterGeneric } from 'shiki'

export interface Token {
  content: string
  color?: string
}

// Keep in sync with the theme in setup/shiki.ts.
const theme = 'github-dark-dimmed'

let highlighter: Promise<HighlighterGeneric<any, any>> | undefined

export async function highlightLines(code: string[]): Promise<Token[][]> {
  highlighter ??= createHighlighter({ themes: [theme], langs: ['cpp'] })
  const { tokens } = (await highlighter).codeToTokens(code.join('\n'), { lang: 'cpp', theme })
  return tokens.map(line => line.map(t => ({ content: t.content, color: t.color })))
}
