import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { getNodeVersionError } from '../scripts/check-node.cjs'

const currentRange = '>=24.15.0 <25'
const checkerPath = fileURLToPath(new URL('../scripts/check-node.cjs', import.meta.url))

function assertRejected(version, range) {
  const error = getNodeVersionError(version, range)
  assert.equal(typeof error, 'string', 'Unsupported versions must return a diagnostic')
  assert.ok(error.includes(String(version)), 'Diagnostic identifies the selected runtime')
  assert.ok(error.includes(range), 'Diagnostic identifies the selected engine requirement')
}

test('Node guard enforces the current minimum and exclusive major ceiling', () => {
  for (const version of ['24.15.0', 'v24.15.0', '24.18.0', '24.99.99']) {
    assert.equal(getNodeVersionError(version, currentRange), null)
  }
  for (const version of ['18.20.0', '24.14.99', '25.0.0', '26.0.0']) {
    assertRejected(version, currentRange)
  }
})

test('Node guard honors older selected bounded engine ranges', () => {
  assert.equal(getNodeVersionError('24.0.0', '>=24.0.0 <25'), null)
  assertRejected('23.99.0', '>=24.0.0 <25')
  for (const version of ['18.0.0', '20.19.0', '22.12.0', '24.14.0']) {
    assert.equal(getNodeVersionError(version, '>=18.0.0 <25'), null)
  }
  assertRejected('17.99.0', '>=18.0.0 <25')
})

test('Node guard honors changed patch floors and partial or full upper bounds', () => {
  assertRejected('24.18.0', '>=24.19.1 <25')
  assert.equal(getNodeVersionError('24.19.1', '>=24.19.1 <25'), null)
  assert.equal(getNodeVersionError('24.15.99', '>=24.15.0 <24.16'), null)
  assertRejected('24.16.0', '>=24.15.0 <24.16')
  assert.equal(getNodeVersionError('24.16.1', '>=24.15.0 <24.16.2'), null)
  assertRejected('24.16.2', '>=24.15.0 <24.16.2')
})

test('Node guard rejects prerelease and malformed runtime versions clearly', () => {
  for (const version of ['v24.15.0-rc.1', '24.18.0-nightly.20261012', '24.15', 'node24.15.0', 'invalid']) {
    assertRejected(version, currentRange)
  }
})

test('Node guard preserves targets without a Node engine requirement', () => {
  for (const range of [undefined, null, '']) {
    assert.equal(getNodeVersionError('18.0.0', range), null)
  }
})

test('Node guard fails clearly for unsupported engine grammar', () => {
  for (const range of ['^24.15.0', '>=24.15.0', '>=24.15.0 <25 || >=26.0.0 <27', 'not a range']) {
    const error = getNodeVersionError('24.18.0', range)
    assert.equal(typeof error, 'string')
    assert.ok(error.includes(range), 'Unsupported requirement is identified')
  }
})

test('standalone Node guard reads its adjacent manifest without dependencies or caller overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmbdb-node-guard-'))
  try {
    const project = path.join(root, 'selected-target')
    const caller = path.join(root, 'caller')
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true })
    fs.mkdirSync(caller)
    const script = path.join(project, 'scripts', 'check-node.cjs')
    fs.copyFileSync(checkerPath, script)
    const wrongRange = '>=99.0.0 <100'
    const callerManifest = path.join(caller, 'package.json')
    fs.writeFileSync(callerManifest, JSON.stringify({ engines: { node: wrongRange } }))
    const major = Number(process.versions.node.split('.')[0])
    const compatibleRange = '>=' + major + '.0.0 <' + (major + 1)
    const env = {
      ...process.env,
      npm_package_json: callerManifest,
      npm_package_engines_node: wrongRange,
    }
    function run(range) {
      fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ engines: { node: range } }))
      return spawnSync(process.execPath, [script], { cwd: caller, env, encoding: 'utf8' })
    }
    const compatible = run(compatibleRange)
    assert.equal(compatible.status, 0, compatible.stderr)
    const incompatible = run(wrongRange)
    assert.equal(incompatible.status, 1)
    assert.ok(incompatible.stderr.includes(process.version))
    assert.ok(incompatible.stderr.includes(wrongRange))
    assert.match(incompatible.stderr, /DUMB|image|Node/i)
    assert.equal(fs.existsSync(path.join(project, 'node_modules')), false)
    const noRequirement = run(undefined)
    assert.equal(noRequirement.status, 0, noRequirement.stderr)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
