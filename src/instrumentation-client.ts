// Runs in the browser before the app hydrates.
//
// Sentry is deliberately NOT imported statically here. With Session
// Replay it is ~150 KB gzipped — the largest chunk in the app — and a
// static import made every page download and evaluate it before the UI
// could respond. It now loads once the browser is idle (a few seconds
// at most), off the critical path. Two things keep monitoring intact:
//
//  - Errors thrown before Sentry finishes loading are buffered from the
//    first moment and reported as soon as it is ready, so a crash during
//    load is not lost.
//  - Route-transition tracing simply starts once Sentry is up.
//
// The actual configuration lives in src/lib/monitoring/sentry-client.ts.
import type * as SentryModule from '@sentry/nextjs';

type SentryApi = typeof SentryModule;

let sentry: SentryApi | null = null;
const earlyErrors: unknown[] = [];
const MAX_BUFFERED_ERRORS = 10;

function bufferError(event: ErrorEvent | PromiseRejectionEvent) {
  if (earlyErrors.length >= MAX_BUFFERED_ERRORS) return;
  earlyErrors.push('reason' in event ? event.reason : (event.error ?? event.message));
}

function loadSentry() {
  void import('@/lib/monitoring/sentry-client')
    .then(({ Sentry }) => {
      // Sentry installs its own global handlers on init; drop ours so
      // later errors aren't reported twice.
      window.removeEventListener('error', bufferError);
      window.removeEventListener('unhandledrejection', bufferError);
      sentry = Sentry;
      for (const err of earlyErrors.splice(0)) Sentry.captureException(err);
    })
    .catch(() => {
      // Monitoring must never break the app (e.g. a blocked chunk).
    });
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', bufferError);
  window.addEventListener('unhandledrejection', bufferError);

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(loadSentry, { timeout: 4000 });
  } else {
    setTimeout(loadSentry, 2000);
  }
}

export function onRouterTransitionStart(
  href: string,
  navigationType: 'push' | 'replace' | 'traverse',
) {
  sentry?.captureRouterTransitionStart(href, navigationType);
}
