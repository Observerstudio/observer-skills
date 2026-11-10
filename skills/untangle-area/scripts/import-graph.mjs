// Real import graph for the source tree, using the TypeScript compiler API.
// Module-level, alias-resolved. No install beyond the repo's own typescript.
// Usage: node import-graph.mjs --root <repo> --out <dir> [--source <dir>] [--typescript <module>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { loadTypeScript, resolveSource, walkSource } from './lib/common.mjs'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
    typescript: { type: 'string' },
  },
})
const REPO = resolve(values.root ?? process.cwd())
const OUT = resolve(values.out ?? join(REPO, 'tmp/untangle-evidence'))
mkdirSync(OUT, { recursive: true })
const { abs: SOURCE, gitPath } = resolveSource(REPO, values.source)
const ts = loadTypeScript(REPO, values.typescript)

const configPath = join(REPO, 'tsconfig.json')
const read = ts.readConfigFile(configPath, ts.sys.readFile)
// A repo without a tsconfig still has imports; fall back to compiler defaults.
const config = read.error
  ? ts.parseJsonConfigFileContent({}, ts.sys, REPO)
  : ts.parseJsonConfigFileContent(read.config, ts.sys, REPO)
const options = { ...config.options, noEmit: true, allowJs: true }
const aliasKeys = Object.keys(options.paths ?? {})

const files = walkSource(SOURCE, /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/).filter(
  (file) => !file.endsWith('.d.ts'),
)

const isLocalSpec = (spec) =>
  spec.startsWith('.') ||
  aliasKeys.some((key) => {
    const prefix = key.replace(/\*$/, '')
    return spec.startsWith(prefix)
  })

const edges = []
const unresolved = []
const host = ts.createCompilerHost(options)
host.fileExists = ts.sys.fileExists
host.readFile = ts.sys.readFile
const cache = ts.createModuleResolutionCache(REPO, (spec) => spec, options)

const rel = (path) => relative(REPO, path).split(sep).join('/')

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const info = ts.preProcessFile(source, true, true)
  const specs = new Set()
  for (const imported of info.importedFiles) specs.add(imported.fileName)
  for (const referenced of info.referencedFiles ?? []) specs.add(referenced.fileName)
  for (const spec of specs) {
    if (!isLocalSpec(spec)) continue
    const resolved = ts.resolveModuleName(spec, file, options, host, cache).resolvedModule
    if (!resolved) {
      unresolved.push({ from: rel(file), spec })
      continue
    }
    const to = rel(resolved.resolvedFileName)
    if (to.includes('node_modules/')) continue
    if (to.startsWith('../')) continue
    if (gitPath !== '.' && to !== gitPath && !to.startsWith(`${gitPath}/`)) continue
    if (to === rel(file)) continue
    edges.push({ from: rel(file), to, spec })
  }
}

const unique = new Map()
for (const edge of edges) unique.set(`${edge.from}\u0000${edge.to}`, edge)
const edgeList = [...unique.values()]

/** Area = the first two path segments under the source root. */
const area = (file) => {
  const inside = gitPath === '.' ? file : file.slice(gitPath.length + 1)
  const parts = inside.split('/')
  return parts.length > 2 ? `${pathPrefix()}${parts[0]}/${parts[1]}` : `${pathPrefix()}${parts[0] ?? ''}`
}
const pathPrefix = () => (gitPath === '.' ? '' : `${gitPath}/`)

/** Top-level area = the first path segment under the source root. */
const top = (file) => {
  const inside = gitPath === '.' ? file : file.slice(gitPath.length + 1)
  return `${pathPrefix()}${inside.split('/')[0] ?? ''}`
}

