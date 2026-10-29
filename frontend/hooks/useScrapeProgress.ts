import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ScrapeProgress } from '../pages/_app';

interface UseScrapeProgressResult {
  progress: ScrapeProgress | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * useScrapeProgress hook with adaptive polling
 * Polls /api/scrape/[novelId]/progress endpoint
 * Adaptive polling: starts at 1.5s, backs off to 10s if no update for 60s
 */
export function useScrapeProgress(novelId: string | null): UseScrapeProgressResult {
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<number>(1500);
  const lastUpdateRef = useRef<number>(Date.now());
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const staleAlertShownRef = useRef<boolean>(false);

  useEffect(() => {
    if (!novelId) {
      setProgress(null);
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
      return;
    }

    const poll = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get(`/api/scrape/${novelId}/progress`);
        const data = response.data as ScrapeProgress;

        setProgress(data);
        setError(null);
        lastUpdateRef.current = Date.now();
        staleAlertShownRef.current = false;

        // Adapt polling interval based on status
        if (data.status === 'completed' || data.status === 'failed') {
          // Stop polling on completion or failure
          if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
          }
          return;
        }

        // Check for stale progress (no update for 300 seconds)
        const timeSinceUpdate = Date.now() - lastUpdateRef.current;
        if (timeSinceUpdate > 300000 && !staleAlertShownRef.current) {
          staleAlertShownRef.current = true;
          console.warn('Scrape progress appears stale');
        }

        // Adapt polling interval: speed up during active scrape, slow down when idle
        if (timeSinceUpdate > 60000) {
          pollIntervalRef.current = 10000; // 10 seconds
        } else {
          pollIntervalRef.current = 1500; // 1.5 seconds
        }
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.message || 'Failed to fetch progress');
        } else {
          setError('Failed to fetch progress');
        }
      } finally {
        setIsLoading(false);
        // Schedule next poll
        pollTimerRef.current = setTimeout(poll, pollIntervalRef.current);
      }
    };

    // Initial poll
    poll();

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [novelId]);

  return {
    progress,
    isLoading,
    error,
  };
}
