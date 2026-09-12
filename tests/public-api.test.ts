import test from 'node:test';
import assert from 'node:assert/strict';
import { mayReleaseContext } from '../src/index.ts';

const local = {
  provider: 'omlx', api: 'openai-completions', baseUrl: 'http://127.0.0.1:8000/v1',
  runtime: 'omlx', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE'
} as const;

test('public delegation eligibility seam is side-effect free and fail closed', () => {
  assert.deepEqual(mayReleaseContext('PRIVATE', local), { allowed: true, reason: 'ELIGIBLE' });
  assert.deepEqual(mayReleaseContext('SECRET', local), { allowed: false, reason: 'SECRET_INELIGIBLE' });
  assert.deepEqual(mayReleaseContext('PRIVATE', { ...local, environment: 'HOSTED_CONTROLLED', baseUrl: 'https://api.example.test/v1', ceiling: 'PUBLIC' }),
    { allowed: false, reason: 'CLASSIFICATION_EXCEEDS_CEILING' });
});
