import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Dynamically import at runtime to avoid webpack bundling issues
async function getServices() {
  const storageModule = await import(path.join(process.cwd(), 'backend/services/storage'));
  const validationModule = await import(path.join(process.cwd(), 'backend/services/utils'));
  return { storageModule, validationModule };
}

interface ProgressResponse {
  success: boolean;
  jobId?: string;
  status?: string;
  completedChapters?: number;
  totalChapters?: number;
  percentComplete?: number;
  estimatedSecondsRemaining?: number;
  lastChapterTitle?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  code?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ProgressResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  try {
    const { storageModule, validationModule } = await getServices();
    const { getScrapeState, getNovel } = storageModule;
    const { validateNovelId, estimateTimeRemaining } = validationModule;

    // Get novelId from route parameter
    const { novelId } = req.query;

    if (!novelId || typeof novelId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Novel ID is required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Validate novel ID format
    validateNovelId(novelId);

    // Get scrape job status
    const job = await getScrapeState(novelId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
        code: 'NOT_FOUND',
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

    // Calculate progress
    const completedChapters = job.completed_chapters || 0;
    const totalChapters = job.total_chapters || 0;
    
    let percentComplete = 0;
    let estimatedSecondsRemaining = 0;

    if (job.status === 'in_progress' && totalChapters > 0) {
      percentComplete = Math.round((completedChapters / totalChapters) * 100);
      
      if (job.started_at && completedChapters > 0) {
        const elapsedSeconds = Math.floor((Date.now() - job.started_at) / 1000);
        estimatedSecondsRemaining = estimateTimeRemaining(
          completedChapters,
          totalChapters,
          elapsedSeconds
        );
      }
    } else if (job.status === 'completed') {
      percentComplete = 100;
      estimatedSecondsRemaining = 0;
    }

    const response: ProgressResponse = {
      success: true,
      jobId: job.id,
      status: job.status,
      completedChapters,
      totalChapters,
      percentComplete,
      estimatedSecondsRemaining,
      lastChapterTitle: job.last_chapter_url || '',
      startedAt: job.started_at,
      completedAt: job.completed_at,
    };

    // Include error if failed
    if (job.status === 'failed' && job.error_message) {
      response.error = job.error_message;
    }

    res.status(200).json(response);
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
