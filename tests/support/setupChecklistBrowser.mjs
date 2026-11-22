export async function expandSetupPanel(page) {
  const panel = page.locator('[data-setup-status]')
  const toggle = panel.locator('[data-setup-toggle]')
  await toggle.waitFor()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  return panel
}

export async function openSetupChecklist(page) {
  const panel = await expandSetupPanel(page)
  await panel.locator('[data-setup-full-checklist]').waitFor()
  return panel
}

export async function expandSetupTask(page, id, { form = false } = {}) {
  const panel = await openSetupChecklist(page)
  const selector = '[data-setup-action=' + JSON.stringify(id) + ']'
  let task
  for (const group of await panel.locator('[data-setup-group]').all()) {
    if (!await group.evaluate(element => element.open)) await group.locator('summary').first().click()
    await group.locator(':scope > div').waitFor()
    const candidate = group.locator(selector)
    if (await candidate.count()) { task = candidate; break }
  }
  if (!task) throw new Error('Checklist task is unavailable in the selected filter: ' + id)
  if (!await task.evaluate(element => element.open)) await task.locator('summary').first().click()
  await task.locator('[data-setup-action-details]').waitFor()
  if (form) {
    const fields = task.locator('[data-setup-action-form]')
    await fields.waitFor()
    if (!await fields.evaluate(element => element.open)) await fields.locator('summary').first().click()
  }
  return task
}

export async function checklistTaskIds(page) {
  const panel = await openSetupChecklist(page)
  const ids = []
  for (const group of await panel.locator('[data-setup-group]').all()) {
    if (!await group.evaluate(element => element.open)) await group.locator('summary').first().click()
    await group.locator(':scope > div').waitFor()
    ids.push(...await group.locator('[data-setup-action]').evaluateAll(elements => elements.map(element => element.dataset.setupAction)))
  }
  return ids.sort()
}