const folderEdges = new Map()
for (const edge of edgeList) {
  const a = area(edge.from)
  const b = area(edge.to)
  if (a === b) continue
  const key = `${a}\u0000${b}`
  folderEdges.set(key, (folderEdges.get(key) ?? 0) + 1)
}
const folderRows = [...folderEdges.entries()]
  .map(([key, count]) => {
    const [a, b] = key.split('\u0000')
    return { a, b, n: count }
  })
  .sort((x, y) => y.n - x.n)

const topEdges = new Map()
for (const edge of edgeList) {
  const a = top(edge.from)
  const b = top(edge.to)
  if (a === b) continue
  if (!topEdges.has(a)) topEdges.set(a, new Set())
  topEdges.get(a).add(b)
}
// Cycles of any length: Tarjan's strongly connected components over the
// top-level area graph, reporting every component with more than one area.
const areaCycles = []
const sccIndex = new Map()
const sccLow = new Map()
const sccStack = []
const onStack = new Set()
const connect = (node) => {
  sccIndex.set(node, sccIndex.size)
  sccLow.set(node, sccIndex.get(node))
  sccStack.push(node)
  onStack.add(node)
  for (const next of topEdges.get(node) ?? []) {
    if (!sccIndex.has(next)) {
      connect(next)
      sccLow.set(node, Math.min(sccLow.get(node), sccLow.get(next)))
    } else if (onStack.has(next)) {
      sccLow.set(node, Math.min(sccLow.get(node), sccIndex.get(next)))
    }
  }
  if (sccLow.get(node) !== sccIndex.get(node)) return
  const component = []
  let member
  do {
    member = sccStack.pop()
    onStack.delete(member)
    component.push(member)
  } while (member !== node)
  if (component.length > 1) areaCycles.push(component.sort())
}
for (const node of topEdges.keys()) if (!sccIndex.has(node)) connect(node)

const markdown = []
markdown.push('# Real import graph (TypeScript compiler API, alias-resolved)')
markdown.push('')
markdown.push(
  `Script: \`import-graph.mjs\` using \`${ts.version}\` from the repo; \`ts.preProcessFile\` + \`ts.resolveModuleName\` with the repo \`tsconfig.json\`. Files scanned: ${files.length} under \`${gitPath}\`.`,
)
markdown.push('')
markdown.push(`- module edges after dedupe: ${edgeList.length}`)
markdown.push(`- unresolved local-looking specs: ${unresolved.length}`)
markdown.push('')
markdown.push('## Folder-to-folder edge counts (top 60, a != b)')
markdown.push('')
markdown.push('| from | to | imports |')
markdown.push('|------|----|--------:|')
folderRows.slice(0, 60).forEach((row) => markdown.push(`| ${row.a} | ${row.b} | ${row.n} |`))
markdown.push('')
markdown.push(`## Cycles between top-level areas (strongly connected groups), ${areaCycles.length}`)
markdown.push('')
for (const group of areaCycles) markdown.push(`- **${group.join(' -> ')} -> ${group[0]}**`)
if (!areaCycles.length) markdown.push('- none')
if (unresolved.length) {
  markdown.push('')
  markdown.push(`## Unresolved local-looking specs (${unresolved.length})`)
  markdown.push('')
  markdown.push('| from | spec |')
  markdown.push('|------|------|')
  for (const item of unresolved.slice(0, 40)) markdown.push(`| \`${item.from}\` | \`${item.spec}\` |`)
}

writeFileSync(join(OUT, '03-import-graph.md'), markdown.join('\n') + '\n')
writeFileSync(
  join(OUT, '03-import-graph.json'),
  JSON.stringify({ files: files.length, edges: edgeList.length, folderRows, areaCycles, unresolved }, null, 1),
)
console.log(
  `files=${files.length} edges=${edgeList.length} unresolved=${unresolved.length} areaCycles=${areaCycles.length}`,
)
console.log('cycles:', areaCycles.map((group) => group.join('->')).join(', ') || 'none')
console.log('folder edges top:', folderRows.slice(0, 10).map((row) => `${row.n} ${row.a} -> ${row.b}`).join('\n'))
