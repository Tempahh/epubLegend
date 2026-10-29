import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Dynamically import at runtime to avoid webpack bundling issues
async function getServices() {
  const storageModule = await import(path.join(process.cwd(), 'backend/services/storage'));
  const validationModule = await import(path.join(process.cwd(), 'backend/services/utils'));
  return { storageModule, validationModule };
}

interface NovelResult {
  novelId: string;
  title: string;
  author?: string;
  url: string;
  status?: string;
  cachedAt?: number;
}

interface NovelSearchResponse {
  success: boolean;
  novels?: NovelResult[];
  totalResults?: number;
  error?: string;
  code?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<NovelSearchResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  try {
    const { storageModule, validationModule } = await getServices();
    const { getNovelByTitle } = storageModule;
    const { validateSearchQuery } = validationModule;

    // Get query parameter
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Validate query
    validateSearchQuery(query);

    // Get novels from database
    const novels = await getNovelByTitle(query, 10);

    const results: NovelResult[] = novels.map((novel: any) => ({
      novelId: novel.id,
      title: novel.title,
      author: novel.author,
      url: novel.url,
      status: novel.status,
      cachedAt: novel.last_scraped_at,
    }));

    res.status(200).json({
      success: true,
      novels: results,
      totalResults: results.length,
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
