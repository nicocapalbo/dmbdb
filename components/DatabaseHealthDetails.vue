<script setup>
const props = defineProps({
  serviceEntry: { type: Object, required: true },
})

const formatBytes = (value) => {
  if (value == null) return '-'
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** unit)).toFixed(unit ? 1 : 0)} ${units[unit]}`
}

const formatPercent = (value) => (
  value == null || !Number.isFinite(Number(value)) ? '-' : `${Number(value).toFixed(1)}%`
)

const formatCount = (value) => (
  value == null || !Number.isFinite(Number(value)) ? '-' : Number(value).toLocaleString()
)
</script>

<template>
  <div class="space-y-3">
    <div
      class="rounded border border-slate-700/70 bg-slate-800/20 p-3 text-sm text-slate-200"
      title="A next-step suggestion based on the indicators currently contributing to this service's score."
    >
      <span class="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recommendation</span>
      {{ props.serviceEntry.recommendation }}
    </div>

    <div v-if="props.serviceEntry.reasons?.length" class="space-y-1 text-xs text-amber-200">
      <div
        v-for="reason in props.serviceEntry.reasons"
        :key="reason"
        title="This indicator contributes to the current pressure score."
      >
        • {{ reason }}
      </div>
    </div>

    <div v-if="props.serviceEntry.databases?.length" class="overflow-x-auto rounded border border-slate-700/70">
      <table class="min-w-full text-xs">
        <thead class="bg-slate-800/60 text-left text-slate-400">
          <tr>
            <th class="p-2" title="Database role and observed path/name.">Database</th>
            <th class="p-2" title="Current database file or PostgreSQL database size.">Size</th>
            <th class="p-2" title="SQLite write-ahead log size. PostgreSQL does not expose a per-database WAL file here.">WAL</th>
            <th class="p-2" title="Filesystem type, mount location, network placement, and read-only state.">Storage</th>
            <th class="p-2" title="Filesystem capacity used and free bytes available to the DUMB process.">Capacity</th>
            <th class="p-2" title="Filesystem inode usage. Running out of inodes prevents new files even when byte capacity remains.">Inodes</th>
            <th class="p-2" title="Elapsed time for the bounded read-only Enhanced-mode probe.">Probe</th>
            <th class="p-2" title="Provider-specific metadata and active pressure indicators.">Pressure details</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="database in props.serviceEntry.databases"
            :key="`${database.role}-${database.path || database.name}`"
            class="border-t border-slate-700/60 align-top"
          >
            <td class="p-2 font-medium">
              {{ database.role }}
              <div class="mt-1 max-w-[320px] break-all font-mono text-[10px] text-slate-500">
                {{ database.path || database.name }}
              </div>
            </td>
            <td class="p-2 whitespace-nowrap">
              {{ database.exists === false ? 'Missing' : formatBytes(database.size_bytes) }}
            </td>
            <td class="p-2 whitespace-nowrap">{{ formatBytes(database.wal_size_bytes) }}</td>
            <td class="p-2 min-w-32">
              <div>
                {{ database.storage?.fs_type || '-' }}
                <span v-if="database.storage?.network" class="ml-1 text-amber-300" title="The database path is on a detected network filesystem.">network</span>
                <span v-if="database.storage?.read_only" class="ml-1 text-rose-300" title="The filesystem reports that it is mounted read-only.">read-only</span>
              </div>
              <div v-if="database.storage?.mount_point" class="mt-1 break-all font-mono text-[10px] text-slate-500">
                {{ database.storage.mount_point }}
              </div>
            </td>
            <td class="p-2 whitespace-nowrap">
              <div>{{ formatPercent(database.storage?.used_percent) }} used</div>
              <div class="mt-1 text-[10px] text-slate-500">{{ formatBytes(database.storage?.free_bytes) }} free</div>
            </td>
            <td class="p-2 whitespace-nowrap">
              <div>{{ formatPercent(database.storage?.inode_used_percent) }} used</div>
              <div class="mt-1 text-[10px] text-slate-500">{{ formatCount(database.storage?.free_inodes) }} free</div>
            </td>
            <td class="p-2 whitespace-nowrap">
              {{ database.probe_ms == null ? '-' : `${Number(database.probe_ms).toFixed(1)} ms` }}
            </td>
            <td class="p-2 min-w-48 text-slate-300">
              <div v-if="database.error" class="text-rose-300">{{ database.error }}</div>
              <div v-if="database.probe_error" class="text-rose-300">Probe: {{ database.probe_error }}</div>
              <div v-if="database.journal_mode">Journal: {{ database.journal_mode }}</div>
              <div v-if="database.page_count != null">Pages: {{ formatCount(database.page_count) }}</div>
              <div v-if="database.freelist_count != null">Free pages: {{ formatCount(database.freelist_count) }}</div>
              <div v-if="database.connections != null">Connections: {{ database.connections }}</div>
              <div v-if="database.lock_waiters">Lock waiters: {{ database.lock_waiters }}</div>
              <div v-if="database.deadlocks_delta">New deadlocks: {{ database.deadlocks_delta }}</div>
              <div v-if="database.rollbacks_delta">New rollbacks: {{ database.rollbacks_delta }}</div>
              <div v-if="database.temp_bytes_delta">New temp data: {{ formatBytes(database.temp_bytes_delta) }}</div>
              <div v-if="database.cache_hit_percent != null">Cache hit: {{ database.cache_hit_percent }}%</div>
              <div v-if="database.oldest_transaction_seconds">Oldest transaction: {{ database.oldest_transaction_seconds }}s</div>
              <div v-if="database.notice" class="text-slate-500">{{ database.notice }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="props.serviceEntry.log_signals" class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
      <div
        v-for="key in ['locked', 'busy', 'timeout', 'io_error', 'deadlock']"
        :key="key"
        class="rounded border border-slate-700/60 bg-slate-800/30 p-2"
        :title="`Cumulative ${key.replace('_', ' ')} messages observed since this log file was first scanned or rotated. Only recent events affect the score.`"
      >
        <div class="uppercase text-[10px] text-slate-500">{{ key.replace('_', ' ') }}</div>
        <div class="mt-1 font-semibold">{{ props.serviceEntry.log_signals[key] || 0 }}</div>
      </div>
    </div>

    <p v-if="props.serviceEntry.probe_notice" class="text-xs text-slate-400">
      {{ props.serviceEntry.probe_notice }}
    </p>
  </div>
</template>
