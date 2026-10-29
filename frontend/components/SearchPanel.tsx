import React, { useState } from 'react';
import { useSearch } from '../hooks/useSearch';
import NovelCard from './NovelCard';

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const { results, isLoading, error, hasMore, onNextPage } = useSearch(query);

  return (
    <div className="w-full">
      <h2 className="text-2xl font-bold mb-4">Search for Novels</h2>

      {/* Search Input */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          placeholder="Enter novel name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && query.trim().length > 0 && (
        <div className="flex justify-center py-8">
          <div className="inline-flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce"></div>
            <span className="text-gray-600">Searching...</span>
          </div>
        </div>
      )}

      {/* Results List */}
      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((novel) => (
            <NovelCard
              key={novel.id}
              novelId={novel.id}
              title={novel.title}
              author={novel.author}
              description={novel.description}
              cover={novel.cover_url}
              genre={novel.genre}
              status="unknown"
            />
          ))}

          {/* Pagination */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={onNextPage}
                disabled={isLoading}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 transition"
              >
                Load More
              </button>
            </div>
          )}

          {/* Results Info */}
          <div className="text-sm text-gray-600 text-center mt-4">
            Showing {Math.min(results.length, 50)} of {results.length} results
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && query.trim().length > 0 && results.length === 0 && !error && (
        <div className="text-center py-8 text-gray-500">
          <p>No novels found matching your search</p>
        </div>
      )}

      {/* Initial State */}
      {!isLoading && query.trim().length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p>Enter a novel name to search</p>
        </div>
      )}
    </div>
  );
}
