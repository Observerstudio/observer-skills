// Special-case counts per area, plus the hand-kept-list detector.
// Usage: node special-cases.mjs --root <repo> --out <dir> [--source <dir>]
//   [--label <name>] [--schema <file>] [--typescript <module>]
//
// `--schema` is the repo's enum schema, whatever notation it uses. Without it
// the enum-list section is skipped; every other detector still runs.
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
    schema: { type: 'string' },
    typescript: { type: 'string' },
  },
})
const ROOT = resolve(values.root ?? process.cwd())
const OUT = resolve(values.out ?? join(ROOT, 'tmp/untangle-evidence'))
mkdirSync(OUT, { recursive: true })
const LABEL = values.label ?? basename(ROOT)
const { abs: SOURCE, gitPath } = resolveSource(ROOT, values.source)
const ts = loadTypeScript(ROOT, values.typescript)

const files = walkSource(SOURCE, /\.(ts|tsx|mts|cts)$/)
const rel = (path) => relative(ROOT, path).split(sep).join('/')
const isTest = (path) =>
  /\.(test|spec|integration\.test)\.(ts|tsx|mts|cts)$/.test(path) ||
  /(^|\/)__(tests|mocks)__\//.test(path)

/** Area = the first two path segments under the source root. */
function areaOf(file) {
  const inside = gitPath === '.' ? file : file.slice(gitPath.length + 1)
  const parts = inside.split('/')
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.slice(0, -1).join('/') || parts[0]
}

// ---- enum members from an optional schema
const enums = new Map()
const enumSource = values.schema ? resolve(ROOT, values.schema) : null
if (enumSource) {
  let schema
  try {
    schema = readFileSync(enumSource, 'utf8')
  } catch {
    throw new Error(`cannot read enum schema: ${enumSource}`)
  }
  const lines = schema.split('\n')
  let current = null
  for (const line of lines) {
    const start = /^enum\s+(\w+)\s*\{/.exec(line)
    if (start) {
      current = start[1]
      enums.set(current, new Set())
      continue
    }
    if (current && /^\}/.test(line)) {
      current = null
      continue
    }
    if (current) {
      const member = /^\s*(\w+)(?:\s+@map\("([^"]+)"\))?/.exec(line)
      if (member) {
        enums.get(current).add(member[2] ?? member[1])
        enums.get(current).add(member[1])
      }
    }
  }
}
const memberToEnums = new Map()
for (const [name, members] of enums) {
  for (const member of members) {
    if (!memberToEnums.has(member)) memberToEnums.set(member, [])
    memberToEnums.get(member).push(name)
  }
}

const counters = new Map()
const bump = (areaName, key) => {
  if (!counters.has(areaName)) {
    counters.set(areaName, {
      ifString: 0,
      catchNoRethrow: 0,
      catchOnlyLog: 0,
      setTimeout: 0,
      sleep: 0,
      retryLoop: 0,
      enumList: 0,
    })
  }
  counters.get(areaName)[key] += 1
}

const enumLists = []
const ifExamples = []
const retryExamples = []
const sleepExamples = []

/** True when `node` contains a ThrowStatement anywhere (AST, not source text). */
function throwsInside(node) {
  return ts.isThrowStatement(node) || node.getChildren().some(throwsInside)
}

const isStringLike = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
const textOf = (node) => (isStringLike(node) ? node.text : undefined)

function isLoggerCall(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (ts.isPropertyAccessExpression(callee)) {
    const object = callee.expression.getText()
    return /^(console|logger|log)$/.test(object) || /^(console|logger|log)$/.test(object.split('.')[0])
  }
  return /^(log|logger|warn|error|info|debug)$/.test(callee.getText())
}

