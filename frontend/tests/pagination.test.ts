import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, pagePath } from '../src/app/core/pagination';
test('related selections retain records beyond the first hundred and preserve filters', async () => {
  const pages: number[] = [];
  const rows = await collectPages(async page => {
    pages.push(page);
    return { results: Array.from({length: page === 1 ? 100 : 21}, (_, i) => (page - 1) * 100 + i), next: page === 1 ? '/api/v2/orders/?page=2' : null };
  });
  assert.equal(rows.length, 121);
  assert.equal(rows.at(-1), 120);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(pagePath('orders/?supplier=a&page_size=100', 2), 'orders/?supplier=a&page_size=100&page=2');
});
test('a later-page failure does not return a silently incomplete selection', async () => {
  await assert.rejects(collectPages(async page => {
    if (page === 2) throw new Error('API indisponível');
    return {results: [1], next: 'next'};
  }), /API indisponível/);
});
