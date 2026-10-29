import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { updateScrapeState } from './storage';
import { validateNovelId } from './utils';

/**
 * In-memory queue for managing scrape jobs
 * Stores job info to track duplicates and status
 */
interface QueuedJob {
  id: string;
  novelId: string;
  mode: 'start' | 'resume';
  status: 'waiting' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  processId?: number;
  retryCount: number;
}

interface JobProcessorEvent {
  type: 'chapter_complete' | 'rate_limited' | 'complete' | 'error';
  chapter?: number;
  title?: string;
  wordCount?: number;
  error?: string;
}

// In-memory queue storage
const jobQueue: Map<string, QueuedJob> = new Map();
const novelToJobId: Map<string, string> = new Map(); // Track novelId -> jobId for duplicate detection
const activeJobs: Map<string, NodeJS.Timeout> = new Map(); // Track active job processes
const MAX_CONCURRENT_JOBS = 5; // Process up to 5 jobs concurrently
const MAX_QUEUE_DEPTH = 20; // Max 20 jobs in queue
let processingCount = 0;

/**
 * Check for existing queued or in-progress job for a novel
 */
function findExistingJob(novelId: string): string | undefined {
  return novelToJobId.get(novelId);
}

/**
 * Get current queue depth
 */
function getQueueDepth(): number {
  return Array.from(jobQueue.values()).filter(
    job => job.status === 'waiting' || job.status === 'in_progress'
  ).length;
}

/**
 * Enqueue a scrape job with duplicate detection
 */
