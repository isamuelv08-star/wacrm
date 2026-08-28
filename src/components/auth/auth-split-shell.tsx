import type { ReactNode } from "react";

// ============================================================
// Full-bleed, edge-to-edge two-column shell for the auth screens
// (login / signup) — replaces the earlier card-in-a-frame treatment
// (rounded panel + Signal Navy signature bars) with a plain fullscreen
// 50/50 split on a near-black ground, per the approved visual
// reference. Shared by both pages so the marketing column and the
// dark form styling can't drift between them.
//
// Deliberately NOT tied to the app's saved theme/mode (same rationale
// as the design it replaces): a not-yet-authenticated visitor has no
// personalization to respect, so every color here is a literal brand
// hex rather than a --background/--primary token.
//
// `--primary` below is #D60000, NOT the pure brand swatch #FF3131:
// white text on #FF3131 measures ~3.66:1 (WCAG requires 4.5:1 for
// normal-size text), so the button/label surfaces that carry white
// text use this darker step of the same hue instead. The true #FF3131
// is kept for the headline emphasis and the small red link below,
// where it sits on the near-black ground instead of behind white text
// and clears contrast easily either way.
export const AUTH_LEFT_BG = "#0B0D12";
export const AUTH_RIGHT_BG = "#0D0F17";
export const AUTH_ACCENT = "#FF3131";
export const AUTH_ACCENT_TEXT = "#D60000";

const formPanelStyle = {
  "--background": AUTH_RIGHT_BG,
  "--card": AUTH_RIGHT_BG,
  "--foreground": "#FFFFFF",
  "--muted-foreground": "#8B92A3",
  "--primary": AUTH_ACCENT_TEXT,
  "--primary-foreground": "#FFFFFF",
  "--ring": AUTH_ACCENT_TEXT,
  "--border": "#242732",
  "--input": "#242732",
  "--muted": "#161822",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
} as React.CSSProperties;

function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <img src="/logo-mark.png" alt="" className={`${className} shrink-0 object-contain`} />
  );
}

export function AuthSplitShell({
  headline,
  tagline,
  children,
}: {
  /** Built with `t.rich(...)` by the page so the emphasized phrase can
   *  move freely per locale instead of being a fixed English-order
   *  string split in two. */
  headline: ReactNode;
  tagline: string;
  children: ReactNode;
}) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      {/* Mobile-only brand strip — the marketing column is dropped
          entirely below lg (it's persuasive copy for a visitor who
          isn't scrolling past it on a phone; the form comes first
          there), but this keeps the mark visible. */}
      <div
        className="flex shrink-0 items-center gap-2 px-6 py-5 lg:hidden"
        style={{ backgroundColor: AUTH_LEFT_BG }}
      >
        <LogoMark className="h-6 w-6" />
        <span className="font-heading text-sm font-bold text-white">Saleslid</span>
      </div>

      {/* Left column — marketing headline. Desktop only. */}
      <div
        className="relative hidden w-full flex-col justify-between overflow-hidden px-10 py-10 lg:flex lg:w-1/2 xl:px-16 xl:py-12"
        style={{ backgroundColor: AUTH_LEFT_BG }}
      >
        {/* Barely-there gradient glow, bottom-left — texture without
            competing with the text on top of it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-1/4 -left-1/4 h-[70%] w-[70%] rounded-full opacity-[0.10] blur-3xl"
          style={{ backgroundColor: AUTH_ACCENT }}
        />

        <div className="relative z-10 flex items-center gap-2">
          <LogoMark />
          <span className="font-heading text-lg font-bold text-white">Saleslid</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="font-heading text-4xl leading-[1.15] font-bold text-white xl:text-[2.75rem]">
            {headline}
          </h1>
          <p className="mt-4 max-w-md text-sm text-gray-400 xl:text-base">
            {tagline}
          </p>
        </div>

        <p className="relative z-10 text-xs text-gray-600">
          © {year} Saleslid
        </p>
      </div>

      {/* Right column — the form. Fills the screen alone on mobile. */}
      <div
        className="relative flex w-full flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:w-1/2 lg:px-16 xl:px-20"
        style={formPanelStyle}
      >
        {/* Soft seam at the 50/50 boundary instead of a hard border —
            desktop only, where the two columns actually sit side by
            side. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-32 -translate-x-1/2 lg:block"
          style={{
            background: `linear-gradient(to right, ${AUTH_LEFT_BG}, transparent)`,
          }}
        />
        <div className="relative z-10 mx-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
