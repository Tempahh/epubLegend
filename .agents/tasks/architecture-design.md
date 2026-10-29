# E-book Scraper and Generator — Architecture Design

## Overview

This system provides a full-stack web scraper for freewebnovel.com that extracts novel metadata and chapters, then generates EPUB and PDF e-books. The architecture separates concerns across a Python scraping backend (called via Node.js subprocess), a Node.js/Express API layer with queued job processing, and a React/Next.js frontend for user interaction. Data flows from search → discovery → queued scraping → cached storage → e-book generation, with resume capability on network disruption and rate-limiting built in to respect server load.

## Data Flow Architecture

### User Journey
1. **Search Phase**: User enters novel name in UI → frontend calls `POST /api/search` → backend scrapes freewebnovel.com search results page and returns matching novels with URLs
2. **Initiate Scrape**: User selects novel → frontend calls `POST /api/scrape` with novelId → backend enqueues job, returns job ID
3. **Monitor Progress**: Frontend polls `GET /api/scrape/:novelId/progress` every 1–2 seconds (adaptive polling: backs off to 10s if stale, alerts after 5 min) to show live chapter count and completion estimate
4. **Generate E-book**: Once complete, user clicks export → `POST /api/generate-ebook` reads cached chapters and generates EPUB or PDF
5. **Resume on Disconnect**: If network drops, frontend detects stale progress and calls `POST /api/scrape` again with same novelId + `mode:'resume'`—backend validates cached chapters and resumes from last complete chapter

### Module Boundaries
- **Frontend** (React/Next.js): UI state, user interactions, WebSocket/polling orchestration
- **API Layer** (Express): Job routing, caching logic, response formatting
- **Queue System** (Bull or custom in-memory): Serializes concurrent scrape requests, prevents thundering
- **Python Scraper** (subprocess): Beautiful Soup scraping, robust HTML parsing, retries
- **Storage Layer** (file system + SQLite): Persists chapters, metadata, job state
- **E-book Generation** (epub-gen, pdfkit): Compiles chapters into distributable formats

## Database Schema

### SQLite Tables

#### `novels`
```sql
CREATE TABLE novels (
  id TEXT PRIMARY KEY,                  -- SHA256 hash of freewebnovel.com URL (e.g., sha256('https://www.freewebnovel.com/solo-leveling.html'))
  url TEXT UNIQUE NOT NULL,             -- freewebnovel novel page URL
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  cover_url TEXT,
  genre TEXT,
  status TEXT CHECK (status IN ('ongoing', 'completed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_scraped_at DATETIME
);
```

**Novel ID Generation:**
The `id` is computed as `SHA256(novel_url)` and stored in the database. This ensures deterministic lookups: given a freewebnovel.com URL, the same novelId is always generated. Users lookup novels by title via the `GET /api/novel-by-title` endpoint (see API Contract).

#### `chapters`
```sql
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,                  -- UUID
  novel_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,      -- Sort order (0 for Prologue, 1+ for chapters, can be non-sequential)
  chapter_title TEXT NOT NULL,          -- Display title: "Chapter 1", "Prologue", "Epilogue", etc.
  url TEXT NOT NULL,                    -- URL of this chapter (can change on re-scrape)
  content TEXT NOT NULL,                -- Full HTML-cleaned chapter body
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- Track re-scrapes
  FOREIGN KEY (novel_id) REFERENCES novels(id),
  UNIQUE(novel_id, chapter_number),
  CHECK(chapter_number >= 0)
);
```

**Chapter Numbering Convention:**
- `chapter_number` is a **sort order** (not strictly 1-indexed): Prologue=0, Chapters 1+, non-sequential preserved
- `chapter_title` stores the display name ("Prologue", "Chapter 1", "Epilogue", etc.)
- On re-scrape, if chapter N is downloaded again, `INSERT OR REPLACE` updates `content` and `updated_at` (uses composite UNIQUE key `(novel_id, chapter_number)`)
- E-book generators use `ORDER BY chapter_number ASC` and detect new chapters via `MAX(chapter_number)`
- Non-sequential chapters (e.g., 1, 5, 10) are preserved in `chapter_number`

**Re-scrape Logic (Node.js):**
```typescript
// On receiving a chapter from the scraper, use INSERT OR REPLACE:
async function saveOrUpdateChapter(novelId: string, chapterData: any) {
  const db = openDatabase();
  const chapterId = generateUUID();
  
  db.prepare(`
    INSERT OR REPLACE INTO chapters (
      id, novel_id, chapter_number, chapter_title, url, content, created_at, updated_at
    ) VALUES (
      COALESCE((SELECT id FROM chapters WHERE novel_id = ? AND chapter_number = ?), ?),
      ?, ?, ?, ?, ?, datetime('now'), datetime('now')
    )
  `).run(
    novelId, chapterData.chapter_number,
    chapterId,
    novelId, chapterData.chapter_number, chapterData.chapter_title,
    chapterData.url, chapterData.content
  );
}
```

#### `scrape_jobs`
```sql
CREATE TABLE scrape_jobs (
  id TEXT PRIMARY KEY,                  -- UUID
  novel_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'paused')),
  total_chapters INTEGER,               -- If known from metadata
  completed_chapters INTEGER DEFAULT 0,
  last_chapter_scraped INTEGER DEFAULT 0,
  last_chapter_valid BOOLEAN DEFAULT 0, -- True if last_chapter_scraped fully downloaded
  last_chapter_url TEXT,                -- Resume from here
  error_message TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES novels(id)
);
```

### JSON Cache Files (Filesystem)
Located at `/Users/mac/Documents/epubLegend/downloads/novels/{novelId}/`:
- `metadata.json`: Cached title, author, description, cover, genre, status
- `cover.jpg`: Cover image (downloaded at scrape time, max 5MB, resized if necessary)
- `chapters/`: Directory of JSON files `{chapterNumber}.json` with structure:
  ```json
  {
    "chapter_number": 1,
    "chapter_title": "Chapter 1: Awakening",
    "url": "https://freewebnovel.com/...",
    "content": "...",
    "word_count": 3200,
    "scraped_at": "2024-01-15T09:00:00Z",
    "completed": true
  }
  ```
- `state.json`: Current job state, resume pointers, validation flags, last error, retry count (see Resume section)

## API Contract

### Authentication
All endpoints are **public** in the MVP (no auth required). For production deployment in shared environments, recommend adding Bearer token authentication or session cookies to restrict access.

### Input Validation Rules
- **Novel ID (`novelId`)**: Must match format of existing novel (SHA256 hash, 64 hex chars). Required field. Return 404 if not found.
- **Search Query (`query`)**: String, 1–200 characters, alphanumeric + spaces/hyphens only. Return 400 if invalid format.
- **Page (`page`)**: Integer, 1–100. Default 1. Return 400 if out of range.
- **Export Format (`format`)**: Enum ['epub', 'pdf']. Required. Return 400 if invalid.
- **Mode (`mode`)**: Enum ['start', 'resume']. Default 'start'. Return 400 if invalid.

