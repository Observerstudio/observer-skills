// Temporal coupling (Tornhill) over the source tree's history.
// Usage: node coupling.mjs --root <repo> --out <dir> [--source <dir>]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { resolveSource } from './lib/common.mjs'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
  },
})
const REPO = resolve(values.root ?? process.cwd())
const OUT = resolve(values.out ?? join(REPO, 'tmp/untangle-evidence'))
mkdirSync(OUT, { recursive: true })
const { gitPath } = resolveSource(REPO, values.source)

const raw = execFileSync(
  'git',
  ['log', '--no-merges', '--no-renames', '--numstat', '--format=--%h--%ad', '--date=short', '--', gitPath],
  { cwd: REPO, maxBuffer: 1 << 30 },
).toString()

const EXCLUDE = [
  /(^|\/)generated\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/,
]

const commits = []
let current = null
for (const line of raw.split('\n')) {
  if (line.startsWith('--')) {
    const [, hash, date] = line.match(/^--([0-9a-f]+)--(.*)$/) ?? []
    current = { hash, date, files: [] }
    commits.push(current)
  } else if (current && line.trim()) {
    const path = line.split('\t')[2]
    if (!path || EXCLUDE.some((re) => re.test(path))) continue
    current.files.push(path)
  }
}

const bulk = commits.filter((commit) => commit.files.length > 40).length
const usable = commits.filter((commit) => commit.files.length > 0 && commit.files.length <= 40)

const revisions = new Map()
const shared = new Map()
for (const commit of usable) {
  const files = [...new Set(commit.files)]
  for (const file of files) revisions.set(file, (revisions.get(file) ?? 0) + 1)
  files.sort()
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const key = files[i] + '\u0000' + files[j]
      shared.set(key, (shared.get(key) ?? 0) + 1)
    }
  }
}

/** Area = the first two path segments under the source root. */
const areaOf = (file) => {
  const rel = gitPath === '.' ? file : relative(gitPath, file).split(sep).join('/')
  const parts = rel.split('/')
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.slice(0, -1).join('/') || parts[0]
}

const rows = []
for (const [key, count] of shared) {
  if (count < 8) continue
  const [a, b] = key.split('\u0000')
  const ra = revisions.get(a)
  const rb = revisions.get(b)
  const degree = count / ((ra + rb) / 2)
  rows.push({ a, b, shared: count, ra, rb, degree, areaA: areaOf(a), areaB: areaOf(b), cross: areaOf(a) !== areaOf(b) })
}
rows.sort((x, y) => y.shared - x.shared || y.degree - x.degree || x.a.localeCompare(y.a))
const byDegree = [...rows].sort((x, y) => y.degree - x.degree || y.shared - x.shared)

const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim()
const cross = rows.filter((row) => row.cross)
const markdown = []
markdown.push(`# Temporal coupling — ${gitPath} full history`)
markdown.push('')
markdown.push(
  `Command: \`git log --no-merges --no-renames --numstat --format='--%h--%ad' --date=short -- ${gitPath}\` in \`${REPO}\` (HEAD @ ${head}).`,
)
markdown.push('')
markdown.push(`- commits parsed: ${commits.length}`)
markdown.push(`- commits dropped as bulk (>40 files): ${bulk}`)
markdown.push(`- commits used: ${usable.length}`)
markdown.push(`- files with >=1 revision: ${revisions.size}`)
markdown.push(`- pairs with >=8 shared commits: ${rows.length}`)
markdown.push('')
markdown.push('Excluded paths: generated files and lockfiles.')
markdown.push('')
markdown.push('## Top 60 pairs by shared commits (>=8)')
markdown.push('')
markdown.push('| # | file A | file B | shared | rev A | rev B | degree | areas | cross-folder |')
markdown.push('|--:|--------|--------|-------:|------:|------:|-------:|--------|--------------|')
rows.slice(0, 60).forEach((row, index) => {
  markdown.push(
    `| ${index + 1} | \`${row.a}\` | \`${row.b}\` | ${row.shared} | ${row.ra} | ${row.rb} | ${row.degree.toFixed(2)} | ${row.areaA} <-> ${row.areaB} | ${row.cross ? '**YES**' : 'no'} |`,
  )
})
markdown.push('')
markdown.push(`## Cross-area pairs among the >=8 set (${cross.length} of ${rows.length})`)
markdown.push('')
markdown.push('| # | file A | file B | shared | rev A | rev B | degree | areas |')
markdown.push('|--:|--------|--------|-------:|------:|------:|-------:|--------|')
cross.slice(0, 60).forEach((row, index) => {
  markdown.push(
    `| ${index + 1} | \`${row.a}\` | \`${row.b}\` | ${row.shared} | ${row.ra} | ${row.rb} | ${row.degree.toFixed(2)} | ${row.areaA} <-> ${row.areaB} |`,
  )
})
markdown.push('')
markdown.push('## Highest degree pairs (>=8 shared), top 25')
markdown.push('')
markdown.push('| file A | file B | shared | degree | cross-folder |')
markdown.push('|--------|--------|-------:|-------:|--------------|')
byDegree.slice(0, 25).forEach((row) => {
  markdown.push(
    `| \`${row.a}\` | \`${row.b}\` | ${row.shared} | ${row.degree.toFixed(2)} | ${row.cross ? '**YES**' : 'no'} |`,
  )
})

writeFileSync(join(OUT, '01-coupling.md'), markdown.join('\n') + '\n')
writeFileSync(
  join(OUT, '01-coupling.json'),
  JSON.stringify(
    { commits: commits.length, bulk, usable: usable.length, files: revisions.size, rows },
    null,
    1,
  ),
)
console.log(
  `commits=${commits.length} bulk=${bulk} usable=${usable.length} files=${revisions.size} pairs>=8=${rows.length} cross=${cross.length}`,
)
console.log(byDegree.slice(0, 10).map((row) => `${row.shared}/${row.degree.toFixed(2)} ${row.a} <-> ${row.b}`).join('\n'))
