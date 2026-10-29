import { v4 as uuidv4 } from 'uuid';
import * as storage from '../storage';

// Mock the database module
jest.mock('../../models/db');

describe('Storage Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveNovel', () => {
    it('should save a novel with all fields', async () => {
      const novel = {
        id: uuidv4(),
        url: 'https://example.com/novel/1',
        title: 'Test Novel',
        author: 'Test Author',
        description: 'Test Description',
        cover_url: 'https://example.com/cover.jpg',
        genre: 'Fantasy',
        created_at: Date.now(),
      };

      await storage.saveNovel(novel);
      // Note: actual assertion depends on mocked db functions
    });

    it('should save a novel with minimal fields', async () => {
      const novel = {
        id: uuidv4(),
        url: 'https://example.com/novel/1',
        title: 'Test Novel',
        created_at: Date.now(),
      };

      await storage.saveNovel(novel);
    });
  });

  describe('saveChapter', () => {
    it('should save a chapter', async () => {
      const chapter = {
        id: uuidv4(),
        novel_id: uuidv4(),
        chapter_number: 1,
        chapter_title: 'Chapter 1',
        url: 'https://example.com/chapter/1',
        content: 'Chapter content here',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await storage.saveChapter(chapter);
    });
  });

  describe('createScrapeJob', () => {
    it('should create a scrape job and return job ID', async () => {
      const novelId = uuidv4();
      const jobId = await storage.createScrapeJob(novelId, 10);

      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');
    });

    it('should create a scrape job without total chapters', async () => {
      const novelId = uuidv4();
      const jobId = await storage.createScrapeJob(novelId);

      expect(jobId).toBeTruthy();
    });
  });

  describe('updateScrapeState', () => {
    it('should update scrape job status', async () => {
      const jobId = uuidv4();
      await storage.updateScrapeState(jobId, { status: 'in_progress' });
      // Verify mock was called
    });

    it('should update multiple fields', async () => {
      const jobId = uuidv4();
      await storage.updateScrapeState(jobId, {
        status: 'in_progress',
        completed_chapters: 5,
        total_chapters: 100,
      });
    });
  });
});
