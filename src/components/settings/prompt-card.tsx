'use client';

import { useState } from 'react';
import { Pencil, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PromptEditorDialog } from './prompt-editor-dialog';
import { cn } from '@/lib/utils';

/**
 * A long free-text AI field (business context, lead-qualification
 * criteria), presented the same way as AiKnowledgeCard / AiMediaLibraryCard
 * — its own titled Card with a short preview and an Add/Edit button,
 * not an inline textarea — so it sits naturally side by side with
 * those two in a grid instead of looking like an unrelated, differently
 * -styled block bolted onto the Behaviour card. The actual editing
 * still happens in PromptEditorDialog's floating window.
 */
export function PromptCard({
  icon: Icon,
  title,
  description,
  value,
  onSave,
  placeholder,
  emptyLabel,
  addLabel,
  editLabel,
  dialogDescription,
  guideTitle,
  guideItems,
  saveLabel,
  cancelLabel,
  hint,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  /** Card subtitle — what this field is for. */
  description: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  emptyLabel: string;
  addLabel: string;
  editLabel: string;
  /** Shown under the dialog's title, above the textarea. */
  dialogDescription?: string;
  guideTitle: string;
  guideItems: string[];
  saveLabel: string;
  cancelLabel: string;
  /** Extra hint shown below the button (e.g. "Leave blank to turn scoring off"). */
  hint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className={cn(
            'line-clamp-3 text-sm',
            value ? 'text-foreground' : 'italic text-muted-foreground',
          )}
        >
          {value || emptyLabel}
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
          {value ? <Pencil className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {value ? editLabel : addLabel}
        </Button>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>

      <PromptEditorDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={dialogDescription}
        value={value}
        onSave={onSave}
        placeholder={placeholder}
        guideTitle={guideTitle}
        guideItems={guideItems}
        saveLabel={saveLabel}
        cancelLabel={cancelLabel}
        readOnly={disabled}
      />
    </Card>
  );
}
