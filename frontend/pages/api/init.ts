import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

// Flag to ensure startup runs only once
let startupComplete = false;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Run startup checks on first API call
    if (!startupComplete) {
      const startupModule = await import(path.join(process.cwd(), 'backend/services/startup'));
      await startupModule.runStartupChecks();
      startupComplete = true;
    }

    res.status(200).json({ success: true, message: 'Server initialized' });
  } catch (error: any) {
    console.error('[Init] Startup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export default handler;