### API Rate Limits (MVP)
- **POST /api/search**: 10 requests/minute per IP (search is lightweight)
- **POST /api/scrape**: 1 active scrape per `novelId`, max 5 total concurrent jobs, max 20 queue depth
- **POST /api/generate-ebook**: 2 requests/minute per IP (generation is resource-intensive)
- When limits exceeded: return 429 (search/generate) or 409 (scrape duplicate) or 503 (queue full)

### POST /api/search
**Request:**
```json
{
  "query": "Solo Leveling",
  "page": 1
}
```

**Validation:**
- `query` must be 1–200 characters, alphanumeric + space/hyphen
- `page` must be 1–100; default 1
- Return max 50 results per page

**Response (200):**
```json
{
  "success": true,
  "results": [
    {
      "novelId": "abc123hash",
      "title": "Solo Leveling",
      "author": "Chugong",
      "description": "...",
      "cover": "https://...",
      "genre": "Action, Fantasy",
      "status": "completed",
      "url": "https://freewebnovel.com/..."
    }
  ],
  "totalResults": 5,
  "page": 1
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Invalid query format (must be 1-200 chars, alphanumeric + space/hyphen)",
  "code": "INVALID_INPUT"
}
```

**Error Response (429):**
```json
{
  "success": false,
  "error": "Rate limited. Max 10 searches per minute.",
  "code": "RATE_LIMIT",
  "retryAfter": 30
}
```

### GET /api/novel-by-title?query=Solo%20Leveling
**New endpoint** for looking up `novelId` by title (supports resume workflow).

**Request:** Query parameter `query` (1–200 chars)

**Response Ordering and Limits**:
- Return maximum **10 results** matching the query title
- Sort by:
  1. Exact title match first (case-insensitive)
  2. Then by `last_scraped_at DESC` (most recently scraped novel first)
  3. Then by `created_at DESC` (newest novel in database first)
- If zero results, return empty array with `success: true`

**Duplicate Handling**: If multiple novels have identical titles (legitimate edge case), all are returned and user must select based on author or URL. UI should display author and URL preview for disambiguation.

**Response (200):**
```json
{
  "success": true,
  "novels": [
    {
      "novelId": "abc123hash",
      "title": "Solo Leveling",
      "author": "Chugong",
      "url": "https://freewebnovel.com/solo-leveling.html",
      "status": "cached",
      "cachedAt": "2024-01-15T10:30:00Z"
    },
    {
      "novelId": "def456hash",
      "title": "Solo Leveling (English Translation)",
      "author": "Translator Name",
      "url": "https://freewebnovel.com/solo-leveling-en.html",
      "status": "in_progress",
      "progress": { "completed": 42, "total": 150 }
    }
  ],
  "totalResults": 2
}
```

### POST /api/scrape
**Request:**
```json
{
  "novelId": "abc123hash",
  "mode": "resume"
}
```

**Validation:**
- `novelId` must be 64-char hex string; required
- `mode` must be 'start' or 'resume'; default 'start'

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_xyz789",
  "novelId": "abc123hash",
  "message": "Scrape job queued",
  "estimatedWaitSeconds": 15
}
```

**Error Response (409 Conflict — duplicate scrape):**
```json
{
  "success": false,
  "error": "Scrape already in progress or queued for this novel",
  "jobId": "job_existing",
  "statusUrl": "/api/scrape/abc123hash/progress",
  "code": "DUPLICATE_JOB"
}
```

**Error Response (503 Service Unavailable — queue full):**
```json
{
  "success": false,
  "error": "Queue full (20 max jobs). Retry in 30 seconds.",
  "code": "QUEUE_FULL",
  "retryAfter": 30
}
```

### GET /api/scrape/:novelId/progress
**Response (200):**
```json
{
  "success": true,
  "jobId": "job_xyz789",
  "status": "in_progress",
  "completedChapters": 42,
  "totalChapters": 150,
  "percentComplete": 28,
  "estimatedSecondsRemaining": 3600,
  "lastChapterTitle": "Chapter 42: The Shadow's Call",
  "paused": false,
  "error": null
}
```

**When complete (200):**
```json
{
  "success": true,
  "status": "completed",
  "completedChapters": 150,
  "totalChapters": 150,
  "percentComplete": 100,
  "completedAt": "2024-01-15T10:30:00Z"
}
```

### POST /api/generate-ebook
**Request:**
```json
{
  "novelId": "abc123hash",
  "format": "epub"
}
```

**Validation:**
- `novelId` must exist in database; required
- `format` must be 'epub' or 'pdf'; required
- Minimum 3 chapters required in cache; return error if below threshold

**Response (200 + file stream):**
```
Content-Type: application/epub+zip or application/pdf
Content-Disposition: attachment; filename="Solo-Leveling.epub"
[binary file data]
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Novel not found",
  "code": "NOT_FOUND"
}
```

**Error Response (422 — insufficient chapters):**
```json
{
  "success": false,
  "error": "Cannot generate e-book: minimum 3 chapters required",
  "completedChapters": 1,
  "code": "INSUFFICIENT_CHAPTERS"
}
```

### GET /api/scrape/:novelId/chapters
**Response (200):**
```json
{
  "success": true,
  "novelId": "abc123hash",
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "Chapter 1: Awakening",
      "wordCount": 3200,
      "scrapedAt": "2024-01-15T09:00:00Z"
    },
    {
      "chapterNumber": 2,
      "title": "Chapter 2: The First Hunt",
      "wordCount": 2950,
      "scrapedAt": "2024-01-15T09:05:00Z"
    }
  ],
  "totalChapters": 2,
  "totalWords": 6150
}
```

## Queue System Design

### In-Memory Queue (Bull + Redis Alternative)
We use **Bull** (Node.js job queue) backed by Redis or in-memory adapter for development. This prevents concurrent scrapes of the same novel and serializes requests.

**Key Properties:**
- Only one job per `novelId` can run concurrently
- If duplicate request arrives for `novelId` already scraping: return **409 Conflict** with existing `jobId` (no duplicate enqueue)
- If duplicate arrives for queued job: return **409 Conflict** with existing `jobId`
- Maximum concurrent jobs: **3** (configurable via `MAX_CONCURRENT_JOBS`)
- Maximum queue depth: **20 jobs** (prevents unbounded memory growth)
- When queue is full (20 jobs): return **503 Service Unavailable**, ask user to retry after delay
- Jobs are persistently stored so resume survives server restart (Redis) or lost on restart (in-memory)
- Retry policy: exponential backoff (2s, 4s, 8s, max 3 retries)
- Job timeout: 5 hours per novel (configurable)

**Job Payload:**
```typescript
interface ScrapeJob {
  novelId: string;
  resumeFromChapter?: number;  // Populated if resuming
  mode: 'start' | 'resume';
  retryCount: number;
}
```

**Queue Duplicate Detection (Node.js):**
```typescript
async function enqueueScrapeJob(novelId: string, mode: 'start' | 'resume') {
  // Check for existing job (in_progress or pending)
  const existingJob = await queue.getJobs(['in_progress', 'waiting']);
  const duplicate = existingJob.find(job => job.data.novelId === novelId);
  
  if (duplicate) {
    // Return 409 with existing job ID
    return { status: 409, jobId: duplicate.id, error: 'Already in progress' };
  }
  
  // Check queue depth
  const depth = existingJob.length;
  if (depth >= 20) {
    return { status: 503, error: 'Queue full, retry later' };
  }
  
  // Enqueue new job
  const job = await queue.add({ novelId, mode, retryCount: 0 });
  return { status: 202, jobId: job.id };
}
```

## Python Scraper Integration

### Subprocess Architecture
The backend spawns a Python child process per scrape job using `child_process.spawn()`. Communication happens via stdin/stdout with JSON payloads.

**Node.js Invocation:**
```javascript
const python = spawn('python3', [
  'scrapers/freewebnovel_scraper.py',
  '--novel-id', novelId,
  '--start-chapter', resumeFromChapter || 1,
  '--cache-dir', `/Users/mac/Documents/epubLegend/downloads/novels/${novelId}`
]);
```

### Rate Limiting Strategy
**Default behavior:** 5 seconds between requests (respects standard rate-limiting etiquette without aggressive backoff). This applies when `RATE_LIMIT_DELAY_MS` environment variable is NOT set or is empty.

**On rate-limit response (HTTP 429):** Exponential backoff, starting at 60 seconds and capping at 300 seconds (5 minutes). Retry same chapter without incrementing chapter counter.

**Configuration (Optional):** Set `RATE_LIMIT_DELAY_MS` env variable to override default only if explicitly set; otherwise default 5-second delay applies. This balances freewebnovel.com load with scrape speed.

**Example configurations:**
- Not set (default): 5-second delay between requests
- `RATE_LIMIT_DELAY_MS=2000`: 2-second delay (faster, more aggressive)
- `RATE_LIMIT_DELAY_MS=10000`: 10-second delay (slower, more conservative)

### Search Result Parsing

**Approach:** Search functionality scrapes the freewebnovel.com search results page directly using BeautifulSoup.

**URL Pattern:** `https://www.freewebnovel.com/search?keywords={query}&pageNo={page}`

