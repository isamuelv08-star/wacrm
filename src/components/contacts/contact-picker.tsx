"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";

export type PickedContact = Pick<Contact, "id" | "name" | "phone" | "email" | "company">;

const COLUMNS = "id, name, phone, email, company";
const MAX_RESULTS = 20;

/**
 * Search-as-you-type contact selector. Replaces a <select> that loaded
 * EVERY contact of the account on open — slow with thousands of
 * contacts, and silently cut at 1000 rows (PostgREST's cap), so newer
 * contacts couldn't be picked at all. Now only the selected contact and
 * up to 20 matches are ever fetched.
 */
export function ContactPicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (id: string, contact: PickedContact | null) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const [supabase] = useState(() => createClient());
  const [selected, setSelected] = useState<PickedContact | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Resolve the selected id (e.g. editing an existing deal) to a label.
  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    let cancelled = false;
    void supabase
      .from("contacts")
      .select(COLUMNS)
      .eq("id", value)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSelected((data as PickedContact | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, selected?.id, supabase]);

  // Debounced search while the list is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const term = query.trim().replace(/[,()*%\\]/g, " ").trim();
    const timer = setTimeout(async () => {
      setLoading(true);
      const base = supabase.from("contacts").select(COLUMNS);
      // No term yet: the newest contacts (usually the one you're after).
      const { data } = term
        ? await base.or(`name.ilike.%${term}%,phone.ilike.%${term}%`).order("name").limit(MAX_RESULTS)
        : await base.order("created_at", { ascending: false }).limit(MAX_RESULTS);
      if (cancelled) return;
      setResults((data ?? []) as PickedContact[]);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, supabase]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (c: PickedContact | null) => {
    setSelected(c);
    setOpen(false);
    setQuery("");
    onChange(c?.id ?? "", c);
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-muted px-2.5 text-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={open ? query : selected ? selected.name || selected.phone : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {selected && !disabled && (
          <button type="button" onClick={() => pick(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 text-sm shadow-lg">
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-muted-foreground">—</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-muted",
                    c.id === value && "bg-muted",
                  )}
                >
                  <span className="truncate text-foreground">{c.name || c.phone}</span>
                  {c.name && c.phone && <span className="truncate text-xs text-muted-foreground">{c.phone}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
