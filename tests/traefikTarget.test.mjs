import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTraefikTarget } from '../server/utils/traefikTarget.js';

test('managed DUMB Traefik URL overrides the default listener port', () => {
  assert.equal(
    resolveTraefikTarget({
      env: { DUMB_TRAEFIK_URL: 'http://127.0.0.1:18082' },
      apiUrl: 'http://127.0.0.1:8000',
    }),
    'http://127.0.0.1:18082',
  );
});

test('legacy DMB alias retains precedence and trailing slash is normalized', () => {
  assert.equal(
    resolveTraefikTarget({
      env: {
        DMB_TRAEFIK_URL: 'http://traefik.internal:19090/',
        DUMB_TRAEFIK_URL: 'http://127.0.0.1:18082',
      },
      apiUrl: 'http://127.0.0.1:8000',
    }),
    'http://traefik.internal:19090',
  );
});

test('standalone frontend retains the default adjacent-host fallback', () => {
  assert.equal(
    resolveTraefikTarget({
      env: {},
      apiUrl: 'http://dumb-api.internal:8000/base?ignored=true',
    }),
    'http://dumb-api.internal:18080',
  );
});
