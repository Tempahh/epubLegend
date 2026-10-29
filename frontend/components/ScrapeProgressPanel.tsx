import React, { useState } from 'react';
import { useScrapeProgress } from '../hooks/useScrapeProgress';

interface ScrapeProgressPanelProps {
  novelId?: string;
  status?: string;
  completedChapters?: number;
  totalChapters?: number;
}

export default function ScrapeProgressPanel({
  novelId,
  status: externalStatus,
  completedChapters: externalCompletedChapters,
  totalChapters: externalTotalChapters,
}: ScrapeProgressPanelProps) {
  const { progress, isLoading, error } = useScrapeProgress(novelId || null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Use provided props or polling data
  const current = progress || {
    novelId: novelId || 'unknown',
    status: (externalStatus as any) || 'pending',
    completedChapters: externalCompletedChapters || 0,
    totalChapters: externalTotalChapters || 0,
    percentComplete: 0,
    estimatedSecondsRemaining: 0,
    lastUpdated: Date.now(),
  };

  const handleResume = async () => {
    if (!novelId) return;

    setResumeError(null);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          novelId,
          mode: 'resume',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setResumeError(data.message || 'Failed to resume');
      }
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Failed to resume');
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.ceil(seconds / 3600)}h`;
  };

  const getStatusDisplay = (): { label: string; color: string } => {
    switch (current.status) {
      case 'queued':
      case 'pending':
        return { label: 'Queued', color: 'text-gray-600' };
      case 'in_progress':
        return { label: 'Scraping...', color: 'text-blue-600' };
      case 'completed':
        return { label: '✓ Complete!', color: 'text-green-600' };
      case 'failed':
        return { label: '✗ Failed', color: 'text-red-600' };
      case 'paused':
        return { label: 'Paused', color: 'text-yellow-600' };
      default:
        return { label: 'Unknown', color: 'text-gray-600' };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="w-full bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Scrape Progress</h2>

      {error && !progress && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {resumeError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {resumeError}
        </div>
      )}

      {/* Status Badge */}
      <div className="mb-4">
        <span className={`inline-block px-3 py-1 text-sm font-semibold rounded-full ${statusDisplay.color} bg-gray-50`}>
          {statusDisplay.label}
        </span>
      </div>

      {/* Progress Bar */}
      {(current.status === 'in_progress' || current.status === 'pending' || current.status === 'queued') && (
        <div className="mb-6">
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-300"
              style={{
                width: `${Math.min(current.percentComplete, 100)}%`,
              }}
            ></div>
          </div>
        </div>
      )}

      {/* Chapter Counter */}
      {current.totalChapters > 0 && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Chapter Progress</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {current.completedChapters}/{current.totalChapters} chapters
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {current.percentComplete.toFixed(1)}% complete
          </div>
        </div>
      )}

      {/* Estimated Time Remaining */}
      {current.status === 'in_progress' && current.estimatedSecondsRemaining > 0 && (
        <div className="mb-4 p-4 bg-blue-50 rounded-lg">
          <div className="text-sm text-blue-600">Estimated Time Remaining</div>
          <div className="text-xl font-semibold text-blue-900 mt-1">
            {formatTime(current.estimatedSecondsRemaining)}
          </div>
        </div>
      )}

      {/* Error Message */}
      {current.status === 'failed' && 'error' in current && current.error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="text-sm font-semibold text-red-700 mb-1">Error</div>
          <div className="text-sm text-red-600">{current.error}</div>
        </div>
      )}

      {/* Action Buttons */}
      {current.status === 'failed' && (
        <div className="mt-6 flex gap-2">
          <button
            onClick={handleResume}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold transition"
          >
            Resume
          </button>
        </div>
      )}

      {current.status === 'paused' && (
        <div className="mt-6 flex gap-2">
          <button
            onClick={handleResume}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold transition"
          >
            Resume
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
          <span className="text-sm text-gray-600">Updating...</span>
        </div>
      )}
    </div>
  );
}
