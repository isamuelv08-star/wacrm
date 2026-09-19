'use client';

import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Loaded on demand (and initialised by that module) so the Sentry SDK
    // isn't part of the bundle every page ships — see
    // src/instrumentation-client.ts.
    void import('@/lib/monitoring/sentry-client')
      .then(({ Sentry }) => Sentry.captureException(error))
      .catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
