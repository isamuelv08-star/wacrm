'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusinessVertical } from '@/types';
import { cn } from '@/lib/utils';

const VERTICALS: readonly BusinessVertical[] = [
  'sales_retail',
  'medical_clinic',
  'spa_beauty',
  'travel_agency',
  'real_estate',
  'workshop_service',
  'professional_services',
  'other',
];

interface BusinessTypeStepProps {
  value: BusinessVertical | null;
  onChange: (vertical: BusinessVertical) => void;
}

/** Onboarding's first step — picks the account's business vertical
 *  (migration 070), which decides whether the wizard later suggests
 *  connecting Google Calendar (see APPOINTMENT_BASED_VERTICALS,
 *  src/types/index.ts) for verticals that run on appointments. */
export function BusinessTypeStep({ value, onChange }: BusinessTypeStepProps) {
  const t = useTranslations('Onboarding.businessType');

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {VERTICALS.map((vertical) => {
        const selected = value === vertical;
        return (
          <button
            key={vertical}
            type="button"
            onClick={() => onChange(vertical)}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
              selected
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40',
            )}
          >
            <span className="font-medium text-foreground">{t(`options.${vertical}`)}</span>
            {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
