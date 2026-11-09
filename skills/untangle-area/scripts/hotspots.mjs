// Hotspots: revisions in the last 6 months x current line count.
// Usage: node hotspots.mjs --root <repo> --out <dir> [--source <dir>] [--since YYYY-MM-DD]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { resolveSource } from './lib/common.mjs'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
    since: { type: 'string' },
  },
})

const REPO = resolve(values.root ?? process.cwd())
const OUT = resolve(values.out ?? join(REPO, 'tmp/untangle-evidence'))
mkdirSync(OUT, { recursive: true })
const { gitPath } = resolveSource(REPO, values.source)

const sixMonthsAgo = new Date()
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
const SINCE = values.since ?? sixMonthsAgo.toISOString().slice(0, 10)
const EXCLUDE = [
  /(^|\/)generated\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/,
]

const raw = execFileSync(
  'git',
  ['log', '--no-merges', '--no-renames', '--since', SINCE, '--numstat', '--format=--%h--%ad', '--date=short', '--', gitPath],
  { cwd: REPO, maxBuffer: 1 << 30 },
).toString()

let commits = 0
const revisions = new Map()
for (const line of raw.split('\n')) {
  if (line.startsWith('--')) {
    commits++
    continue
  }
  if (!line.trim()) continue
  const path = line.split('\t')[2]
  if (!path || EXCLUDE.some((re) => re.test(path))) continue
  revisions.set(path, (revisions.get(path) ?? 0) + 1)
}

const files = [...revisions.keys()].filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file))
const rows = []
for (const file of files) {
  let text
  try {
    text = readFileSync(join(REPO, file), 'utf8')
  } catch {
    continue
  }
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  rows.push({
    file,
    rev: revisions.get(file),
    lines,
    score: revisions.get(file) * lines,
    area: areaOf(file),
  })
}
rows.sort((a, b) => b.score - a.score || b.rev - a.rev)

/** Area = the first two path segments under the source root. */
function areaOf(file) {
  const rel = gitPath === '.' ? file : relative(gitPath, file).split('\\').join('/')
  const parts = rel.split('/')
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.slice(0, -1).join('/') || parts[0]
}

const top = rows.slice(0, 40)
const groups = new Map()
for (const row of top) {
  if (!groups.has(row.area)) groups.set(row.area, [])
  groups.get(row.area).push(row)
}
const groupSorted = [...groups.entries()].sort(
  (a, b) =>
    b[1].length - a[1].length ||
    b[1].reduce((sum, row) => sum + row.score, 0) - a[1].reduce((sum, row) => sum + row.score, 0),
)

const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim()
const markdown = []
markdown.push(`# Hotspots — revisions (since ${SINCE}) x current lines`)
markdown.push('')
markdown.push(
  `Command: \`git log --no-merges --no-renames --since ${SINCE} --numstat --format=--%h--%ad --date=short -- ${gitPath}\` then \`wc -l\` on each current file at ${head}.`,
)
markdown.push('')
markdown.push(`- commits in window: ${commits}`)
markdown.push(`- source files with >=1 revision: ${files.length}`)
markdown.push('')
markdown.push('## Top 40 files by score (revisions x lines)')
markdown.push('')
markdown.push('| # | file | revisions | lines | score | area |')
markdown.push('|--:|------|----------:|------:|------:|------|')
top.forEach((row, index) =>
  markdown.push(
    `| ${index + 1} | \`${row.file}\` | ${row.rev} | ${row.lines} | ${row.score} | ${row.area} |`,
  ),
)
markdown.push('')
markdown.push('## Top 40 grouped by area')
markdown.push('')
markdown.push('| area | files in top 40 | summed score | files |')
markdown.push('|------|----------------:|-------------:|-------|')
for (const [area, list] of groupSorted) {
  markdown.push(
    `| ${area} | ${list.length} | ${list.reduce((sum, row) => sum + row.score, 0)} | ${list
      .map((row) => row.file.split('/').pop())
      .join(', ')} |`,
  )
}

writeFileSync(join(OUT, '02-hotspots.md'), markdown.join('\n') + '\n')
writeFileSync(
  join(OUT, '02-hotspots.json'),
  JSON.stringify(
    { commits, files: files.length, top, groups: groupSorted.map(([area, list]) => [area, list.length]) },
    null,
    1,
  ),
)
console.log(`commits=${commits} files=${files.length}`)
console.log(top.slice(0, 12).map((row) => `${row.score}\t${row.rev}\t${row.lines}\t${row.file}`).join('\n'))
console.log('---groups---')
console.log(groupSorted.map(([area, list]) => `${list.length}\t${area}`).join('\n'))
