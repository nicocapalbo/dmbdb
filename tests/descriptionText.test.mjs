import assert from 'node:assert/strict'
import test from 'node:test'

import {
  descriptionParts,
  descriptionPlainText,
} from '../helper/descriptionText.js'

test('descriptionParts emits safe HTTP links without interpreting HTML', () => {
  const parts = descriptionParts(
    '<script>alert(1)</script> See https://example.com/docs?mode=safe.',
  )

  assert.deepEqual(parts, [
    { type: 'text', text: '<script>alert(1)</script> See ' },
    {
      type: 'link',
      text: 'https://example.com/docs?mode=safe',
      href: 'https://example.com/docs?mode=safe',
    },
    { type: 'text', text: '.' },
  ])
})

test('descriptionParts supports line and paragraph break modes', () => {
  assert.deepEqual(descriptionParts('one\ntwo', { lineBreaks: 'all' }), [
    { type: 'text', text: 'one' },
    { type: 'break', count: 1 },
    { type: 'text', text: 'two' },
  ])
  assert.deepEqual(descriptionParts('one\ntwo\n\nthree', { lineBreaks: 'paragraphs' }), [
    { type: 'text', text: 'one two' },
    { type: 'break', count: 2 },
    { type: 'text', text: 'three' },
  ])
})

test('descriptionPlainText normalizes whitespace without HTML parsing', () => {
  assert.equal(
    descriptionPlainText('<b>literal</b>\n  description'),
    '<b>literal</b> description',
  )
})
