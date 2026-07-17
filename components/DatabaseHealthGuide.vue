<template>
  <details class="rounded border border-sky-800/40 bg-sky-950/20 p-3 text-xs text-slate-300">
    <summary
      class="cursor-pointer font-medium text-sky-200"
      title="Open a plain-language explanation of Database Health collection, scores, and limitations."
    >
      How to read Database Health
    </summary>
    <div class="mt-3 grid gap-3 md:grid-cols-3">
      <div>
        <p class="font-semibold text-slate-200">What it observes</p>
        <p class="mt-1 text-slate-400">
          Database and WAL size, filesystem placement, free space, inode usage,
          read-only state, and recent database-related log signals. Enhanced mode
          adds bounded, read-only metadata/statistics probes.
        </p>
      </div>
      <div>
        <p class="font-semibold text-slate-200">What the score means</p>
        <p class="mt-1 text-slate-400">
          The 0–100 score is accumulated evidence: healthy 0–19, moderate 20–44,
          high 45–69, and critical 70–100. Observe representative imports, scans,
          maintenance, and playback before acting on one sample.
        </p>
      </div>
      <div>
        <p class="font-semibold text-slate-200">What it cannot do</p>
        <p class="mt-1 text-slate-400">
          It cannot profile individual application queries, prove root cause,
          predict a PostgreSQL speedup, detect every short-lived event, repair a
          database, replace backups, or replace application-native diagnostics.
        </p>
      </div>
    </div>
    <p class="mt-3 border-t border-sky-800/30 pt-2 text-[11px] text-slate-400">
      Collection is external and read-only. DUMB never runs VACUUM, ANALYZE,
      checkpoints, integrity checks, migrations, repairs, or application data queries.
      “Healthy” means no configured indicator was observed—not that a database is guaranteed healthy.
    </p>
  </details>
</template>
