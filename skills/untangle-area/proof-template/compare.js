// Part 3 of the untangle differential: compare two dumps, field by field.
//
// Usage:
//   node compare.js --before <before.json> --after <after.json> [--out <differences.json>]
//
// Exit code: 0 when every sampled value is identical, 1 when anything differs
// or an input is empty, 2 on a usage/read/parse error.

const fs = require('node:fs')
const { parseArgs } = require('node:util')

const USAGE =
  'usage: node compare.js --before <before.json> --after <after.json> [--out <differences.json>]'

let values
try {
  values = parseArgs({
    options: {
      before: { type: 'string' },
      after: { type: 'string' },
      out: { type: 'string' },
    },
  }).values
} catch (error) {
  console.error(`${USAGE}\n${error.message}`)
  process.exit(2)
}

if (!values.before || !values.after) {
  console.error(USAGE)
  process.exit(2)
}

// JSON.parse rounds integers past 2^53, so two distinct dump values would look
// equal. Check integer tokens (outside strings) before parsing and reject them.
function rejectUnsafeIntegers(text, file) {
  const unquoted = text.replace(/"(?:\\.|[^"\\])*"/g, '""')
  for (const token of unquoted.match(/(?<![\d.eE])-?\d+(?![\d.eE])/g) ?? []) {
    const value = BigInt(token)
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
      console.error(`cannot compare ${file}: integer ${token} exceeds Number.MAX_SAFE_INTEGER`)
      process.exit(2)
    }
  }
}

function readJson(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    console.error(`cannot read ${file}: ${error.message}`)
    process.exit(2)
  }
  if (text.trim() === '') {
    console.error(`nothing to compare: ${file} is empty`)
    process.exit(1)
  }
  rejectUnsafeIntegers(text, file)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.error(`cannot parse ${file}: ${error.message}`)
    process.exit(2)
  }
  // An empty `[]` or `{}` compares equal to itself: no samples, no proof.
  if (parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length === 0) {
    console.error(`nothing to compare: ${file} is empty`)
    process.exit(1)
  }
  return parsed
}

const before = readJson(values.before)
const after = readJson(values.after)

const differences = []
function walk(x, y, path) {
  if (x === y) return
  const tx = typeof x
  const ty = typeof y
  if (tx !== ty || x === null || y === null || tx !== 'object') {
    differences.push({ path, before: x, after: y })
    return
  }
  if (Array.isArray(x) !== Array.isArray(y)) {
    differences.push({ path, before: x, after: y })
    return
  }
  if (Array.isArray(x)) {
    if (x.length !== y.length) {
      differences.push({ path: `${path}.length`, before: x.length, after: y.length })
    }
    const length = Math.max(x.length, y.length)
    for (let i = 0; i < length; i++) walk(x[i], y[i], `${path}[${i}]`)
    return
  }
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const key of keys) walk(x[key], y[key], path ? `${path}.${key}` : key)
}
walk(before, after, '')

console.log('differences:', differences.length)
const byField = Object.create(null)
for (const difference of differences) {
  byField[difference.path] = (byField[difference.path] || 0) + 1
}
console.log('by field:', JSON.stringify(byField, null, 2))
const byValue = {}
for (const difference of differences) {
  const key = JSON.stringify([difference.before, difference.after])
  byValue[key] = (byValue[key] || 0) + 1
}
console.log('by value pair:', JSON.stringify(byValue, null, 2))

if (values.out) fs.writeFileSync(values.out, JSON.stringify(differences, null, 2))
process.exit(differences.length === 0 ? 0 : 1)