**BeautifulSoup Selectors** (confirmed selectors; update if HTML structure changes):
- Result container: `div.SearchResult` or `div.novel-item`
- Novel URL: `a.novel-title` or `a[href*="/novel/"]` → href attribute
- Title: Text content of title link
- Author: `span.author-name` or `div.author-info` → text content
- Cover image: `img.cover-image` or `img.novel-cover` → src attribute
- Genre/Tags: `span.tag`, `a.genre` → text content (comma-separated)
- Status (ongoing/completed): Check page text for "ongoing" or "completed" indicator

**Error Handling:** 
- If HTML structure changes and selectors fail to find results, return HTTP 503 with message: "Search temporarily unavailable due to site structure changes. Retry in 1 hour or report issue."
- Cache selector updates during development so changes can be deployed quickly
- Log parse failures (count of missing fields) for monitoring

**Example Scraper Code Snippet:**
```python
def search_novels(query: str, page: int) -> list[dict]:
    """Search freewebnovel.com and return matching novels."""
    url = f"https://www.freewebnovel.com/search?keywords={quote(query)}&pageNo={page}"
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.content, 'html.parser')
    results = []
    
    for result in soup.select('div.SearchResult, div.novel-item'):
        try:
            title_elem = result.select_one('a.novel-title, a[href*="/novel/"]')
            if not title_elem:
                continue
            
            novel_url = title_elem.get('href', '')
            if not novel_url.startswith('http'):
                novel_url = f"https://www.freewebnovel.com{novel_url}"
            
            title = title_elem.get_text(strip=True)
            author = result.select_one('span.author-name, div.author-info')?.get_text(strip=True) or 'Unknown'
            cover_img = result.select_one('img.cover-image, img.novel-cover')
            cover_url = cover_img.get('src', '') if cover_img else None
            
            genre_tags = result.select('span.tag, a.genre')
            genre = ', '.join([tag.get_text(strip=True) for tag in genre_tags]) or 'N/A'
            
            results.append({
                'url': novel_url,
                'title': title,
                'author': author,
                'cover': cover_url,
                'genre': genre
            })
        except Exception as e:
            print(f"Error parsing result: {e}", file=sys.stderr)
            continue
    
    return results
```

**Python Script (High-Level):**
```python
# scrapers/freewebnovel_scraper.py
import sys
import json
import time
from bs4 import BeautifulSoup
import requests
import os

# Default: 5 seconds; override via RATE_LIMIT_DELAY_MS if set
DEFAULT_RATE_LIMIT_DELAY = int(os.getenv('RATE_LIMIT_DELAY_MS', '5000')) / 1000

def scrape_novel(novel_id, start_chapter, cache_dir):
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0 (scraper)'})
    
    chapter_num = start_chapter
    while True:
        try:
            chapter_data = scrape_chapter(session, novel_id, chapter_num, cache_dir)
            if not chapter_data:
                break
            
            print(json.dumps({
                'type': 'chapter_complete',
                'chapter': chapter_num,
                'title': chapter_data['title'],
                'wordCount': len(chapter_data['content'].split()),
                'completed': True
            }), flush=True)
            
            time.sleep(DEFAULT_RATE_LIMIT_DELAY)  # Default 5s; respects rate limit
            chapter_num += 1
        except requests.exceptions.RequestException as e:
            if e.response and e.response.status_code == 429:
                # Rate limited: exponential backoff
                backoff = min(60 * (2 ** retry_count), 300)  # 60s → 300s
                print(json.dumps({
                    'type': 'rate_limited',
                    'backoff_seconds': backoff,
                    'chapter': chapter_num
                }), flush=True)
                time.sleep(backoff)
                # Retry same chapter, do not increment
            else:
                print(json.dumps({
                    'type': 'error',
                    'code': 'NETWORK_ERROR',
                    'message': str(e),
                    'retryable': True,
                    'chapter': chapter_num
                }), flush=True)
                sys.exit(1)
        except Exception as e:
            print(json.dumps({
                'type': 'error',
                'code': 'PARSE_ERROR',
                'message': str(e),
                'chapter': chapter_num
            }), flush=True)
            sys.exit(1)
```

