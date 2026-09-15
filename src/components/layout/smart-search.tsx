"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Loader2, MessageCircle, User } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { sanitizeOrSearchTerm } from "@/lib/search";

interface SearchResult {
  contactId: string;
  name: string;
  phone: string;
  conversationId: string | null;
}

const MIN_QUERY_LEN = 2;
const RESULT_LIMIT = 6;

/**
 * Header search — looks up contacts by name/phone/email within the
 * current account and, when a contact has an existing conversation,
 * jumps straight to that thread in the inbox instead of just landing
 * on the Contacts list. Debounced so every keystroke doesn't fire a
 * query.
 */
export function SmartSearch() {
  const t = useTranslations("Header");
  const router = useRouter();
  const { accountId } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!accountId || trimmed.length < MIN_QUERY_LEN) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results when the query drops below the minimum length
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const escaped = sanitizeOrSearchTerm(trimmed).replace(/[%_]/g, (c) => `\\${c}`);
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, phone, email, conversations(id, updated_at)")
        .eq("account_id", accountId)
        .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`)
        .limit(RESULT_LIMIT);

      if (!error && data) {
        setResults(
          data.map((row) => {
            const conversations = (row.conversations ?? []) as {
              id: string;
              updated_at: string;
            }[];
            const latest = conversations.sort(
              (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
            )[0];
            return {
              contactId: row.id as string,
              name: (row.name as string) || (row.phone as string),
              phone: row.phone as string,
              conversationId: latest?.id ?? null,
            };
          }),
        );
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, accountId]);

  // Close the results dropdown on outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function goToResult(result: SearchResult) {
    setOpen(false);
    setQuery("");
    if (result.conversationId) {
      router.push(`/inbox?c=${result.conversationId}`);
    } else {
      router.push(`/contacts?q=${encodeURIComponent(result.name)}`);
    }
  }

  const showDropdown = open && query.trim().length >= MIN_QUERY_LEN;

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:max-w-xs">
      <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 transition-colors focus-within:border-primary/50">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("searchPlaceholder")}
          className="w-full min-w-0 truncate bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-lg ring-1 ring-foreground/5">
          {results === null || loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {t("searchNoResults")}
            </p>
          ) : (
            <>
              <ul className="max-h-80 overflow-y-auto py-1">
                {results.map((r) => (
                  <li key={r.contactId}>
                    <button
                      type="button"
                      onClick={() => goToResult(r)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          r.conversationId
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.conversationId ? (
                          <MessageCircle className="h-3.5 w-3.5" />
                        ) : (
                          <User className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.phone}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/contacts?q=${encodeURIComponent(query.trim())}`);
                }}
                className="block w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-muted"
              >
                {t("searchViewAll")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
