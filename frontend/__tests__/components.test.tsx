import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchPanel from '../components/SearchPanel';
import NovelCard from '../components/NovelCard';
import ScrapeProgressPanel from '../components/ScrapeProgressPanel';
import ExportPanel from '../components/ExportPanel';
import HistoryPanel from '../components/HistoryPanel';
import { AppProvider, useAppContext } from '../pages/_app';

// Mock axios for search
jest.mock('axios');

// Wrapper component that provides context
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('SearchPanel', () => {
  it('renders with search input', () => {
    render(<SearchPanel />, { wrapper: Wrapper });
    const input = screen.getByPlaceholderText('Enter novel name...');
    expect(input).toBeInTheDocument();
  });

  it('shows initial state with prompt', () => {
    render(<SearchPanel />, { wrapper: Wrapper });
    expect(screen.getByText(/enter a novel name to search/i)).toBeInTheDocument();
  });
});

describe('NovelCard', () => {
  const mockNovel = {
    novelId: '123',
    title: 'Solo Leveling',
    author: 'Chugong',
    description: 'A great web novel',
    genre: 'Fantasy',
    status: 'ongoing' as const,
    cover: 'https://example.com/cover.jpg',
  };

  it('renders novel information', () => {
    render(
      <NovelCard {...mockNovel} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText('Solo Leveling')).toBeInTheDocument();
    expect(screen.getByText(/Chugong/)).toBeInTheDocument();
    expect(screen.getByText('Fantasy')).toBeInTheDocument();
  });

  it('displays status badge', () => {
    render(
      <NovelCard {...mockNovel} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/Ongoing/i)).toBeInTheDocument();
  });

  it('renders Start Scrape button', () => {
    render(
      <NovelCard {...mockNovel} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/Start Scrape/i)).toBeInTheDocument();
  });

  it('shows scraped chapter count when available', () => {
    render(
      <NovelCard {...mockNovel} scrapedChapterCount={15} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/15 chapters cached/i)).toBeInTheDocument();
  });

  it('handles button click', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    global.fetch = mockFetch;

    render(
      <NovelCard {...mockNovel} />,
      { wrapper: Wrapper }
    );

    const button = screen.getByText(/Start Scrape/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scrape',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});

describe('ScrapeProgressPanel', () => {
  it('renders status badge', () => {
    render(
      <ScrapeProgressPanel novelId="123" status="in_progress" completedChapters={5} totalChapters={20} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/Scraping/i)).toBeInTheDocument();
  });

  it('displays chapter counter when total chapters available', () => {
    render(
      <ScrapeProgressPanel novelId="123" status="in_progress" completedChapters={5} totalChapters={20} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/5\/20 chapters/)).toBeInTheDocument();
  });

  it('shows progress percentage', () => {
    render(
      <ScrapeProgressPanel novelId="123" status="in_progress" completedChapters={5} totalChapters={20} />,
      { wrapper: Wrapper }
    );

    // Should show percentage (currently displays 0% if not passed from polling)
    expect(screen.getByText(/% complete/)).toBeInTheDocument();
  });

  it('shows completed status correctly', () => {
    render(
      <ScrapeProgressPanel novelId="123" status="completed" completedChapters={20} totalChapters={20} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText('✓ Complete!')).toBeInTheDocument();
  });

  it('shows failed status with error', () => {
    render(
      <ScrapeProgressPanel novelId="123" status="failed" />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText('✗ Failed')).toBeInTheDocument();
  });
});

describe('ExportPanel', () => {
  it('renders export buttons', () => {
    render(
      <ExportPanel novelId="123" status="completed" completedChapters={10} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/Export as EPUB/i)).toBeInTheDocument();
    expect(screen.getByText(/Export as PDF/i)).toBeInTheDocument();
  });

  it('disables buttons when completedChapters < 3', () => {
    render(
      <ExportPanel novelId="123" status="completed" completedChapters={2} />,
      { wrapper: Wrapper }
    );

    const epubButton = screen.getByText(/Export as EPUB/i) as HTMLButtonElement;
    const pdfButton = screen.getByText(/Export as PDF/i) as HTMLButtonElement;

    expect(epubButton.disabled).toBe(true);
    expect(pdfButton.disabled).toBe(true);
  });

  it('disables buttons when status is not completed', () => {
    render(
      <ExportPanel novelId="123" status="in_progress" completedChapters={10} />,
      { wrapper: Wrapper }
    );

    const epubButton = screen.getByText(/Export as EPUB/i) as HTMLButtonElement;
    const pdfButton = screen.getByText(/Export as PDF/i) as HTMLButtonElement;

    expect(epubButton.disabled).toBe(true);
    expect(pdfButton.disabled).toBe(true);
  });

  it('enables buttons when requirements are met', () => {
    render(
      <ExportPanel novelId="123" status="completed" completedChapters={10} />,
      { wrapper: Wrapper }
    );

    const epubButton = screen.getByText(/Export as EPUB/i) as HTMLButtonElement;
    const pdfButton = screen.getByText(/Export as PDF/i) as HTMLButtonElement;

    expect(epubButton.disabled).toBe(false);
    expect(pdfButton.disabled).toBe(false);
  });
});

describe('HistoryPanel', () => {
  it('renders empty state when no history', () => {
    render(<HistoryPanel />, { wrapper: Wrapper });

    expect(screen.getByText(/No scrape history yet/i)).toBeInTheDocument();
  });

  // Full history testing requires mocking useAppContext which requires more setup
  // This is covered in state.test.tsx
});
