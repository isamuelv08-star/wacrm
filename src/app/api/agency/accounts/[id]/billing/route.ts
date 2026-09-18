import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import {
  updateAgencyAccountBilling,
  type AgencyAccountBillingInput,
} from '@/lib/agency/account-detail'
import type { BillingCycle, SubscriptionStatus } from '@/lib/agency/overview'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BILLING_CYCLES: BillingCycle[] = ['monthly', 'yearly']
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['trial', 'active', 'past_due', 'canceled']

/**
 * PATCH /api/agency/accounts/[id]/billing — upsert the manual
 * subscription record (migration 097) the agency owner keeps for one
 * client account. Same trust/shape conventions as
 * /api/agency/accounts/[id]'s PATCH (status).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { planName, priceAmount, billingCycle, subscriptionStatus, renewalDate, notes } = body

  if (planName !== null && typeof planName !== 'string') {
    return NextResponse.json({ error: "'planName' must be a string or null" }, { status: 400 })
  }
  if (priceAmount !== null && typeof priceAmount !== 'number') {
    return NextResponse.json({ error: "'priceAmount' must be a number or null" }, { status: 400 })
  }
  if (typeof billingCycle !== 'string' || !BILLING_CYCLES.includes(billingCycle as BillingCycle)) {
    return NextResponse.json(
      { error: `'billingCycle' must be one of: ${BILLING_CYCLES.join(', ')}` },
      { status: 400 },
    )
  }
  if (
    typeof subscriptionStatus !== 'string' ||
    !SUBSCRIPTION_STATUSES.includes(subscriptionStatus as SubscriptionStatus)
  ) {
    return NextResponse.json(
      { error: `'subscriptionStatus' must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }
  if (renewalDate !== null && typeof renewalDate !== 'string') {
    return NextResponse.json({ error: "'renewalDate' must be a string or null" }, { status: 400 })
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return NextResponse.json({ error: "'notes' must be a string or null" }, { status: 400 })
  }

  const input: AgencyAccountBillingInput = {
    planName: planName as string | null,
    priceAmount: priceAmount as number | null,
    billingCycle: billingCycle as BillingCycle,
    subscriptionStatus: subscriptionStatus as SubscriptionStatus,
    renewalDate: renewalDate as string | null,
    notes: notes as string | null | undefined,
  }

  try {
    await updateAgencyAccountBilling(id, input)
  } catch (err) {
    console.error('[PATCH /api/agency/accounts/[id]/billing] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update billing' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
