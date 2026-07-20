import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MEDIASTORM_SERVICES,
  isMediaStormNavigationPath,
} from '../server/utils/embeddedServiceRoutes.js'

test('recognizes MediaStorm root navigation without claiming DUMB routes', () => {
  assert.equal(MEDIASTORM_SERVICES.has('mediastorm'), true)

  for (const pathname of [
    '/admin',
    '/admin/settings',
    '/account/login',
    '/watch',
    '/watch/movie/123',
    '/share/invite-token',
    '/register',
  ]) {
    assert.equal(isMediaStormNavigationPath(pathname), true, pathname)
  }

  for (const pathname of ['/', '/services/mediastorm', '/api/process/processes']) {
    assert.equal(isMediaStormNavigationPath(pathname), false, pathname)
  }
})
