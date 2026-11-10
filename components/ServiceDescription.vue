<script>
import { defineComponent, h } from 'vue'
import { lexer } from 'marked'

const httpHref = (value) => {
  try {
    const url = new URL(String(value || ''))
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

const inlineNodes = (tokens = []) => tokens.map(token => {
  switch (token.type) {
    case 'text':
      return token.tokens ? inlineNodes(token.tokens) : token.text || ''
    case 'escape':
      return token.text || ''
    case 'br':
      return h('br')
    case 'codespan':
      return h('code', {
        class: 'rounded bg-gray-900 px-1 py-0.5 font-mono text-gray-200 break-words'
      }, token.text || '')
    case 'strong':
      return h('strong', { class: 'font-semibold text-gray-200' }, inlineNodes(token.tokens))
    case 'em':
      return h('em', null, inlineNodes(token.tokens))
    case 'del':
      return h('del', null, inlineNodes(token.tokens))
    case 'link': {
      const children = inlineNodes(token.tokens)
      const href = httpHref(token.href)
      return href
        ? h('a', {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'text-blue-400 underline break-words'
        }, children)
        : children
    }
    default:
      // HTML, images and unsupported inline syntax remain literal text.
      return token.raw || token.text || ''
  }
})

const blockNodes = (tokens = []) => tokens.flatMap(token => {
  switch (token.type) {
    case 'space':
      return []
    case 'paragraph':
    case 'text':
      return [h('p', { class: 'm-0' }, inlineNodes(token.tokens || [{ type: 'text', text: token.text }]))]
    case 'list':
      return [h(token.ordered ? 'ol' : 'ul', {
        class: token.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5',
        ...(token.ordered ? { start: token.start } : {})
      }, token.items.map(item => h('li', { class: 'space-y-1' }, blockNodes(item.tokens))))]
    case 'heading':
      return [h('p', { class: 'font-semibold text-gray-200' }, inlineNodes(token.tokens))]
    case 'blockquote':
      return [h('blockquote', { class: 'border-l-2 border-gray-600 pl-3 space-y-2' }, blockNodes(token.tokens))]
    case 'code':
      return [h('pre', { class: 'overflow-x-auto rounded bg-gray-900 p-3 text-gray-200' }, [
        h('code', null, token.text || '')
      ])]
    case 'hr':
      return [h('hr', { class: 'border-gray-600' })]
    default:
      // Vue escapes this text; backend descriptions cannot create DOM nodes.
      return [h('p', { class: 'whitespace-pre-wrap break-words' }, token.raw || token.text || '')]
  }
})

export default defineComponent({
  props: {
    text: { type: [String, Number], default: '' }
  },
  setup(props) {
    return () => h('div', {
      class: 'not-prose space-y-3 text-sm leading-relaxed text-gray-300'
    }, blockNodes(lexer(String(props.text ?? '').replace(/\r\n?/g, '\n'), {
      gfm: true,
      breaks: true
    })))
  }
})
</script>