for (const file of files) {
  const relPath = rel(file)
  if (isTest(relPath)) continue
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const areaName = areaOf(relPath)

  const visit = (node) => {
    if (ts.isIfStatement(node) && node.expression && ts.isBinaryExpression(node.expression)) {
      const operator = node.expression.operatorToken.kind
      if (
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(operator)
      ) {
        if (isStringLike(node.expression.left) || isStringLike(node.expression.right)) {
          bump(areaName, 'ifString')
          if (ifExamples.length < 25) {
            ifExamples.push(
              `${relPath}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} \`${node.expression
                .getText()
                .slice(0, 90)}\``,
            )
          }
        }
      }
    }

    if (ts.isCatchClause(node) && node.block) {
      const body = node.block.statements
      const hasThrow = body.some(throwsInside)
      if (!hasThrow) {
        bump(areaName, 'catchNoRethrow')
        if (
          body.length === 1 &&
          ts.isExpressionStatement(body[0]) &&
          isLoggerCall(body[0].expression)
        ) {
          bump(areaName, 'catchOnlyLog')
        } else if (
          body.length <= 2 &&
          body.every(
            (statement) => ts.isExpressionStatement(statement) && isLoggerCall(statement.expression),
          )
        ) {
          bump(areaName, 'catchOnlyLog')
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ''
      if (name === 'setTimeout') bump(areaName, 'setTimeout')
      if (/^(sleep|sleepMs|delay|wait)$/i.test(name)) {
        bump(areaName, 'sleep')
        if (sleepExamples.length < 15) {
          sleepExamples.push(
            `${relPath}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${name}(...)`,
          )
        }
      }
    }

    if (
      ts.isForStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForOfStatement(node)
    ) {
      if (/retr(y|ies)|attempt|backoff/i.test(node.getText().slice(0, 400))) {
        bump(areaName, 'retryLoop')
        if (retryExamples.length < 15) {
          retryExamples.push(
            `${relPath}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} \`${node
              .getText()
              .split('\n')[0]
              .slice(0, 80)}\``,
          )
        }
      }
    }

    if (memberToEnums.size && ts.isArrayLiteralExpression(node)) {
      const members = node.elements.map(textOf)
      if (members.length >= 2 && members.every((member) => member !== undefined)) {
        const byEnum = new Map()
        for (const member of members) {
          for (const enumName of memberToEnums.get(member) ?? []) {
            byEnum.set(enumName, (byEnum.get(enumName) ?? 0) + 1)
          }
        }
        for (const [enumName, count] of byEnum) {
          if (count >= 2) {
            const onlyThisEnum = members.filter((member) =>
              (memberToEnums.get(member) ?? []).includes(enumName),
            ).length
            if (onlyThisEnum === members.length) {
              bump(areaName, 'enumList')
              enumLists.push({
                file: relPath,
                line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                enum: enumName,
                kind: 'array',
                count: members.length,
                sample: members.slice(0, 4).join(','),
              })
              break
            }
          }
        }
      }
    }

    if (memberToEnums.size && ts.isObjectLiteralExpression(node) && node.properties.length >= 2) {
      const byEnum = new Map()
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const key = property.name
        const keyText = ts.isIdentifier(key) ? key.text : isStringLike(key) ? key.text : undefined
        if (keyText) {
          for (const enumName of memberToEnums.get(keyText) ?? []) {
            if (!byEnum.has(enumName)) byEnum.set(enumName, { keys: 0, values: 0 })
            byEnum.get(enumName).keys += 1
          }
        }
        const initializer = property.initializer
        const valueText = isStringLike(initializer)
          ? initializer.text
          : ts.isPropertyAccessExpression(initializer)
            ? initializer.name.text
            : undefined
        if (valueText) {
          for (const enumName of memberToEnums.get(valueText) ?? []) {
            if (!byEnum.has(enumName)) byEnum.set(enumName, { keys: 0, values: 0 })
            byEnum.get(enumName).values += 1
          }
        }
      }
      for (const [enumName, found] of byEnum) {
        if (found.keys + found.values >= 2 && (found.keys >= 2 || found.values >= 2)) {
          bump(areaName, 'enumList')
          enumLists.push({
            file: relPath,
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            enum: enumName,
            kind: found.keys >= 2 ? 'map-keys' : 'map-values',
            count: found.keys >= 2 ? found.keys : found.values,
            sample: node.properties
              .slice(0, 3)
              .map((property) => property.getText().split(':')[0])
              .join(','),
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
}

// Skipped/todo tests are counted over test files too.
const testSkips = []
for (const file of files) {
  const relPath = rel(file)
  if (!isTest(relPath)) continue
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['skip', 'todo'].includes(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      ['it', 'describe', 'test'].includes(node.expression.expression.text)
    ) {
      testSkips.push(
        `${relPath}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.expression.getText()}`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const rows = [...counters.entries()]
  .map(([areaName, counts]) => ({ area: areaName, ...counts }))
  .sort(
    (x, y) =>
      y.ifString + y.catchNoRethrow + y.retryLoop + y.enumList -
      (x.ifString + x.catchNoRethrow + x.retryLoop + x.enumList),
  )

const markdown = []
markdown.push(`# Special-case counts — ${LABEL}`)
markdown.push('')
markdown.push(
  `Root: \`${ROOT}\`, source: \`${gitPath}\`. AST scan with TypeScript ${ts.version} (\`ts.createSourceFile\`), no regex. Production files only (test files excluded from the per-area table; skipped tests reported separately). Files scanned: ${files.length}.`,
)
markdown.push('')
if (enumSource) {
  markdown.push(`Enum schema: \`${rel(enumSource)}\` (${enums.size} enums).`)
} else {
  markdown.push('Enum schema: none passed (`--schema` not supplied); enum-list detection skipped.')
}
markdown.push('')
markdown.push('Detector definitions (exact):')
markdown.push(
  '- `ifString`: `if` whose condition is a binary `==`/`===`/`!=`/`!==` with one side a string literal or no-substitution template.',
)
markdown.push('- `catchNoRethrow`: `catch` block containing no `throw` statement.')
markdown.push(
  '- `catchOnlyLog`: catch block whose every statement is an expression statement calling a logger (at most 2 such statements).',
)
markdown.push('- `setTimeout` / `sleep`: call expressions named `setTimeout`, or `sleep|sleepMs|delay|wait`.')
markdown.push('- `retryLoop`: `for`/`while`/`do`/`for-of` whose first 400 chars match `/retry|retries|attempt|backoff/i`.')
markdown.push('- `skippedTest`: `it.skip` / `describe.skip` / `test.todo` / `test.skip` call; counted over ALL files.')
markdown.push(
  '- `enumList`: an array literal whose every element is a member of the same enum (>=2 elements), OR an object literal with >=2 property keys or values that are members of one enum.',
)
markdown.push('')
markdown.push('## Per-area counts (production files)')
markdown.push('')
markdown.push('| area | ifString | catchNoRethrow | catchOnlyLog | setTimeout | sleep | retryLoop | enumList |')
markdown.push('|------|---------:|--------------:|-------------:|-----------:|------:|----------:|---------:|')
for (const row of rows) {
  markdown.push(
    `| ${row.area} | ${row.ifString} | ${row.catchNoRethrow} | ${row.catchOnlyLog} | ${row.setTimeout} | ${row.sleep} | ${row.retryLoop} | ${row.enumList} |`,
  )
}
const totals = rows.reduce(
  (sum, row) => {
    for (const key of Object.keys(sum)) sum[key] += row[key]
    return sum
  },
  { ifString: 0, catchNoRethrow: 0, catchOnlyLog: 0, setTimeout: 0, sleep: 0, retryLoop: 0, enumList: 0 },
)
markdown.push('')
markdown.push(`Totals: ${JSON.stringify(totals)}`)
markdown.push('')
markdown.push(`## Hand-kept enum lists (production files): ${enumLists.length} found`)
markdown.push('')
markdown.push('| file:line | enum | shape | members | first members |')
markdown.push('|-----------|------|-------|--------:|---------------|')
for (const item of enumLists.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  markdown.push(
    `| \`${item.file}:${item.line}\` | \`${item.enum}\` | ${item.kind} | ${item.count} | ${item.sample} |`,
  )
}
if (!enumLists.length) markdown.push('| — | — | — | — | — |')
markdown.push('')
markdown.push(`## Skipped/todo tests (all files): ${testSkips.length}`)
markdown.push('')
for (const item of testSkips) markdown.push(`- \`${item}\``)
if (!testSkips.length) markdown.push('- none')
markdown.push('')
markdown.push('## Examples: ifString (first 25)')
markdown.push('')
for (const example of ifExamples) markdown.push(`- \`${example}\``)
markdown.push('')
markdown.push('## Examples: retryLoop (first 15)')
markdown.push('')
for (const example of retryExamples) markdown.push(`- \`${example}\``)
markdown.push('')
markdown.push('## Examples: sleep (first 15)')
markdown.push('')
for (const example of sleepExamples) markdown.push(`- \`${example}\``)

writeFileSync(join(OUT, '04-special-cases.md'), markdown.join('\n') + '\n')
console.log(
  `${LABEL}: files=${files.length} enumLists=${enumLists.length} skips=${testSkips.length} totals=${JSON.stringify(totals)}`,
)
console.log('areas:', rows.slice(0, 8).map((row) => `${row.area} if=${row.ifString} catch=${row.catchNoRethrow}/${row.catchOnlyLog} enumList=${row.enumList}`).join('\n'))
