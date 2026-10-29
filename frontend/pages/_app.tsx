import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import type { AppProps } from 'next/app';
import '../styles/globals.css';

export interface SearchResult {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  cover_url?: string;
}

export interface ScrapeProgress {
  novelId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'paused';
  completedChapters: number;
  totalChapters: number;
  percentComplete: number;
  estimatedSecondsRemaining: number;
  error?: string;
  lastUpdated: number;
}

export interface HistoryItem {
  novelId: string;
  title: string;
  completedChapters: number;
  createdAt: number;
  downloadUrls?: {
    epub?: string;
    pdf?: string;
  };
}

interface AppContextType {
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  currentScrape: ScrapeProgress | null;
  setCurrentScrape: (scrape: ScrapeProgress | null) => void;
  history: HistoryItem[];
  setHistory: (history: HistoryItem[]) => void;
  clearCurrentScrape: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const CURRENT_SCRAPE_STORAGE_KEY = 'currentScrapeNovelId';

export function AppProvider({ children }: { children: ReactNode }) {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentScrape, setCurrentScrape] = useState<ScrapeProgress | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Load currentScrapeNovelId from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(CURRENT_SCRAPE_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setCurrentScrape(parsed);
        } catch {
          // Invalid JSON, ignore
        }
      }
    }
  }, []);

  // Persist currentScrape to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentScrape) {
        localStorage.setItem(CURRENT_SCRAPE_STORAGE_KEY, JSON.stringify(currentScrape));
      } else {
        localStorage.removeItem(CURRENT_SCRAPE_STORAGE_KEY);
      }
    }
  }, [currentScrape]);

  const clearCurrentScrape = () => {
    setCurrentScrape(null);
  };

  return (
    <AppContext.Provider
      value={{
        searchResults,
        setSearchResults,
        currentScrape,
        setCurrentScrape,
        history,
        setHistory,
        clearCurrentScrape,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AppProvider>
      <Component {...pageProps} />
    </AppProvider>
  );
}

export default MyApp;
