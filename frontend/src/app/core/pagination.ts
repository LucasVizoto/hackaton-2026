export interface PageResult<T> { results: T[]; next?: string | null; }

/** Used only for bounded related-record selections; screen lists keep pagination. */
export async function collectPages<T>(read: (page: number) => Promise<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await read(page);
    rows.push(...result.results);
    if (!result.next) return rows;
  }
}

export function pagePath(path: string, page: number): string {
  const [resource, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  return `${resource}?${params}`;
}
