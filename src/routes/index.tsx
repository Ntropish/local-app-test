import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Welcome to Your App
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          A beautiful application built with React, TanStack Router, and SQLite.
        </p>

        <div className="space-y-4">
          <Link
            to="/ingredients"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium transition-colors"
          >
            Manage Ingredients
          </Link>

          <div className="text-sm text-gray-500">
            <p>Development Tools:</p>
            <button
              onClick={() => window.resetDatabase?.()}
              className="text-blue-600 hover:text-blue-700 underline"
            >
              Reset Database
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
