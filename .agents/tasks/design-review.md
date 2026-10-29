# Design Review: E-book Scraper Architecture

**Design Document**: `/Users/mac/Documents/epubLegend/.agents/tasks/architecture-design.md`  
**Review Date**: 2024  
**Reviewer**: Design Review Subagent  
**Verdict**: See verdict JSON for final determination

---

## Methodology

This review checks the design document fresh, independent of implementation context. We verify:
1. Ambiguities that allow multiple valid interpretations
2. Unverified assumptions against actual source systems
3. Missing operational details and error specifications
4. Feasibility gaps and scope boundaries
5. Conflicting statements within the document

---

## Findings

### 1. HIGH: Unverified BeautifulSoup Selectors May Not Match freewebnovel.com HTML

**Problem**  
The design specifies BeautifulSoup selectors for parsing search results and chapters:
- Search result container: `div.SearchResult` or `div.novel-item`
- Next chapter link: `a.next`, `a[rel="next"]`, or href pattern matching
- Metadata: `meta[property="og:title"]`, `span.author-name`, etc.

These selectors are stated as "confirmed selectors; update if HTML structure changes" but no evidence is provided that they actually exist on the live freewebnovel.com site. If the site uses JavaScript-heavy rendering, different class names, or a different DOM structure, all chapter and search discovery will fail silently or with cryptic parse errors.

**Location**  
- Python Scraper Integration > Search Result Parsing > BeautifulSoup Selectors
- Python Scraper Integration > Chapter Discovery Algorithm
- E-book Generation > Metadata Extraction via Beautiful Soup

**Risk**  
- Silent failures: selectors find no elements, chapter count stays 0, user sees incomplete scrape
- Not caught by code review; only discovered at runtime on live site
- Maintenance burden: every site HTML update requires scraper changes

**Concrete Fix**  
Before implementation begins, create a test harness that:
1. Downloads a single search results page from freewebnovel.com/search with a popular query
2. Attempts parsing with each selector in the design
3. Logs which selectors succeed/fail and actual class names found
4. Validates that at least one novel is extracted with title, author, URL, cover
5. Downloads a chapter page and validates chapter content extraction

Add this test harness path and results to the design as a prerequisite. Document the actual selectors used (not speculative ones). Specify fallback behavior if selectors fail: return 503 error with "Search structure changed; manual update required" message.

---

### 2. HIGH: Resume Logic Race Condition — Partial Write During Chapter Save

**Problem**  
The design specifies atomic writes using temp file + rename and `os.fsync()` to prevent corruption on crash. However, the implementation has a subtle race condition:

```python
# In save_chapter():
1. Write to temp file
2. os.fsync()
3. os.rename(temp_file, ch_file)  # Atomic
4. update_state_json()  # SEPARATE call — not atomic!
```

If the process crashes between step 3 and 4, the chapter is written to disk but `state.json` still shows `"last_chapter_valid": false` or `"last_chapter_scraped": old_number`. On resume, the validation logic will see the incomplete state and either:
- Attempt to re-download the chapter (duplicate content)
- Skip the chapter and miss content

Additionally, the validation function checks for `completed: true` flag in chapter JSON, but the code provided sets `completed: False` during write and never updates it to `true` after the atomic rename.

**Location**  
- Error Handling & Resilience > Resume on Connection Drop
- Python Scraper Integration > Python Save Function (Safe Against Crashes)

**Risk**  
- Duplicate chapters or missing chapters on resume after crash
- State file becomes inconsistent with actual chapters on disk
- Validation logic cannot reliably determine where to resume

**Concrete Fix**  
1. **Set `completed: true` BEFORE the atomic rename**, not after:
   ```python
   # Write to temp file with completed: False
   with open(temp_file, 'w') as f:
       json.dump({...,'completed': False}, f)
       f.flush()
       os.fsync(f.fileno())
   
   # NOW update state FIRST and sync
   update_state_json(cache_dir, {'last_chapter_valid': True, 'last_chapter_scraped': chapter_num})
   
   # THEN atomic rename
   os.rename(temp_file, ch_file)
   
   # After rename, write completed: true to the finalized file
   with open(ch_file, 'r+') as f:
       data = json.load(f)
       data['completed'] = True
       f.seek(0)
       json.dump(data, f)
       f.flush()
       os.fsync(f.fileno())
   ```

2. **Alternatively, simplify**: Remove the `completed` flag entirely. Treat file existence as proof of completion. The `state.json` becomes the source of truth for validation. Update resume validation to use `last_chapter_valid` flag, not the flag inside chapter JSON.

---

