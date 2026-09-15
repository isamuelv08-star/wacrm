'use client';

import { CheckCircle2, Users, UserCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type WhatsAppMode = 'shared' | 'multiwhatsapp';

const MODES: readonly WhatsAppMode[] = ['shared', 'multiwhatsapp'];
const MODE_ICON: Record<WhatsAppMode, typeof Users> = {
  shared: Users,
  multiwhatsapp: UserCog,
};

interface WhatsAppModeStepProps {
  value: WhatsAppMode;
  onChange: (mode: WhatsAppMode) => void;
}

/**
 * Onboarding step — picks accounts.whatsapp_mode (migration 085)
 * before the WhatsApp-connect step right after it, since that step's
 * copy/behavior can eventually branch on this choice. Only two
 * options by design: 'shared' (today's only behavior — one number,
 * optionally round-robinned across a team) stays the default and
 * nothing about it changes; 'multiwhatsapp' (each seller connects
 * their own number) is the new opt-in. An existing account can change
 * this later from Settings — it's not a one-time, unchangeable choice.
 */
export function WhatsAppModeStep({ value, onChange }: WhatsAppModeStepProps) {
  const t = useTranslations('Onboarding.whatsappMode');

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {MODES.map((mode) => {
        const selected = value === mode;
        const Icon = MODE_ICON[mode];
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors',
              selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
            </div>
            <span className="text-sm font-semibold text-foreground">
              {t(`options.${mode}.title`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t(`options.${mode}.description`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
