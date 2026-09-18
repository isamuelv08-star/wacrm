"use client";

import { Megaphone, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Conversation } from "@/types";

interface AdReferralCardProps {
  referral: NonNullable<Conversation["ad_referral"]>;
}

/**
 * "This conversation started from an ad" card, shown once above the
 * message list when `conversations.ad_referral` (migration 096) is
 * set — the actual Click-to-WhatsApp ad creative (image/headline)
 * behind the generic "Meta Ads" Lead Source tag. Meta serves these
 * `image_url`/`thumbnail_url` referral assets from a public ad-creative
 * CDN (unlike inbound message media), so they render directly with no
 * proxy/token needed.
 */
export function AdReferralCard({ referral }: AdReferralCardProps) {
  const t = useTranslations("Inbox.messageThread");
  const thumbnail = referral.image_url || referral.thumbnail_url;
  if (!thumbnail && !referral.headline && !referral.body) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Meta CDN asset, not a local/optimizable one
        <img
          src={thumbnail}
          alt={referral.headline || ""}
          className="h-14 w-14 flex-shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md bg-muted">
          <Megaphone className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Megaphone className="h-3.5 w-3.5" />
          {t("startedFromAd")}
        </p>
        {referral.headline && (
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {referral.headline}
          </p>
        )}
        {referral.body && (
          <p className="truncate text-xs text-muted-foreground">{referral.body}</p>
        )}
        {referral.source_url && (
          <a
            href={referral.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t("viewAd")}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
