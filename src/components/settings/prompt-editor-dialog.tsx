'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Full-screen-ish editor for a long free-text field (business context,
 * lead-qualification criteria) — opened from a compact card instead of
 * an always-expanded inline textarea, so a long prompt doesn't blow up
 * the Agentes IA page's height. Edits are local to the dialog until
 * "Save" — the caller (AiConfig) only commits them into its own state,
 * the account-wide Save button still persists everything together,
 * same as before this existed.
 */
export function PromptEditorDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onSave,
  placeholder,
  guideTitle,
  guideItems,
  saveLabel,
  cancelLabel,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  /** Heading for the reference panel (e.g. "Recommended structure"). */
  guideTitle: string;
  /** Short bullet lines — kept as plain strings (not markdown) so
   *  every locale's translation stays simple key/value text. */
  guideItems: string[];
  saveLabel: string;
  cancelLabel: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  // Re-sync the draft to the live value every time the dialog opens —
  // deliberately not on every `value` change, so typing in the dialog
  // is never fought by a parent re-render. Same sanctioned "reset
  // dialog-local state on open" pattern as EventFormDialog.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/* `grid-cols-1` at the base is load-bearing: with only the
            `lg:` column definition, a viewport (or dialog) narrower
            than that breakpoint left the grid with NO explicit
            columns, so the browser fell back to sizing the textarea's
            track to its shrink-to-fit min-content — a couple of
            characters wide — instead of stretching it. Every line
            wrapped after 1-2 letters as a result. `min-w-0` on the
            textarea itself is the usual second half of this fix: a
            grid/flex item's default `min-width: auto` otherwise still
            refuses to shrink the column below the textarea's own
            preferred width once real content is typed. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[1fr_260px]">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={readOnly}
            rows={16}
            className="min-h-[320px] w-full min-w-0 resize-y lg:min-h-[400px]"
            autoFocus
          />
          <div className="shrink-0 space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{guideTitle}</p>
            <ul className="list-disc space-y-1.5 pl-4">
              {guideItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          {!readOnly && (
            <Button
              onClick={() => {
                onSave(draft);
                onOpenChange(false);
              }}
            >
              {saveLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
