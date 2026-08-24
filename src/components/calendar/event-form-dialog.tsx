'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useCan } from '@/hooks/use-can'
import {
  createEvent,
  deleteEvent,
  updateEvent,
  type CalendarEventInput,
} from '@/lib/calendar/queries'
import type { CalendarEvent, CalendarEventType, Contact, Deal, Profile } from '@/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const EVENT_TYPES: CalendarEventType[] = ['call', 'meeting', 'follow_up', 'task', 'other']
const REMINDER_OPTIONS = [15, 30, 60, 1440] as const

interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = editing; absent = creating. */
  event?: CalendarEvent | null
  /** Pre-fills the date when creating from a selected calendar day. */
  defaultDate?: Date
  /** Pre-fills the contact link when opened from a contact/deal quick-add button. */
  defaultContactId?: string | null
  defaultDealId?: string | null
  onSaved: () => void
}

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
  defaultContactId,
  defaultDealId,
  onSaved,
}: EventFormDialogProps) {
  const t = useTranslations('Calendar')
  const supabase = createClient()
  const { accountId, profile, isAdmin, isOwner } = useAuth()
  const canPickAssignee = isAdmin || isOwner
  // RLS requires agent+ to write calendar_events — a viewer can still
  // open this dialog to look at an event's details, but Save/Delete
  // need to be hidden rather than left clickable-but-doomed.
  const canWrite = useCan('send-messages')

  const [type, setType] = useState<CalendarEventType>('call')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [contactId, setContactId] = useState('')
  const [dealId, setDealId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState('')

  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [saving, setSaving] = useState(false)
  // `saving` (React state) doesn't block a second click until a
  // re-render disables the button — a fast double-click could fire
  // handleSave twice concurrently. On a brand-new event there's no
  // unique constraint to catch the collision (unlike the sales-goals
  // save bug this mirrors), so a race here would silently create a
  // duplicate event outright. A ref-backed guard closes that window
  // synchronously.
  const savingRef = useRef(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset fields every time the dialog opens or its input props
  // change — a legitimate prop-driven sync, same posture as
  // deal-form.tsx's own reset effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setConfirmDelete(false)
    if (event) {
      setType(event.type)
      setTitle(event.title)
      setNotes(event.notes ?? '')
      const starts = new Date(event.starts_at)
      setDate(toDateInput(starts))
      setStartTime(toTimeInput(starts))
      setEndTime(event.ends_at ? toTimeInput(new Date(event.ends_at)) : '')
      setContactId(event.contact_id ?? '')
      setDealId(event.deal_id ?? '')
      setAssignedTo(event.assigned_to ?? '')
      setReminderMinutesBefore(
        event.reminder_minutes_before != null ? String(event.reminder_minutes_before) : '',
      )
    } else {
      const base = defaultDate ?? new Date()
      setType('call')
      setTitle('')
      setNotes('')
      setDate(toDateInput(base))
      setStartTime('09:00')
      setEndTime('')
      setContactId(defaultContactId ?? '')
      setDealId(defaultDealId ?? '')
      setAssignedTo(profile?.id ?? '')
      setReminderMinutesBefore('')
    }
  }, [open, event, defaultDate, defaultContactId, defaultDealId, profile?.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Supporting data — same "fetch once while open" shape as deal-form.tsx.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const [c, p] = await Promise.all([
        supabase.from('contacts').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      if (cancelled) return
      setContacts((c.data ?? []) as Contact[])
      setProfiles((p.data ?? []) as Profile[])
    })()
    return () => {
      cancelled = true
    }
  }, [open, supabase])

  // Deals narrow to whichever contact is currently selected.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([])
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('deals')
        .select('id, title')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      setDeals((data ?? []) as Deal[])
    })()
    return () => {
      cancelled = true
    }
  }, [open, contactId, supabase])

  async function handleSave() {
    if (savingRef.current) return
    if (!title.trim() || !date || !startTime) {
      toast.error(t('toastRequired'))
      return
    }
    if (!accountId) {
      toast.error(t('toastNotLinked'))
      return
    }

    const startsAt = new Date(`${date}T${startTime}`)
    if (Number.isNaN(startsAt.getTime())) {
      toast.error(t('toastInvalidDate'))
      return
    }
    const endsAt = endTime ? new Date(`${date}T${endTime}`) : null

    const input: CalendarEventInput = {
      type,
      title: title.trim(),
      notes: notes.trim() || null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      contactId: contactId || null,
      dealId: dealId || null,
      assignedTo: assignedTo || null,
      reminderMinutesBefore: reminderMinutesBefore ? Number(reminderMinutesBefore) : null,
    }

    savingRef.current = true
    setSaving(true)
    const { error } = event
      ? await updateEvent(supabase, event.id, input)
      : await createEvent(supabase, accountId, profile?.id ?? null, input)
    setSaving(false)
    savingRef.current = false

    if (error) {
      toast.error(event ? t('toastFailedSave') : t('toastFailedCreate'))
      return
    }
    toast.success(event ? t('toastUpdated') : t('toastCreated'))
    onOpenChange(false)
    onSaved()
  }

  async function handleDelete() {
    if (!event) return
    setDeleting(true)
    const { error } = await deleteEvent(supabase, event.id)
    setDeleting(false)
    if (error) {
      toast.error(t('toastFailedDelete'))
      return
    }
    toast.success(t('toastDeleted'))
    setConfirmDelete(false)
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="themed-scrollbar max-h-[85vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {event ? t('editEvent') : t('newEvent')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('typeLabel')}</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CalendarEventType)}
              disabled={!canWrite}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t(`type.${et}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('title')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              disabled={!canWrite}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('date')}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('startTime')}</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t('endTime')} <span className="text-xs text-muted-foreground">{t('optional')}</span>
              </Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('contact')}</Label>
            <select
              value={contactId}
              onChange={(e) => {
                setContactId(e.target.value)
                setDealId('')
              }}
              disabled={!canWrite}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              <option value="">{t('noContact')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>
          </div>

          {contactId && deals.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('deal')}</Label>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                disabled={!canWrite}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                <option value="">{t('noDeal')}</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canPickAssignee && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('assignedTo')}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                disabled={!canWrite}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                <option value="">{t('unassigned')}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('reminderLabel')}</Label>
            <select
              value={reminderMinutesBefore}
              onChange={(e) => setReminderMinutesBefore(e.target.value)}
              disabled={!canWrite}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              <option value="">{t('reminderNone')}</option>
              {REMINDER_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t(`reminder.${minutes}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('notes')}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              disabled={!canWrite}
              className="min-h-[80px] border-border bg-muted text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          {event && canWrite &&
            (confirmDelete ? (
              <div className="flex w-full items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs sm:mr-auto sm:w-auto">
                <span className="text-red-300">{t('deletePrompt')}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? t('deleting') : t('confirm')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300 sm:mr-auto"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('deleteEvent')}
              </button>
            ))}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          {canWrite && (
            <Button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : event ? (
                t('saveChanges')
              ) : (
                t('createEvent')
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
