'use strict'

// This can run before dependencies are installed. Keep it dependency-free and
// compatible with older Node runtimes so unsupported installations get a useful
// error. The authored engine range uses >=major.minor.patch <major[.minor[.patch]].
const fs = require('fs')
const path = require('path')

function parseVersion(version, partial) {
  if (typeof version !== 'string') return null
  const pattern = partial
    ? /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/
    : /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  const match = pattern.exec(version)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
  return parts.every(Number.isSafeInteger) ? parts : null
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function getNodeVersionError(version, range) {
  if (range === undefined || range === null || range === '') return null
  const bounds = typeof range === 'string' && /^>=([^\s]+)\s+<([^\s]+)$/.exec(range)
  const minimum = bounds && parseVersion(bounds[1], false)
  const maximum = bounds && parseVersion(bounds[2], true)
  if (!minimum || !maximum || compareVersions(minimum, maximum) >= 0) {
    return 'Unsupported frontend Node engine range ' + JSON.stringify(range) +
      '; use >=major.minor.patch <major[.minor[.patch]] in package.json.'
  }
  const actual = parseVersion(version, false)
  if (actual && compareVersions(actual, minimum) >= 0 && compareVersions(actual, maximum) < 0) {
    return null
  }
  return 'DUMB Frontend requires Node ' + range + '; found ' + String(version) +
    '. Update the DUMB container image before rebuilding or updating the frontend, ' +
    'preserving existing persistent volumes. For a standalone frontend, install a matching Node version.'
}

function main() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    const error = getNodeVersionError(process.version, manifest.engines && manifest.engines.node)
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  } catch (error) {
    console.error('Unable to check the frontend Node requirement: ' + error.message)
    process.exitCode = 1
  }
}

module.exports = { getNodeVersionError }
if (require.main === module) main()
