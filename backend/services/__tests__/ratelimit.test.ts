import {
  checkRateLimitForRequest,
  rateLimitMiddleware,
  clearRateLimitStore,
  getRateLimitStatus,
} from '../ratelimit';
import { NextApiRequest, NextApiResponse } from 'next';

describe('Rate Limit Service', () => {
  beforeEach(() => {
    clearRateLimitStore();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkRateLimitForRequest', () => {
    it('should allow requests within limit', () => {
      const config = {
        '/api/search': { limit: 10, windowMs: 60000 },
      };

      for (let i = 0; i < 10; i++) {
        const result = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
        expect(result.allowed).toBe(true);
      }
    });

    it('should block requests exceeding limit', () => {
      const config = {
        '/api/search': { limit: 10, windowMs: 60000 },
      };

      // Fill the limit
      for (let i = 0; i < 10; i++) {
        checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      }

      // This should be blocked
      const result = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should reset after time window', () => {
      const config = {
        '/api/search': { limit: 2, windowMs: 60000 },
      };

      // Fill limit
      checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      checkRateLimitForRequest('192.168.1.1', '/api/search', config);

      // Should be blocked
      let result = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      expect(result.allowed).toBe(false);

      // Fast forward past window
      jest.advanceTimersByTime(61000);

      // Should be allowed again
      result = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      expect(result.allowed).toBe(true);
    });

    it('should handle different IPs independently', () => {
      const config = {
        '/api/search': { limit: 1, windowMs: 60000 },
      };

      const result1 = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      expect(result1.allowed).toBe(true);

      const result2 = checkRateLimitForRequest('192.168.1.2', '/api/search', config);
      expect(result2.allowed).toBe(true);

      // First IP should be blocked
      const result3 = checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      expect(result3.allowed).toBe(false);

      // Second IP should still be allowed
      const result4 = checkRateLimitForRequest('192.168.1.2', '/api/search', config);
      expect(result4.allowed).toBe(false);
    });

    it('should allow unlimited requests for endpoints without config', () => {
      const config = {
        '/api/search': { limit: 1, windowMs: 60000 },
      };

      // Make 100 requests to unconfigured endpoint
      for (let i = 0; i < 100; i++) {
        const result = checkRateLimitForRequest('192.168.1.1', '/api/other', config);
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('rateLimitMiddleware', () => {
    it('should allow request and return true', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '192.168.1.1' },
      } as any as NextApiRequest;

      const responseMock = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any as NextApiResponse;

      const result = rateLimitMiddleware(req, responseMock, '/api/search');
      expect(result).toBe(true);
      expect(responseMock.status).not.toHaveBeenCalled();
    });

    it('should block request and return false', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '192.168.1.1' },
      } as any as NextApiRequest;

      const responseMock = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any as NextApiResponse;

      // Fill the limit
      for (let i = 0; i < 10; i++) {
        rateLimitMiddleware(req, responseMock, '/api/search');
      }

      // This should fail
      const result = rateLimitMiddleware(req, responseMock, '/api/search');
      expect(result).toBe(false);
      expect(responseMock.status).toHaveBeenCalledWith(429);
      expect(responseMock.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'RATE_LIMIT',
        })
      );
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return empty status initially', () => {
      const status = getRateLimitStatus();
      expect(Object.keys(status).length).toBe(0);
    });

    it('should track rate limit status', () => {
      const config = {
        '/api/search': { limit: 10, windowMs: 60000 },
      };

      checkRateLimitForRequest('192.168.1.1', '/api/search', config);
      checkRateLimitForRequest('192.168.1.1', '/api/search', config);

      const status = getRateLimitStatus();
      expect(status['192.168.1.1']).toBeDefined();
      expect(status['192.168.1.1'].count).toBe(2);
    });
  });
});