### 3. HIGH: Chapter Validation Missing Edge Case — Non-Sequential Chapter Numbers

**Problem**  
The design states chapters may be non-sequential (e.g., 1, 5, 10 if the novel skips or has special chapters). The validation function iterates through chapter files in numerical order:

```typescript
for (const chFile of chapters.sort((a, b) => parseInt(a) - parseInt(b))) {
  if (!isValid) {
    return parseInt(chFile);  // Resume from here
  }
}
```

This assumes chapter file numbers are contiguous after sorting. But if a novel has chapters 1, 2, 10, 15, and chapter 10 is incomplete, the function will resume from chapter 10. The scraper will then attempt to download chapter 11, 12, 13, 14 in sequence, which may not exist. The scraper's chapter discovery algorithm (following "next chapter" links) will fail if chapters 11–14 are not present on the site.

**Location**  
- Error Handling & Resilience > Resume validation (Node.js)
- Database Schema > Chapter Numbering Convention

**Risk**  
- Resume assumes sequential chapter numbers, but data schema explicitly allows non-sequential
- Scraper may attempt to scrape non-existent chapters and get stuck in retry loops

**Concrete Fix**  
1. **Store the actual next chapter URL in state.json**, not just the chapter number:
   ```json
   {
     "last_chapter_scraped": 10,
     "last_chapter_url": "https://freewebnovel.com/novel/xyz/chapter-11",
     "last_chapter_valid": true
   }
   ```

2. **Python scraper uses the stored URL to resume**, not numeric increment:
   ```python
   if resume_url:
       next_chapter_url = resume_url
   else:
       next_chapter_url = get_initial_chapter_url(novel_page)
   
   while next_chapter_url:
       chapter_data = scrape_chapter(next_chapter_url)
       ...
       next_chapter_url = find_next_chapter_link(chapter_data)
   ```

3. **Update resume validation** to return the stored URL, not the chapter number.

---

### 4. HIGH: Insufficient Specification of Chapter Discovery Termination

**Problem**  
The design states "If still not found, novel is complete" for chapter discovery, but the Python scraper code provided does not implement this termination logic explicitly. The while loop:

```python
chapter_num = start_chapter
while True:
    try:
        chapter_data = scrape_chapter(session, novel_id, chapter_num, cache_dir)
        if not chapter_data:
            break
```

assumes `scrape_chapter()` returns falsy when no chapter is found. But the implementation is not shown. Questions:
- Does `scrape_chapter()` return `None` when a 404 occurs, or does it raise an exception?
- How is the "next chapter URL not found" condition communicated to the caller?
- Does the scraper stop immediately or retry multiple times?

If `scrape_chapter()` silently returns empty dict `{}` or similar, the loop may not terminate correctly.

**Location**  
- Python Scraper Integration > Chapter Discovery Algorithm
- Python Scraper Integration > Python Script (High-Level)

**Risk**  
- Scraper hangs or runs indefinitely if termination logic is ambiguous
- Novel scrape appears stuck, user sees 0% progress for hours

**Concrete Fix**  
Specify the exact `scrape_chapter()` signature and return values:
```python
def scrape_chapter(session, novel_url) -> Optional[dict]:
    """
    Scrape a single chapter from the given URL.
    
    Returns:
        dict with keys: {
            'chapter_number': int,
            'title': str,
            'content': str,
            'url': str,
            'next_chapter_url': str or None  # URL of next chapter, or None if this is the last
        }
        or None if:
        - URL returns 404
        - URL is not a valid chapter page (missing content selectors)
        - Network error after max retries
    
    Raises:
        CriticalError: if non-recoverable error (e.g., auth required)
    """
```

And clarify termination:
```python
next_url = initial_chapter_url
while next_url:
    chapter_data = scrape_chapter(session, next_url)
    if chapter_data is None:
        print(json.dumps({'type': 'chapter_not_found', 'url': next_url}))
        break
    
    # Save, emit progress
    next_url = chapter_data.get('next_chapter_url')  # None = last chapter
```

---

### 5. MEDIUM: Ambiguous Error Handling for Search Parse Failures

**Problem**  
The design states: "If HTML structure changes and selectors fail to find results, return HTTP 503." But there is no specification for partial parse failures. What if:
- Selector finds 50 results, but 30% are missing author field?
- 1 out of 50 results fails to parse (malformed HTML in one search result)?
- All 50 results fail to extract cover image (selector changed)?

Should the endpoint:
- Return partial results (30 of 50 novels)?
- Return 503 error (reject the entire response)?
- Return partial results + warning field?

**Location**  
- Python Scraper Integration > Search Result Parsing > Error Handling
- API Contract > POST /api/search > Error Response

