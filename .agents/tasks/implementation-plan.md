# Implementation Plan: epubLegend Scraper and E-book Generator

**Project Goal:** Build a full-stack web scraper for freewebnovel.com that extracts novels and chapters, generates EPUB/PDF e-books, supports resume on network disruption, and provides a search UI.

**Architecture:** Next.js 14 frontend + Express API (via Next.js routes) + Python Beautiful Soup scraper + SQLite database + Bull job queue + Puppeteer PDF generation.

**Critical Path:** Project init → Database schema → Python scraper → API foundation → Queue system → Frontend UI → E-book generation → Integration testing.

---

## Implementation Strategy

Work is decomposed into **7 independent features (FEATs)** that execute sequentially. Each FEAT:
- Leaves the codebase in a buildable state
- Has its own verification suite (unit + integration tests)
- Depends only on previous FEATs, not on future ones
- Is tracked in a separate FEAT JSON file under `/Users/mac/Documents/epubLegend/.agents/tasks/features/`

**Execution Flow:**
1. FEAT-001 (Project init) → 2. FEAT-002 (Python scraper) → 3. FEAT-003 (API foundation) → 4. FEAT-004 (Queue) → 5. FEAT-005 (Frontend) → 6. FEAT-006 (E-book generation) → 7. FEAT-007 (Integration tests) → Convergence loop (fixer + reviewer) → Merge to main.

---

## FEAT-001: Project Initialization

**Goal:** Set up Next.js workspace structure, TypeScript config, environment variables, SQLite schema, and directory scaffolding.

