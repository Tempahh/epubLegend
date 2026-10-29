import { NextApiRequest, NextApiResponse } from 'next';
import { getIpAddress } from './utils';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting: Map<ip, RateLimitStore>
const rateLimitStore = new Map<string, RateLimitStore>();

/**
 * Rate limit configuration per endpoint
 */
interface RateLimitConfig {
  [endpoint: string]: {
    limit: number; // Requests per window
    windowMs: number; // Time window in milliseconds
  };
}

const defaultConfig: RateLimitConfig = {
  '/api/search': {
    limit: 10,
    windowMs: 60000, // 1 minute
  },
};

/**
 * Get or initialize rate limit record for an IP
 */
function getRateLimitRecord(ip: string): RateLimitStore {
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, {
      count: 0,
      resetTime: Date.now() + defaultConfig['/api/search'].windowMs,
    });
  }
  
  const record = rateLimitStore.get(ip)!;
  
  // Reset if window has passed
  if (Date.now() > record.resetTime) {
    record.count = 0;
    record.resetTime = Date.now() + defaultConfig['/api/search'].windowMs;
  }
  
  return record;
}

/**
 * Check if request is allowed under rate limit
 * Returns {allowed: boolean, retryAfter?: number}
 */
export function checkRateLimitForRequest(
  ip: string,
  endpoint: string,
  config: RateLimitConfig = defaultConfig
): { allowed: boolean; retryAfter?: number } {
  const endpointConfig = config[endpoint];
  
  if (!endpointConfig) {
    // No rate limit for this endpoint
    return { allowed: true };
  }
  
  const record = getRateLimitRecord(ip);
  
  if (record.count < endpointConfig.limit) {
    record.count++;
    return { allowed: true };
  }
  
  // Rate limited
  const retryAfter = Math.ceil((record.resetTime - Date.now()) / 1000);
  return { allowed: false, retryAfter: Math.max(1, retryAfter) };
}

/**
 * Rate limit middleware for Next.js API routes
 * Call this at the start of your handler
 */
export function rateLimitMiddleware(
  req: NextApiRequest,
  res: NextApiResponse,
  endpoint: string,
  config: RateLimitConfig = defaultConfig
): boolean {
  const ip = getIpAddress(req);
  const result = checkRateLimitForRequest(ip, endpoint, config);
  
  if (!result.allowed) {
    res.status(429).json({
      success: false,
      error: 'Rate limited',
      code: 'RATE_LIMIT',
      retryAfter: result.retryAfter,
    });
    return false;
  }
  
  return true;
}

/**
 * Clear all rate limit records (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get current rate limit status for debugging
 */
export function getRateLimitStatus(): Record<string, any> {
  const status: Record<string, any> = {};
  
  rateLimitStore.forEach((record, ip) => {
    status[ip] = {
      count: record.count,
      resetTime: new Date(record.resetTime).toISOString(),
      secondsUntilReset: Math.ceil((record.resetTime - Date.now()) / 1000),
    };
  });
  
  return status;
}
