const packageVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

// installed_source is supplied only after DUMB validates the current runtime.
// Saved branch/release selectors describe future installs, not the served build.
export const frontendInstalledSource = (packageVersion, processes) => {
  const version = String(packageVersion || '').trim().replace(/^v/i, '')
  if (!Array.isArray(processes)) return null
  const source = processes.find(process => process?.config_key === 'dumb_frontend')?.installed_source
  if (!source || source.schema_version !== 1 || source.repository !== 'nicocapalbo/dmbdb'
    || !['release', 'branch', 'commit'].includes(source.source_kind)
    || typeof source.commit_sha !== 'string' || source.commit_sha.length !== 40 || !/^[0-9a-f]{40}$/.test(source.commit_sha)
    || typeof source.package_version !== 'string' || !packageVersionPattern.test(source.package_version)
    || source.package_version !== version
    || typeof source.requested_ref !== 'string' || !source.requested_ref.length || source.requested_ref.length > 160
    || /[\x00-\x20\x7f]/.test(source.requested_ref)) return null
  return source
}

export const frontendBuildDisplay = (packageVersion, processes) => {
  const version = String(packageVersion || '').trim().replace(/^v/i, '')
  const fallback = { label: `v${version}`, title: '' }
  const source = frontendInstalledSource(version, processes)
  if (!source) return fallback
  if (source.source_kind === 'release') return fallback
  const channel = source.source_kind === 'branch' ? source.requested_ref : 'commit'
  return {
    label: `v${version} · ${channel} ${source.commit_sha.slice(0, 8)}`,
    title: `${channel} · ${source.commit_sha}`,
  }
}
