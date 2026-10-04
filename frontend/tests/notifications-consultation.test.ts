import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Api } from '../src/app/core/api';
import { Notifications } from '../src/app/shared/notifications';

test('management consultation retains notification pagination and cannot acknowledge records', async () => {
  const reads: string[] = [];
  const writes: string[] = [];
  let operational = false;
  const api = {
    can: () => operational,
    get: async (path: string) => {
      reads.push(path);
      const page = path.endsWith('page=2') ? 2 : 1;
      return { count: 122, next: page === 1 ? '?page=2' : null,
        results: [{ id: `notice-${page}`, acknowledged_at: null }] };
    },
    post: async (path: string) => { writes.push(path); },
  };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  try {
    const notices = runInInjectionContext(injector, () => new Notifications());
    await notices.load();
    assert.equal(notices.count(), 122);
    assert.equal(notices.hasNext(), true);
    await notices.load(2);
    assert.equal(notices.page, 2);
    assert.equal(notices.rows()[0].id, 'notice-2');
    assert.equal(notices.hasNext(), false);
    await notices.acknowledge('notice-2');
    assert.deepEqual(writes, []);
    operational = true;
    await notices.acknowledge('notice-2');
    assert.deepEqual(writes, ['notifications/notice-2/acknowledge/']);
    assert.equal(reads.at(-1), 'notifications/?page=2');
    assert.equal(notices.page, 2);
  } finally { injector.destroy(); }
});
