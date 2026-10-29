import React, { useState } from 'react';
import { useAppContext } from '../pages/_app';

interface NovelCardProps {
  novelId: string;
  title: string;
  author: string;
  description: string;
  cover?: string;
  genre: string;
  status: 'unknown' | 'ongoing' | 'completed' | 'scraped';
  scrapedChapterCount?: number;
}

export default function NovelCard({
  novelId,
  title,
  author,
  description,
  cover,
  genre,
  status,
  scrapedChapterCount,
}: NovelCardProps) {
  const { setCurrentScrape } = useAppContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartScrape = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          novelId,
          mode: 'start',
        }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError('Already scraping this novel');
        } else {
          const errorData = await response.json();
          setError(errorData.message || 'Failed to start scrape');
        }
        return;
      }

      await response.json(); // Consume response body
      // Update app context with initial scrape progress
      setCurrentScrape({
        novelId,
        status: 'queued',
        completedChapters: 0,
        totalChapters: 0,
        percentComplete: 0,
        estimatedSecondsRemaining: 0,
        lastUpdated: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scrape');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'ongoing':
        return 'bg-blue-100 text-blue-700';
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'scraped':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-lg transition overflow-hidden">
      <div className="flex gap-4 p-4">
        {/* Cover Image */}
        <div className="flex-shrink-0">
          <div className="relative w-24 h-32 bg-gray-200 rounded overflow-hidden">
            {cover ? (
              <img
                src={cover}
                alt={title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Fallback on error
                  e.currentTarget.src = '/placeholder.svg';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-300">
                <span className="text-gray-500 text-xs">No cover</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600 mb-1">by {author}</p>

            {/* Genre Tags */}
            <div className="mb-2 flex flex-wrap gap-1">
              <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                {genre}
              </span>
            </div>

            {/* Status Badge */}
            <div className="mb-2">
              <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getStatusColor(status)}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-700 line-clamp-2">{description}</p>
          </div>

          {/* Action Area */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex-1">
              {error && <p className="text-xs text-red-600">{error}</p>}
              {scrapedChapterCount !== undefined && scrapedChapterCount > 0 && (
                <p className="text-xs text-green-600">✓ {scrapedChapterCount} chapters cached</p>
              )}
            </div>

            <button
              onClick={handleStartScrape}
              disabled={isLoading || status === 'scraped'}
              className={`px-4 py-2 rounded font-semibold transition ${
                isLoading || status === 'scraped'
                  ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isLoading ? 'Starting...' : status === 'scraped' ? 'Re-scrape' : 'Start Scrape'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
