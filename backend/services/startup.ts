import { checkOrphanedJobs } from './queue';

/**
 * Run startup checks and recovery procedures
 */
export async function runStartupChecks(): Promise<void> {
  console.log('[Startup] Running server startup checks...');

  try {
    // Check for orphaned jobs and mark them as paused
    await checkOrphanedJobs();
    console.log('[Startup] Orphaned job check complete');
  } catch (error) {
    console.error('[Startup] Error during startup checks:', error);
  }
}
