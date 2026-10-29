import {
  validateSearchQuery,
  validatePageNumber,
  validateNovelId,
  validateFormat,
  hashNovelId,
  estimateTimeRemaining,
  getIpAddress,
  rateLimitKey,
  ValidationError,
} from '../utils';
import { NextApiRequest } from 'next';

describe('Utils Service', () => {
  describe('validateSearchQuery', () => {
    it('should accept valid queries', () => {
      expect(() => validateSearchQuery('solo leveling')).not.toThrow();
      expect(() => validateSearchQuery('test-novel')).not.toThrow();
      expect(() => validateSearchQuery('a')).not.toThrow();
    });

    it('should reject empty query', () => {
      expect(() => validateSearchQuery('')).toThrow(ValidationError);
    });

    it('should reject query > 200 chars', () => {
      const longQuery = 'a'.repeat(201);
      expect(() => validateSearchQuery(longQuery)).toThrow(ValidationError);
    });

    it('should reject special characters', () => {
      expect(() => validateSearchQuery('test@query')).toThrow(ValidationError);
      expect(() => validateSearchQuery('test!novel')).toThrow(ValidationError);
    });

    it('should reject non-string query', () => {
      expect(() => validateSearchQuery(null as any)).toThrow(ValidationError);
    });
  });

  describe('validatePageNumber', () => {
    it('should accept valid page numbers', () => {
      expect(() => validatePageNumber(1)).not.toThrow();
      expect(() => validatePageNumber(50)).not.toThrow();
      expect(() => validatePageNumber(100)).not.toThrow();
    });

    it('should reject page < 1', () => {
      expect(() => validatePageNumber(0)).toThrow(ValidationError);
      expect(() => validatePageNumber(-1)).toThrow(ValidationError);
    });

    it('should reject page > 100', () => {
      expect(() => validatePageNumber(101)).toThrow(ValidationError);
    });

    it('should reject non-integer', () => {
      expect(() => validatePageNumber(1.5)).toThrow(ValidationError);
    });
  });

  describe('validateNovelId', () => {
    it('should accept valid SHA256 hex', () => {
      const validId = 'a'.repeat(64);
      expect(() => validateNovelId(validId)).not.toThrow();
    });

    it('should reject non-64-char ID', () => {
      expect(() => validateNovelId('abc')).toThrow(ValidationError);
      expect(() => validateNovelId('a'.repeat(63))).toThrow(ValidationError);
    });

    it('should reject non-hex characters', () => {
      expect(() => validateNovelId('z'.repeat(64))).toThrow(ValidationError);
    });

    it('should reject empty ID', () => {
      expect(() => validateNovelId('')).toThrow(ValidationError);
    });
  });

  describe('validateFormat', () => {
    it('should accept epub and pdf', () => {
      expect(() => validateFormat('epub')).not.toThrow();
      expect(() => validateFormat('pdf')).not.toThrow();
    });

    it('should reject other formats', () => {
      expect(() => validateFormat('mobi')).toThrow(ValidationError);
      expect(() => validateFormat('txt')).toThrow(ValidationError);
    });
  });

  describe('hashNovelId', () => {
    it('should generate deterministic hash', () => {
      const url = 'https://example.com/novel/1';
      const hash1 = hashNovelId(url);
      const hash2 = hashNovelId(url);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);
    });

    it('should generate different hashes for different URLs', () => {
      const hash1 = hashNovelId('https://example.com/novel/1');
      const hash2 = hashNovelId('https://example.com/novel/2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('estimateTimeRemaining', () => {
    it('should return 0 for no progress', () => {
      const estimated = estimateTimeRemaining(0, 100, 60);
      expect(estimated).toBe(0);
    });

    it('should estimate remaining time', () => {
      // 10 chapters done in 60 seconds, 90 remaining
      // Rate: 6 seconds per chapter
      // Expected: 90 * 6 = 540 seconds
      const estimated = estimateTimeRemaining(10, 100, 60);
      expect(estimated).toBe(540);
    });

    it('should round up', () => {
      const estimated = estimateTimeRemaining(3, 10, 10);
      // Rate: 10/3 = 3.33 seconds per chapter
      // Remaining: 7 * 3.33 = 23.33, rounds to 24
      expect(estimated).toBe(24);
    });
  });

  describe('getIpAddress', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = {
        headers: { 'x-forwarded-for': '192.168.1.1' },
        socket: {},
      } as any as NextApiRequest;

      const ip = getIpAddress(req);
      expect(ip).toBe('192.168.1.1');
    });

    it('should handle multiple IPs in x-forwarded-for', () => {
      const req = {
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
        socket: {},
      } as any as NextApiRequest;

      const ip = getIpAddress(req);
      expect(ip).toBe('192.168.1.1');
    });

    it('should use remote address as fallback', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as any as NextApiRequest;

      const ip = getIpAddress(req);
      expect(ip).toBe('127.0.0.1');
    });

    it('should return unknown if no IP found', () => {
      const req = {
        headers: {},
        socket: {},
      } as any as NextApiRequest;

      const ip = getIpAddress(req);
      expect(ip).toBe('unknown');
    });
  });

  describe('rateLimitKey', () => {
    it('should create a rate limit key', () => {
      const key = rateLimitKey('192.168.1.1');
      expect(key).toBe('ratelimit:192.168.1.1');
    });
  });
});
