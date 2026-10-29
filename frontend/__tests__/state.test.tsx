import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppProvider, useAppContext, ScrapeProgress } from '../pages/_app';

const STORAGE_KEY = 'currentScrapeNovelId';

// Test component that uses context
function TestComponent() {
  const { currentScrape, setCurrentScrape, history, setHistory, clearCurrentScrape } = useAppContext();

  const mockScrape: ScrapeProgress = {
    novelId: '123',
    status: 'in_progress',
    completedChapters: 5,
    totalChapters: 20,
    percentComplete: 25,
    estimatedSecondsRemaining: 1800,
    lastUpdated: Date.now(),
  };

  return (
    <div>
      {currentScrape ? (
        <div>
          <p>Current: {currentScrape.novelId}</p>
          <p>Status: {currentScrape.status}</p>
        </div>
      ) : (
        <p>No scrape</p>
      )}

      <button onClick={() => setCurrentScrape(mockScrape)}>Start Scrape</button>
      <button onClick={clearCurrentScrape}>Clear Scrape</button>

      <p>History: {history.length}</p>
      <button onClick={() => setHistory([...history, { novelId: '456', title: 'Test', completedChapters: 10, createdAt: Date.now() }])}>
        Add History
      </button>
    </div>
  );
}

describe('AppContext', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('provides context values', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    expect(screen.getByText('No scrape')).toBeInTheDocument();
    expect(screen.getByText('History: 0')).toBeInTheDocument();
  });

  it('updates context state', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    const startButton = screen.getByText('Start Scrape');
    fireEvent.click(startButton);

    expect(screen.getByText('Current: 123')).toBeInTheDocument();
    expect(screen.getByText('Status: in_progress')).toBeInTheDocument();
  });

  it('clears current scrape', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    const startButton = screen.getByText('Start Scrape');
    fireEvent.click(startButton);

    expect(screen.getByText('Current: 123')).toBeInTheDocument();

    const clearButton = screen.getByText('Clear Scrape');
    fireEvent.click(clearButton);

    expect(screen.getByText('No scrape')).toBeInTheDocument();
  });

  it('persists currentScrape to localStorage', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    const startButton = screen.getByText('Start Scrape');
    fireEvent.click(startButton);

    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.novelId).toBe('123');
    expect(parsed.status).toBe('in_progress');
  });

  it('removes from localStorage on clear', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    const startButton = screen.getByText('Start Scrape');
    fireEvent.click(startButton);

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    const clearButton = screen.getByText('Clear Scrape');
    fireEvent.click(clearButton);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loads currentScrape from localStorage on mount', () => {
    const mockScrape: ScrapeProgress = {
      novelId: '999',
      status: 'completed',
      completedChapters: 20,
      totalChapters: 20,
      percentComplete: 100,
      estimatedSecondsRemaining: 0,
      lastUpdated: Date.now(),
    };

    // Set localStorage before rendering
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockScrape));

    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    // Component should load the persisted state
    waitFor(() => {
      expect(screen.getByText('Current: 999')).toBeInTheDocument();
      expect(screen.getByText('Status: completed')).toBeInTheDocument();
    });
  });

  it('manages history state', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    expect(screen.getByText('History: 0')).toBeInTheDocument();

    const addHistoryButton = screen.getByText('Add History');
    fireEvent.click(addHistoryButton);

    expect(screen.getByText('History: 1')).toBeInTheDocument();

    fireEvent.click(addHistoryButton);

    expect(screen.getByText('History: 2')).toBeInTheDocument();
  });

  it('handles invalid JSON in localStorage gracefully', () => {
    // Set invalid JSON
    localStorage.setItem(STORAGE_KEY, '{invalid json}');

    // Should not throw
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    // Should show no scrape since invalid JSON was ignored
    expect(screen.getByText('No scrape')).toBeInTheDocument();
  });

  it('provides setSearchResults function', () => {
    function SearchTestComponent() {
      const { searchResults, setSearchResults } = useAppContext();

      return (
        <div>
          <p>Results: {searchResults.length}</p>
          <button
            onClick={() =>
              setSearchResults([
                {
                  id: '1',
                  title: 'Test Novel',
                  author: 'Author',
                  genre: 'Fantasy',
                  description: 'Description',
                },
              ])
            }
          >
            Add Result
          </button>
        </div>
      );
    }

    render(
      <AppProvider>
        <SearchTestComponent />
      </AppProvider>
    );

    expect(screen.getByText('Results: 0')).toBeInTheDocument();

    const addButton = screen.getByText('Add Result');
    fireEvent.click(addButton);

    expect(screen.getByText('Results: 1')).toBeInTheDocument();
  });
});
