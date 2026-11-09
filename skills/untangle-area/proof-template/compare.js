// Part 3 of the untangle differential: compare two dumps, field by field.
//
// Usage:
//   node compare.js --before <before.json> --after <after.json> [--out <differences.json>]
//
// Exit code: 0 when every sampled value is identical, 1 when anything differs
// or an input is empty, 2 on a usage/read/parse error.

const fs = require('node:fs')
const { parseArgs } = require('node:util')

const { values } = parseArgs({
  options: {
    before: { type: 'string' },
    after: { type: 'string' },
    out: { type: 'string' },
  },
})

if (!values.before || !values.after) {
  console.error(
    'usage: node compare.js --before <before.json> --after <after.json> [--out <differences.json>]',
  )
  process.exit(2)
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
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error(`cannot parse ${file}: ${error.message}`)
    process.exit(2)
  }
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
const byField = {}
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
