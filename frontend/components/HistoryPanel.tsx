import React from 'react';
import { useAppContext, HistoryItem } from '../pages/_app';

export default function HistoryPanel() {
  const { history } = useAppContext();

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDownload = (item: HistoryItem, format: 'epub' | 'pdf') => {
    const url = item.downloadUrls?.[format];
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.title}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className="w-full bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Scrape History</h2>

      {history.length > 0 ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {history.map((item) => (
            <div key={item.novelId} className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.completedChapters} chapters scraped</p>
                </div>
                <span className="text-xs text-gray-500">{formatDate(item.createdAt)}</span>
              </div>

              {/* Download Links */}
              <div className="flex gap-2 mt-3">
                {item.downloadUrls?.epub ? (
                  <button
                    onClick={() => handleDownload(item, 'epub')}
                    className="flex-1 text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition"
                  >
                    ↓ EPUB
                  </button>
                ) : (
                  <div className="flex-1 text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded cursor-not-allowed">
                    No EPUB
                  </div>
                )}

                {item.downloadUrls?.pdf ? (
                  <button
                    onClick={() => handleDownload(item, 'pdf')}
                    className="flex-1 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                  >
                    ↓ PDF
                  </button>
                ) : (
                  <div className="flex-1 text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded cursor-not-allowed">
                    No PDF
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No scrape history yet</p>
          <p className="text-sm mt-1">Your scraped novels will appear here</p>
        </div>
      )}
    </div>
  );
}
