import type { Conversation } from "@/types";

export type ConversationPlatform = "whatsapp" | "instagram" | "messenger";

/**
 * The channel a conversation arrived on. `conversation.platform` is a
 * real DB column since migration 080 (Messenger); Instagram still has
 * no backend behind it and is never actually populated, but reading it
 * here rather than hardcoding "whatsapp" keeps this helper ready for it.
 */
export function getConversationPlatform(
  conversation: Pick<Conversation, "platform"> | null | undefined,
): ConversationPlatform {
  if (conversation?.platform === "instagram") return "instagram";
  if (conversation?.platform === "messenger") return "messenger";
  return "whatsapp";
}

/**
 * Brand-referencing accent colors — deliberately desaturated nods to each
 * platform's identity rather than a literal copy of its logo colors.
 * Expressed in oklch so they combine cleanly with the app's own oklch
 * theme tokens via `color-mix()`.
 */
export const WHATSAPP_TINT = "oklch(0.7 0.12 152)";

// orange -> magenta -> purple, muted versus the saturated real IG mark.
export const INSTAGRAM_STOPS = [
  "oklch(0.78 0.14 55)",
  "oklch(0.64 0.19 5)",
  "oklch(0.55 0.17 325)",
] as const;

export const INSTAGRAM_GRADIENT = `linear-gradient(135deg, ${INSTAGRAM_STOPS[0]}, ${INSTAGRAM_STOPS[1]}, ${INSTAGRAM_STOPS[2]})`;

/** Single mid-gradient hue, for spots that need one flat accent color. */
export const INSTAGRAM_ACCENT = INSTAGRAM_STOPS[1];

// blue -> violet, a muted nod to Messenger's own gradient bubble mark.
export const MESSENGER_STOPS = [
  "oklch(0.62 0.19 258)",
  "oklch(0.58 0.22 295)",
] as const;

export const MESSENGER_GRADIENT = `linear-gradient(135deg, ${MESSENGER_STOPS[0]}, ${MESSENGER_STOPS[1]})`;

/** Single mid-gradient hue, for spots that need one flat accent color. */
export const MESSENGER_ACCENT = MESSENGER_STOPS[0];

/**
 * A soft, mode-adaptive background tint for the given platform, blended
 * against a surface token (defaults to `--background`) so it stays subtle
 * in both light and dark mode instead of a fixed hex that only looks right
 * in one.
 */
export function platformSoftBackground(
  platform: ConversationPlatform,
  strength = 8,
  surfaceVar: "--background" | "--card" | "--muted" = "--background",
): string {
  if (platform === "whatsapp") {
    return `color-mix(in oklch, ${WHATSAPP_TINT} ${strength}%, var(${surfaceVar}))`;
  }
  const stops = platform === "messenger" ? MESSENGER_STOPS : INSTAGRAM_STOPS;
  return `linear-gradient(135deg, ${stops.map(
    (stop) => `color-mix(in oklch, ${stop} ${strength}%, var(${surfaceVar}))`,
  ).join(", ")})`;
}
