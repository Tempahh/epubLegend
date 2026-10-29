import React from 'react';
import Head from 'next/head';
import { useAppContext } from './_app';
import SearchPanel from '../components/SearchPanel';
import ScrapeProgressPanel from '../components/ScrapeProgressPanel';
import ExportPanel from '../components/ExportPanel';
import HistoryPanel from '../components/HistoryPanel';

export default function Home() {
  const { currentScrape } = useAppContext();

  return (
    <>
      <Head>
        <title>epubLegend - Web Novel Scraper</title>
        <meta name="description" content="Scrape novels from freewebnovel.com and generate EPUB/PDF e-books" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <h1 className="text-3xl font-bold text-gray-900">epubLegend</h1>
            <p className="text-gray-600">Web Novel Scraper & E-book Generator</p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            {/* Search Panel - Left/Top Column */}
            <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
              <SearchPanel />
            </div>

            {/* Scrape Progress Panel - Right/Bottom Column */}
            <div className="lg:col-span-1">
              {currentScrape ? (
                <ScrapeProgressPanel
                  novelId={currentScrape.novelId}
                  status={currentScrape.status}
                  completedChapters={currentScrape.completedChapters}
                  totalChapters={currentScrape.totalChapters}
                />
              ) : (
                <div className="bg-white rounded-lg shadow p-6 text-center">
                  <h2 className="text-2xl font-bold mb-4">Scrape Progress</h2>
                  <div className="text-gray-500 py-8">
                    <p>No active scrape</p>
                    <p className="text-sm mt-2">Search for a novel and click "Start Scrape"</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Export and History Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Export Panel */}
            {currentScrape && (
              <ExportPanel
                novelId={currentScrape.novelId}
                status={currentScrape.status}
                completedChapters={currentScrape.completedChapters}
              />
            )}

            {/* History Panel */}
            <HistoryPanel />
          </div>
        </main>
      </div>
    </>
  );
}
