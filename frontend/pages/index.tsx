import React from 'react';
import Head from 'next/head';
import { useAppContext } from './_app';

export default function Home() {
  const { currentScrape, history } = useAppContext();

  return (
    <>
      <Head>
        <title>epubLegend - Web Novel Scraper</title>
        <meta name="description" content="Scrape novels from freewebnovel.com and generate EPUB/PDF e-books" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <h1 className="text-3xl font-bold text-gray-900">epubLegend</h1>
            <p className="text-gray-600">Web Novel Scraper & E-book Generator</p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Search Panel - Placeholder */}
            <div className="md:col-span-2 bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Search for Novels</h2>
              <div className="bg-gray-100 p-8 rounded text-center text-gray-500">
                <p>SearchPanel component (from FEAT-003)</p>
              </div>
            </div>

            {/* Scrape Progress Panel - Placeholder */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Scrape Progress</h2>
              {currentScrape ? (
                <div className="bg-blue-50 p-4 rounded">
                  <p className="text-gray-700 mb-2">
                    Status: <span className="font-semibold">{currentScrape.status}</span>
                  </p>
                  <p className="text-gray-700">
                    Progress: {currentScrape.completedChapters}/{currentScrape.totalChapters}
                  </p>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-8">
                  <p>No active scrape</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Export Panel - Placeholder */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Export E-book</h2>
              <div className="bg-gray-100 p-8 rounded text-center text-gray-500">
                <p>ExportPanel component (from FEAT-006)</p>
              </div>
            </div>

            {/* History Panel - Placeholder */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Scrape History</h2>
              {history.length > 0 ? (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div key={item.novelId} className="p-3 bg-gray-50 rounded">
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-sm text-gray-600">
                        {item.completedChapters} chapters
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-center py-8">
                  <p>No history yet</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
