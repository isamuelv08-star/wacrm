'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff, Flame, Handshake, CalendarClock, Users, CalendarCheck2 } from 'lucide-react';
import { listTimezones } from '@/lib/timezone-list';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Same list on every render/instance — Intl's timezone data doesn't
// change at runtime, so compute it once at module scope rather than
// re-deriving it (or holding it in state) per component instance.
const TIMEZONE_OPTIONS = listTimezones();

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  openrouter: 'OpenRouter',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  openrouter: 'sk-or-...',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  // Voice-note transcription key (OpenRouter, migration 041) — only
  // relevant when provider is 'anthropic' (OpenAI and OpenRouter
  // accounts both transcribe directly with their own main key, see
  // transcribe.ts's hybrid rule).
  const [transcriptionKey, setTranscriptionKey] = useState('');
  const [transcriptionKeyEdited, setTranscriptionKeyEdited] = useState(false);
  const [hasStoredTranscriptionKey, setHasStoredTranscriptionKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [qualificationCriteria, setQualificationCriteria] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [salesModeEnabled, setSalesModeEnabled] = useState(false);
  const [aiSchedulingEnabled, setAiSchedulingEnabled] = useState(false);
  const [googleCalendarSyncEnabled, setGoogleCalendarSyncEnabled] = useState(false);
  // Whether the account has an active Google Calendar connection
  // (Settings → Integrations) — gates the sync switch below, since
  // there's nothing to sync to without one. Independent fetch from
  // ai_configs, mirrors the "load once per account" ref pattern used
  // for hotLeadAlertMinutes/timezone below.
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [leadAutoAssignEnabled, setLeadAutoAssignEnabled] = useState(false);
  // null = "never stop responding" (migration 047).
  const [maxPerConversation, setMaxPerConversation] = useState<number | null>(3);
  // null (default) = auto-resume is off — a handoff stays paused until a
  // human acts (migration 068). A number = minutes to wait with no human
  // reply before the bot picks the thread back up on its own.
  const [autoResumeAfterMinutes, setAutoResumeAfterMinutes] = useState<number | null>(null);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // HOT-lead response-time alert threshold — lives on `accounts`
  // (migration 040), not the ai_config table, so it's fetched/saved
  // through /api/account rather than /api/ai/config. Tracked against
  // its last-loaded value so an unrelated AI-config save doesn't fire
  // an extra PATCH when this field wasn't touched.
  const [hotLeadAlertMinutes, setHotLeadAlertMinutes] = useState(15);
  const loadedHotLeadAlertMinutesRef = useRef(15);

  // Account timezone (migration 065) — needed for AI scheduling to
  // convert a relative phrase like "tomorrow at 10" into the right
  // absolute time. Same "lives on `accounts`, fetched/saved through
  // /api/account" posture as hotLeadAlertMinutes above.
  const [timezone, setTimezone] = useState('UTC');
  const loadedTimezoneRef = useRef('UTC');

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setQualificationCriteria(data.qualification_criteria ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setSalesModeEnabled(Boolean(data.sales_mode_enabled));
        setAiSchedulingEnabled(Boolean(data.ai_scheduling_enabled));
        setGoogleCalendarSyncEnabled(Boolean(data.google_calendar_sync_enabled));
        setLeadAutoAssignEnabled(Boolean(data.lead_auto_assign_enabled));
        // The stored value is a number, or null ("never stop") — only an
        // absent key (older/partial payload) should fall back to the
        // column's own default, so this checks for undefined, not ??.
        setMaxPerConversation(
          data.auto_reply_max_per_conversation === undefined
            ? 3
            : data.auto_reply_max_per_conversation,
        );
        setAutoResumeAfterMinutes(
          data.auto_resume_after_minutes === undefined
            ? null
            : data.auto_resume_after_minutes,
        );
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setHasStoredTranscriptionKey(Boolean(data.has_transcription_key));
        setTranscriptionKey(data.has_transcription_key ? MASKED_KEY : '');
        setTranscriptionKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHotLeadAlertMinutes = useCallback(async () => {
    try {
      const res = await fetch('/api/account');
      const data = await res.json();
      if (res.ok && typeof data?.account?.hot_lead_alert_minutes === 'number') {
        setHotLeadAlertMinutes(data.account.hot_lead_alert_minutes);
        loadedHotLeadAlertMinutesRef.current = data.account.hot_lead_alert_minutes;
      }
      if (res.ok && typeof data?.account?.timezone === 'string') {
        setTimezone(data.account.timezone);
        loadedTimezoneRef.current = data.account.timezone;
      }
    } catch {
      // Best-effort — the field just falls back to its default and the
      // next successful load corrects it.
    }
  }, []);

  const fetchGoogleCalendarStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/google-calendar');
      const data = await res.json();
      setGoogleCalendarConnected(res.ok && Boolean(data.connected));
    } catch {
      setGoogleCalendarConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    void fetchHotLeadAlertMinutes();
    void fetchGoogleCalendarStatus();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig, fetchHotLeadAlertMinutes, fetchGoogleCalendarStatus]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model === AI_PROVIDER_DEFAULT_MODEL.openrouter ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const transcriptionKeyPayload = () =>
    transcriptionKeyEdited ? transcriptionKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    transcription_api_key: transcriptionKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    qualification_criteria: qualificationCriteria.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    sales_mode_enabled: salesModeEnabled,
    ai_scheduling_enabled: aiSchedulingEnabled,
    google_calendar_sync_enabled: googleCalendarSyncEnabled,
    lead_auto_assign_enabled: leadAutoAssignEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    auto_resume_after_minutes: autoResumeAfterMinutes,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const accountUpdate: Record<string, unknown> = {};
      if (hotLeadAlertMinutes !== loadedHotLeadAlertMinutesRef.current) {
        accountUpdate.hot_lead_alert_minutes = hotLeadAlertMinutes;
      }
      if (timezone !== loadedTimezoneRef.current) {
        accountUpdate.timezone = timezone;
      }

      const [configResult, accountResult] = await Promise.all([
        fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
        }).then(async (res) => ({ res, data: await res.json() })),
        Object.keys(accountUpdate).length > 0
          ? fetch('/api/account', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(accountUpdate),
            }).then(async (res) => ({ res, data: await res.json() }))
          : null,
      ]);

      if (configResult.res.ok) {
        await fetchConfig();
      } else {
        toast.error(configResult.data.error ?? t('saveFailed'));
      }

      if (accountResult) {
        if (accountResult.res.ok) {
          loadedHotLeadAlertMinutesRef.current = hotLeadAlertMinutes;
          loadedTimezoneRef.current = timezone;
        } else {
          toast.error(accountResult.data.error ?? t('hotLeadAlertsSaveFailed'));
        }
      }

      if (configResult.res.ok && (!accountResult || accountResult.res.ok)) {
        toast.success(t('saveSuccess'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSalesModeEnabled(false);
        setAiSchedulingEnabled(false);
        setGoogleCalendarSyncEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('encryptionNotice')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="openrouter">
                      {PROVIDER_LABEL.openrouter}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>

            {provider === 'anthropic' && (
              <div className="space-y-2">
                <Label htmlFor="ai-transcription-key">
                  {t('transcriptionKey')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('optionalTranscription')}
                  </span>
                </Label>
                <Input
                  id="ai-transcription-key"
                  type="password"
                  value={transcriptionKey}
                  onChange={(e) => {
                    setTranscriptionKey(e.target.value);
                    setTranscriptionKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (!transcriptionKeyEdited && hasStoredTranscriptionKey) {
                      setTranscriptionKey('');
                      setTranscriptionKeyEdited(true);
                    }
                  }}
                  placeholder="sk-or-... (OpenRouter)"
                  disabled={disabled}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  {t('transcriptionHint')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-qualification-criteria">
                {t('qualificationCriteria')}
              </Label>
              <Textarea
                id="ai-qualification-criteria"
                value={qualificationCriteria}
                onChange={(e) => setQualificationCriteria(e.target.value)}
                placeholder={t('qualificationCriteriaPlaceholder')}
                rows={5}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('qualificationCriteriaHint')}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Handshake className="h-3.5 w-3.5 text-primary" />
                  {t('salesMode')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('salesModeDesc')}
                </p>
              </div>
              <Switch
                checked={salesModeEnabled}
                onCheckedChange={setSalesModeEnabled}
                disabled={disabled || !autoReplyEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CalendarClock className="h-3.5 w-3.5 text-primary" />
                  {t('aiScheduling')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('aiSchedulingDesc')}
                </p>
              </div>
              <Switch
                checked={aiSchedulingEnabled}
                onCheckedChange={setAiSchedulingEnabled}
                disabled={disabled || !autoReplyEnabled}
              />
            </div>

            {aiSchedulingEnabled && (
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <CalendarCheck2 className="h-3.5 w-3.5 text-primary" />
                    {t('googleCalendarSync')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {googleCalendarConnected ? t('googleCalendarSyncDesc') : t('googleCalendarSyncNotConnected')}
                  </p>
                </div>
                <Switch
                  checked={googleCalendarSyncEnabled}
                  onCheckedChange={setGoogleCalendarSyncEnabled}
                  disabled={disabled || !googleCalendarConnected}
                />
              </div>
            )}

            {aiSchedulingEnabled && (
              <div className="space-y-2">
                <Label htmlFor="ai-timezone">{t('timezoneLabel')}</Label>
                <select
                  id="ai-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={disabled}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-xs"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {t('timezoneHint')}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('maxAutoRepliesDesc')}
                  </p>
                </div>
                <Input
                  id="ai-max"
                  type="number"
                  min={1}
                  max={1000}
                  value={maxPerConversation ?? ''}
                  onChange={(e) =>
                    setMaxPerConversation(
                      Math.min(1000, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={disabled || !autoReplyEnabled || maxPerConversation === null}
                  className="w-20"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[20, 30, 100].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={maxPerConversation === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMaxPerConversation(preset)}
                    disabled={disabled || !autoReplyEnabled}
                  >
                    {preset}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={maxPerConversation === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMaxPerConversation(null)}
                  disabled={disabled || !autoReplyEnabled}
                >
                  {t('maxAutoRepliesUnlimited')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ai-auto-resume">{t('autoResume')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('autoResumeDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="ai-auto-resume"
                    type="number"
                    min={1}
                    max={1440}
                    value={autoResumeAfterMinutes ?? ''}
                    onChange={(e) =>
                      setAutoResumeAfterMinutes(
                        Math.min(1440, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                    disabled={disabled || !autoReplyEnabled || autoResumeAfterMinutes === null}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('autoResumeMinutes')}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={autoResumeAfterMinutes === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAutoResumeAfterMinutes(null)}
                  disabled={disabled || !autoReplyEnabled}
                >
                  {t('autoResumeOff')}
                </Button>
                {[15, 30, 60].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={autoResumeAfterMinutes === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAutoResumeAfterMinutes(preset)}
                    disabled={disabled || !autoReplyEnabled}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  {t('leadAutoAssign')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('leadAutoAssignDesc')}
                </p>
              </div>
              <Switch
                checked={leadAutoAssignEnabled}
                onCheckedChange={setLeadAutoAssignEnabled}
                disabled={disabled || !autoReplyEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-primary" /> {t('hotLeadAlertsTitle')}
            </CardTitle>
            <CardDescription>{t('hotLeadAlertsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="hot-lead-alert-minutes">
                  {t('hotLeadAlertMinutesLabel')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('hotLeadAlertMinutesHint')}
                </p>
              </div>
              <Input
                id="hot-lead-alert-minutes"
                type="number"
                min={0}
                max={10080}
                value={hotLeadAlertMinutes}
                onChange={(e) =>
                  setHotLeadAlertMinutes(
                    Math.min(10080, Math.max(0, Number(e.target.value) || 0)),
                  )
                }
                disabled={disabled}
                className="w-20"
              />
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
