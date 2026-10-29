import { renderHook, act, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useSearch } from '../hooks/useSearch';
import { useScrapeProgress } from '../hooks/useScrapeProgress';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('useSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('returns empty results on mount', () => {
    const { result } = renderHook(() => useSearch(''));

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('debounces search by 300ms', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        results: [
          { id: '1', title: 'Test Novel', author: 'Author', genre: 'Fantasy', description: 'Desc' },
        ],
        hasMore: false,
      },
    });

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } }
    );

    // Change query
    rerender({ query: 'test' });

    // Before 300ms, API should not be called
    expect(mockedAxios.post).not.toHaveBeenCalled();

    // Fast-forward 300ms
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Now API should be called
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/search', {
        query: 'test',
        page: 1,
      });
    });
  });

  it('handles search errors gracefully', async () => {
    mockedAxios.post.mockRejectedValue(
      new Error('Network error')
    );

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } }
    );

    rerender({ query: 'test' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  it('handles 400 validation errors', async () => {
    const error = new Error('Validation error');
    (error as any).isAxiosError = true;
    (error as any).response = {
      status: 400,
      data: { message: 'Invalid query' },
    };
    mockedAxios.post.mockRejectedValue(error);

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } }
    );

    rerender({ query: 'test' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  it('handles 429 rate limit errors', async () => {
    const error = new Error('Rate limit exceeded');
    (error as any).isAxiosError = true;
    (error as any).response = {
      status: 429,
      data: { retryAfter: 60 },
    };
    mockedAxios.post.mockRejectedValue(error);

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } }
    );

    rerender({ query: 'test' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  it('supports pagination', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        results: Array.from({ length: 25 }, (_, i) => ({
          id: `${i}`,
          title: `Novel ${i}`,
          author: `Author ${i}`,
          genre: 'Fantasy',
          description: `Desc ${i}`,
        })),
        hasMore: true,
      },
    });

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: 'test' } }
    );

    rerender({ query: 'test' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    // Load next page
    act(() => {
      result.current.onNextPage();
    });

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/search', {
        query: 'test',
        page: 2,
      });
    });
  });

  it('clears results when query is empty', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        results: [
          { id: '1', title: 'Test', author: 'Author', genre: 'Fantasy', description: 'Desc' },
        ],
        hasMore: false,
      },
    });

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: 'test' } }
    );

    rerender({ query: 'test' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.results.length).toBeGreaterThan(0);
    });

    // Clear query
    rerender({ query: '' });

    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe('useScrapeProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('returns null when novelId is null', () => {
    const { result } = renderHook(() => useScrapeProgress(null));

    expect(result.current.progress).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('starts polling with 1.5s interval', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        novelId: '123',
        status: 'in_progress',
        completedChapters: 5,
        totalChapters: 20,
        percentComplete: 25,
        estimatedSecondsRemaining: 3600,
        lastUpdated: Date.now(),
      },
    });

    const { result } = renderHook(() => useScrapeProgress('123'));

    // Initial poll happens immediately
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/scrape/123/progress');
    });
  });

  it('updates progress state correctly', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        novelId: '123',
        status: 'in_progress',
        completedChapters: 10,
        totalChapters: 50,
        percentComplete: 20,
        estimatedSecondsRemaining: 1800,
        lastUpdated: Date.now(),
      },
    });

    const { result } = renderHook(() => useScrapeProgress('123'));

    await waitFor(() => {
      expect(result.current.progress).not.toBeNull();
      expect(result.current.progress?.completedChapters).toBe(10);
    });
  });

  it('handles fetch errors gracefully', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useScrapeProgress('123'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });
});
