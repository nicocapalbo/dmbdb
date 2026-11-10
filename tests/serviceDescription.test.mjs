import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createSSRApp, h } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

const { descriptor } = parse(fs.readFileSync(
  new URL('../components/ServiceDescription.vue', import.meta.url), 'utf8',
))
const source = compileScript(descriptor, { id: 'service-description', inlineTemplate: true }).content
  .replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace(/from ['"]marked['"]/g, `from ${JSON.stringify(import.meta.resolve('marked'))}`)
const { default: ServiceDescription } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`,
)
const render = text => renderToString(createSSRApp({ render: () => h(ServiceDescription, { text }) }))

const mediastorm = [
  'mediastorm',
  '- Fully self-hosted streaming server for Debrid, Torrent, and Usenet sources.',
  '- Includes an admin UI and browser player plus native mobile and TV clients.',
  '- Uses DUMB-managed PostgreSQL for accounts, watch history, and playback state.',
  '- Current builds use `admin` / `admin` for first login and require a replacement password during',
  '  that same sign-in before creating the first admin session.',
  '',
  'Documentation: https://dumbarr.com/services/optional/mediastorm',
].join('\n')

test('actual formatter renders the backend mediastorm sample as paragraphs, four bullets, inline code and docs link', async () => {
  const html = await render(mediastorm)
  assert.match(html, /<p[^>]*>mediastorm<\/p>/)
  assert.equal([...html.matchAll(/<li\b/g)].length, 4)
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1])
  assert.match(items[3], /Current builds use/)
  assert.match(items[3], /that same sign-in before creating the first admin session/)
  assert.equal([...html.matchAll(/<code\b[^>]*>admin<\/code>/g)].length, 2)
  assert.match(html, /href="https:\/\/dumbarr.com\/services\/optional\/mediastorm"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.doesNotMatch(html, /<p[^>]*>\s*<(?:ul|ol|p)\b/)
})

test('single line breaks, blank paragraphs and CRLF survive without becoming a run-on string', async () => {
  const html = await render('First line\r\nSecond line\r\n\r\n- One\r\n- Two')
  assert.match(html, /First line<br\s*\/?>(?:\n)?Second line/)
  assert.equal([...html.matchAll(/<ul\b/g)].length, 1)
  assert.equal([...html.matchAll(/<li\b/g)].length, 2)
  assert.doesNotMatch(html, /First line Second line/)
})

test('ordered and nested lists retain emphasis and inline code through text-wrapper tokens', async () => {
  const html = await render('3. **First** with *emphasis*\n4. Second\n   - Nested `/media/books`\n\nAfter list.')
  assert.match(html, /<ol\b[^>]*start="3"/)
  assert.match(html, /<strong\b[^>]*>First<\/strong>/)
  assert.match(html, /<em>emphasis<\/em>/)
  assert.match(html, /<ul\b/)
  assert.match(html, /<code\b[^>]*>\/media\/books<\/code>/)
  assert.match(html, /<p[^>]*>After list\.<\/p>/)
})

test('backend HTML, images and executable URL schemes remain inert while normal web links work', async () => {
  const text = [
    '<script>alert("unsafe")</script>',
    '',
    '<img src="https://example.test/pixel" onerror="alert(1)">',
    '<iframe src="https://example.test/frame"></iframe>',
    '',
    '![tracking](https://example.test/image)',
    '[script link](javascript:alert%281%29) [data link](data:text/html,unsafe)',
    '[docs](https://example.test/docs?q=a&b=2)',
  ].join('\n')
  const html = await render(text)
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/i)
  assert.doesNotMatch(html, /href="(?:javascript|data):/i)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img /)
  assert.match(html, /!\[tracking\]/)
  assert.match(html, /script link/)
  assert.match(html, /data link/)
  assert.match(html, /href="https:\/\/example.test\/docs\?q=a&amp;b=2"/)
  assert.equal([...html.matchAll(/<a\b/g)].length, 1)
})

test('code blocks and inline code keep markup literal and never create links or active elements', async () => {
  const html = await render('`https://example.test/code`\n\n~~~html\n<script>literal()</script>\n~~~')
  assert.match(html, /<code\b[^>]*>https:\/\/example.test\/code<\/code>/)
  assert.match(html, /<pre\b[^>]*><code>&lt;script&gt;literal\(\)&lt;\/script&gt;<\/code><\/pre>/)
  assert.doesNotMatch(html, /<script\b/)
  assert.doesNotMatch(html, /<a\b/)
})

test('blank, null and numeric descriptions produce readable text without placeholder words', async () => {
  for (const value of ['', null, undefined]) {
    const html = await render(value)
    assert.doesNotMatch(html, /undefined|null|<p\b/)
  }
  assert.match(await render(42), /<p[^>]*>42<\/p>/)
})
