// Shared helpers: resolve the source root and load the TypeScript compiler API
// from the target repo. Nothing here knows any particular project layout.
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve, sep } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  'tmp',
])

/**
 * The directory the scanners treat as the source tree.
 *
 * `--source src` wins; otherwise `<root>/src` when it exists, else the root
 * itself (repos that keep `app/`, `lib/`, `server/` at the top level).
 */
export function resolveSource(root, source) {
  const abs = source
    ? resolve(root, source)
    : existsSync(join(root, 'src'))
      ? join(root, 'src')
      : root
  if (!existsSync(abs)) throw new Error(`source directory not found: ${abs}`)
  const rel = relative(root, abs).split(sep).join('/')
  return { abs, gitPath: rel === '' ? '.' : rel }
}

/** Every source file under `dir` with one of `extensions`, skipping build and vendor folders. */
export function walkSource(dir, extensions) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path)
      } else if (extensions.test(entry.name)) {
        files.push(path)
      }
    }
  }
  walk(dir)
  return files
}

/**
 * TypeScript from the target repo (most TS repos have it). `--typescript`
 * or `TS_MODULE` can point at a compiler elsewhere, for a repo whose
 * dependencies are not installed yet.
 */
export function loadTypeScript(root, explicit) {
  const specifiers = [explicit, process.env.TS_MODULE].filter(
    (value) => typeof value === 'string' && value.length > 0,
  )
  const loaders = [createRequire(join(root, 'package.json')), createRequire(import.meta.url)]
  for (const specifier of specifiers) {
    for (const load of loaders) {
      try {
        return load(specifier)
      } catch {
        // Try the next loader, then the default lookup below.
      }
    }
  }
  for (const load of loaders) {
    try {
      return load('typescript')
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    `TypeScript not found for ${root}. Install it there (npm i -D typescript), or pass --typescript <module> / TS_MODULE.`,
  )
}