**Risk**  
- Inconsistent behavior: sometimes users see partial results, sometimes errors
- Frontend logic may not handle "partial success" responses

**Concrete Fix**  
Define explicit thresholds and responses:

1. **Parse success threshold**: If >= 80% of search results parse successfully, return 200 with partial results. Log parse failures to stderr.
2. **Partial success response** (200):
   ```json
   {
     "success": true,
     "results": [ /* 40 successful results */ ],
     "totalResults": 40,
     "warnings": [
       "3 results failed to parse (malformed HTML)",
       "7 results missing author field (null substituted)"
     ],
     "page": 1
   }
   ```
3. **Parse failure threshold**: If < 80% of results parse, return 503 "Structural changes detected."
4. **All results fail**: Return 503 immediately.

Implement a parse counter in the scraper:
```python
success_count = 0
for result in soup.select(...):
    try:
        novel = parse_result(result)
        results.append(novel)
        success_count += 1
    except Exception as e:
        parse_errors.append(str(e))

if success_count / len(results_found) < 0.8:
    raise StructureChangeError()
```

---

### 6. MEDIUM: Queue Duplicate Detection Race Condition

**Problem**  
The queue deduplication logic shown:

```typescript
const existingJob = await queue.getJobs(['in_progress', 'waiting']);
const duplicate = existingJob.find(job => job.data.novelId === novelId);

if (duplicate) {
  return { status: 409, jobId: duplicate.id };
}

const job = await queue.add({ novelId, mode, retryCount: 0 });
```

has a classic race condition: between the `find()` check and the `queue.add()` call, another concurrent request could enqueue the same novel, resulting in two jobs for the same novelId.

**Location**  
- Queue System Design > In-Memory Queue (Bull + Redis Alternative) > Queue Duplicate Detection (Node.js)

**Risk**  
- Two concurrent scrape requests for the same novel can bypass deduplication
- User sees 409 conflict on retry, but scrapers are already running

**Concrete Fix**  
Use Bull's built-in job key feature or atomic check-then-add:

```typescript
// Option 1: Bull job key (prevents duplicates at queue level)
const job = await queue.add(
  { novelId, mode, retryCount: 0 },
  { jobId: `scrape:${novelId}` }  // Unique key per novelId
);
// Bull automatically returns existing job if key already exists

// Option 2: Atomic check in a Bull event handler
queue.on('before:add', async (job) => {
  const existing = await queue.getJobs(['in_progress', 'waiting'], 0, -1);
  if (existing.find(j => j.data.novelId === job.data.novelId)) {
    throw new Error('Duplicate job');
  }
});
```

Document which approach will be used in implementation.

---

### 7. MEDIUM: Missing Specification for Job Timeout and Stalled Job Recovery

**Problem**  
The design specifies "Job timeout: 5 hours per novel" but does not specify:
- What happens when a job times out? (marked failed? requeued?)
- How are stalled jobs (started but no progress updates) detected?
- What is the "stalled" timeout threshold?
- Should stalled jobs be automatically recovered, or requires user resume?

In Bull, stalled jobs are moved back to "waiting" queue after a lockRenewal failure. But the design does not clarify this behavior.

**Location**  
- Queue System Design > In-Memory Queue > Key Properties (job timeout line)
- Error Handling & Resilience > Retry Strategy (no mention of stalled jobs)

**Risk**  
- Long-running scrapes at 4:50 hours may timeout unexpectedly
- Stalled jobs silently sit in queue, user unaware
- No clear UX guidance for timeouts

**Concrete Fix**  
Add to Queue System Design:

```
**Job Stalled Behavior**:
- Bull considers a job "stalled" if lockRenewal (heartbeat) fails for 30 seconds
- Stalled jobs are moved back to "waiting" queue
- Max stalls: 2 (Bull default). After 2 stalls, job is marked failed
- Failed job shows error message to user: "Scrape interrupted. Click Resume to continue."

**Timeout Behavior**:
- If job exceeds 5 hours: marked failed
- state.json preserves last_chapter_scraped
- On user resume: validator checks cache, resumes from checkpoint

**No automatic retry**: Stalled/timeout jobs require explicit user action to resume.
```

---

### 8. MEDIUM: Ambiguous PDF Generation Fallback — No Alternative Specified

**Problem**  
The design states: "If Puppeteer cannot launch, return 503 error." But users who encounter this error have no alternative. They cannot generate PDFs at all. The design mentions EPUB as an alternative, but the endpoint `/api/generate-ebook` only accepts one `format` at a time.

