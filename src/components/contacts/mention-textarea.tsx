'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import type { TeamMember } from '@/lib/dashboard/member-detail';
import { cn } from '@/lib/utils';

/**
 * Plain textarea with "@" teammate autocomplete — the same mechanism as
 * the team chat composer (team-chat-composer.tsx): picking a teammate
 * inserts the literal text "@Full Name", and the caller resolves who was
 * mentioned at submit time with `extractMentionedUserIds`.
 *
 * The suggestion list renders inline under the field rather than as a
 * floating popover, so it can never be clipped by the narrow, scrolling
 * panels this is used in (Inbox sidebar, Contacts sheet).
 */
export function MentionTextarea({
  value,
  onChange,
  roster,
  placeholder,
  rows = 2,
  disabled,
  onSubmit,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  roster: TeamMember[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** Ctrl/Cmd+Enter. Plain Enter stays a newline — notes are multi-line. */
  onSubmit?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const matches =
    query === null
      ? []
      : roster
          .filter((m) => {
            const q = query.toLowerCase();
            const name = m.name.toLowerCase();
            return (
              m.name.trim() !== '' &&
              m.name !== '—' &&
              (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q)))
            );
          })
          .slice(0, 5);

  function detect(text: string, cursor: number) {
    const match = /@(\S*)$/.exec(text.slice(0, cursor));
    setQuery(match ? match[1] : null);
    setActive(0);
  }

  function insert(member: TeamMember) {
    const el = ref.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const match = /@(\S*)$/.exec(value.slice(0, cursor));
    if (!match) return;
    const before = value.slice(0, match.index);
    const after = value.slice(cursor);
    onChange(`${before}@${member.name} ${after}`);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + member.name.length + 2;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[active] ?? matches[0]);
        return;
      }
    }
    if (e.key === 'Escape' && query !== null) {
      e.preventDefault();
      setQuery(null);
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        className={cn(
          'w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 disabled:opacity-60',
          className,
        )}
      />
      {query !== null && matches.length > 0 && (
        <ul
          role="listbox"
          className="mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-sm"
        >
          {matches.map((m, i) => (
            <li key={m.userId} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown (not click) so the textarea's blur — which closes
                // the list — can't win the race against the selection.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(m);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground',
                  i === active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
                  {m.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
