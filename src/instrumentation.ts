import * as Sentry from '@sentry/nextjs';

// Server + edge counterpart of instrumentation-client.ts — same
// opt-in gating, same env var. Both runtimes share one Sentry
// project; nothing here needs to distinguish them beyond calling
// `init` once per runtime the server process actually uses.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function register() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}

// Reports server-side rendering/route-handler/server-action errors
// that Next.js's own error boundaries never see (e.g. one thrown
// during streaming, after the response already started).
export const onRequestError = Sentry.captureRequestError;
