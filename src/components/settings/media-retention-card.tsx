'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HardDrive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

const OPTIONS: (number | null)[] = [null, 30, 60, 90, 180, 365];

/**
 * How long chat files (customer photos / audio / video / documents and
 * advisor attachments) are kept — migration 119. Older ones are deleted
 * by the archive-media job; the messages themselves stay.
 */
export function MediaRetentionCard() {
  const t = useTranslations('Settings.mediaRetention');
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const [days, setDays] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/media-retention')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDays(data.days ?? null);
        setAvailable(data.available !== false);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (value: number | null) => {
    const previous = days;
    setDays(value);
    setSaving(true);
    try {
      const res = await fetch('/api/account/media-retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: value }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('saved'));
    } catch {
      setDays(previous);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <HardDrive className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">{t('title')}</p>
            <p className="text-xs text-muted-foreground">{t('description')}</p>
          </div>
          {!available ? (
            <p className="text-xs text-muted-foreground">{t('unavailable')}</p>
          ) : (
            <select
              value={days === null ? 'forever' : String(days)}
              onChange={(e) => save(e.target.value === 'forever' ? null : Number(e.target.value))}
              disabled={!canEdit || saving || !loaded}
              className="h-9 w-full max-w-xs rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              {OPTIONS.map((o) => (
                <option key={o ?? 'forever'} value={o === null ? 'forever' : String(o)}>
                  {o === null ? t('forever') : t('days', { count: o })}
                </option>
              ))}
            </select>
          )}
          {days !== null && <p className="text-xs text-amber-600 dark:text-amber-400">{t('warning', { count: days })}</p>}
        </div>
      </div>
    </div>
  );
}