**Key Decisions:**
- **Monorepo with npm workspaces:** Root package.json manages frontend/ and backend/ as workspaces for shared dependencies.
- **SQLite over NoSQL:** Better for ACID guarantees (scrape job atomicity) and schema clarity. Use better-sqlite3 for synchronous access (simpler for job updates).
- **TypeScript everywhere (except Python):** Strict mode, path aliases (@frontend/*, @backend/*) for import clarity.
- **Locked tech stack from design:** Next.js 14, React 18, Tailwind CSS, Bull queue (in-memory for MVP), Puppeteer for PDF (NOT wkhtmltopdf).

**Steps (High-Level):**
1. Create root package.json with workspaces config, shared dev dependencies.
2. Create frontend/package.json with Next.js 14, React 18, TypeScript, Tailwind CSS, axios, sharp, epub-gen.
3. Create backend/package.json with Bull, better-sqlite3, axios, uuid, ts-node.
4. Create tsconfig.json at root with strict mode and path aliases.
5. Create .env.local with variables (NOVEL_SOURCE_URL, CACHE_DIR, DB_PATH, RATE_LIMIT_DELAY_MS commented out for 5s default).
6. Create .gitignore (exclude db/, downloads/, .env.local, node_modules/).
7. Create directory structure: frontend/{pages,components,hooks,styles,public}, backend/{services,scrapers,models}, db/, downloads/novels/.
8. Create SQLite schema: novels, chapters, scrape_jobs tables via backend/models/db.ts using better-sqlite3.
9. Create frontend/_app.tsx with AppContext provider and Tailwind CSS setup.
10. Create frontend/index.tsx as main app shell (placeholder components).
11. Create setup.sh to verify Python 3.9+, install pip dependencies (beautifulsoup4, requests), create db/ and downloads/ directories.

**Verification:**
- `npm install` succeeds without errors.
- `npm run build` compiles TypeScript and builds Next.js.
- `npm run dev` starts dev server on localhost:3000.
- SQLite schema initialized: db/novels.db exists with 3 tables.
- .env.local file exists with all required variables.

**Blocking Issues:** None (greenfield project).

**Estimated Effort:** Medium (boilerplate setup, ~2-3 hours).

---

## FEAT-002: Python Scraper Implementation

**Goal:** Create Beautiful Soup-based scraper for freewebnovel.com search and chapter extraction with atomic file writes and rate limit handling.

**Key Decisions:**
- **Beautiful Soup for HTML parsing:** Simple, reliable, no JavaScript rendering needed for freewebnovel.com.
- **Atomic file writes:** Use temp file + rename + os.fsync() to prevent corruption on crash (resume safety).
- **JSON stdout for subprocess communication:** Node.js reads JSON lines from Python stdout; simple protocol, no external libraries needed.
- **Graceful selector fallbacks:** If main selector fails, try alternatives (a.next → a[rel=next] → regex); don't raise on missing selector.
- **Rate limiting:** 5-second default delay (configurable via RATE_LIMIT_DELAY_MS env var); exponential backoff on HTTP 429.

**Steps (High-Level):**
1. Implement search_novels(query, page) using BeautifulSoup selectors (div.SearchResult, a.novel-title, span.author-name, img.cover-image, a.genre).
2. Implement extract_metadata(soup, novel_url) to extract title, author, description, cover, genre, status via meta tags.
3. Implement scrape_chapter(session, chapter_url) to GET, parse, extract chapter_title and next_chapter_url using fallback selectors.
4. Implement find_next_chapter_url(soup) with fallback chain (a.next → a[rel=next] → regex /chapter-\d+/ → None if complete).
5. Implement clean_chapter_content(raw_html) to remove scripts, styles, ads, author notes; convert relative URLs to absolute; preserve formatting.
6. Implement save_chapter(cache_dir, chapter_num, chapter_data) using atomic write (temp file + os.fsync() + rename).
7. Implement update_state_json(cache_dir, updates) to track last_chapter_scraped, last_chapter_valid, retry_count.
8. Create main scrape_novel(novel_id, start_chapter, cache_dir) function with argparse CLI.
9. Handle errors: network (retry), rate limit (exponential backoff), parse error (skip, continue), novel complete (exit 0).
10. Create pytest tests: mock BeautifulSoup responses, test metadata extraction, chapter parsing, atomic writes, rate limit backoff.

**Verification:**
- `python -m pytest backend/scrapers/test_freewebnovel_scraper.py -v` passes all tests.
- `python backend/scrapers/freewebnovel_scraper.py --help` shows all CLI options.
- Manual test: run with mock HTML, verify JSON stdout matches spec (type, chapter, wordCount, completed).

**Blocking Issues:** None (standalone module, only depends on FEAT-001 environment setup).

**Estimated Effort:** Medium-High (Beautiful Soup parsing, atomic writes, error handling, ~3-4 hours).

---

## FEAT-003: Backend API Foundation

**Goal:** Implement Express API routes (via Next.js API routes) for search, novel lookup, scrape initiation, and progress polling with input validation and error handling per the design API contract.

**Key Decisions:**
- **Input validation centralized in utils.ts:** Functions for query validation, novel ID format checking, format enum validation.
- **In-memory rate limiter for MVP:** Track requests by IP in Map<ip, {count, resetTime}>; Redis can be swapped in later.
- **Graceful error responses:** All errors return JSON with {success, error, code, retryAfter} for consistency.
- **SHA256 novel IDs:** Hash novel URL to create deterministic, collision-resistant ID; re-hashing same URL always produces same ID (important for resume logic).

**Steps (High-Level):**
1. Create storage.ts with SQLite functions: openDatabase(), saveNovel(), saveChapter(), getNovelById(), getNovelByTitle(), getChaptersByNovelId(), getScrapeJobStatus(), createScrapeJob(), updateScrapeJob().
2. Create utils.ts with: hashNovelUrl(), validateSearchQuery(), validateNovelId(), validateFormat(), estimateTimeRemaining(), getIpAddress().
3. Create ratelimit.ts with in-memory rate limiter and rateLimitMiddleware().
4. Create POST /api/search endpoint: validate query/page, spawn Python scraper subprocess, parse JSON results, return max 50 results or error 503 on parse failure.
5. Create GET /api/novel-by-title endpoint: validate query, search novels table, return max 10 results sorted (exact match, last_scraped_at DESC, created_at DESC).
6. Create GET /api/scrape/:novelId/progress endpoint: validate novelId, query scrape_jobs for most recent job, return status with percentComplete, estimatedSecondsRemaining, error (if failed).
7. Create GET /api/scrape/:novelId/chapters endpoint: validate novelId, fetch chapters sorted by chapter_number, return with wordCount totals.
8. Create middleware/error-handler.ts for centralized error handling.
9. Create unit tests: mock database queries, mock subprocess, test input validation, test rate limit responses, test error scenarios.

**Verification:**
- `npm run test -- frontend/pages/api/__tests__` passes all API tests.
- `npm run dev` starts server without errors.
- Validation test: POST /api/search with query >200 chars returns 400.
- Rate limit test: exceed 10 requests/minute to /api/search, 11th returns 429.
- Manual test: POST /api/search with valid query returns 200 (or 503 if scraper subprocess not ready).

**Blocking Issues:** Depends on FEAT-001 (database schema, environment setup).

**Estimated Effort:** Medium (API design, validation, error handling, ~2-3 hours).

---

## FEAT-004: Queue System and Job Management

**Goal:** Implement Bull job queue with in-memory adapter, prevent concurrent scrapes per novel, enforce global limits (3 max concurrent, 20 queue depth), and integrate Python scraper subprocess.

**Key Decisions:**
- **Bull with in-memory adapter for MVP:** No external Redis dependency, sufficient for single-server testing. Production deployment can switch to Redis.
- **One scrape per novel enforced:** Duplicate request returns 409 Conflict, prevents race conditions.
- **Global concurrency limits:** Max 3 concurrent jobs across all novels, max 20 jobs queued (prevents unbounded memory).
- **JSON stdout protocol:** Job processor reads chapter_complete, rate_limited, complete, error events from Python subprocess and updates DB after each event.
- **Chapter validation on resume:** Check completed flag AND content length >= 500 chars before skipping chapter.

**Steps (High-Level):**
1. Create queue.ts with Bull setup: in-memory adapter, jobProcessor function, enqueueScrapeJob() for duplicate detection and queue depth checking.
2. Implement jobProcessor: spawn Python subprocess, read JSON lines, handle event types (chapter_complete, rate_limited, complete, error), update scrape_jobs DB row after each event.
3. Implement validateCachedChapters(novelId): iterate cached chapters, return resume point (next valid chapter or incomplete chapter).
4. Create POST /api/scrape endpoint: parse request {novelId, mode}, validate novelId, call validateCachedChapters if resume, call enqueueScrapeJob(), return 202 or 409 or 503.
5. Implement job recovery on Node.js startup: query scrape_jobs for status='in_progress', log orphaned jobs warning with resume instructions.
6. Create unit tests: duplicate detection returns 409, queue depth returns 503, job processor updates DB on progress, validateCachedChapters returns correct resume point, startup logs orphaned jobs.

**Verification:**
- `npm run test -- backend/services/__tests__/queue.test.ts` passes all tests.
- Manual test: POST /api/scrape twice with same novelId, 2nd returns 409.
- Enqueue 20 jobs, 21st returns 503.
- Manually create cached chapters (1-42 complete, 43 incomplete), validateCachedChapters returns 43.

**Blocking Issues:** Depends on FEAT-001 (database) and FEAT-003 (API endpoints).

**Estimated Effort:** Medium-High (subprocess protocol, queue logic, resume validation, ~3-4 hours).

---

## FEAT-005: Frontend Components and UI

**Goal:** Implement React components for search, novel card display, progress tracking, export, and history with adaptive polling, localStorage persistence, and state management.

**Key Decisions:**
- **Context API for state management:** Simple, no Redux/Zustand needed for MVP; app state = {searchResults, currentScrape, history}.
- **Adaptive polling:** Start 1.5s interval, back off to 10s after 60s no update, alert after 300s no update.
- **localStorage for persistence:** currentScrapeNovelId survives page refresh/browser restart.
- **Tailwind CSS styling:** No CSS-in-JS, responsive grid/flexbox layout, mobile-first design.
- **Debounced search:** 300ms debounce on search input to avoid excessive API calls.

**Steps (High-Level):**
1. Create AppContext in frontend/_app.tsx with useAppState() hook providing {searchResults, currentScrape, history, startScrape, clearScrape, resumeScrape}.
2. Create useScrapeProgress() hook: accepts novelId, polls /api/scrape/:novelId/progress with adaptive interval, returns {progress, status, isLoading, error}.
3. Create useSearch() hook: debounced search input, fetches POST /api/search, handles validation errors and rate limit errors.
4. Create SearchPanel component: renders search input + results list + pagination, calls useSearch hook.
5. Create NovelCard component: renders cover image (fallback to placeholder), title, author, genre tags, status badge, Start Scrape button; on click POSTs /api/scrape.
6. Create ScrapeProgressPanel component: renders based on status (pending/in_progress/completed/failed/paused); shows progress bar, chapter counter, estimated time, error message; includes Resume button.
7. Create ExportPanel component: renders Export EPUB/PDF buttons (disabled if <3 chapters or status != completed); on click POSTs /api/generate-ebook, streams file download.
8. Create HistoryPanel component: renders previous scrapes with download links, delete option.
9. Create main index.tsx layout with SearchPanel, ScrapeProgressPanel, ExportPanel, HistoryPanel; responsive grid.
10. Style with Tailwind CSS: button hover states, input focus, progress bar animation, mobile breakpoints.
11. Create unit tests: component rendering, hook polling interval, localStorage persistence, button click events.

**Verification:**
- `npm run dev` starts server, http://localhost:3000 loads without errors.
- `npm run test -- frontend/__tests__` passes all component tests.
- Manual test: search input triggers API call after 300ms debounce.
- Manual test: click Start Scrape, ScrapeProgressPanel appears with Queued status.
- Manual test: refresh page while scrape in progress, ScrapeProgressPanel persists via localStorage.
- DevTools check: no console errors, responsive layout works on mobile.

**Blocking Issues:** Depends on FEAT-003 (API endpoints) and FEAT-004 (queue system); requires real API to fully test.

**Estimated Effort:** Medium (React components, hooks, state management, Tailwind styling, ~3-4 hours).

---

## FEAT-006: E-book Generation (EPUB and PDF)

**Goal:** Implement EPUB generation via epub-gen and PDF generation via Puppeteer with cover image handling, metadata, TOC, and error recovery.

**Key Decisions:**
- **epub-gen for EPUB generation:** Handles EPUB structure, metadata, TOC generation automatically.
- **Puppeteer for PDF generation:** Headless Chrome rendering, no OS-specific binary dependencies (unlike wkhtmltopdf), cross-platform compatible.
- **Cover image caching:** Download at scrape time, resize if >5MB to 1024x1536 pixels, generate text placeholder if download fails.
- **Minimum 3 chapters required:** Validate before generation, return 422 if insufficient.
- **Atomic PDF generation:** Use temp file to prevent incomplete output on error.

**Steps (High-Level):**
1. Create ebook.ts with functions: loadCachedChapters(), loadMetadata(), downloadAndCacheCover() with resize + fallback placeholder, validateChapters() (minimum 3), generateEpub(), generatePdf().
2. Implement downloadAndCacheCover(): fetch cover URL, check size, resize if >5MB using sharp, save to downloads/novels/{novelId}/cover.jpg; on error, generate placeholder (1024x1536 gray background with title/author text overlay).
3. Implement generateEpub(): load metadata, chapters, cover; create EpubGenerator instance; output to downloads/novels/{novelId}/{title}.epub; return file path.
4. Implement generatePdf(): load metadata, chapters, cover; build HTML with title page, TOC, chapters (each on new page); use Puppeteer to render HTML → PDF with page breaks, margins, print background; output to downloads/novels/{novelId}/{title}.pdf.
5. Implement buildPdfHtml(): construct HTML document with proper CSS styling (serif font, page breaks, margins), title page with cover, TOC, chapters with h2 titles; escape special characters.
6. Create POST /api/generate-ebook endpoint: validate {novelId, format}, check completedChapters >= 3, call generateEpub or generatePdf, return file stream with Content-Type and Content-Disposition headers; on error return 422/503.
7. Create comprehensive tests: generate EPUB and PDF with mock chapters, validate file structure (EPUB is zip, PDF is valid PDF), verify cover image resizing, verify placeholder generation on missing URL.

**Verification:**
- `npm run test -- backend/services/__tests__/ebook.test.ts` passes all tests.
- Manual test: generate EPUB, verify with `unzip -t downloads/novels/{testId}/*.epub` (no errors).
- Manual test: generate PDF, verify with `file downloads/novels/{testId}/*.pdf` (reports PDF document).
- Manual test: POST /api/generate-ebook with <3 chapters returns 422.
- Manual test: open generated EPUB in e-reader, verify chapters render correctly.
- Manual test: open generated PDF in PDF viewer, verify cover page, TOC, chapter page breaks.

**Blocking Issues:** Depends on FEAT-001 (database, storage) and FEAT-004 (queue to cache chapters); Puppeteer will auto-download Chromium (~150MB) on first use.

**Estimated Effort:** Medium (EPUB/PDF generation, cover handling, error scenarios, ~2-3 hours).

---

## FEAT-007: Integration Testing and Verification

**Goal:** Create comprehensive end-to-end test suite covering full workflows (search → scrape → resume → export), error recovery, rate limiting, and edge cases.

**Key Decisions:**
- **Mock-based testing:** Use jest.mock() for HTTP calls and subprocess communication; no live scraping of freewebnovel.com.
- **Test data fixtures:** Create realistic mock HTML (search results, chapter content with ads/notes), incomplete chapters, large files for resume testing.
- **Coverage target:** >80% for critical paths (API handlers, queue logic, storage, scraper).
- **Error scenarios:** Network drops, parse errors, rate limits, duplicate jobs, orphaned jobs, insufficient chapters.

**Steps (High-Level):**
1. Create tests/fixtures/mock-data.ts with reusable test data: mockSearchHtml (realistic search page), mockChapterHtml (chapter with content/ads/notes), mockNovelMetadata, mockJobProgress.
2. Create tests/setup.ts to initialize test environment: create temp db/downloads/ before tests, clear before each test, cleanup after.
3. Create tests/e2e/scrape-workflow.test.ts: test_search_returns_results, test_scrape_job_lifecycle, test_scrape_resume_after_interruption, test_scrape_handles_network_error, test_scrape_handles_rate_limit, test_export_epub_requires_3_chapters, test_export_pdf_generates_with_cover, test_export_pdf_fallback_on_puppeteer_unavailable.
4. Create tests/e2e/user-journey.test.ts: full workflow from search to export (search → scrape → poll → complete → export EPUB → refresh browser → history).
5. Create tests/e2e/error-recovery.test.ts: resume on network drop, resume validates cached chapters, retry on parse error, orphaned jobs on restart, duplicate job detection.
6. Create tests/e2e/rate-limiting.test.ts: search rate limit (10/min), queue depth limit (20), per-novel concurrency (1), global concurrency (3).
7. Create tests/e2e/novel-metadata.test.ts: deterministic novel ID generation (SHA256), exact title match in search, non-sequential chapter numbering.
8. Create tests/e2e/ebook-generation.test.ts: EPUB file is valid zip, EPUB contains metadata, EPUB chapters have formatting, PDF file is valid, PDF has cover page and TOC.
9. Create tests/README.md documenting test structure and how to run.
10. Create jest.config.js with test match patterns, coverage thresholds, module name mapper for path aliases.

**Verification:**
- `npm run test` executes all tests (unit + e2e) and reports >80% coverage.
- All integration tests pass (full workflow end-to-end).
- Coverage report shows backend/services >85%, backend/scrapers >80%, frontend/components >80%, frontend/hooks >80%.
- Manual workflow: search → scrape → wait for completion → export EPUB/PDF → verify files.
- Rate limit test: 11 search requests return 429 on 11th.
- Resume test: simulate network drop, verify resume from correct chapter.

**Blocking Issues:** Depends on all previous FEATs (001-006); only starts after integration with all modules complete.

**Estimated Effort:** Medium-High (comprehensive test coverage, mocking, edge cases, ~3-4 hours).

---

## Convergence Loop: Integration Verification + Code Review

### Fixer Step (max 2 iterations)

**Iteration 1 (no prior review):**
1. Run `npm run build` to compile all TypeScript.
2. Run `npm run test` to execute all unit and integration tests.
3. Check coverage report: must be >80% for critical paths.
4. Check for any failing tests or build errors.
5. Fix issues: missing imports, type errors, test failures, broken integrations between FEATs.
6. Re-run `npm run test` to verify fixes.
7. Document fixes and evidence in step output.

**Iteration 2 (if review finds issues):**
1. Read /Users/mac/Documents/epubLegend/.agents/tasks/verdict.json from reviewer.
2. For each finding with severity high/medium, implement fix.
3. For findings that change user-visible behavior: call send_message with severity 'warning', describe change, wait for user approval.
4. Re-run `npm run test` to verify all fixes.
5. Document what was fixed in step output.

### Reviewer Step (after all FEATs + fixer)

1. Read all FEAT-*.json files; verify status='completed' for each.
2. Review implementation against design document:
   - API contract matches specification (endpoints, request/response format, error codes).
   - Database schema correct (tables, constraints, indexes, re-scrape logic with INSERT OR REPLACE).
   - Python scraper complete (search, chapter parsing, atomic writes, rate limiting, error handling).
   - Queue system functional (duplicate detection, concurrency limits, job recovery on restart).
   - Frontend UI functional (search, scrape, progress, export, history, localStorage persistence).
   - E-book generation works (EPUB valid, PDF valid, cover handling, metadata embedded).
   - Integration tests comprehensive (>80% coverage, all workflows tested, error scenarios covered).
3. Check test output:
   - All tests pass (npm run test output shows 0 failures).
   - Coverage report shows >80% for backend/services, backend/scrapers, frontend/components, frontend/hooks.
   - No linting errors (if eslint configured).
4. Write verdict.json to /Users/mac/Documents/epubLegend/.agents/tasks/verdict.json:
   ```json
   {
     "verdict": "APPROVED" | "CHANGES_REQUESTED",
     "timestamp": "2024-01-15T10:30:00Z",
     "reviewer_notes": "All FEATs complete and tested. ...",
     "findings": [
       {
         "finding": "Coverage for backend/services is 78%, below 80% threshold",
         "severity": "high",
         "fix": "Add tests for error edge cases in queue.ts"
       }
     ],
     "coverage": {
       "backend_services": 0.84,
       "backend_scrapers": 0.82,
       "frontend_components": 0.85,
       "frontend_hooks": 0.83,
       "overall": 0.83
     }
   }
   ```
5. Call send_message with severity 'success' with verdict summary.

---

## Final Merge Step

1. Verify all FEAT-*.json files have status='completed'.
2. Verify verdict.json has verdict='APPROVED'.
3. Commit all local changes to main branch (or feature branch if using Git Flow).
4. Verify no uncommitted changes remain: `git status` should show clean working tree.
5. Output summary: List all 7 FEATs completed, >80% test coverage achieved, key deliverables (API endpoints, components, scraper, e-book generation), ready for deployment or further testing.

---

## Critical Path & Dependencies

```
FEAT-001 (Project init)
  ↓
FEAT-002 (Python scraper) + FEAT-003 (API foundation) [can run in parallel after 001]
  ↓
FEAT-004 (Queue system) [depends on 003 API structure]
  ↓
FEAT-005 (Frontend UI) [depends on 004 for scrape endpoint]
  ↓
FEAT-006 (E-book generation) [depends on 004 for cached chapters]
  ↓
FEAT-007 (Integration testing) [depends on all FEATs]
  ↓
Convergence Loop (Fixer + Reviewer)
  ↓
Merge to main
```

**Sequential Execution:** Each FEAT must complete before the next starts (no parallelization within the single worktree). Estimated total implementation time: 18-24 hours (depending on complexity encountered).

---

## Known Assumptions & Contingencies

1. **Beautiful Soup selectors:** Selectors (div.SearchResult, a.novel-title, etc.) are based on freewebnovel.com current structure as of design document. If site structure changes, selectors in FEAT-002 must be updated and tests re-run.

2. **Puppeteer Chromium download:** First `npm run build` or test will trigger auto-download of Chromium (~150MB). This is large but necessary; production deployments should pre-cache this artifact.

3. **Python 3.9+ requirement:** Project requires Python 3.9+. setup.sh verifies this; deployment must ensure Python available.

4. **In-memory queue for MVP:** Bull with in-memory adapter sufficient for single-server testing. Production should use Redis for persistence across restarts and multi-worker scaling. Code in FEAT-004 is abstracted so Redis can be swapped in via configuration.

5. **Rate limiting:** Default 5-second delay between requests (configurable). If freewebnovel.com implements stricter rate limiting, RATE_LIMIT_DELAY_MS can be increased or exponential backoff tuned in Python scraper.

6. **Resume atomicity:** Python scraper uses os.fsync() to ensure chapter data written to disk before marking completed. This is reliable on POSIX systems (macOS/Linux) and Windows NTFS; however, unusual filesystems or NFS mounts might not guarantee fsync safety. Standard production deployments (local SSD, ext4/APFS) are safe.

---

## Success Criteria

- [ ] All 7 FEATs complete with status='completed' in respective JSON files.
- [ ] Build succeeds: `npm run build` with no errors.
- [ ] Tests pass: `npm run test` shows >80% coverage, 0 failures.
- [ ] Dev server runs: `npm run dev` starts on localhost:3000 without errors.
- [ ] Manual workflow succeeds: search → scrape (with mock) → export → verify EPUB/PDF.
- [ ] Resume tested: simulate network drop, verify resume from correct chapter.
- [ ] Rate limiting tested: 11 requests return 429, queue depth limit returns 503.
- [ ] Code review approved: verdict.json shows verdict='APPROVED'.

---

**Document Version:** 1.0  
**Generated:** 2024-01-15  
**For:** Implementation workflow wf_1122b7209b91a4c6
