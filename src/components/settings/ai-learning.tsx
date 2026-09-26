'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, GraduationCap, Loader2, RefreshCw, Trash2, Trophy, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Status = 'pending' | 'approved' | 'rejected';

interface Example {
  id: string;
  customer_text: string;
  advisor_reply: string;
  outcome: 'open' | 'won' | 'lost';
  status: Status;
  created_at: string;
}

/**
 * Settings → AI: what the AI learned from the advisors' own replies
 * (migration 116, src/lib/ai/learning). Admins approve / reject the
 * mined examples; approved ones are shown to the AI as "this is how we
 * answer" when a similar customer message comes in.
 */
export function AiLearningCard({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const t = useTranslations('Settings.aiLearning');
  const [status, setStatus] = useState<Status>('pending');
  const [examples, setExamples] = useState<Example[]>([]);
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [enabled, setEnabled] = useState(true);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [mining, setMining] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadedRef = useRef<string | null>(null);

  const load = useCallback(async (s: Status) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/learned-examples?status=${s}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAvailable(data.available !== false);
      setExamples(data.examples ?? []);
      setCounts(data.counts ?? {});
      setEnabled(data.learningEnabled !== false);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    void load('pending');
  }, [accountId, load]);

  const switchTab = (s: Status) => {
    setStatus(s);
    void load(s);
  };

  const toggleEnabled = async (value: boolean) => {
    setEnabled(value);
    const res = await fetch('/api/ai/learned-examples', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learningEnabled: value }),
    });
    if (!res.ok) {
      setEnabled(!value);
      toast.error(t('saveFailed'));
    }
  };

  const learnNow = async () => {
    setMining(true);
    try {
      const res = await fetch('/api/ai/learned-examples', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t('learned', { count: data.stored ?? 0 }));
      await load(status);
    } catch {
      toast.error(t('learnFailed'));
    } finally {
      setMining(false);
    }
  };

  const setExampleStatus = async (id: string, next: Status) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/learned-examples/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      await load(status);
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/learned-examples/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await load(status);
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const approveAll = async () => {
    setMining(true);
    try {
      const res = await fetch('/api/ai/learned-examples', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveAllPending: true }),
      });
      if (!res.ok) throw new Error();
      await load(status);
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setMining(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!available ? (
          <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={enabled} onCheckedChange={toggleEnabled} disabled={!canEdit} />
                {t('enabled')}
              </label>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={learnNow} disabled={mining}>
                  {mining ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t('learnNow')}
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1 text-sm">
              {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => switchTab(s)}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 font-medium transition-colors',
                    status === s ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`tab.${s}`)} ({counts[s] ?? 0})
                </button>
              ))}
            </div>

            {status === 'pending' && canEdit && (counts.pending ?? 0) > 0 && (
              <Button size="sm" variant="secondary" onClick={approveAll} disabled={mining}>
                <Check className="h-4 w-4" />
                {t('approveAll')}
              </Button>
            )}

            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : examples.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t(`empty.${status}`)}</p>
            ) : (
              <ul className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                {examples.map((ex) => (
                  <li key={ex.id} className="rounded-lg border p-3 text-sm">
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      <span className="font-medium text-foreground">{t('customer')}: </span>
                      {ex.customer_text}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap">
                      <span className="font-medium">{t('advisor')}: </span>
                      {ex.advisor_reply}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {ex.outcome === 'won' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <Trophy className="h-3 w-3" />
                          {t('fromWonSale')}
                        </span>
                      ) : (
                        <span />
                      )}
                      {canEdit && (
                        <div className="flex gap-1">
                          {ex.status !== 'approved' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === ex.id}
                              onClick={() => setExampleStatus(ex.id, 'approved')}
                              aria-label={t('approve')}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                          )}
                          {ex.status !== 'rejected' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === ex.id}
                              onClick={() => setExampleStatus(ex.id, 'rejected')}
                              aria-label={t('reject')}
                            >
                              <X className="h-4 w-4 text-red-600" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === ex.id}
                            onClick={() => remove(ex.id)}
                            aria-label={t('delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
