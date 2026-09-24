"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_LABEL,
  AI_PROVIDER_KEY_PLACEHOLDER,
} from "@/lib/ai/defaults";
import type { AiProvider } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const TONES = ["professional", "friendly", "consultative", "direct"] as const;
type Tone = (typeof TONES)[number];

const FIELDS = ["name", "city", "product", "need", "budget"] as const;
type Field = (typeof FIELDS)[number];

type LoadState = "loading" | "configured" | "form";

/**
 * Onboarding's simplified AI step — replaces the wizard's old raw
 * <AiConfig /> embed (the full Settings-tier panel: provider, API
 * key, model, free-text system prompt, qualification criteria, 6+
 * behavior toggles, timezone, numeric limits — 15+ technical fields
 * dumped on a brand-new user with zero context).
 *
 * Provider + API key + model can't be dropped — POST /api/ai/config
 * requires them and live-validates against the provider, there is no
 * platform-shared key this app can fall back to (fully BYO-key by
 * design). What this DOES simplify: no free-text prompt writing and
 * no secondary toggles (channels/sales mode/scheduling/media/handoff/
 * thread control) at first contact — just tone + what to collect,
 * turned into systemPrompt/qualificationCriteria automatically. The
 * full panel stays reachable (and this step's own choices stay fully
 * editable) from Settings → IA.
 */
export function AiToneStep() {
  const t = useTranslations("Onboarding.aiTone");
  const [state, setState] = useState<LoadState>("loading");

  const [provider, setProvider] = useState<AiProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [tone, setTone] = useState<Tone>("friendly");
  const [fields, setFields] = useState<Set<Field>>(new Set(["name", "need"]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/config");
        const data = (await res.json()) as { configured?: boolean };
        setState(data.configured ? "configured" : "form");
      } catch {
        setState("form");
      }
    })();
  }, []);

  function toggleField(field: Field) {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      setError(t("apiKeyRequired"));
      return;
    }
    setSaving(true);
    setError(null);

    const systemPrompt = t(`tonePrompts.${tone}`);
    const qualificationCriteria =
      fields.size > 0
        ? t("qualificationTemplate", {
            fields: FIELDS.filter((f) => fields.has(f))
              .map((f) => t(`fields.${f}`))
              .join(", "),
          })
        : null;

    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: AI_PROVIDER_DEFAULT_MODEL[provider],
          api_key: apiKey.trim(),
          system_prompt: systemPrompt,
          qualification_criteria: qualificationCriteria,
          is_active: true,
          // Configured but not live yet — a fresh, unreviewed prompt
          // talking to real customers unattended is a bigger decision
          // than this one step should make silently. Settings → IA
          // has the switch once they've had a look.
          auto_reply_enabled: false,
          autoreply_channels: ["whatsapp"],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : t("saveFailed"));
        setSaving(false);
        return;
      }
      setSaved(true);
      setState("configured");
    } catch {
      setError(t("networkError"));
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (state === "configured") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          {saved ? t("savedBody") : t("alreadyConfiguredBody")}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setState("form")}>
          {t("reconfigure")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("providerLabel")}</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as AiProvider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">{AI_PROVIDER_LABEL.openai}</SelectItem>
              <SelectItem value="anthropic">{AI_PROVIDER_LABEL.anthropic}</SelectItem>
              <SelectItem value="openrouter">{AI_PROVIDER_LABEL.openrouter}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("apiKeyLabel")}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={AI_PROVIDER_KEY_PLACEHOLDER[provider]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("toneLabel")}</Label>
        <div className="grid grid-cols-2 gap-2">
          {TONES.map((option) => {
            const selected = tone === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setTone(option)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="font-medium text-foreground">{t(`tones.${option}`)}</span>
                {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("fieldsLabel")}</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FIELDS.map((field) => (
            <label
              key={field}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5 text-sm hover:border-primary/40"
            >
              <Checkbox
                checked={fields.has(field)}
                onCheckedChange={() => toggleField(field)}
              />
              <span className="text-foreground">{t(`fields.${field}`)}</span>
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <Button type="button" onClick={() => void handleSave()} disabled={saving} className="self-start">
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("saving")}
          </>
        ) : (
          t("save")
        )}
      </Button>
    </div>
  );
}
