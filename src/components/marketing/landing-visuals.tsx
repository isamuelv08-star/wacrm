// Decorative + demo visuals for the marketing landing page. Colors are
// literal brand hex — NOT the app's live theme tokens (bg-primary,
// etc.) — same reasoning as the login screen's ScalingSignaturePanel:
// an anonymous visitor's browser may carry a saved theme/mode from a
// previous session on this machine, and the marketing page should
// always show the real brand identity regardless of that.
import { Flame } from "lucide-react";

export const BRAND = {
  abyss: "#0A1120", // primary dark background
  signal: "#122A4E", // secondary dark section
  steel: "#224370", // structural accent on dark
  red: "#FF3131", // decorative accent, glow, large bold CTA text
  redSafe: "#D60000", // normal-size text-bearing UI (buttons, links)
  porcelain: "#FAF8F5", // light section background
  ink: "#12182A", // text on porcelain
} as const;

/**
 * Same diagonal-cut bar geometry as the login screen's
 * ScalingSignaturePanel, re-proportioned for a landscape hero panel
 * instead of a tall one. `aria-hidden` — purely decorative.
 */
export function DiagonalBars() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <span
        className="absolute inset-y-[-20%] left-[-10%] w-[30%]"
        style={{
          backgroundColor: BRAND.steel,
          clipPath: "polygon(60% 0%, 85% 0%, 40% 100%, 15% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-20%] left-[24%] w-[20%]"
        style={{
          backgroundColor: BRAND.red,
          clipPath: "polygon(60% 0%, 80% 0%, 35% 100%, 15% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-20%] left-[52%] w-[34%]"
        style={{
          backgroundColor: BRAND.steel,
          clipPath: "polygon(60% 0%, 90% 0%, 40% 100%, 10% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-20%] left-[90%] w-[18%]"
        style={{
          backgroundColor: "#1A3660",
          clipPath: "polygon(60% 0%, 85% 0%, 35% 100%, 10% 100%)",
        }}
      />
    </div>
  );
}

const TEASER_ROWS = [
  { name: "Juana Torres", text: "Sí, quiero el paquete completo", tag: "HOT", time: "2m", dot: BRAND.red },
  { name: "Carlos Ruiz", text: "¿Cuánto cuesta el envío?", tag: "WARM", time: "12m", dot: "#F5A524" },
  { name: "Ana Gómez", text: "Gracias, después reviso", tag: "COLD", time: "1h", dot: "#94A3B8" },
] as const;

const TAG_STYLE: Record<(typeof TEASER_ROWS)[number]["tag"], string> = {
  HOT: "bg-red-100 text-red-700",
  WARM: "bg-amber-100 text-amber-700",
  COLD: "bg-slate-100 text-slate-600",
};

/** Small floating "inbox" card for the hero — the visual hook is the
 *  real HOT/WARM/COLD lead-scoring feature, not an abstract icon. */
export function InboxTeaserCard({ className }: { className?: string }) {
  return (
    <div
      className={`w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl shadow-black/50 ${className ?? ""}`}
    >
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-medium text-slate-500">Inbox · en vivo</span>
      </div>
      <ul className="space-y-3">
        {TEASER_ROWS.map((row) => (
          <li key={row.name} className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.dot }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{row.name}</p>
              <p className="truncate text-xs text-slate-500">{row.text}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TAG_STYLE[row.tag]}`}>
                {row.tag}
              </span>
              <span className="text-[10px] text-slate-400">{row.time}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SIDEBAR_ROWS = [
  { name: "Juana Torres", dot: BRAND.red, active: true },
  { name: "Carlos Ruiz", dot: "#F5A524", active: false },
  { name: "Ana Gómez", dot: "#94A3B8", active: false },
  { name: "Luis Peña", dot: "#94A3B8", active: false },
] as const;

/** Larger "browser chrome" mockup for the dedicated product section —
 *  a stylized recreation of the real inbox layout (sidebar + thread),
 *  not a screenshot. Sidebar hides below `sm` so the mobile view still
 *  reads clearly instead of cramming a 3-column layout into a phone. */
export function ProductPreview() {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#0F1B33] shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/20 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-3 truncate rounded-md bg-white/5 px-3 py-1 text-[11px] text-white/40">
          app.scalingcrm.com/inbox
        </span>
      </div>
      <div className="flex flex-col sm:flex-row">
        <div className="hidden w-44 shrink-0 border-r border-white/10 p-3 sm:block">
          {SIDEBAR_ROWS.map((row) => (
            <div
              key={row.name}
              className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${row.active ? "bg-white/10 text-white" : "text-white/50"}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.dot }} />
              <span className="truncate">{row.name}</span>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-sm font-semibold text-red-300">
              JT
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">Juana Torres</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                <Flame className="h-2.5 w-2.5" />
                HOT · calificado por IA
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-3 py-2 text-sm text-white/90 sm:max-w-[75%]">
              Hola, ¿todavía tienen el paquete premium disponible?
            </div>
            <div
              className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-white sm:max-w-[75%]"
              style={{ backgroundColor: BRAND.redSafe }}
            >
              ¡Sí! Te paso el detalle ahora mismo 👇
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-3 py-2 text-sm text-white/90 sm:max-w-[75%]">
              Perfecto, quiero comprarlo hoy mismo
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
