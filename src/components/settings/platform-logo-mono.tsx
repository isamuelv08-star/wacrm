import { WhatsAppGlyph, MessengerGlyph, InstagramGlyph } from '@/components/icons/brand-icons';

/**
 * Monochrome "negative" mark for a channel-connection card — a solid
 * black chip with the platform's glyph in white, instead of the
 * brand-colored badge <PlatformIcon> (platform-accent.tsx) renders
 * for the inbox's own channel badges/avatar rings. Deliberately a
 * separate component rather than a mode on PlatformIcon: this look is
 * specific to the Settings → Integrations connection cards (and the
 * onboarding wizard's channel list), not the inbox, where the colored
 * badges still help tell channels apart at a glance in a busy list.
 */
export function PlatformLogoMono({
  platform,
  className = 'h-4 w-4',
}: {
  platform: 'whatsapp' | 'messenger' | 'instagram';
  className?: string;
}) {
  const Glyph =
    platform === 'whatsapp' ? WhatsAppGlyph : platform === 'messenger' ? MessengerGlyph : InstagramGlyph;

  return (
    <span className="flex items-center justify-center rounded-full bg-black p-2 text-white">
      <Glyph className={className} />
    </span>
  );
}
