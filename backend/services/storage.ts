import { initDb, getDatabase, getNovelById as dbGetNovelById, getChaptersByNovelId as dbGetChaptersByNovelId, getScrapeJobStatus as dbGetScrapeJobStatus, createScrapeJob as dbCreateScrapeJob, updateScrapeJob as dbUpdateScrapeJob, saveNovel as dbSaveNovel, saveChapter as dbSaveChapter } from '../models/db';
import { v4 as uuidv4 } from 'uuid';

export interface Novel {
  id: string;
  url: string;
  title: string;
  author?: string;
  description?: string;
  cover_url?: string;
  genre?: string;
  status?: string;
  created_at: number;
  last_scraped_at?: number;
}

export interface Chapter {
  id: string;
  novel_id: string;
  chapter_number: number;
  chapter_title?: string;
  url?: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface ScrapeJob {
  id: string;
  novel_id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'paused';
  total_chapters?: number;
  completed_chapters?: number;
  last_chapter_scraped?: number;
  last_chapter_valid?: number;
  last_chapter_url?: string;
  error_message?: string;
  started_at?: number;
  completed_at?: number;
  created_at: number;
}

export async function openDatabase() {
  return await initDb();
}

export async function saveNovel(novel: Novel): Promise<void> {
  await openDatabase();
  dbSaveNovel({
    id: novel.id,
    url: novel.url,
    title: novel.title,
    author: novel.author,
    description: novel.description,
    cover_url: novel.cover_url,
    genre: novel.genre,
  });
}

export async function saveChapter(chapter: Chapter): Promise<void> {
  await openDatabase();
  dbSaveChapter({
    id: chapter.id,
    novel_id: chapter.novel_id,
    chapter_number: chapter.chapter_number,
    chapter_title: chapter.chapter_title,
    url: chapter.url,
    content: chapter.content,
  });
}

export async function getNovel(novelId: string): Promise<Novel | null> {
  await openDatabase();
  return dbGetNovelById(novelId);
}

export async function getNovelByTitle(query: string, limit: number = 10): Promise<Novel[]> {
  await openDatabase();
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM novels
    WHERE title LIKE ?
    ORDER BY
      CASE WHEN title = ? THEN 0 ELSE 1 END,
      COALESCE(last_scraped_at, 0) DESC,
      created_at DESC
    LIMIT ?
  `);
  stmt.bind([`%${query}%`, query, limit]);

  const results: Novel[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as Novel);
  }
  stmt.free();
  return results;
}

export async function getChapters(novelId: string): Promise<Chapter[]> {
  await openDatabase();
  return dbGetChaptersByNovelId(novelId);
}

export async function getScrapeState(novelId: string): Promise<ScrapeJob | null> {
  await openDatabase();
  return dbGetScrapeJobStatus(novelId);
}

export async function createScrapeJob(novelId: string, totalChapters?: number): Promise<string> {
  await openDatabase();
  const jobId = uuidv4();
  dbCreateScrapeJob({
    id: jobId,
    novel_id: novelId,
    status: 'queued',
  });
  
  if (totalChapters) {
    updateScrapeState(jobId, { total_chapters: totalChapters });
  }
  
  return jobId;
}

export async function updateScrapeState(jobId: string, updates: Partial<ScrapeJob>): Promise<void> {
  await openDatabase();
  const updateObj: Record<string, any> = {};
  
  if (updates.status !== undefined) updateObj.status = updates.status;
  if (updates.total_chapters !== undefined) updateObj.total_chapters = updates.total_chapters;
  if (updates.completed_chapters !== undefined) updateObj.completed_chapters = updates.completed_chapters;
  if (updates.last_chapter_scraped !== undefined) updateObj.last_chapter_scraped = updates.last_chapter_scraped;
  if (updates.last_chapter_valid !== undefined) updateObj.last_chapter_valid = updates.last_chapter_valid;
  if (updates.last_chapter_url !== undefined) updateObj.last_chapter_url = updates.last_chapter_url;
  if (updates.error_message !== undefined) updateObj.error_message = updates.error_message;
  if (updates.started_at !== undefined) updateObj.started_at = updates.started_at;
  if (updates.completed_at !== undefined) updateObj.completed_at = updates.completed_at;
  
  dbUpdateScrapeJob(jobId, updateObj);
}
