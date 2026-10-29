import React, { useState } from 'react';

interface ExportPanelProps {
  novelId?: string;
  status?: string;
  completedChapters?: number;
}

export default function ExportPanel({
  novelId,
  status,
  completedChapters = 0,
}: ExportPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isExportEnabled = status === 'completed' && completedChapters >= 3 && novelId;

  const handleExport = async (format: 'epub' | 'pdf') => {
    if (!novelId) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/generate-ebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          novelId,
          format,
        }),
      });

      if (!response.ok) {
        if (response.status === 422) {
          setError('Insufficient chapters to generate e-book (minimum 3 required)');
        } else {
          const data = await response.json();
          setError(data.message || `Failed to generate ${format.toUpperCase()}`);
        }
        return;
      }

      // Handle file download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Extract filename from Content-Disposition header if available
      const contentDisposition = response.headers.get('content-disposition');
      let filename = `novel.${format}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+?)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccess(`${format.toUpperCase()} exported successfully!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to export ${format.toUpperCase()}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getDisabledReason = (): string => {
    if (!novelId) {
      return 'No novel selected';
    }
    if (status !== 'completed') {
      return 'Scraping must be completed first';
    }
    if (completedChapters < 3) {
      return `Need at least 3 chapters (have ${completedChapters})`;
    }
    return '';
  };

  return (
    <div className="w-full bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Export E-book</h2>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* Info Box */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          <strong>Status:</strong> {!novelId ? 'No novel selected' : `${completedChapters} chapters available`}
        </p>
        <p className="text-xs text-blue-700 mt-1">
          Exports require at least 3 completed chapters.
        </p>
      </div>

      {/* Export Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => handleExport('epub')}
          disabled={!isExportEnabled || isLoading}
          title={!isExportEnabled ? getDisabledReason() : ''}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
            isExportEnabled && !isLoading
              ? 'bg-purple-500 text-white hover:bg-purple-600'
              : 'bg-gray-300 text-gray-600 cursor-not-allowed'
          }`}
        >
          {isLoading ? 'Exporting...' : 'Export as EPUB'}
        </button>

        <button
          onClick={() => handleExport('pdf')}
          disabled={!isExportEnabled || isLoading}
          title={!isExportEnabled ? getDisabledReason() : ''}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
            isExportEnabled && !isLoading
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-gray-300 text-gray-600 cursor-not-allowed'
          }`}
        >
          {isLoading ? 'Exporting...' : 'Export as PDF'}
        </button>
      </div>

      {!isExportEnabled && novelId && (
        <p className="text-sm text-gray-600 mt-4 text-center">{getDisabledReason()}</p>
      )}
    </div>
  );
}
