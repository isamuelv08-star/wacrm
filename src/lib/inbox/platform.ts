import type { Conversation } from "@/types";

export type ConversationPlatform = "whatsapp" | "instagram";

/**
 * The channel a conversation arrived on. Every conversation today comes
 * through WhatsApp — there is no Instagram integration wired up yet, so
 * `conversation.platform` is never actually populated — but reading it
 * first (rather than hardcoding "whatsapp") keeps every consumer of this
 * helper forward-compatible with a real multi-channel backend later.
 */
export function getConversationPlatform(
  conversation: Pick<Conversation, "platform"> | null | undefined,
): ConversationPlatform {
  return conversation?.platform === "instagram" ? "instagram" : "whatsapp";
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
  return `linear-gradient(135deg, ${INSTAGRAM_STOPS.map(
    (stop) => `color-mix(in oklch, ${stop} ${strength}%, var(${surfaceVar}))`,
  ).join(", ")})`;
}
