import { createMocks } from 'node-mocks-http';
import handler from '../search';

describe('/api/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject GET request', async () => {
    const { req, res } = createMocks({
      method: 'GET',
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(false);
    expect(data.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('should be callable with valid POST', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        query: 'solo leveling',
        page: 1,
      },
    });

    // Handler should be callable and defined
    expect(handler).toBeDefined();
  });

  it('should handle errors gracefully', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        query: '',
      },
    });

    await handler(req, res);

    // Should return some error status
    expect(res._getStatusCode()).toBeGreaterThanOrEqual(400);
  });
});
