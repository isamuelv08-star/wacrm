'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { MessageTemplate } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const NONE = '__none__'

export function BookingNotificationsPanel() {
  const t = useTranslations('Settings.booking.notifications')
  const supabase = createClient()
  const { accountId, canEditSettings } = useAuth()

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [confirmationId, setConfirmationId] = useState(NONE)
  const [reminderId, setReminderId] = useState(NONE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [templatesRes, accountRes] = await Promise.all([
        supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('name'),
        supabase
          .from('accounts')
          .select('appointment_confirmation_template_id, appointment_reminder_template_id')
          .eq('id', accountId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setTemplates((templatesRes.data ?? []) as MessageTemplate[])
      setConfirmationId(accountRes.data?.appointment_confirmation_template_id ?? NONE)
      setReminderId(accountRes.data?.appointment_reminder_template_id ?? NONE)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  async function save() {
    if (!accountId) return
    setSaving(true)
    const { error } = await supabase
      .from('accounts')
      .update({
        appointment_confirmation_template_id: confirmationId === NONE ? null : confirmationId,
        appointment_reminder_template_id: reminderId === NONE ? null : reminderId,
      })
      .eq('id', accountId)
    setSaving(false)
    if (error) {
      toast.error(t('saveFailed'))
      return
    }
    toast.success(t('saveSuccess'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : templates.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t('needApprovedTemplate')}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('templateContract')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('confirmationLabel')}</Label>
                <select
                  value={confirmationId}
                  onChange={(e) => setConfirmationId(e.target.value)}
                  disabled={!canEditSettings || saving}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value={NONE}>{t('none')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t('reminderLabel')}</Label>
                <select
                  value={reminderId}
                  onChange={(e) => setReminderId(e.target.value)}
                  disabled={!canEditSettings || saving}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value={NONE}>{t('none')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {canEditSettings && (
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
