<script setup>
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import SetupChecklist from '~/components/SetupChecklist.vue'
import SetupChoiceSummary from '~/components/SetupChoiceSummary.vue'
import { setupCheckLabel, sanitizeSetupPreview } from '~/helper/setupArrangements.js'
import { setupReviewServiceGroups, setupReviewServiceName, setupReviewServicePurpose, setupReviewBlockingChecks, setupReviewBlocker, setupReviewRemainingActions } from '~/helper/setupReviewPresentation.js'
import { useOnboardingStore } from '~/stores/onboarding.js'
const store = useOnboardingStore()
const setup = useSetupArrangementsStore()
const supported = computed(() => store._capabilities?.setup_arrangements === true)
const { reviewPayload } = storeToRefs(store)
const groups = computed(() => setupReviewServiceGroups(setup.plan?.services || []))
const blockers = computed(() => setupReviewBlockingChecks(setup.plan))
const remaining = computed(() => setupReviewRemainingActions(setup.plan))
const requiredLater = computed(() => remaining.value.filter(action => action.required === true))
const optionalLater = computed(() => remaining.value.filter(action => action.required !== true))
const safeReviewPayload = computed(() => sanitizeSetupPreview(reviewPayload.value))
const optionalSelected = key => (reviewPayload.value?.optional_services || []).some(service => (typeof service === 'string' ? service : service.key) === key)
const editChoices = () => { const index = store.wizardSteps.findIndex(step => step.id === 'arrangement'); if (index >= 0) store.step = index + 1 }
onMounted(async () => { if (supported.value) await store.previewSetupChoices() })
</script>

