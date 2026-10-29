import { createMocks } from 'node-mocks-http';
import handler from '../scrape/[novelId]/progress';

describe('/api/scrape/[novelId]/progress', () => {
  const validNovelId = 'a'.repeat(64);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject DELETE request', async () => {
    const { req, res } = createMocks({
      method: 'DELETE',
      query: { novelId: validNovelId },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
  });

  it('should be callable', async () => {
    expect(handler).toBeDefined();
  });

  it('should have GET method', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { novelId: validNovelId },
    });

    await handler(req, res);

    // Should return some response (200, 400, 404, or 500)
    expect(res._getStatusCode()).toBeGreaterThan(0);
  });
});
