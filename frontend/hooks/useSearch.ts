import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { SearchResult } from '../pages/_app';

interface UseSearchResult {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  onNextPage: () => void;
}

/**
 * useSearch hook with debounced search queries
 * Fetches search results from /api/search endpoint
 * Debounces input by 300ms to avoid excessive requests
 */
export function useSearch(query: string): UseSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Reset page when query changes
    if (query.trim().length === 0) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Set up debounce timer
    debounceTimerRef.current = setTimeout(() => {
      performSearch(query, 1);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  const performSearch = async (searchQuery: string, pageNum: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.post('/api/search', {
        query: searchQuery,
        page: pageNum,
      });

      if (pageNum === 1) {
        setResults(response.data.results || []);
        setPage(1);
      } else {
        setResults((prev) => [...prev, ...(response.data.results || [])]);
        setPage(pageNum);
      }

      setHasMore(response.data.hasMore || false);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 429) {
          setError(`Rate limited. Please retry after ${err.response.data.retryAfter || 60} seconds`);
        } else if (err.response?.status === 400) {
          setError(err.response.data.message || 'Invalid search query');
        } else {
          setError(err.message || 'Search failed');
        }
      } else {
        setError('Search failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onNextPage = () => {
    if (hasMore && !isLoading) {
      performSearch(query, page + 1);
    }
  };

  return {
    results,
    isLoading,
    error,
    page,
    hasMore,
    onNextPage,
  };
}
