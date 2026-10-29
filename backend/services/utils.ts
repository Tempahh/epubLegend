import crypto from 'crypto';
import { NextApiRequest } from 'next';

export class ValidationError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfter: number, message: string = 'Rate limited') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Validate search query: alphanumeric + space/hyphen, 1-200 chars
 */
export function validateSearchQuery(query: string): void {
  if (!query || typeof query !== 'string') {
    throw new ValidationError(400, 'Query is required and must be a string');
  }
  
  if (query.length < 1 || query.length > 200) {
    throw new ValidationError(400, 'Query must be between 1 and 200 characters');
  }
  
  // Allow alphanumeric, spaces, and hyphens
  if (!/^[a-zA-Z0-9\s\-]+$/.test(query)) {
    throw new ValidationError(400, 'Query can only contain alphanumeric characters, spaces, and hyphens');
  }
}

/**
 * Validate page number: 1-100
 */
export function validatePageNumber(page: number): void {
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100) {
    throw new ValidationError(400, 'Page must be an integer between 1 and 100');
  }
}

/**
 * Validate novel ID: 64-char hex (SHA256)
 */
export function validateNovelId(novelId: string): void {
  if (!novelId || typeof novelId !== 'string') {
    throw new ValidationError(400, 'Novel ID is required');
  }
  
  if (novelId.length !== 64) {
    throw new ValidationError(400, 'Novel ID must be 64 characters (SHA256 hex)');
  }
  
  if (!/^[a-f0-9]{64}$/.test(novelId)) {
    throw new ValidationError(400, 'Novel ID must be a valid SHA256 hex string');
  }
}

/**
 * Validate format: epub or pdf
 */
export function validateFormat(format: string): void {
  if (!['epub', 'pdf'].includes(format)) {
    throw new ValidationError(400, "Format must be 'epub' or 'pdf'");
  }
}

/**
 * Create deterministic SHA256 hash for a URL
 */
export function hashNovelId(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * Estimate time remaining for scraping
 */
export function estimateTimeRemaining(
  completedChapters: number,
  totalChapters: number,
  elapsedSeconds: number
): number {
  if (completedChapters === 0 || totalChapters === 0) {
    return 0;
  }
  
  const chaptersRemaining = totalChapters - completedChapters;
  const avgTimePerChapter = elapsedSeconds / completedChapters;
  return Math.ceil(chaptersRemaining * avgTimePerChapter);
}

/**
 * Extract IP address from request
 */
export function getIpAddress(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  
  if (typeof forwarded === 'string') {
    // Take the first IP if there are multiple
    return forwarded.split(',')[0].trim();
  }
  
  if (Array.isArray(forwarded)) {
    return forwarded[0] || 'unknown';
  }
  
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Create rate limit key for an IP
 */
export function rateLimitKey(ip: string): string {
  return `ratelimit:${ip}`;
}

/**
 * Check rate limit for an IP
 * Returns true if allowed, false if rate limited
 */
export function checkRateLimit(_ip: string, _limit: number, _windowMs: number): { allowed: boolean; retryAfter?: number } {
  // This is a placeholder - actual rate limiting is handled by rateLimitMiddleware
  // This is kept for backward compatibility and testing
  return { allowed: true };
}
