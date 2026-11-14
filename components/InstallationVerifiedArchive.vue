<script setup>
import { backupBytes, backupText, backupTime } from '~/helper/installationBackups.js'
import { backupArchiveFormat } from '~/helper/installationBackupCompression.js'
defineProps({ archive: { type: Object, required: true }, compact: { type: Boolean, default: false } })
</script>

<template>
  <section class="rounded-lg border p-3 space-y-2" style="border-color: var(--app-success, var(--app-accent));" role="status" aria-label="Saved verified backup archive" data-testid="installation-verified-archive">
    <h4 class="font-semibold">Archive verified and saved</h4>
    <p v-if="!compact" class="text-sm">Archive creation and verification finished successfully. This saved receipt is separate from service recovery; it is not a new integrity check of the stored file.</p>
    <p v-if="!compact" class="text-xs">{{ backupArchiveFormat(archive) }} · {{ backupBytes(archive.size_bytes) }}<span v-if="archive.created_at"> · Saved {{ backupTime(archive.created_at) }}</span></p>
    <code class="block break-all text-xs" data-testid="installation-verified-archive-reference">{{ backupText(archive.reference) }}</code>
    <p v-if="!compact" class="text-xs">Restore preview revalidates the selected archive before use. Keep the archive at its registered destination.</p>
  </section>
</template>
