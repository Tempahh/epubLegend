import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Dynamically import at runtime to avoid webpack bundling issues
async function getServices() {
  const storageModule = await import(path.join(process.cwd(), 'backend/services/storage'));
  const validationModule = await import(path.join(process.cwd(), 'backend/services/utils'));
  return { storageModule, validationModule };
}

interface ChapterInfo {
  chapterNumber: number;
  title?: string;
  wordCount?: number;
  scrapedAt?: number;
}

interface ChaptersResponse {
  success: boolean;
  novelId?: string;
  chapters?: ChapterInfo[];
  totalChapters?: number;
  totalWords?: number;
  error?: string;
  code?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ChaptersResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  try {
    const { storageModule, validationModule } = await getServices();
    const { getChapters, getNovel } = storageModule;
    const { validateNovelId } = validationModule;

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

    // Verify novel exists
    const novel = await getNovel(novelId);
    if (!novel) {
      return res.status(404).json({
        success: false,
        error: 'Novel not found',
        code: 'NOT_FOUND',
      });
    }

    // Get chapters for novel
    const dbChapters = await getChapters(novelId);

    const chapters: ChapterInfo[] = dbChapters.map((ch: any) => ({
      chapterNumber: ch.chapter_number,
      title: ch.chapter_title,
      wordCount: ch.content ? ch.content.split(/\s+/).length : 0,
      scrapedAt: ch.updated_at,
    }));

    // Calculate totals
    const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);

    res.status(200).json({
      success: true,
      novelId,
      chapters,
      totalChapters: chapters.length,
      totalWords,
    });
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
