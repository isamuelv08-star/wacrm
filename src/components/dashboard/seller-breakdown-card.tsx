'use client'

import { useTranslations } from 'next-intl'
import { Users, MessageSquare, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currency'
import type { SellerBreakdownRow } from '@/lib/dashboard/seller-scope'

/**
 * Admin/owner-only dashboard section for a multiwhatsapp account
 * (085) — "el dueño ve todo consolidado, con la opción de entrar y
 * ver el detalle de cada vendedor" (phase 7). Each row is clickable:
 * picking one re-scopes the whole dashboard's main cards to just that
 * seller's number(s) via `onSelectSeller`; picking "Todos" (or
 * clicking the already-selected row again) resets to the consolidated
 * account-wide view.
 */
export function SellerBreakdownCard({
  rows,
  loading,
  selectedSellerId,
  onSelectSeller,
  currency,
}: {
  rows: SellerBreakdownRow[] | null
  loading: boolean
  selectedSellerId: string | null
  onSelectSeller: (sellerId: string | null) => void
  currency: string
}) {
  const t = useTranslations('Dashboard.sellerBreakdown')

  if (!loading && (!rows || rows.length === 0)) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        {selectedSellerId && (
          <button
            type="button"
            onClick={() => onSelectSeller(null)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('viewAll')}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-4 space-y-2">
        {loading && !rows
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
            ))
          : rows?.map((row) => {
              const selected = row.userId === selectedSellerId
              return (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => onSelectSeller(selected ? null : row.userId)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {row.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {t('activeConversations', { count: row.activeConversations })}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {formatCurrency(row.openPipelineValue, currency)}
                    </span>
                  </span>
                </button>
              )
            })}
      </div>
    </div>
  )
}
