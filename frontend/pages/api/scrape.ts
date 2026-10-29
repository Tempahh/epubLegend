import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Dynamically import at runtime to avoid webpack bundling issues
async function getServices() {
  const storageModule = await import(path.join(process.cwd(), 'backend/services/storage'));
  const validationModule = await import(path.join(process.cwd(), 'backend/services/utils'));
  const queueModule = await import(path.join(process.cwd(), 'backend/services/queue'));
  return { storageModule, validationModule, queueModule };
}

interface ScrapeRequest {
  novelId: string;
  mode?: 'start' | 'resume';
}

interface ScrapeResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  estimatedWaitSeconds?: number;
  statusUrl?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  try {
    const { storageModule, validationModule, queueModule } = await getServices();
    const { getNovel } = storageModule;
    const { validateNovelId } = validationModule;
    const { enqueueScrapeJob, validateCachedChapters } = queueModule;

    // Parse request body
    const { novelId, mode = 'start' } = req.body as ScrapeRequest;

    // Validate inputs
    if (!novelId || typeof novelId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Novel ID is required',
        code: 'VALIDATION_ERROR',
      });
    }

    validateNovelId(novelId);

    if (!['start', 'resume'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: "Mode must be 'start' or 'resume'",
        code: 'VALIDATION_ERROR',
      });
    }

    // Verify novel exists
    const novel = await getNovel(novelId);
    if (!novel) {
      return res.status(404).json({
        success: false,
        error: 'Novel not found',
        code: 'NOT_FOUND',
      });
    }

    // Determine resume point if resuming
    let resumeFromChapter = 1;
    if (mode === 'resume') {
      resumeFromChapter = await validateCachedChapters(novelId);
    }

    // Enqueue job
    const result = await enqueueScrapeJob(novelId, mode, resumeFromChapter);

    if (result.status === 202) {
      // Success
      return res.status(202).json({
        success: true,
        jobId: result.jobId,
        message: result.message,
        estimatedWaitSeconds: result.estimatedWaitSeconds,
        statusUrl: `/api/scrape/${novelId}/progress`,
      });
    } else if (result.status === 409) {
      // Duplicate job
      return res.status(409).json({
        success: false,
        jobId: result.jobId,
        error: result.message,
        code: result.code,
        statusUrl: `/api/scrape/${novelId}/progress`,
      });
    } else if (result.status === 503) {
      // Queue full
      return res.status(503).json({
        success: false,
        error: result.error,
        code: result.code,
        retryAfter: 30,
      });
    } else {
      // Error
      return res.status(result.status || 500).json({
        success: false,
        error: result.error || 'Unknown error',
        code: result.code,
      });
    }
  } catch (error: any) {
    console.error('[API Error]', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
}

export default handler;
