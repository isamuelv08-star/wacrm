import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One tile in the Integrations grid (Settings → Integrations). Replaces
 * the old full-width "icon + text + button, all in one row" list item —
 * a vertical card (icon top, name/subtitle middle, action pinned to the
 * bottom) reads as a real app-store-style picker instead of a form.
 *
 * Presentational only: callers own their own connect/status logic and
 * hand it in as `action`.
 */
export function IntegrationCard({
  icon,
  name,
  badge,
  subtitle,
  action,
  muted = false,
  className,
}: {
  icon: ReactNode;
  name: string;
  /** Small pill next to the name — e.g. "Coming soon". */
  badge?: ReactNode;
  subtitle: string;
  action: ReactNode;
  /** Dims the whole tile — used for not-yet-available integrations. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow',
        !muted && 'hover:shadow-md',
        muted && 'opacity-70',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </div>
      <div className="flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          {name}
          {badge}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div>{action}</div>
    </div>
  );
}