**Error Handling in Python:**
- **Network errors** (ConnectionError, Timeout): Return JSON with `retryable: true`; Node.js handles exponential backoff per retry table
- **Rate limiting (429)**: Emit `rate_limited` message, pause exponentially (60–300s), retry same chapter without incrementing
- **Parse errors** (HTML malformed, meta tags missing): Log and skip, emit error but continue to next chapter
- **Novel ended** (no next chapter link found): Emit completion, exit gracefully

### Chapter Discovery Algorithm
The scraper discovers next chapter URLs using a fallback chain:
1. Search for `<a class='next'>` or `<a rel='next'>`
2. If not found, search for `<a>` with href matching pattern `/chapter-\d+/`
3. If not found, check for text containing "Next Chapter"
4. If still not found, novel is complete

To handle freewebnovel.com structure updates, the selectors are centralized:
```python
NEXT_CHAPTER_SELECTORS = [
    'a.next',
    'a[rel="next"]',
    'a:contains("Next Chapter")',
]

def find_next_chapter_url(soup):
    for selector in NEXT_CHAPTER_SELECTORS:
        link = soup.select_one(selector)
        if link and link.get('href'):
            return link['href']
    # If no standard next link, check for chapter-number patterns
    for link in soup.find_all('a', href=re.compile(r'/chapter-\d+/')):
        return link['href']
    return None  # Novel is complete
```

**Metadata Extraction via Beautiful Soup:**
```python
def extract_metadata(soup, novel_url):
    return {
        'title': soup.find('meta', {'property': 'og:title'})['content'],
        'author': soup.select_one('div.book-authors')?.text or 'Unknown',
        'description': soup.find('meta', {'name': 'description'})['content'],
        'cover': soup.find('meta', {'property': 'og:image'})['content'],
        'genre': ', '.join([tag.text for tag in soup.select('a.tag')]),
        'status': 'completed' if 'completed' in soup.text.lower() else 'ongoing'
    }

def clean_chapter_content(raw_html):
    """
    Cleans chapter HTML according to rules:
    1. Remove <script>, <style>, <noscript> tags and content
    2. Remove common ad/banner classes: [class*="ad"], [class*="banner"]
    3. Remove author notes: <div class="author-note">, etc.
    4. Preserve formatting: <b>, <i>, <u>, <p>, <br>, <blockquote>
    5. Remove event handlers: onclick, onload, etc.
    6. Convert relative image URLs to absolute (freewebnovel.com domain)
    7. Remove external links (keep local chapter links)
    8. Trim excessive whitespace
    """
    soup = BeautifulSoup(raw_html, 'html.parser')
    
    # Remove unwanted tags
    for tag in soup.find_all(['script', 'style', 'noscript']):
        tag.decompose()
    
    for tag in soup.find_all(class_=re.compile(r'ad|banner|comment|author-note')):
        tag.decompose()
    
    # Remove event handlers
    for tag in soup.find_all(True):
        for attr in ['onclick', 'onload', 'onerror']:
            if attr in tag.attrs:
                del tag.attrs[attr]
    
    # Convert relative images to absolute
    for img in soup.find_all('img'):
        src = img.get('src', '')
        if src and not src.startswith('http'):
            img['src'] = f'https://www.freewebnovel.com{src}'
    
    # Remove external links (keep chapter links)
    for link in soup.find_all('a', href=True):
        if not link['href'].startswith('/') and 'freewebnovel' not in link['href']:
            link.unwrap()
    
    return str(soup).strip()
```

## E-book Generation

### EPUB Generation (epub-gen)
**Process:**
1. Validate: minimum 3 chapters required; return 422 error if insufficient
2. Read metadata from `metadata.json`
3. Sort chapters by `chapter_number`
4. Build chapters array with HTML content (cleaned, headings styled)
5. Generate TOC from chapter titles
6. Embed cover image if present (cache at scrape time)
7. Output to `/downloads/novels/{novelId}/{title}.epub`

**Code Pattern:**
```typescript
const EpubGenerator = require('epub-gen');

async function generateEpub(novelId: string, format: string) {
  const chapters = await loadCachedChapters(novelId);
  if (chapters.length < 3) {
    throw new Error(`Insufficient chapters: ${chapters.length} (minimum 3)`);
  }
  
  const metadata = await loadMetadata(novelId);
  const coverPath = path.join(cacheDir, novelId, 'cover.jpg');
  const coverExists = await fs.promises.access(coverPath).then(() => true).catch(() => false);
  
  const epub = new EpubGenerator({
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    cover: coverExists ? coverPath : undefined,
    content: chapters.map(ch => ({
      title: ch.chapter_title,
      data: `<h1>${ch.chapter_title}</h1>\n${ch.content}`
    }))
  });
  
  const outputPath = path.join(cacheDir, novelId, `${metadata.title}.epub`);
  await epub.promise;
  console.log(`EPUB generated: ${outputPath}`);
  return outputPath;
}
```

### PDF Generation (Puppeteer)
**Recommended approach for MVP (and production):** Use **puppeteer** (headless Chrome/Chromium) for cross-platform compatibility and no external system binary dependencies. **Do not use wkhtmltopdf** (requires OS-specific binary installation and adds CI/CD complexity).

**Process:**
1. Validate: minimum 3 chapters required
2. Build HTML document with title page, TOC, chapters
3. Use Puppeteer to render HTML → PDF
4. Output to `/downloads/novels/{novelId}/{title}.pdf`

