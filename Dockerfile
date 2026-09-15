# syntax=docker/dockerfile:1

# ---------------------------------------------------------------
# Stage 1 — install dependencies (cached until package*.json change)
# ---------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------
# Stage 2 — build
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build
# time, so they must be provided as build args (docker-compose.yml
# forwards them from .env.local). Server-only secrets (service role
# key, ENCRYPTION_KEY, META_APP_SECRET, ...) are read at runtime and
# must NOT be baked into the image.
#
# NEXT_PUBLIC_SUPABASE_URL/ANON_KEY default to this project's actual
# values below instead of being left blank. A second deployment built
# straight from this Dockerfile (e.g. a standalone /agency instance on
# its own EasyPanel service, see src/proxy.ts's AGENCY_STANDALONE_MODE)
# may not go through docker-compose.yml's `build.args` at all — if the
# platform's build step doesn't forward these as --build-arg, they'd
# otherwise bake in as empty strings, breaking the browser Supabase
# client silently (no session ever gets established — surfaces as
# "AuthSessionMissingError" server-side, with no visible error to the
# user; see the postmortem this comment is from). The anon key is
# meant to be public — it's already inlined into the main app's own
# bundle, readable via view-source on the live site, and access is
# actually enforced by RLS, not by this key being secret. Still
# override-able per environment via --build-arg / compose for a
# genuinely different Supabase project.
# ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL=https://cxolwxwxcmtyaovwntvq.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4b2x3eHd4Y210eWFvdndudHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MTIyNzEsImV4cCI6MjEwMTk4ODI3MX0.SlZee5lgkmC8rUjCiR0iGakQO1HIvqm7-dWTGRnB7DA
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------
# Stage 3 — minimal runtime (standalone output)
# ---------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

# Next's standalone-output file tracing (@vercel/nft) only picked up the
# .cjs helpers here, not the esm/ ones next-intl's ESM build needs at
# runtime — leaving `.next/standalone` missing
# node_modules/@swc/helpers/esm/_interop_require_default.js and crashing
# on boot with MODULE_NOT_FOUND. Overwrite with the full package so
# runtime has both.
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/@swc/helpers ./node_modules/@swc/helpers

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
