<script setup>
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps({
  analysis: { type: String, default: '' },
  provider: { type: String, default: '' },
  usage: { type: Object, default: () => ({}) },
  sessionId: { type: String, default: '' },
  followUpLoading: { type: Boolean, default: false },
  title: { type: String, default: 'Analysis' },
})
const emit = defineEmits(['follow-up'])
const toast = useToast()
const followUpQuestion = ref('')

const rendered = computed(() => {
  if (!import.meta.client || !props.analysis) return ''
  const html = marked.parse(props.analysis, { gfm: true, breaks: true })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
})

const usageSummary = computed(() => {
  const parts = []
  if (props.usage?.prompt_tokens != null) parts.push(`prompt ${props.usage.prompt_tokens}`)
  if (props.usage?.completion_tokens != null) parts.push(`completion ${props.usage.completion_tokens}`)
  if (props.usage?.total_tokens != null) parts.push(`total ${props.usage.total_tokens}`)
  return parts.join(' · ')
})

const copyAnalysis = async () => {
  await navigator.clipboard.writeText(props.analysis)
  toast.success({ title: 'Analysis copied', message: 'Markdown copied to the clipboard.' })
}

const downloadAnalysis = () => {
  const blob = new Blob([props.analysis], { type: 'text/markdown;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `dumb-ai-analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
  link.click()
  URL.revokeObjectURL(link.href)
}

const askFollowUp = () => {
  const value = followUpQuestion.value.trim()
  if (!value) return
  emit('follow-up', value)
  followUpQuestion.value = ''
}
</script>

<template>
  <section v-if="analysis" class="border border-emerald-500/30 bg-emerald-950/20">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 px-3 py-2">
      <div class="text-sm font-semibold text-emerald-100">{{ title }}</div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="text-right text-xs text-emerald-200/70">
          <div>{{ provider }}</div>
          <div v-if="usageSummary">{{ usageSummary }}</div>
        </div>
        <button class="button-small border border-slate-50/20 !p-2" title="Copy Markdown" @click="copyAnalysis">
          <span class="material-symbols-rounded !text-[18px]">content_copy</span>
        </button>
        <button class="button-small border border-slate-50/20 !p-2" title="Download Markdown report" @click="downloadAnalysis">
          <span class="material-symbols-rounded !text-[18px]">download</span>
        </button>
      </div>
    </header>

    <div class="ai-markdown px-4 py-3 text-sm leading-6 text-slate-100" v-html="rendered"></div>

    <form
      v-if="sessionId"
      class="flex flex-col gap-2 border-t border-emerald-500/20 px-3 py-3 sm:flex-row"
      @submit.prevent="askFollowUp"
    >
      <Input
        v-model="followUpQuestion"
        class="min-w-0 grow"
        placeholder="Ask a follow-up using the same evidence..."
        :disabled="followUpLoading"
      />
      <button
        type="submit"
        class="button-small border border-slate-50/20 !px-3 !py-2"
        :disabled="followUpLoading || !followUpQuestion.trim()"
      >
        <span v-if="followUpLoading" class="animate-spin material-symbols-rounded !text-[18px]">progress_activity</span>
        <span v-else class="material-symbols-rounded !text-[18px]">send</span>
        <span>Ask</span>
      </button>
    </form>
  </section>
</template>

<style scoped>
.ai-markdown :deep(h1),
.ai-markdown :deep(h2),
.ai-markdown :deep(h3) {
  margin: 1rem 0 0.45rem;
  color: rgb(236 253 245);
  font-weight: 650;
  letter-spacing: 0;
}
.ai-markdown :deep(h1) { font-size: 1.35rem; }
.ai-markdown :deep(h2) { font-size: 1.15rem; }
.ai-markdown :deep(h3) { font-size: 1rem; }
.ai-markdown :deep(p),
.ai-markdown :deep(ul),
.ai-markdown :deep(ol),
.ai-markdown :deep(pre),
.ai-markdown :deep(table) { margin: 0.65rem 0; }
.ai-markdown :deep(ul) { list-style: disc; padding-left: 1.35rem; }
.ai-markdown :deep(ol) { list-style: decimal; padding-left: 1.35rem; }
.ai-markdown :deep(code) {
  border: 1px solid rgb(51 65 85);
  background: rgb(2 6 23 / 0.75);
  padding: 0.1rem 0.3rem;
  font-size: 0.82rem;
}
.ai-markdown :deep(pre) {
  overflow-x: auto;
  border: 1px solid rgb(51 65 85);
  background: rgb(2 6 23 / 0.8);
  padding: 0.75rem;
}
.ai-markdown :deep(pre code) { border: 0; padding: 0; }
.ai-markdown :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
.ai-markdown :deep(th),
.ai-markdown :deep(td) {
  border: 1px solid rgb(71 85 105);
  padding: 0.45rem 0.6rem;
  text-align: left;
  vertical-align: top;
}
.ai-markdown :deep(th) { background: rgb(15 23 42); }
.ai-markdown :deep(a) { color: rgb(125 211 252); text-decoration: underline; }
.ai-markdown :deep(blockquote) {
  border-left: 3px solid rgb(52 211 153);
  margin: 0.75rem 0;
  padding-left: 0.8rem;
  color: rgb(203 213 225);
}
</style>
