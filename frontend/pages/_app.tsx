import React, { createContext, useContext, useState, ReactNode } from 'react';
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
  currentScrape: ScrapeProgress | null;
  history: HistoryItem[];
  startScrape: (novelId: string) => Promise<void>;
  clearScrape: () => void;
  resumeScrape: (novelId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [searchResults] = useState<SearchResult[]>([]);
  const [currentScrape] = useState<ScrapeProgress | null>(null);
  const [history] = useState<HistoryItem[]>([]);

  // TODO: Implement in FEAT-004 (Queue System)
  const startScrape = async (novelId: string) => {
    console.log('Starting scrape for novelId:', novelId);
  };

  const clearScrape = () => {
    console.log('Clearing scrape');
  };

  const resumeScrape = async (novelId: string) => {
    console.log('Resuming scrape for novelId:', novelId);
  };

  return (
    <AppContext.Provider
      value={{
        searchResults,
        currentScrape,
        history,
        startScrape,
        clearScrape,
        resumeScrape,
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
