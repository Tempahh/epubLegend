import { enqueueScrapeJob, validateCachedChapters, checkOrphanedJobs, getJobStatus } from '../queue';
import * as storage from '../storage';
import * as db from '../../models/db';

jest.mock('../storage');
jest.mock('../../models/db');
jest.mock('child_process');

describe('Queue System', () => {
  const testNovelId = 'a'.repeat(64); // Valid SHA256 hex

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueScrapeJob', () => {
    it('should enqueue a new job with status 202', async () => {
      (storage.createScrapeJob as jest.Mock).mockResolvedValue(undefined);

      const novelId = 'f'.repeat(64);
      const result = await enqueueScrapeJob(novelId, 'start');

      expect(result.status).toBe(202);
      expect(result.jobId).toBeTruthy();
      expect(result.message).toBe('Scrape job queued');
      expect(result.estimatedWaitSeconds).toBeGreaterThanOrEqual(0);
      expect(storage.createScrapeJob).toHaveBeenCalledWith(novelId);
    });

    it('should return 400 for invalid novel ID format', async () => {
      const result = await enqueueScrapeJob('invalid-id', 'start');

      expect(result.status).toBe(400);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('validateCachedChapters', () => {
    it('should return 1 for invalid novel ID', async () => {
      const result = await validateCachedChapters('invalid-id');

      expect(result).toBe(1);
    });

    it('should handle missing cache gracefully', async () => {
      const result = await validateCachedChapters('9'.repeat(64));

      expect(result).toBe(1);
    });
  });

  describe('checkOrphanedJobs', () => {
    it('should detect and mark orphaned jobs', async () => {
      const mockUpdateStmt = {
        step: jest.fn(),
        free: jest.fn(),
        bind: jest.fn(),
      };

      const mockSelectStmt = {
        step: jest.fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false),
        getAsObject: jest.fn()
          .mockReturnValueOnce({ id: 'job-1', novel_id: 'novel-1' })
          .mockReturnValueOnce({ id: 'job-2', novel_id: 'novel-2' }),
        free: jest.fn(),
        bind: jest.fn(),
      };

      const mockDb = {
        prepare: jest.fn((sql) => {
          if (sql.includes('SELECT')) {
            return mockSelectStmt;
          } else {
            return mockUpdateStmt;
          }
        }),
      };

      (db.initDb as jest.Mock).mockResolvedValue(mockDb);
      (db.saveDatabase as jest.Mock).mockImplementation(() => {});

      await checkOrphanedJobs();

      expect(mockUpdateStmt.bind).toHaveBeenCalled();
      expect(mockUpdateStmt.step).toHaveBeenCalled();
    });

    it('should not log anything when no orphaned jobs exist', async () => {
      const mockSelectStmt = {
        step: jest.fn().mockReturnValueOnce(false),
        getAsObject: jest.fn(),
        free: jest.fn(),
        bind: jest.fn(),
      };

      const mockDb = {
        prepare: jest.fn().mockReturnValue(mockSelectStmt),
      };

      (db.initDb as jest.Mock).mockResolvedValue(mockDb);

      await checkOrphanedJobs();

      expect(mockSelectStmt.step).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('should return job status for active job', async () => {
      (storage.createScrapeJob as jest.Mock).mockResolvedValue(undefined);

      const enqueueResult = await enqueueScrapeJob(testNovelId, 'start');
      const jobId = enqueueResult.jobId;

      const job = getJobStatus(jobId);

      expect(job).toBeTruthy();
      expect(job?.id).toBe(jobId);
      expect(job?.novelId).toBe(testNovelId);
      expect(job?.status).toBe('waiting');
    });

    it('should return undefined for non-existent job', () => {
      const job = getJobStatus('non-existent-job-id');

      expect(job).toBeUndefined();
    });
  });

  describe('Duplicate job detection', () => {
    it('should detect duplicate job after enqueue completes', async () => {
      (storage.createScrapeJob as jest.Mock).mockResolvedValue(undefined);

      const novelId = '7'.repeat(64);
      const result1 = await enqueueScrapeJob(novelId, 'start');
      expect(result1.status).toBe(202);

      // Duplicate should be detected immediately
      const result2 = await enqueueScrapeJob(novelId, 'start');
      expect(result2.status).toBe(409);
      expect(result2.jobId).toBe(result1.jobId);
      expect(result2.code).toBe('DUPLICATE_JOB');
    });
  });

  describe('Queue validation', () => {
    it('should validate novelId is required', async () => {
      const result = await enqueueScrapeJob('', 'start');

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.code).toBeDefined();
    });

    it('should validate novelId hex format', async () => {
      const result = await enqueueScrapeJob('z'.repeat(64), 'start');

      expect(result.status).toBe(400);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Mode support', () => {
    it('should support resume mode with chapter parameter', async () => {
      (storage.createScrapeJob as jest.Mock).mockResolvedValue(undefined);

      const novelId = '8'.repeat(64);
      const result = await enqueueScrapeJob(novelId, 'resume', 10);

      expect(result.status).toBe(202);
    });
  });
});
