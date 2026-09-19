// Browser-side Sentry initialisation. Imported ONLY dynamically (see
// src/instrumentation-client.ts and src/app/global-error.tsx) so the
// SDK — about 150 KB gzipped with Session Replay, the single largest
// chunk in the app — stays out of the bundle every page has to download
// and parse before it can become interactive.
//
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://a837ee0690fc88d2d64f11b94e57978f@o4512030547050496.ingest.us.sentry.io/4512030678777857',

  integrations: [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.1,

  // Replay only records sessions that hit an error. Regular sessions are
  // never recorded: the CRM shows customer chats and contact data.
  replaysSessionSampleRate: 0,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // Never send user data or HTTP bodies: customer chats and contact
    // details pass through this app.
    userInfo: false,
    httpBodies: [],
  },
});

export { Sentry };