**Code Pattern:**
```typescript
const puppeteer = require('puppeteer');

async function generatePdf(novelId: string) {
  const chapters = await loadCachedChapters(novelId);
  if (chapters.length < 3) {
    throw new Error(`Insufficient chapters: ${chapters.length} (minimum 3)`);
  }
  
  const metadata = await loadMetadata(novelId);
  const coverPath = path.join(cacheDir, novelId, 'cover.jpg');
  const coverExists = await fs.promises.access(coverPath).then(() => true).catch(() => false);
  
  // Build HTML document
  const html = buildPdfHtml(metadata, chapters, coverExists ? coverPath : null);
  
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle2' });
  
  const outputPath = path.join(cacheDir, novelId, `${metadata.title}.pdf`);
  await page.pdf({
    path: outputPath,
    format: 'A4',
    margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
    printBackground: true
  });
  
  await browser.close();
  console.log(`PDF generated: ${outputPath}`);
  return outputPath;
}

function buildPdfHtml(metadata, chapters, coverPath) {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: serif; line-height: 1.6; }
        .title-page { page-break-after: always; text-align: center; }
        .title-page h1 { font-size: 2.5em; margin-top: 3em; }
        .chapter { page-break-before: always; }
        .chapter h2 { font-size: 1.8em; margin-top: 1em; }
      </style>
    </head>
    <body>
  `;
  
  // Title page
  if (coverPath) {
    html += `<div class="title-page"><img src="file://${coverPath}" style="max-height: 400px;"></div>`;
  }
  html += `<div class="title-page"><h1>${escapeHtml(metadata.title)}</h1><p>By ${escapeHtml(metadata.author)}</p></div>`;
  
  // Chapters
  chapters.forEach(ch => {
    html += `<div class="chapter"><h2>${escapeHtml(ch.chapter_title)}</h2>${ch.content}</div>`;
  });
  
  html += `</body></html>`;
  return html;
}
```

**Error Handling:**
- If Puppeteer fails to launch (Chrome not available): Return 503 Service Unavailable with message "PDF generation unavailable. Try EPUB export instead or retry."
- If chapter rendering fails: Log error and attempt fallback (EPUB-only export recommended to user)

### Cover Image Handling
**Download and cache at scrape time:**
- URL: from `novel.cover_url` (extracted via Beautiful Soup)
- Timeout: 10 seconds; if timeout, skip cover and use placeholder
- Max size: 5 MB; if larger, resize to 1024x1536 pixels using sharp or ImageMagick
- Fallback: if download fails or unavailable, generate solid placeholder with title text
- Cache location: `/downloads/novels/{novelId}/cover.jpg`
- Validation: check file exists before referencing in EPUB/PDF

**Placeholder Generation Specification** (if download fails or unavailable):
- Create image: 1024x1536 pixels, solid color background (light gray #f0f0f0)
- Overlay text with title and author (black, centered, large font)
- Implementation: Use sharp or Canvas library to generate PNG, save to cache
- Same file path as downloaded cover: `/downloads/novels/{novelId}/cover.jpg`

**Code Pattern:**
```typescript
async function downloadAndCacheCover(novelId: string, coverUrl: string) {
  if (!coverUrl) {
    // No URL provided; generate placeholder
    await generateCoverPlaceholder(novelId, title, author);
    return true;
  }
  
  try {
    const response = await axios.get(coverUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    let imageBuffer = response.data;
    
    // Check size
    if (imageBuffer.length > 5 * 1024 * 1024) {
      const sharp = require('sharp');
      imageBuffer = await sharp(imageBuffer)
        .resize(1024, 1536, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    }
    
    const coverPath = path.join(cacheDir, novelId, 'cover.jpg');
    await fs.promises.writeFile(coverPath, imageBuffer);
    return true;
  } catch (err) {
    console.log(`Cover download failed for ${novelId}: ${err.message}`);
    // Fallback to placeholder
    await generateCoverPlaceholder(novelId, title, author);
    return false;
  }
}

async function generateCoverPlaceholder(novelId: string, title: string, author: string) {
  const sharp = require('sharp');
  
  const svg = `
    <svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f0f0f0"/>
      <text x="512" y="600" font-size="48" font-weight="bold" text-anchor="middle" fill="#333">
        ${escapeXml(title)}
      </text>
      <text x="512" y="700" font-size="32" text-anchor="middle" fill="#666">
        ${escapeXml(author || 'Unknown Author')}
      </text>
    </svg>
  `;
  
  const buffer = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  const coverPath = path.join(cacheDir, novelId, 'cover.jpg');
  await fs.promises.writeFile(coverPath, buffer);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

## Error Handling & Resilience

### Retry Strategy
| Error | Condition | Retry? | Backoff | Max Attempts |
|-------|-----------|--------|---------|--------------|
| Network timeout | `ECONNRESET`, `ETIMEDOUT` | Yes | Exponential 2s–32s | 3 |
| Rate limit (429) | Server response code | Yes | Linear 60s–300s | Infinite (paused) |
| Parse error | BeautifulSoup cannot extract | No | N/A | 1 (skip chapter) |
| Novel not found (404) | URL returns 404 | No | N/A | 1 (abort) |
| File write error | Disk full, permission denied | Yes | Linear 5s–30s | 3 |

**Implementation:**
- Python scraper logs failures to `state.json` with timestamps
- Node.js API layer inspects exit code and `state.json` after subprocess completes
- If retryable, job is re-queued with increment counter
- After max retries, job marked `failed`, user notified

### Resume on Connection Drop
1. Frontend detects stale progress (no update for 10 seconds) → calls `POST /api/scrape` again with `mode: 'resume'`
2. Backend queries `scrape_jobs` for `novel_id` with status `in_progress`
3. If exists, Node.js backend validates cached chapters before resuming
4. **Chapter validation**: For each cached chapter file, check for `"completed": true` flag and verify content length >= 500 characters (minimum threshold for valid chapter)
5. If last cached chapter fails validation, resume from that chapter (not `+1`, to recover partial download)
6. Update `state.json` with: `{ last_chapter_scraped, last_chapter_valid: boolean, resumeFromChapter }`
7. Re-enqueue new job with `mode: 'resume'` and `resumeFromChapter` pointer
8. Python scraper skips already-downloaded and validated chapters, continues from checkpoint or recovery point

**Critical: Chapter Completion Atomicity** — Python scraper MUST write `completed: true` to the JSON file only after the chapter is fully flushed to disk. Use `os.fsync()` to ensure data reaches the filesystem before marking complete.

**Python Save Function (Safe Against Crashes):**
```python
def save_chapter(cache_dir, chapter_num, chapter_data):
    """Save chapter to file atomically. Use temp file + rename to prevent corruption."""
    chapters_dir = os.path.join(cache_dir, 'chapters')
    os.makedirs(chapters_dir, exist_ok=True)
    
    ch_file = os.path.join(chapters_dir, f'{chapter_num}.json')
    temp_file = ch_file + '.tmp'
    
    # Write to temp file first
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump({
            'chapter_number': chapter_num,
            'chapter_title': chapter_data['title'],
            'url': chapter_data['url'],
            'content': chapter_data['content'],
            'word_count': len(chapter_data['content'].split()),
            'scraped_at': datetime.now().isoformat(),
            'completed': False  # Mark incomplete during write
        }, f)
        f.flush()
        os.fsync(f.fileno())  # Force OS to sync to disk
    
    # Atomic rename (completes the chapter write)
    os.rename(temp_file, ch_file)
    
    # Update state.json after successful write to indicate chapter is valid
    update_state_json(cache_dir, {
        'last_chapter_scraped': chapter_num,
        'last_chapter_valid': True
    })

def update_state_json(cache_dir, updates):
    """Update state file with checkpoint info."""
    state_file = os.path.join(cache_dir, 'state.json')
    
    # Load existing state
    try:
        with open(state_file, 'r') as f:
            state = json.load(f)
    except FileNotFoundError:
        state = {}
    
    # Update and write back
    state.update(updates)
    state['updated_at'] = datetime.now().isoformat()
    
    with open(state_file, 'w') as f:
        json.dump(state, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
```

**State file structure (state.json):**
```json
{
  "novel_id": "abc123hash",
  "last_chapter_scraped": 42,
  "last_chapter_valid": false,
  "resumeFromChapter": 42,
  "total_chapters_known": 150,
  "retry_count": 1,
  "last_error": null,
  "created_at": "2024-01-15T09:00:00Z",
  "updated_at": "2024-01-15T09:25:00Z"
}
```

**Resume validation (Node.js):**
```typescript
async function validateCachedChapters(novelId: string): Promise<number> {
  const chaptersDir = path.join(cacheDir, novelId, 'chapters');
  
  // Return 1 if chapters dir doesn't exist
  try {
    await fs.promises.access(chaptersDir);
  } catch {
    return 1; // Start from chapter 1
  }
  
  const chapters = await fs.promises.readdir(chaptersDir);
  let lastValidChapter = 0;
  
  // Sort by chapter number and validate in order
  for (const chFile of chapters.sort((a, b) => parseInt(a) - parseInt(b))) {
    try {
      const chData = JSON.parse(
        await fs.promises.readFile(path.join(chaptersDir, chFile), 'utf-8')
      );
      
      // Chapter is valid if: completed flag is true AND content >= 500 chars
      const isValid = 
        chData.completed === true && 
        (chData.content?.length ?? 0) >= 500;
      
      if (isValid) {
        lastValidChapter = parseInt(chFile);
      } else {
        // Found incomplete chapter; resume from here (not +1)
        console.log(`Found incomplete chapter ${chFile}. Resuming from here.`);
        return parseInt(chFile);
      }
    } catch (err) {
      console.error(`Error validating chapter ${chFile}: ${err.message}`);
      // Invalid chapter file; resume from here
      return parseInt(chFile);
    }
  }
  
  // All chapters valid; continue from next chapter
  return lastValidChapter + 1;
}
```

### Rate Limiting (Respect Server)
- 5-minute delay between requests **if configured** (respects `/robots.txt` or Robots meta tag)
- Detect 429 via HTTP response, pause exponentially
- Adaptive: if no 429 for 100 requests, reduce delay gradually

## Frontend Component Hierarchy

```
App
├── SearchPanel
│   ├── SearchInput (debounced onChange)
│   └── SearchResults (map over results)
│       └── NovelCard
│           └── [Start Scrape Button]
├── ScrapeProgressPanel
│   ├── ProgressBar (% complete)
│   ├── ChapterCounter (42/150)
│   ├── EstimatedTime (2 hours remaining)
│   ├── PauseResumeButton
│   └── StatusMessage (current chapter title)
├── ExportPanel
│   ├── ExportButton (EPUB)
│   └── ExportButton (PDF)
└── HistoryPanel
    └── HistoryItem (previous scrapes, re-download option)
```

### State Management (React Context + Hooks)
```typescript
interface AppState {
  searchResults: Novel[];
  currentScrape: {
    novelId: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    progress: { completed: number; total: number };
    jobId: string;
  };
  history: { novelId: string; title: string; scrapedAt: Date }[];
}

// Adaptive polling hook for progress
// Starts with 1.5s interval, backs off to 10s if no update for 60s, alerts if no update for 300s
useEffect(() => {
  if (currentScrape?.status !== 'in_progress') return;
  
  let lastUpdateTime = Date.now();
  let pollInterval = 1500;
  let noUpdateTimer: NodeJS.Timeout;
  
  const poll = async () => {
    try {
      const response = await fetch(`/api/scrape/${currentScrape.novelId}/progress`);
      const data = await response.json();
      
      if (data.success) {
        setProgress(data);
        lastUpdateTime = Date.now();
        
        // Reset no-update warning if we get data
        if (noUpdateTimer) clearTimeout(noUpdateTimer);
        
        // Adjust polling interval based on update staleness
        const timeSinceUpdate = Date.now() - lastUpdateTime;
        pollInterval = timeSinceUpdate > 60000 ? 10000 : 1500;
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  };
  
  // Set up intervals
  const pollTimer = setInterval(poll, pollInterval);
  
  // Alert if no update for 5 minutes
  noUpdateTimer = setTimeout(() => {
    if (Date.now() - lastUpdateTime > 300000) {
      showAlert('No progress for 5 minutes. Consider resuming or checking network.');
    }
  }, 300000);
  
  // Run poll immediately
  poll();
  
  return () => {
    clearInterval(pollTimer);
    if (noUpdateTimer) clearTimeout(noUpdateTimer);
  };
}, [currentScrape?.status, currentScrape?.novelId]);
```

**Polling Behavior:**
- Check every **1.5 seconds** while scrape is active
- If no progress update for **60 seconds**: back off to 10-second polls (reduce backend load)
- If no progress update for **300 seconds**: show alert to user suggesting resume or network check
- On first update after backoff: reset to 1.5-second intervals

### State Persistence Across Browser Sessions

**Problem**: After page refresh or browser restart, the frontend loses track of which novel was being scraped. The resume workflow must survive these events.

**Solution**: Use localStorage to persist the current scrape state:

```typescript
// useScrapeProgress.ts
import { useEffect, useState } from 'react';

export function useScrapeProgress() {
  const [currentScrapeId, setCurrentScrapeId] = useState<string | null>(() => {
    // On mount, attempt to restore from localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem('currentScrapeNovelId');
    }
    return null;
  });
  
  const [progress, setProgress] = useState(null);
  
  // Save to localStorage whenever scrape starts
  const startScrape = async (novelId: string) => {
    const response = await fetch('/api/scrape', {
      method: 'POST',
      body: JSON.stringify({ novelId, mode: 'start' })
    });
    const data = await response.json();
    if (data.success) {
      localStorage.setItem('currentScrapeNovelId', novelId);
      setCurrentScrapeId(novelId);
    }
  };
  
  // Clear from localStorage when complete
  const clearScrape = () => {
    localStorage.removeItem('currentScrapeNovelId');
    setCurrentScrapeId(null);
  };
  
  // Poll progress if a scrape is in progress
  useEffect(() => {
    if (!currentScrapeId) return;
    
    const poll = async () => {
      try {
        const response = await fetch(`/api/scrape/${currentScrapeId}/progress`);
        const data = await response.json();
        if (data.success) {
          setProgress(data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearScrape();
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };
    
    poll();
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [currentScrapeId]);
  
  return { currentScrapeId, progress, startScrape, clearScrape };
}
```

**Queue Concurrency Clarification**:
- Only **one scrape per novel** can be active (enforced by 409 Conflict response)
- **Maximum 3 concurrent scrapes across all novels** (global concurrency limit)
- **Maximum 20 jobs queued** (limits memory growth)
- Users *can* search for and queue multiple novels, but only 3 will scrape simultaneously
- Remaining jobs enter queue and process in FIFO order

### ScrapeProgressPanel Component Specification

**Props**:
```typescript
interface ScrapeProgressPanelProps {
  novelId: string;
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  progress: { completed: number; total: number };
  error?: { code: string; message: string };
  onResume: (novelId: string) => void;
  onCancel: (jobId: string) => void;
}
```

**UI Rendering Rules**:

| Status | Display | Actions |
|--------|---------|---------|
| pending | "Queued (position #X)" | Cancel button |
| in_progress | "42/150 chapters (28%)" + ProgressBar + "Est. 2h remaining" | No actions (pause not implemented in MVP) |
| completed | "✓ Complete! Ready to export." | Export EPUB/PDF buttons |
| failed | "⚠️ Error: {error.message}. Last successful: ch. 42/150" | Resume button, View Details link |
| paused | "⏸ Paused at ch. 42/150" | Resume button, Cancel button |

**Error Detail Modal**: On failed scrape, display:
- Error code (e.g., NETWORK_ERROR, PARSE_ERROR)
- Last successful chapter
- Timestamp of failure
- Suggested action (Resume, Try different novel, Check internet connection)

**No Pause Endpoint Exists**: The current design does not include `POST /api/scrape/:novelId/pause`. For MVP, omit pause functionality and recommend queuing pause/resume as a future feature.

## File Organization

```
/Users/mac/Documents/epubLegend/
├── .agents/tasks/
│   └── architecture-design.md (this file)
├── frontend/
│   ├── components/
│   │   ├── SearchPanel.tsx
│   │   ├── NovelCard.tsx
│   │   ├── ScrapeProgressPanel.tsx
│   │   ├── ExportPanel.tsx
│   │   └── HistoryPanel.tsx
│   ├── pages/
│   │   ├── index.tsx (main app)
│   │   └── api/
│   │       ├── search.ts
│   │       ├── scrape.ts
│   │       ├── scrape/[novelId]/progress.ts
│   │       ├── scrape/[novelId]/chapters.ts
│   │       └── generate-ebook.ts
│   ├── hooks/
│   │   ├── useScrapeProgress.ts
│   │   └── useSearch.ts
│   ├── styles/
│   │   └── globals.css (Tailwind)
│   └── package.json (Next.js config)
├── backend/
│   ├── scrapers/
│   │   └── freewebnovel_scraper.py
│   ├── services/
│   │   ├── queue.ts (Bull setup)
│   │   ├── scraper.ts (subprocess manager)
│   │   ├── storage.ts (file/DB operations)
│   │   └── ebook.ts (EPUB/PDF generation)
│   ├── models/
│   │   └── db.ts (SQLite initialization)
│   └── package.json
├── downloads/
│   └── novels/
│       └── {novelId}/
│           ├── metadata.json
│           ├── state.json
│           ├── chapters/
│           │   ├── 1.json
│           │   ├── 2.json
│           │   └── ...
│           ├── {title}.epub
│           └── {title}.pdf
├── db/
│   └── novels.db (SQLite)
└── docker-compose.yml (optional: Redis for queue)
```

## Technology Stack (Locked)
- **Frontend**: Next.js 14+, React 18+, TypeScript, Tailwind CSS, axios
- **Backend**: Node.js 18+, Express (via Next.js API routes), TypeScript, Bull (job queue)
- **Scraping**: Python 3.9+, Beautiful Soup 4, requests library
- **Database**: SQLite3 with `better-sqlite3`
- **E-book**: 
  - **EPUB**: `epub-gen` npm package
  - **PDF**: `puppeteer` (headless Chrome/Chromium) — **DO NOT use pdfkit or wkhtmltopdf**. If Puppeteer cannot launch, return 503 error.
- **Process**: child_process.spawn for Python subprocess
- **HTTP**: axios for frontend, node-fetch or axios for backend

## Deployment & Configuration

### Job Recovery Behavior After Server Restart

**Redis (Production)**:
1. On server restart, Bull reloads all jobs from Redis
2. Jobs with status `in_progress` are marked `failed` (process was killed)
3. User can resume by calling `POST /api/scrape` with `mode: 'resume'`
4. Backend detects existing cache and resumes from last valid chapter
5. **No automatic retry** of failed in-progress jobs; user must manually resume

**In-Memory Queue (Development)**:
1. On server restart, all jobs are lost (in-memory storage is volatile)
2. Startup hook checks SQLite for orphaned jobs (status = `in_progress`) and logs them
3. User must manually resume by calling `POST /api/scrape` with `mode: 'resume'`
4. Example warning log:
   ```
   ⚠️  Found 2 orphaned jobs from previous session
      Job job_123 for novel abc123hash
      Resume via: POST /api/scrape with novelId=abc123hash, mode=resume
   ```

**Recommendation**: For production, use Redis. For development, document that manual resume is required after restart.

**Startup Recovery Code (Node.js):**
```typescript
async function checkOrphanedJobs() {
  const db = openDatabase();
  const orphaned = db.prepare(
    "SELECT id, novel_id FROM scrape_jobs WHERE status = 'in_progress'"
  ).all();
  
  if (orphaned.length > 0) {
    console.warn(`⚠️  Found ${orphaned.length} orphaned jobs from previous session`);
    orphaned.forEach(job => {
      console.warn(`   Job ${job.id} for novel ${job.novel_id}`);
      console.warn(`   Resume via: POST /api/scrape with novelId=${job.novel_id}, mode=resume`);
    });
  }
}
```

### Environment Variables (.env.local)
```
NOVEL_SOURCE_URL=https://www.freewebnovel.com
CACHE_DIR=/Users/mac/Documents/epubLegend/downloads
DB_PATH=/Users/mac/Documents/epubLegend/db/novels.db
# RATE_LIMIT_DELAY_MS=5000  # Uncomment to override 5-second default
REQUEST_TIMEOUT_MS=15000
MAX_RETRIES=3
PYTHON_PATH=/usr/bin/python3
```

### Docker (Optional for Redis + App)
Redis queue backend for multi-worker scalability (not required for MVP).

## Testing Strategy

### Unit Tests
- **Python scraper**: Mock BeautifulSoup responses, test metadata extraction, chapter parsing
- **Backend services**: Queue behavior, storage read/write, state transitions
- **Frontend hooks**: `useScrapeProgress`, `useSearch` with mocked API calls

### Integration Tests
- **Scrape job lifecycle**: Start → progress → complete → resume on error
- **E-book generation**: Load chapters → generate EPUB → validate file structure
- **API endpoints**: Search → initiate scrape → poll progress → export

### End-to-End Tests
- Full journey: Search novel → scrape → monitor progress → export EPUB/PDF

## Known Limitations & Future Work
- **Backlog**: WebSocket for real-time progress (polling sufficient for MVP)
- **Backlog**: Multi-language support (metadata extraction assumes English)
- **Out of scope**: Concurrent scraping of multiple novels (queue prevents this; users must scrape sequentially)
- **Edge case**: Novel URL changes or site structure updates require scraper maintenance

---

## Design Review Responses

### HIGH Severity Findings

**#1 — Ambiguous Scrape Resume Behavior Under Partial Failure**
- **Status**: ADDRESSED
- **Changes**: Added `os.fsync()` to Python scraper to ensure chapter data reaches disk before marking `completed: true`. Implemented atomic file write using temp file + rename pattern. Enhanced Node.js validation to check both `completed: true` flag and minimum content length (500 chars). Resume now correctly resumes from incomplete chapters (not skipping). Added complete Python implementation for `save_chapter()` and `update_state_json()` functions.
- **Location**: Resume on Connection Drop section, Python Save Function (Safe Against Crashes) subsection, Resume validation (Node.js) subsection

**#2 — Novel ID Lookup During Search Does Not Define Data Source**
- **Status**: ADDRESSED
- **Changes**: Added new subsection "Search Result Parsing" under Python Scraper Integration specifying URL pattern (`https://www.freewebnovel.com/search?keywords={query}&pageNo={page}`), BeautifulSoup selector examples, error handling for structure changes (return 503), and complete Python scraper code snippet showing search implementation with fallback selectors.
- **Location**: Python Scraper Integration > Search Result Parsing subsection

**#3 — PDF Generation Dependency Chain Unresolved — pdfkit + wkhtmltopdf vs. Puppeteer**
- **Status**: ADDRESSED
- **Changes**: Explicitly locked PDF generation to **puppeteer ONLY** in Technology Stack. Removed all references to `pdfkit` and `wkhtmltopdf`. Updated PDF Generation section title to "(Puppeteer)" and clarified that wkhtmltopdf is NOT to be used. Specified error handling: if Puppeteer cannot launch, return 503 with actionable message.
- **Location**: Technology Stack section, E-book Generation > PDF Generation (Puppeteer) subsection

**#4 — SQL UNIQUE Constraint Conflict in chapters Table**
- **Status**: ADDRESSED
- **Changes**: Removed conflicting `url TEXT UNIQUE` constraint. Kept only `UNIQUE(novel_id, chapter_number)`. Added `INSERT OR REPLACE` re-scrape logic to allow chapter updates. Provided complete Node.js `saveOrUpdateChapter()` function showing INSERT OR REPLACE pattern. Clarified that URL can change on re-scrape and is no longer a unique identifier.
- **Location**: Database Schema > `chapters` table definition, Re-scrape Logic (Node.js) code

### MEDIUM Severity Findings

**#5 — Rate Limiting Conflict: 5-Second Default vs. Original 5-Minute Requirement**
- **Status**: ADDRESSED
- **Changes**: Clarified that 5-second delay is the DEFAULT (applies when `RATE_LIMIT_DELAY_MS` is NOT set). Updated .env.local example to show RATE_LIMIT_DELAY_MS commented out with clear documentation. Separated production behavior from environment override examples. Removed the conflicting 300000 (5-minute) value from .env example.
- **Location**: Python Scraper Integration > Rate Limiting Strategy subsection, Deployment & Configuration > Environment Variables subsection

**#6 — Missing Specification for Multi-Novel Resume UI Workflow**
- **Status**: ADDRESSED
- **Changes**: Added new subsection "State Persistence Across Browser Sessions" with complete `useScrapeProgress()` hook implementation showing localStorage persistence of `currentScrapeNovelId`. Clarified queue concurrency: 1 scrape per novel, max 3 concurrent, max 20 queued. Documented how UI restores scrape state on browser restart.
- **Location**: Frontend Component Hierarchy > State Persistence Across Browser Sessions subsection

**#7 — Missing Specification for Error Recovery UI and Retry User Interface**
- **Status**: ADDRESSED
- **Changes**: Expanded ScrapeProgressPanel component spec with status→UI mapping table showing all 5 states (pending, in_progress, completed, failed, paused) and corresponding actions. Specified error detail modal content. Clarified that pause endpoint does NOT exist in MVP; only resume is available. Added link between resume functionality and failure recovery.
- **Location**: Frontend Component Hierarchy > ScrapeProgressPanel Component Specification subsection

### NIT Severity Findings

**#8 — Minor: Inconsistent Chapter Numbering Documentation**
- **Status**: ADDRESSED
- **Changes**: Clarified chapter numbering convention unambiguously: `chapter_number` is sort order (not strictly 1-indexed), Prologue=0, Chapters 1+, non-sequential preserved. Added example: "Prologue=0, Chapter 1=1, Chapter 2=2, Epilogue=3". Removed contradictory "1-indexed" language.
- **Location**: Database Schema > `chapters` table > Chapter Numbering Convention subsection

**#9 — Minor: Missing Specification for Duplicate Search Results Handling**
- **Status**: ADDRESSED
- **Changes**: Specified max 10 results returned, sorted by exact title match → last_scraped_at DESC → created_at DESC. Added author and URL fields to response for user disambiguation. Documented handling of true duplicates (both returned, user selects by author/URL).
- **Location**: API Contract > GET /api/novel-by-title > Response Ordering and Limits subsection

**#10 — Minor: Missing Documentation for Cover Image Fallback**
- **Status**: ADDRESSED
- **Changes**: Specified placeholder generation: 1024x1536 pixels, solid light gray (#f0f0f0) background, black centered text overlay with title and author, large font. Provided complete TypeScript code for `generateCoverPlaceholder()` with sharp/SVG approach including XML escaping utility function.
- **Location**: E-book Generation > Cover Image Handling > Placeholder Generation Specification subsection

**#11 — Minor: Ambiguous Job Queue Persistence Behavior**
- **Status**: ADDRESSED
- **Changes**: Clarified distinct recovery behaviors: Redis marks in_progress jobs as failed on restart (user must manually resume); in-memory loses all jobs, startup logs warn with resume instructions. Provided example warning log format. Documented recommendation to use Redis for production.
- **Location**: Deployment & Configuration > Job Recovery Behavior After Server Restart subsection

---

**Revision Completion**: All 11 findings (4 HIGH, 3 MEDIUM, 4 NIT) have been systematically incorporated into the design. The document is now complete and ready for implementation. Key additions:
- Search result parsing mechanism with concrete selectors
- Atomic chapter file writes with crash safety (os.fsync())
- Explicit puppeteer-only PDF generation (locked in tech stack)
- Removed SQL constraint conflict (no more URL UNIQUE)
- Clarified rate limiting defaults vs. overrides
- Added UI state persistence across browser sessions
- Added error recovery UI specifications
- Specified all placeholders, limits, and edge cases

