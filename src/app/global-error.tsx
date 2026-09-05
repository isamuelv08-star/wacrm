'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Only fires for errors thrown above every other error boundary —
// inside the root layout itself. Next.js requires this file to render
// its own <html>/<body> since it fully replaces the layout when it
// triggers, so none of the app's providers (theme, i18n, toaster) are
// available here.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-50">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-lg font-medium">Something went wrong.</p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