export async function enqueueScrapeJob(
  novelId: string,
  mode: 'start' | 'resume' = 'start',
  resumeFromChapter: number = 1
): Promise<{ status: number; jobId: string; message?: string; estimatedWaitSeconds?: number; error?: string; code?: string }> {
  try {
    // Validate novelId
    validateNovelId(novelId);

    // Check for existing job
    const existingJobId = findExistingJob(novelId);
    if (existingJobId) {
      const existingJob = jobQueue.get(existingJobId);
      if (existingJob && (existingJob.status === 'waiting' || existingJob.status === 'in_progress')) {
        return {
          status: 409,
          jobId: existingJobId,
          message: 'Job already in progress',
          code: 'DUPLICATE_JOB',
        };
      }
    }

    // Check queue depth
    if (getQueueDepth() >= MAX_QUEUE_DEPTH) {
      return {
        status: 503,
        jobId: '',
        message: 'Queue full',
        code: 'QUEUE_FULL',
        error: 'Queue at maximum capacity',
      };
    }

    // Create new job
    const jobId = uuidv4();
    const job: QueuedJob = {
      id: jobId,
      novelId,
      mode,
      status: 'waiting',
      createdAt: Date.now(),
      retryCount: 0,
    };

    jobQueue.set(jobId, job);
    novelToJobId.set(novelId, jobId);

    // Create scrape job in database
    const { createScrapeJob } = await import('./storage');
    await createScrapeJob(novelId);

    // Estimate wait time based on queue depth
    const queueDepth = getQueueDepth();
    const estimatedWaitSeconds = Math.max(0, (queueDepth - 1) * 30); // ~30s per job

    // Process job asynchronously (don't await) - skip in tests
    if (process.env.NODE_ENV !== 'test') {
      setImmediate(() => {
        processJob(jobId, resumeFromChapter).catch(err => {
          console.error(`[Queue] Job ${jobId} processing failed:`, err);
        });
      });
    }

    return {
      status: 202,
      jobId,
      message: 'Scrape job queued',
      estimatedWaitSeconds,
    };
  } catch (error: any) {
    // Handle validation errors
    if (error.name === 'ValidationError' && error.statusCode) {
      return {
        status: error.statusCode,
        jobId: '',
        error: error.message,
        code: 'VALIDATION_ERROR',
      };
    }
    
    console.error('[Queue] Enqueue error:', error);
    return {
      status: 500,
      jobId: '',
      error: error.message,
      code: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Process a queued job
 */
async function processJob(jobId: string, resumeFromChapter: number): Promise<void> {
  const job = jobQueue.get(jobId);
  if (!job) {
    console.warn(`[Queue] Job ${jobId} not found`);
    return;
  }

  // Wait if too many jobs are processing
  while (processingCount >= MAX_CONCURRENT_JOBS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  processingCount++;

  try {
    job.status = 'in_progress';
    job.startedAt = Date.now();

    // Update database
    await updateScrapeState(jobId, {
      status: 'in_progress',
      started_at: Date.now(),
    });

    console.log(`[Queue] Starting job ${jobId} for novel ${job.novelId}`);

    // Spawn Python subprocess
    await spawnScrapeProcess(job, resumeFromChapter);

    job.status = 'completed';
    job.completedAt = Date.now();

    // Update database
    await updateScrapeState(jobId, {
      status: 'completed',
      completed_at: Date.now(),
    });

    console.log(`[Queue] Job ${jobId} completed`);
  } catch (error: any) {
    console.error(`[Queue] Job ${jobId} failed:`, error);
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = error.message;

    // Determine if error is retryable
    const isRetryable = error.retryable !== false && job.retryCount < 3;

    if (isRetryable) {
      const backoffMs = Math.pow(2, job.retryCount) * 2000; // 2s, 4s, 8s
      job.retryCount++;
      console.log(`[Queue] Job ${jobId} will retry in ${backoffMs}ms (attempt ${job.retryCount})`);

      setTimeout(() => {
        processJob(jobId, resumeFromChapter).catch(err => {
          console.error(`[Queue] Retry processing failed for ${jobId}:`, err);
        });
      }, backoffMs);
    } else {
      // Update database with error
      await updateScrapeState(jobId, {
        status: 'failed',
        completed_at: Date.now(),
        error_message: error.message,
      });
    }
  } finally {
    processingCount--;
  }
}

/**
 * Spawn Python scraper subprocess
 */
function spawnScrapeProcess(job: QueuedJob, resumeFromChapter: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cacheDir = path.join(
      process.cwd(),
      'downloads/novels',
      job.novelId
    );

    const pythonScriptPath = path.join(
      process.cwd(),
      'backend/scrapers/freewebnovel_scraper.py'
    );

    const args = [
      pythonScriptPath,
      '--novel-id', job.novelId,
      '--start-chapter', String(resumeFromChapter),
      '--cache-dir', cacheDir,
    ];

    const proc = spawn('python3', args, {
      timeout: 3600000, // 1 hour timeout
    });

    job.processId = proc.pid;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();

      // Process complete JSON lines
      const lines = stdout.split('\n');
      stdout = lines.pop() || ''; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as JobProcessorEvent;
          handleJobEvent(job, event).catch(err => {
            console.error(`[Queue] Error handling event for job ${job.id}:`, err);
          });
        } catch (e) {
          console.warn(`[Queue] Failed to parse job output: ${line}`, e);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      console.log(`[Queue] Job ${job.id} stderr:`, data.toString());
    });

    proc.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Python scraper exited with code ${code}: ${stderr}`);
        (error as any).retryable = code !== 1; // Exit code 1 is typically parse error, not retryable
        reject(error);
      }
    });

    proc.on('error', (err: Error) => {
      const error = new Error(`Failed to spawn scraper process: ${err.message}`);
      (error as any).retryable = true;
      reject(error);
    });

    // Store cleanup timer
    const timeoutId: NodeJS.Timeout = setTimeout(() => {
      if (!proc.killed) {
        proc.kill();
        reject(new Error('Scraper process timeout'));
      }
    }, 3600000); // 1 hour

    activeJobs.set(job.id, timeoutId);
  });
}

/**
 * Handle events from job processor
 */
async function handleJobEvent(job: QueuedJob, event: JobProcessorEvent): Promise<void> {
  const { updateScrapeState } = await import('./storage');

  switch (event.type) {
    case 'chapter_complete':
      // Update progress in database
      if (event.chapter) {
        await updateScrapeState(job.id, {
          completed_chapters: event.chapter,
          last_chapter_scraped: event.chapter,
        });
        console.log(
          `[Queue] Job ${job.id} progress: ${event.chapter} chapters (${event.title})`
        );
      }
      break;

    case 'rate_limited':
      console.log(`[Queue] Job ${job.id} rate limited, resuming...`);
      break;

    case 'complete':
      console.log(`[Queue] Job ${job.id} scraping complete`);
      break;

    case 'error':
      console.error(`[Queue] Job ${job.id} scraper error: ${event.error}`);
      throw new Error(event.error || 'Unknown scraper error');
  }
}

/**
 * Validate cached chapters for resume logic
 * Returns the chapter number to resume from
 */
export async function validateCachedChapters(novelId: string): Promise<number> {
  const fs = await import('fs');
  const path_module = await import('path');

  try {
    validateNovelId(novelId);

    const chapterDir = path_module.join(
      process.cwd(),
      'downloads/novels',
      novelId,
      'chapters'
    );

    // If no cache directory exists, start from chapter 1
    if (!fs.existsSync(chapterDir)) {
      console.log(`[Queue] No cache found for ${novelId}, starting from chapter 1`);
      return 1;
    }

    // Read chapter files
    const files = fs.readdirSync(chapterDir);
    const chapterFiles = files
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('.json', ''), 10);
        const numB = parseInt(b.replace('.json', ''), 10);
        return numA - numB;
      });

    if (chapterFiles.length === 0) {
      console.log(`[Queue] No valid chapters found for ${novelId}, starting from chapter 1`);
      return 1;
    }

    // Check each chapter in order
    for (const file of chapterFiles) {
      const filePath = path_module.join(chapterDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Check if completed and has sufficient content
      if (data.completed !== true || !data.content || data.content.length < 500) {
        const chapterNum = parseInt(file.replace('.json', ''), 10);
        console.log(
          `[Queue] Found incomplete chapter ${chapterNum} for ${novelId}, resuming from there`
        );
        return chapterNum;
      }
    }

    // All chapters valid, resume from next chapter
    const lastChapter = parseInt(chapterFiles[chapterFiles.length - 1].replace('.json', ''), 10);
    const resumeFrom = lastChapter + 1;
    console.log(
      `[Queue] All ${lastChapter} chapters valid for ${novelId}, resuming from chapter ${resumeFrom}`
    );
    return resumeFrom;
  } catch (error: any) {
    console.error(`[Queue] Error validating cached chapters for ${novelId}:`, error);
    return 1; // Default to start from beginning on error
  }
}

/**
 * Check for orphaned jobs on startup
 */
export async function checkOrphanedJobs(): Promise<void> {
  try {
    const { initDb } = await import('../models/db');
    const db = await initDb();

    // Query for orphaned jobs (status='in_progress' but no active process)
    const stmt = db.prepare(`
      SELECT id, novel_id FROM scrape_jobs
      WHERE status = 'in_progress'
    `);

    const orphanedJobs: Array<{ id: string; novel_id: string }> = [];

    while (stmt.step()) {
      orphanedJobs.push(stmt.getAsObject() as any);
    }
    stmt.free();

    if (orphanedJobs.length === 0) {
      return;
    }

    console.warn(`⚠️  Found ${orphanedJobs.length} orphaned job(s) on startup:`);
    orphanedJobs.forEach(job => {
      console.warn(`  - Job ID: ${job.id}, Novel ID: ${job.novel_id}`);
    });
    console.warn('Resume via: POST /api/scrape with novelId=..., mode=resume');

    // Mark orphaned jobs as paused
    for (const job of orphanedJobs) {
      const updateStmt = db.prepare(`
        UPDATE scrape_jobs SET status = 'paused' WHERE id = ?
      `);
      updateStmt.bind([job.id]);
      updateStmt.step();
      updateStmt.free();
    }

    // Save database
    const { saveDatabase } = await import('../models/db');
    saveDatabase();
  } catch (error: any) {
    console.error('[Queue] Error checking orphaned jobs:', error);
  }
}

/**
 * Get job status
 */
export function getJobStatus(jobId: string): QueuedJob | undefined {
  return jobQueue.get(jobId);
}

/**
 * Get all active jobs
 */
export function getActiveJobs(): QueuedJob[] {
  return Array.from(jobQueue.values()).filter(
    job => job.status === 'waiting' || job.status === 'in_progress'
  );
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const job = jobQueue.get(jobId);
  if (!job) return;

  if (job.processId) {
    process.kill(job.processId);
  }

  const timer = activeJobs.get(jobId);
  if (timer) {
    clearTimeout(timer);
    activeJobs.delete(jobId);
  }

  job.status = 'failed';
  job.error = 'Job cancelled';

  await updateScrapeState(jobId, {
    status: 'failed',
    error_message: 'Job cancelled',
  });
}
