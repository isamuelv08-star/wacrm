"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadLeadProfile, summaryNeedsRefresh, type LeadProfile } from "@/lib/contacts/lead-profile";
import type { Contact } from "@/types";

export type SummaryStatus =
  | "idle"
  | "generating"
  | "error"
  | "not_configured"
  | "no_messages"
  | "no_permission";

/**
 * Loads a contact's AI lead profile (score, intelligence, deals,
 * promises, activity, tags) and asks the server for a fresh AI
 * narrative only when it's missing or stale — extracted from
 * lead-summary-tab.tsx (Contacts → "Resumen") so a second, more
 * compact caller (the inbox sidebar's summary card) can show just the
 * executive-summary slice of the same data without a second fetch/
 * generation pipeline to keep in sync.
 */
export function useLeadSummary(contact: Contact | null) {
  const locale = useLocale();
  const { canSendMessages } = useAuth();
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<SummaryStatus>("idle");
  const requestedFor = useRef<string | null>(null);
  const contactId = contact?.id;

  const generate = useCallback(
    async (force: boolean) => {
      if (!contactId) return;
      setStatus("generating");
      try {
        const res = await fetch(`/api/contacts/${contactId}/summary`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force, locale }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus(
            json.code === "ai_not_configured"
              ? "not_configured"
              : json.code === "no_messages"
                ? "no_messages"
                : "error",
          );
          return;
        }
        setProfile((p) => (p ? { ...p, summary: json.summary } : p));
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    },
    [contactId, locale],
  );

  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting when the contact changes, before the fetch below repopulates it
    setProfile(null);
    setLoadError(false);
    setStatus("idle");
    loadLeadProfile(createClient(), contactId)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        if (!p.latestMessage) {
          setStatus("no_messages");
          return;
        }
        if (!summaryNeedsRefresh(p, locale)) return;
        if (!canSendMessages) {
          if (!p.summary) setStatus("no_permission");
          return;
        }
        // Once per (contact, newest message, language) per mounted tab —
        // also absorbs React strict-mode's double effect in dev.
        const key = `${contactId}:${p.latestMessage.id}:${locale}`;
        if (requestedFor.current === key) return;
        requestedFor.current = key;
        void generate(false);
      })
      .catch((err) => {
        console.error("[lead-summary] load failed:", err);
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [contactId, locale, canSendMessages, generate]);

  return {
    profile,
    loadError,
    status,
    canRefresh: canSendMessages && !!profile?.latestMessage,
    refresh: () => void generate(true),
  };
}

export type { LeadProfile };
