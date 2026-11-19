<script setup>
import { computed } from 'vue'
import { infinidyskV2Stages } from '~/helper/infinidyskV2Stages.js'
import { infinidyskV2StatusDuration as duration } from '~/helper/infinidyskV2Status.js'
const props = defineProps({ value: { type: Object, default: null }, job: { type: Object, default: null }, confirmed: { type: Boolean, default: true }, preview: { type: Boolean, default: false } })
const timeline = computed(() => infinidyskV2Stages(props.value, props))
const groups = computed(() => !timeline.value?.recorded ? [] : [
  { id: 'migration', steps: timeline.value.steps.filter(step => !timeline.value.recovery || step.id !== 'restore_v1') },
  ...(timeline.value.recovery ? [{ id: 'recovery', steps: timeline.value.steps.filter(step => step.id === 'restore_v1') }] : []),
])
</script>

<template>
  <section v-if="timeline" class="v2-stage-tracker rounded border border-slate-600 p-3 text-sm" :aria-label="preview ? 'Planned migration stages' : 'Migration stages'" data-testid="v2-stages">
    <h4 class="font-semibold">{{ preview ? 'Planned migration stages' : 'Migration stages' }}</h4>
    <p class="v2-stage-note mt-1 text-xs" data-testid="v2-stages-note">{{ timeline.note }}</p>
    <div v-for="group in groups" :key="group.id">
    <h5 v-if="group.id === 'recovery'" class="mt-3 border-t border-slate-600 pt-3 font-semibold">Recovery</h5>
    <ol class="v2-stage-list mt-3" :aria-label="group.id === 'recovery' ? 'Recovery stages' : 'Migration stages'" data-testid="v2-stage-list">
      <li v-for="step in group.steps" :key="step.id" class="v2-stage" :data-state="step.state" :data-testid="'v2-stage-' + step.id" :aria-current="confirmed && timeline.currentId === step.id && ['running', 'waiting'].includes(step.state) ? 'step' : undefined">
        <span class="v2-stage-symbol" aria-hidden="true">{{ step.symbol }}</span>
        <span class="v2-stage-label">{{ step.label }}</span>
        <span class="v2-stage-state">{{ step.statusLabel }}</span>
      </li>
    </ol>
    </div>
    <details v-if="timeline.recorded" class="mt-3 text-xs" data-testid="v2-stage-details">
      <summary class="cursor-pointer">What happens in each stage</summary>
      <dl class="mt-2 space-y-2"><div v-for="step in timeline.steps" :key="step.id"><dt class="font-semibold">{{ step.label }}<span v-if="step.elapsedSeconds !== undefined"> · {{ duration(step.elapsedSeconds) }}</span></dt><dd class="v2-stage-note">{{ step.detail }}</dd></div></dl>
    </details>
  </section>
</template>

<style scoped>
.v2-stage-tracker { color: var(--app-text, #e2e8f0); }
.v2-stage-note { color: var(--app-text-muted, #cbd5e1); }
.v2-stage-list { display: grid; gap: 0; list-style: none; padding: 0; }
.v2-stage { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; column-gap: .5rem; padding: .4rem 0; align-items: start; }
.v2-stage-symbol { position: relative; text-align: center; font-weight: 700; }
.v2-stage:not(:last-child) .v2-stage-symbol::after { content: ''; position: absolute; top: 1.2rem; bottom: -.5rem; left: 50%; border-left: 1px solid var(--app-border, #475569); }
.v2-stage-state { font-size: .75rem; text-align: right; color: var(--app-text-muted, #cbd5e1); }
.v2-stage[data-state='running'], .v2-stage[data-state='waiting'] { font-weight: 600; }
.v2-stage[data-state='completed'] .v2-stage-symbol { color: #6ee7b7; }
.v2-stage[data-state='running'] .v2-stage-symbol { color: #7dd3fc; }
.v2-stage[data-state='waiting'] .v2-stage-symbol, .v2-stage[data-state='interrupted'] .v2-stage-symbol { color: #fde68a; }
.v2-stage[data-state='failed'] .v2-stage-symbol { color: #fda4af; }
[data-appearance-mode='light'] .v2-stage[data-state='completed'] .v2-stage-symbol { color: #047857; }
[data-appearance-mode='light'] .v2-stage[data-state='running'] .v2-stage-symbol { color: #0369a1; }
[data-appearance-mode='light'] .v2-stage[data-state='waiting'] .v2-stage-symbol,
[data-appearance-mode='light'] .v2-stage[data-state='interrupted'] .v2-stage-symbol { color: #92400e; }
[data-appearance-mode='light'] .v2-stage[data-state='failed'] .v2-stage-symbol { color: #be123c; }
@media (max-width: 480px) {
  .v2-stage { grid-template-columns: 1.25rem minmax(0, 1fr); }
  .v2-stage-state { grid-column: 2; text-align: left; }
}
</style>
