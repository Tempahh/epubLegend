import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Dynamically import at runtime to avoid webpack bundling issues
async function getServices() {
  const validationModule = await import(path.join(process.cwd(), 'backend/services/utils'));
  const rateLimitModule = await import(path.join(process.cwd(), 'backend/services/ratelimit'));
  return { validationModule, rateLimitModule };
}

interface SearchResult {
  url: string;
  title: string;
  author: string;
  cover: string;
  genre: string;
}

interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  totalResults?: number;
  page?: number;
  error?: string;
  code?: string;
  retryAfter?: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse<SearchResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  try {
    const { validationModule, rateLimitModule } = await getServices();
    const { validateSearchQuery, validatePageNumber } = validationModule;
    const { rateLimitMiddleware } = rateLimitModule;

    // Rate limiting
    if (!rateLimitMiddleware(req, res, '/api/search')) {
      return; // Response already sent by middleware
    }

    // Parse request body
    const { query, page = 1 } = req.body;

    // Validate inputs
    validateSearchQuery(query);
    validatePageNumber(page);

    // Spawn Python scraper process
    try {
      const results = await executeSearch(query, page);
      
      res.status(200).json({
        success: true,
        results: results.slice(0, 50), // Max 50 results
        totalResults: results.length,
        page,
      });
    } catch (error: any) {
      if (error.code === 'PARSE_ERROR' || error.message?.includes('parse')) {
        return res.status(503).json({
          success: false,
          error: 'Search temporarily unavailable',
          code: 'SERVICE_UNAVAILABLE',
        });
      }
      
      throw error;
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

/**
 * Execute Python scraper for search
 */
function executeSearch(query: string, page: number): Promise<SearchResult[]> {
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(
      process.cwd(),
      'backend/scrapers/freewebnovel_scraper.py'
    );

    const proc = spawn('python3', [pythonScriptPath, 'search', '--query', query, '--page', String(page)], {
      timeout: 30000, // 30 second timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number) => {
      if (code !== 0) {
        // Python script failed or timed out
        return reject({
          code: 'PYTHON_ERROR',
          message: `Python scraper exited with code ${code}: ${stderr}`,
        });
      }

      try {
        // Parse JSON output
        const results = JSON.parse(stdout) as SearchResult[];
        resolve(results);
      } catch (e) {
        reject({
          code: 'PARSE_ERROR',
          message: `Failed to parse Python scraper output: ${(e as Error).message}`,
        });
      }
    });

    proc.on('error', (err: Error) => {
      reject({
        code: 'SPAWN_ERROR',
        message: `Failed to spawn Python process: ${err.message}`,
      });
    });

    // Kill process on timeout
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill();
        reject({
          code: 'TIMEOUT',
          message: 'Python scraper took too long to respond',
        });
      }
    }, 30000);
  });
}

export default handler;
