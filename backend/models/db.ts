import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

let db: SqlJsDatabase | null = null;
let SQL: any = null;

export async function initDb(): Promise<SqlJsDatabase> {
  if (!db) {
    if (!SQL) {
      SQL = await initSqlJs();
    }

    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../db/novels.db');
    const dbDir = path.dirname(dbPath);

    // Ensure db directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }

    // Create tables if they don't exist
    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS novels (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        description TEXT,
        cover_url TEXT,
        genre TEXT,
        status TEXT DEFAULT 'not_started',
        created_at INTEGER NOT NULL,
        last_scraped_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        chapter_title TEXT,
        url TEXT,
        content TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
        UNIQUE(novel_id, chapter_number)
      );

      CREATE TABLE IF NOT EXISTS scrape_jobs (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'in_progress', 'completed', 'failed', 'paused')),
        total_chapters INTEGER,
        completed_chapters INTEGER DEFAULT 0,
        last_chapter_scraped INTEGER,
        last_chapter_valid INTEGER,
        last_chapter_url TEXT,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chapters_novel_id ON chapters(novel_id);
      CREATE INDEX IF NOT EXISTS idx_scrape_jobs_novel_id ON scrape_jobs(novel_id);
      CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
    `;

    db.run(createTablesSQL);
    saveDatabase();
  }

  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function saveDatabase(): void {
  if (!db) return;

  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../db/novels.db');
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function saveNovel(novelData: {
  id: string;
  url: string;
  title: string;
  author?: string;
  description?: string;
  cover_url?: string;
  genre?: string;
}): void {
  const db = getDatabase();

  // Try to insert, on conflict update
  const insertSQL = `
    INSERT INTO novels (id, url, title, author, description, cover_url, genre, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(insertSQL, [
    novelData.id,
    novelData.url,
    novelData.title,
    novelData.author || null,
    novelData.description || null,
    novelData.cover_url || null,
    novelData.genre || null,
    Date.now(),
  ]);

  saveDatabase();
}

export function saveChapter(chapterData: {
  id: string;
  novel_id: string;
  chapter_number: number;
  chapter_title?: string;
  url?: string;
  content: string;
}): void {
  const db = getDatabase();
  const now = Date.now();

  const insertSQL = `
    INSERT OR REPLACE INTO chapters (id, novel_id, chapter_number, chapter_title, url, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(insertSQL, [
    chapterData.id,
    chapterData.novel_id,
    chapterData.chapter_number,
    chapterData.chapter_title || null,
    chapterData.url || null,
    chapterData.content,
    now,
    now,
  ]);

  saveDatabase();
}

export function getNovelById(novelId: string): any {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM novels WHERE id = ?');
  stmt.bind([novelId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function getNovelByTitle(title: string): any[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM novels
    WHERE title LIKE ?
    ORDER BY
      CASE WHEN title = ? THEN 0 ELSE 1 END,
      COALESCE(last_scraped_at, 0) DESC,
      created_at DESC
    LIMIT 10
  `);
  stmt.bind([`%${title}%`, title]);

  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getChaptersByNovelId(novelId: string): any[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM chapters
    WHERE novel_id = ?
    ORDER BY chapter_number ASC
  `);
  stmt.bind([novelId]);

  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getScrapeJobStatus(novelId: string): any {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM scrape_jobs
    WHERE novel_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  stmt.bind([novelId]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function createScrapeJob(jobData: {
  id: string;
  novel_id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'paused';
}): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO scrape_jobs (id, novel_id, status, created_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.bind([jobData.id, jobData.novel_id, jobData.status, Date.now()]);
  stmt.step();
  stmt.free();

  saveDatabase();
}

export function updateScrapeJob(jobId: string, updates: Record<string, any>): void {
  const db = getDatabase();

  // Build the SET clause dynamically
  const setClauses: string[] = [];
  const values: any[] = [];

  Object.entries(updates).forEach(([key, value]) => {
    setClauses.push(`${key} = ?`);
    values.push(value);
  });

  values.push(jobId);

  const stmt = db.prepare(`
    UPDATE scrape_jobs
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  stmt.bind(values);
  stmt.step();
  stmt.free();

  saveDatabase();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
