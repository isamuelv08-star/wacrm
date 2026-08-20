import { Camera, MessageCircle } from "lucide-react";
import {
  INSTAGRAM_GRADIENT,
  WHATSAPP_TINT,
  type ConversationPlatform,
} from "@/lib/inbox/platform";

/**
 * Small filled icon chip identifying a conversation's platform — used on
 * the "Todas" tab so each row's origin is recognizable at a glance without
 * fully tinting the row. Lucide dropped brand marks a while back, so
 * Instagram is represented by a camera glyph on the gradient rather than
 * the literal logo.
 */
export function PlatformIcon({
  platform,
  className = "h-3 w-3",
}: {
  platform: ConversationPlatform;
  className?: string;
}) {
  // `ring-2 ring-card` separates the chip from whatever it's sitting on
  // top of (the avatar) — without it, the badge's edge blends straight
  // into the avatar behind it instead of reading as a distinct badge.
  if (platform === "instagram") {
    return (
      <span
        aria-label="Instagram"
        className="flex items-center justify-center rounded-full p-[3px] text-white shadow-sm ring-2 ring-card"
        style={{ backgroundImage: INSTAGRAM_GRADIENT }}
      >
        <Camera className={className} />
      </span>
    );
  }
  return (
    <span
      aria-label="WhatsApp"
      className="flex items-center justify-center rounded-full p-[3px] text-white shadow-sm ring-2 ring-card"
      style={{ backgroundColor: WHATSAPP_TINT }}
    >
      <MessageCircle className={className} />
    </span>
  );
}

/**
 * Wraps an avatar with Instagram's "story ring" gradient border; WhatsApp
 * gets a plain (no-ring) wrapper.
 *
 * Both branches must render an actual sized element carrying `sizeClass` —
 * the wrapped avatar's own classes are `h-full w-full`, so without a
 * definite-size ancestor here those percentages have nothing to resolve
 * against. An earlier version returned `<>{children}</>` (a bare Fragment,
 * i.e. no box at all) for the WhatsApp case, which let the avatar collapse
 * or balloon unpredictably depending on its flex context — the caved-in
 * "not a real circle" avatar and squeezed-out name in the inbox both
 * traced back to that.
 */
export function AvatarRing({
  platform,
  sizeClass,
  children,
}: {
  platform: ConversationPlatform;
  /** Tailwind size classes matching the wrapped avatar, e.g. "h-10 w-10". */
  sizeClass: string;
  children: React.ReactNode;
}) {
  if (platform === "instagram") {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full p-[2px] ${sizeClass}`}
        style={{ backgroundImage: INSTAGRAM_GRADIENT }}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-card p-[1.5px]">
          {children}
        </span>
      </span>
    );
  }
  return <span className={`flex shrink-0 ${sizeClass}`}>{children}</span>;
}
