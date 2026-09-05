import * as Sentry from '@sentry/nextjs';

// Sentry is opt-in, like every other integration in this codebase
// (Zernio, Google Calendar, ...): a self-hosted deployment that never
// sets NEXT_PUBLIC_SENTRY_DSN just doesn't report anything, with no
// error or degraded behaviour.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Trace a sample of transactions for basic performance visibility
    // (route timings, slow API calls) without shipping every request.
    tracesSampleRate: 0.1,
  });
}

// Lets Sentry tag transactions with the App Router navigation that
// triggered them — required export name, see Next.js's
// instrumentation-client.js docs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