<template>
  <section class="space-y-6 text-gray-100" data-setup-review>
    <header class="space-y-2">
      <h2 class="text-2xl font-semibold">Review your setup</h2>
      <p>Check the apps you chose and what happens next. Nothing has been installed or changed by this preview.</p>
    </header>
    <p v-if="setup.loading && supported" role="status">Checking your setup plan…</p>
    <p v-if="setup.error && supported" role="alert" class="rounded border border-amber-500 p-3 text-amber-100">{{ setup.error }}</p>
    <template v-if="supported && setup.plan">
      <section v-if="blockers.length" class="space-y-3 rounded-lg border border-amber-500 p-4" data-setup-start-blockers>
        <h3 class="text-lg font-semibold">{{ blockers.length === 1 ? 'One thing needs attention before starting' : blockers.length + ' things need attention before starting' }}</h3>
        <article v-for="check in blockers" :key="check.key" class="space-y-2">
          <h4 class="font-semibold">{{ setupReviewBlocker(check, setup.plan.services).title }}</h4>
          <p class="text-sm">{{ setupReviewBlocker(check, setup.plan.services).explanation }}</p>
          <p class="text-sm">{{ setupReviewBlocker(check, setup.plan.services).next }}</p>
          <details class="text-sm text-gray-300"><summary class="cursor-pointer">Details for the person managing DUMB</summary><p class="mt-2">{{ check.label }}</p><p v-if="check.detail">{{ check.detail }}</p></details>
        </article>
      </section>
      <section class="space-y-3 rounded-lg border border-gray-600 p-4" data-setup-selected-apps>
        <h3 class="text-lg font-semibold">The apps you chose</h3>
        <ul v-if="groups.chosen.length" class="space-y-3">
          <li v-for="service in groups.chosen" :key="service.id || service.key"><p class="font-semibold">{{ setupReviewServiceName(service) }}</p><p class="text-sm text-gray-300">{{ setupReviewServicePurpose(service) }}</p></li>
        </ul>
        <p v-else class="text-sm text-gray-300">The selected apps are listed in the setup details below.</p>
        <details v-if="groups.required.length || groups.companions.length" class="text-sm">
          <summary class="cursor-pointer">Supporting services DUMB will manage ({{ groups.required.length + groups.companions.length }})</summary>
          <p class="my-2 text-gray-300">These help your chosen apps run. Required dependencies are included automatically.</p>
          <ul class="space-y-1"><li v-for="service in [...groups.required, ...groups.companions]" :key="service.id || service.key">{{ setupReviewServiceName(service) }} · {{ groups.required.includes(service) ? 'Required dependency' : 'Optional companion' }}</li></ul>
        </details>
        <div v-if="groups.external.length" class="space-y-1 text-sm"><h4 class="font-semibold">Apps you already run elsewhere</h4><p v-for="service in groups.external" :key="service.id || service.key">{{ setupReviewServiceName(service) }} · DUMB will connect to this app, not install it.</p></div>
      </section>
      <section class="space-y-3 rounded-lg border border-blue-400/50 p-4" data-setup-next-steps>
        <h3 class="text-lg font-semibold">What happens when you start</h3>
        <ol class="list-decimal space-y-2 pl-5 text-sm">
          <li>DUMB prepares the chosen apps and their supporting services.</li>
          <li>It applies your saved choices and makes the connections it supports.</li>
          <li>You can choose an optional walkthrough to finish sign-ins, app choices and connections, or use the full checklist.</li>
        </ol>
        <p class="text-sm text-gray-300">Starting an app does not mean every connection is ready. The walkthrough explains the remaining steps after startup; your checklist keeps them available if you choose to finish later.</p>
      </section>
      <section v-if="remaining.length" class="space-y-2 rounded-lg border border-gray-600 p-4" data-setup-finish-later>
        <h3 class="text-lg font-semibold">Finish after the apps start</h3>
        <p v-if="requiredLater.length" class="text-sm">{{ requiredLater.length }} {{ requiredLater.length === 1 ? 'task is' : 'tasks are' }} required to finish your connections. You can start the apps first; these tasks remain on your setup checklist.</p>
        <p v-if="optionalLater.length" class="text-sm">{{ optionalLater.length }} {{ optionalLater.length === 1 ? 'task is' : 'tasks are' }} optional. Finish these when you want to use or test the related features.</p>
        <details class="text-sm"><summary class="cursor-pointer">See the tasks to finish</summary><ul class="mt-2 space-y-2"><li v-for="action in remaining" :key="action.id">{{ action.label }} · {{ action.required === true ? 'Required for this connection' : 'Optional' }}</li></ul></details>
        <p class="text-sm text-gray-300">App-specific menus, such as music quality profiles and library folders, become available when the app has started and completed its own setup. If a menu is still empty, the checklist explains which connection or app setup needs attention.</p>
      </section>
      <details class="rounded-lg border border-gray-600 p-4" data-setup-review-choices>
        <summary class="cursor-pointer font-semibold">Review saved connection choices</summary>
        <div class="mt-4 space-y-3"><SetupChoiceSummary :data="setup.plan" /><button type="button" class="underline text-cyan-200" @click="editChoices">Change connection choices</button></div>
      </details>
      <details class="rounded-lg border border-gray-600 p-4" data-setup-technical-review>
        <summary class="cursor-pointer font-semibold">Technical setup details</summary>
        <div class="mt-4 space-y-4">
          <ul v-if="setup.plan.checks?.length" class="space-y-2" aria-label="Arrangement readiness">
            <li v-for="check in setup.plan.checks" :key="check.key" class="rounded border border-gray-600 p-3 text-sm"><p class="font-semibold">{{ check.label }} · {{ setupCheckLabel(check) }}</p><p v-if="check.detail">{{ check.detail }}</p></li>
          </ul>
          <SetupChecklist :data="setup.plan" :capabilities="store._capabilities" preview />
        </div>
      </details>
    </template>
    <section v-else-if="!supported" class="space-y-2 rounded-lg border border-gray-600 p-4">
      <h3 class="text-lg font-semibold">Your selected apps</h3>
      <p v-for="(service, index) in reviewPayload.core_services || []" :key="index">{{ service.instance_name || service.name }}</p>
      <p v-for="service in reviewPayload.optional_services || []" :key="typeof service === 'string' ? service : service.key">{{ typeof service === 'string' ? service : service.key }}</p>
      <p class="text-sm text-gray-300">This DUMB version starts the selected apps. Follow the app guides to finish their connections afterward.</p>
    </section>
    <aside v-if="optionalSelected('authelia')" class="rounded-lg border border-violet-400/50 p-4 text-sm">
      <h3 class="font-semibold">Authelia needs a sign-in setup step</h3>
      <p class="mt-1">DUMB installs Authelia and leaves it stopped until you finish its initial account setup. After onboarding, open its checklist task to continue. A stopped status at that point is expected.</p>
    </aside>
    <aside v-if="optionalSelected('aiostreams')" class="rounded-lg border border-cyan-400/50 p-4 text-sm">
      <h3 class="font-semibold">Signing in to AIOStreams</h3>
      <p class="mt-1">Use the administrator account you chose for AIOStreams. Its saved public address is used for Stremio and sign-in connections; DUMB keeps its encryption key separately. Include the app data and DUMB settings in your backups.</p>
    </aside>
    <details class="rounded-lg border border-gray-600 p-4 text-sm" data-setup-payload>
      <summary class="cursor-pointer font-semibold">Advanced configuration payload</summary>
      <p class="my-2 text-gray-300">For experienced users. Sensitive values are masked in this preview.</p>
      <pre class="overflow-x-auto whitespace-pre-wrap">{{ safeReviewPayload }}</pre>
    </details>
    <div v-if="supported" class="flex flex-wrap items-center gap-4 text-sm">
      <button type="button" :disabled="setup.loading" class="underline text-cyan-200 disabled:opacity-50" @click="store.previewSetupChoices()">{{ setup.error ? 'Retry setup preview' : 'Refresh setup preview' }}</button>
      <button v-if="setup.plan" type="button" class="underline text-cyan-200" @click="editChoices">Back to installation choices</button>
    </div>
    <p class="text-sm text-gray-300">When you are ready, choose <strong class="text-gray-100">Start services</strong> below. You can return to your checklist from the dashboard.</p>
  </section>
</template>
