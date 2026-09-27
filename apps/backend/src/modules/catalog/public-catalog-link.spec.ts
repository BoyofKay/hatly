import { resolvePublicCatalogIds } from './public-catalog-link';

describe('resolvePublicCatalogIds', () => {
  it('runs no query for an empty page', async () => {
    const query = jest.fn();
    expect((await resolvePublicCatalogIds({ query } as never, [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('maps listing id → catalog id from ONE query; unlinked / inactive-catalog listings are simply absent', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'p1', catalog_id: 'c1' }]);
    const result = await resolvePublicCatalogIds({ query } as never, ['p1', 'p2', 'p3']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.get('p1')).toBe('c1');
    expect(result.has('p2')).toBe(false);
    expect(result.has('p3')).toBe(false);
  });

  it('only ever exposes ACTIVE, non-deleted catalog products (the SQL says so)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await resolvePublicCatalogIds({ query } as never, ['p1']);
    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain('c.is_active = true');
    expect(sql).toContain('c.deleted_at IS NULL');
    expect(query.mock.calls[0][1]).toEqual([['p1']]);
  });
});
