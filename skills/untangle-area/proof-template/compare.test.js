// node --test proof-template/compare.test.js
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')

const compare = join(__dirname, 'compare.js')

function run(args) {
  return spawnSync(process.execPath, [compare, ...args], { encoding: 'utf8' })
}

function withFiles(files, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'untangle-compare-'))
  try {
    const paths = {}
    for (const [name, content] of Object.entries(files)) {
      paths[name] = join(dir, name)
      writeFileSync(paths[name], content)
    }
    return callback(paths)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('empty before file exits non-zero with a clear message, not a stack trace', () => {
  withFiles({ 'before.json': '', 'after.json': '{"a":1}' }, (paths) => {
    const result = run(['--before', paths['before.json'], '--after', paths['after.json']])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /nothing to compare: .*before\.json is empty/)
    assert.doesNotMatch(result.stderr, /\n\s+at /)
  })
})

test('empty after file exits non-zero with a clear message', () => {
  withFiles({ 'before.json': '{"a":1}', 'after.json': '  \n' }, (paths) => {
    const result = run(['--before', paths['before.json'], '--after', paths['after.json']])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /nothing to compare: .*after\.json is empty/)
  })
})

test('identical dumps report zero differences', () => {
  withFiles(
    { 'before.json': '{"rows":[{"amount":"1.00"}]}', 'after.json': '{"rows":[{"amount":"1.00"}]}' },
    (paths) => {
      const result = run(['--before', paths['before.json'], '--after', paths['after.json']])
      assert.equal(result.status, 0)
      assert.match(result.stdout, /differences: 0/)
    },
  )
})

test('a changed value fails the comparison', () => {
  withFiles(
    { 'before.json': '{"rows":[{"amount":"1.00"}]}', 'after.json': '{"rows":[{"amount":"2.00"}]}' },
    (paths) => {
      const result = run(['--before', paths['before.json'], '--after', paths['after.json']])
      assert.equal(result.status, 1)
      assert.match(result.stdout, /differences: 1/)
    },
  )
})

test('invalid JSON exits 2 with a clear message', () => {
  withFiles({ 'before.json': '{', 'after.json': '{}' }, (paths) => {
    const result = run(['--before', paths['before.json'], '--after', paths['after.json']])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /cannot parse .*before\.json/)
  })
})