The error message says "Try EPUB export instead" but the design does not allow batch export (EPUB + PDF together). User must run generation twice, which is inefficient.

**Location**  
- E-book Generation > PDF Generation (Puppeteer) > Error Handling
- API Contract > POST /api/generate-ebook

**Risk**  
- Users may abandon the app if PDF export fails
- No graceful degradation or workaround documented

**Concrete Fix**  
This is a scope decision for implementation. Document the choice:

**Option A (Current)**: PDF generation is all-or-nothing. If Puppeteer fails, return 503. Users must use EPUB only.
- Pro: Simple implementation
- Con: No fallback for users who need PDF

**Option B (Recommended)**: Allow batch export of both EPUB and PDF in a single request:
```json
POST /api/generate-ebook
{
  "novelId": "...",
  "formats": ["epub", "pdf"]  // Can request one or both
}

Response: Zip file containing both formats, or available formats if one fails
```

**Option C (Quick fallback)**: If Puppeteer fails, generate EPUB only and return message "PDF generation unavailable, EPUB included instead."

Choose one and document it explicitly in the API contract.

---

### 9. MEDIUM: Rate Limiting Defaults Conflict with Original 5-Minute Requirement

**Problem**  
Original user request (message #2) implied a 5-minute tolerance for scrape completion. The design now defaults to 5-second rate-limiting delay between requests. For a novel with 500 chapters:
- At 5-second delays: 500 chapters × 5s = 2500 seconds ≈ 42 minutes (exceeds 5-minute requirement)
- At 2-second delays: 500 chapters × 2s = 1000 seconds ≈ 17 minutes (exceeds 5-minute requirement)

The design notes this is configurable via `RATE_LIMIT_DELAY_MS`, but the default 5 seconds means users will almost never meet a 5-minute scrape window unless the novel is very short (<60 chapters).

**Location**  
- Python Scraper Integration > Rate Limiting Strategy
- Deployment & Configuration > Environment Variables

**Risk**  
- Original requirement (5-minute window) is not achievable with defaults
- Users may misunderstand what "5 minutes" means (it was in original request; design now interprets it as "tolerate up to 5 minutes without progress")

**Concrete Fix**  
Clarify the original requirement's intent. The design says:
> "5 mins if such length is needed" — interpreted as tolerance window for progress monitoring

If the intent was to scrape any novel in 5 minutes, that's infeasible with respectful rate limiting. If the intent was to tolerate 5 minutes without progress updates before showing an alert, then the design is correct (frontend shows alert at 300s).

Document explicitly:
```
**Rate Limiting & Scrape Duration**:

- Default delay between requests: 5 seconds (respects server load)
- Novels with N chapters take approximately: N × 5 seconds + overhead
- Example: 100-chapter novel ≈ 8–10 minutes; 500-chapter novel ≈ 40–50 minutes
- This is normal and acceptable; no acceleration recommended

**Original "5-minute requirement" interpretation**: 
Frontend tolerates up to 5 minutes without progress update before alerting user to check network.
This is implemented in adaptive polling (backs off to 10s, alerts at 300s).

**If faster scraping needed**: Reduce `RATE_LIMIT_DELAY_MS` to 2000 or 1000ms (risky; may trigger server rate-limiting).
```

---

### 10. NIT: Novel ID Generation Not Deterministic for URL Variants

**Problem**  
Novel ID is computed as `SHA256(novel_url)`. But URLs can have variants:
- `https://www.freewebnovel.com/solo-leveling.html`
- `https://freewebnovel.com/solo-leveling.html` (no www)
- `https://www.freewebnovel.com/solo-leveling.html?ref=source` (query param)

Each variant produces a different hash. If the API normalizes URLs before hashing but search results return non-normalized URLs, a user could see the same novel twice with different novelIds.

**Location**  
- Database Schema > `novels` table > Novel ID Generation

**Risk**  
- Duplicate novels in cache with different novelIds but same content
- Resume workflow fails if user searches for novel and gets different novelId

**Concrete Fix**  
Specify URL normalization rules:
```typescript
function normalizeNovelUrl(url: string): string {
  const parsed = new URL(url);
  // Force www subdomain
  if (!parsed.hostname.startsWith('www')) {
    parsed.hostname = 'www.' + parsed.hostname;
  }
  // Remove query params and fragments
  parsed.search = '';
  parsed.hash = '';
  // Remove trailing slash for consistency
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString();
}

function computeNovelId(url: string): string {
  const normalized = normalizeNovelUrl(url);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

Apply this normalization to all novel URLs before hashing.

---

### 11. NIT: Missing Specification for Cover Image Caching Cache Invalidation

**Problem**  
Cover images are downloaded once at scrape time and cached. But if a user re-scrapes a novel weeks later, the cached cover is reused without checking if it has been updated on the site.

The design does not specify:
- Should cover be re-downloaded on re-scrape? (Yes/No/Only if metadata changed?)
- When should cached cover be invalidated?
- How long is cover cache valid?

**Location**  
- E-book Generation > Cover Image Handling

**Risk**  
- Stale cover images if site updates novel cover
- No user control over cover update

**Concrete Fix**  
Add explicit rule:

```
**Cover Image Caching**:
- Downloaded at initial scrape time
- Cached at `/downloads/novels/{novelId}/cover.jpg`
- On re-scrape: only download cover if metadata.last_updated > cached_at, or if force-refresh flag is set
- Manual refresh: add query param to generate-ebook endpoint: `POST /api/generate-ebook?refresh_cover=true`
```

Or simpler (for MVP):
```
- Download cover only once at initial scrape
- On re-scrape: preserve existing cover (do not re-download)
- If user wants to refresh cover: delete cache manually or provide a "Clear cover" button
```

---

## Verified Assumptions

1. ✓ **Beautiful Soup 4 can parse HTML**: Standard library, no auth required. Site is publicly accessible.
2. ✓ **Bull job queue is suitable for MVP**: Widely used, well-documented, in-memory backend sufficient for single-machine.
3. ✓ **Next.js API routes can spawn Python subprocesses**: `child_process.spawn()` is standard and well-supported.
4. ✓ **SQLite with better-sqlite3 is suitable backend**: Widely used, sufficient for this workload (no millions of records expected).
5. ✓ **Puppeteer can render HTML → PDF**: Production-ready library, used by major projects.
6. ✓ **React Context + hooks for state management**: Standard React patterns, suitable for single-page app scope.
7. ✓ **Filesystem caching for chapters and metadata**: No external service dependency, portable, human-readable JSON.
8. ✓ **axios for HTTP requests**: Lightweight, widely used, good error handling.

---

## Unverified/Wrong Assumptions

1. ⚠️ **Assumption: freewebnovel.com has stable, predictable HTML selectors**
   - **Unverified**: No actual HTML snapshots or selector testing provided
   - **Risk**: All chapter/search parsing could fail if site HTML changes
   - **Mitigation**: Test selectors against live site before implementation

2. ⚠️ **Assumption: Python scraper can cleanly exit with empty next-chapter URL**
   - **Unverified**: `scrape_chapter()` behavior on novel completion not fully specified
   - **Risk**: Scraper hangs or crashes if termination logic is ambiguous
   - **Mitigation**: Specify exact return values and edge cases

3. ⚠️ **Assumption: freewebnovel.com returns HTTP 429 for rate-limiting**
   - **Unverified**: Site behavior under rate limits not confirmed
   - **Risk**: If site blocks with IP ban or CAPTCHA instead, retry logic fails
   - **Mitigation**: Monitor live scraping for actual rate-limit responses

4. ⚠️ **Assumption: Atomic file rename prevents corruption on all filesystems**
   - **Context-dependent**: Works on ext4, NTFS, APFS. May not work on network filesystems (NFS)
   - **Risk**: If cache dir is mounted NFS, atomic rename is not atomic
   - **Mitigation**: Document filesystem requirements; consider flock-based locking if network storage used

5. ❌ **WRONG: Chapter completion atomicity is guaranteed with current implementation**
   - **Actual**: Race condition exists between chapter file write and state.json update (see Finding #2)
   - **Mitigation**: Fix by reordering operations or simplifying completion logic

---

## Summary of Issues by Severity

| Severity | Count | Blockers |
|----------|-------|----------|
| HIGH | 4 | YES — must resolve before implementation |
| MEDIUM | 5 | YES — design is incomplete without clarity |
| NIT | 2 | NO — can proceed but should document choices |

---

## Recommendation

**The design is not ready for implementation.** There are 4 HIGH-severity findings and 5 MEDIUM-severity findings that must be resolved:

1. **Highest priority**: Verify BeautifulSoup selectors against live freewebnovel.com (Finding #1)
2. **Second priority**: Fix resume race condition and chapter validation logic (Findings #2, #3, #4)
3. **Third priority**: Clarify error handling, queue deduplication, and PDF fallback (Findings #5, #6, #8)

Loop back with clarifications and test results before proceeding to implementation.

---

## Acknowledgment

The design document demonstrates strong overall structure and comprehensive API specification. The issues identified are specific edge cases, unverified assumptions, and incomplete error paths—not fundamental architectural flaws. With the fixes noted above, this design is sound and implementable.
