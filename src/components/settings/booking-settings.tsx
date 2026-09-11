'use client'

import { useTranslations } from 'next-intl'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPanelHead } from './settings-panel-head'
import { BookingServicesPanel } from './booking-services-panel'
import { BookingHoursPanel } from './booking-hours-panel'
import { BookingPagesPanel } from './booking-pages-panel'
import { BookingNotificationsPanel } from './booking-notifications-panel'

/**
 * Settings → Reservas: everything needed for a Calendly-style public
 * booking flow (migration 079) — services offered, each staff member's
 * weekly hours, the shareable booking page link(s), and which WhatsApp
 * template confirms/reminds the customer once they've booked.
 */
export function BookingSettings() {
  const t = useTranslations('Settings.booking')

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">{t('tabServices')}</TabsTrigger>
          <TabsTrigger value="hours">{t('tabHours')}</TabsTrigger>
          <TabsTrigger value="pages">{t('tabPages')}</TabsTrigger>
          <TabsTrigger value="notifications">{t('tabNotifications')}</TabsTrigger>
        </TabsList>
        <TabsContent value="services" className="mt-4">
          <BookingServicesPanel />
        </TabsContent>
        <TabsContent value="hours" className="mt-4">
          <BookingHoursPanel />
        </TabsContent>
        <TabsContent value="pages" className="mt-4">
          <BookingPagesPanel />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <BookingNotificationsPanel />
        </TabsContent>
      </Tabs>
    </section>
  )
}
