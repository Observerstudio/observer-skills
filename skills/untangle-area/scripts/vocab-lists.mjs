// Hand-kept vocabulary lists: SCREAMING_SNAKE_CASE string literals that are
// not necessarily enum members. Two owners of the same vocabulary are a hidden
// link; the detector finds the copies.
// Usage: node vocab-lists.mjs --root <repo> --out <dir> [--source <dir>]
//   [--label <name>] [--only <path-prefix>] [--min 8] [--typescript <module>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { loadTypeScript, resolveSource, walkSource } from './lib/common.mjs'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
    label: { type: 'string' },
    only: { type: 'string' },
    min: { type: 'string' },
    typescript: { type: 'string' },
  },
})
const ROOT = resolve(values.root ?? process.cwd())
const OUT = resolve(values.out ?? join(ROOT, 'tmp/untangle-evidence'))
mkdirSync(OUT, { recursive: true })
const LABEL = values.label ?? basename(ROOT)
const ONLY = values.only
const MIN = Number(values.min ?? 8)
if (!Number.isInteger(MIN) || MIN < 1) {
  console.error(`--min must be a positive integer, got: ${values.min}`)
  process.exit(2)
}
const { abs: SOURCE } = resolveSource(ROOT, values.source)
const ts = loadTypeScript(ROOT, values.typescript)

const rel = (path) => relative(ROOT, path).split(sep).join('/')
const SCREAM = /^[A-Z][A-Z0-9_]{2,}$/
const textOf = (node) => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined)

const files = walkSource(SOURCE, /\.(ts|tsx|mts|cts)$/).filter((file) => {
  const path = rel(file)
  if (/\.(test|spec|integration\.test)\.(ts|tsx|mts|cts)$/.test(path)) return false
  if (/(^|\/)__(tests|mocks)__\//.test(path)) return false
  return !ONLY || path === ONLY || path.startsWith(ONLY.endsWith('/') ? ONLY : `${ONLY}/`)
})

const hits = []
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node) && node.properties.length >= MIN) {
      let keys = 0
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const key = ts.isIdentifier(property.name) ? property.name.text : textOf(property.name)
        if (key && SCREAM.test(key)) keys += 1
      }
      if (keys >= MIN) {
        hits.push({
          file: rel(file),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          kind: 'object-map',
          members: keys,
          totalProps: node.properties.length,
        })
      }
    }
    if (ts.isArrayLiteralExpression(node) && node.elements.length >= MIN) {
      const members = node.elements.map(textOf)
      const matching = members.filter((member) => member && SCREAM.test(member)).length
      if (matching >= MIN && matching === members.length) {
        hits.push({
          file: rel(file),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          kind: 'array',
          members: matching,
          totalProps: matching,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

const markdown = [
  `# Vocabulary-list detector — ${LABEL}`,
  '',
  `Object literals with >=${MIN} SCREAMING_SNAKE_CASE property keys, or arrays with >=${MIN} such string elements (production files${ONLY ? ` under \`${ONLY}\`` : ''}).`,
  '',
  `Hits: ${hits.length}`,
  '',
  '| file:line | shape | members |',
  '|-----------|-------|--------:|',
]
for (const hit of hits) markdown.push(`| \`${hit.file}:${hit.line}\` | ${hit.kind} | ${hit.members} |`)
writeFileSync(join(OUT, '04b-vocab-lists.md'), markdown.join('\n') + '\n')
console.log(`${LABEL}: vocabHits=${hits.length}`)
console.log(hits.map((hit) => `${hit.file}:${hit.line} ${hit.kind} ${hit.members}`).join('\n'))
