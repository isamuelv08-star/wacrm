import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Flame,
  Inbox,
  KanbanSquare,
  Mic,
  Users,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { spaceGrotesk } from "./fonts";
import { BRAND, DiagonalBars, InboxTeaserCard, ProductPreview } from "./landing-visuals";

// Literal brand hex throughout this file (not bg-primary / the app's
// live theme tokens) — see landing-visuals.tsx's top comment for why:
// an anonymous visitor's saved theme shouldn't change what the brand
// looks like here.

const SECONDARY_FEATURES = [
  {
    icon: Inbox,
    title: "Inbox unificado",
    description: "Todo tu equipo respondiendo desde una sola bandeja de WhatsApp.",
  },
  {
    icon: KanbanSquare,
    title: "Pipelines de venta",
    description: "Cada lead en un pipeline visual, sin perder de vista ninguna oportunidad.",
  },
  {
    icon: Workflow,
    title: "Automatizaciones",
    description: "Respuestas y flujos que trabajan incluso cuando tu equipo duerme.",
  },
] as const;

const EXTRA_FEATURES = [
  { icon: Mic, label: "Transcripción de notas de voz" },
  { icon: Users, label: "Asignación automática del equipo" },
  { icon: BarChart3, label: "Reportes con historial real" },
] as const;

// Explicit arbitrary-value classes (not `variant="default"`, which
// resolves to the app's live `bg-primary` / `hover:bg-primary/80`
// theme tokens) so this button is always the brand red regardless of
// a returning visitor's saved accent theme — same reasoning as the
// literal hex colors elsewhere on this page.
function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <Button
      size="lg"
      render={<Link href="/signup" />}
      className={`h-11 border-0 bg-[#D60000] px-6 text-white hover:bg-[#B80000] ${className}`}
    >
      Crear cuenta gratis
      <ArrowRight />
    </Button>
  );
}

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.abyss }}>
      {/* Nav */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src="/scaling-logo-mark.png" alt="" className="h-7 w-7 object-contain" />
            <span className={`${spaceGrotesk.className} text-base font-semibold text-white`}>
              ScalingCRM
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Button
              variant="ghost"
              render={<Link href="/login" />}
              className="hidden text-white hover:bg-white/10 hover:text-white sm:inline-flex"
            >
              Iniciar sesión
            </Button>
            <PrimaryCta />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — asymmetric split: copy left, brand bars + inbox
            teaser right. On mobile the bars/teaser drop below the
            copy instead of hiding outright, scaled down. */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: "rgba(255,49,49,0.15)", color: "#FF8A8A" }}
              >
                <Flame className="h-3.5 w-3.5" />
                Calificación de leads con IA
              </span>

              <h1
                className={`${spaceGrotesk.className} mt-5 text-4xl leading-[1.1] font-semibold text-white sm:text-5xl`}
              >
                Tu WhatsApp filtra solo quién está listo para comprar.
              </h1>

              <p className="mt-5 max-w-lg text-lg text-white/70">
                ScalingCRM califica cada conversación como{" "}
                <span className="font-semibold text-white">HOT</span>,{" "}
                <span className="font-semibold text-white">WARM</span> o{" "}
                <span className="font-semibold text-white">COLD</span> automáticamente — tu equipo
                habla primero con quien va a comprar hoy, no con quien solo pregunta el precio.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <PrimaryCta className="px-6" />
                <Button
                  size="lg"
                  variant="outline"
                  render={<Link href="/login" />}
                  className="h-11 border-white/20 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white"
                >
                  Iniciar sesión
                </Button>
              </div>

              <p className="mt-5 text-sm text-white/40">
                Open source · Autoalojable en tu propia infraestructura
              </p>
            </div>

            <div className="relative">
              <div className="relative h-64 overflow-hidden rounded-2xl sm:h-80 lg:h-[420px]">
                <DiagonalBars />
              </div>
              <div className="mt-[-4rem] flex justify-center lg:absolute lg:inset-0 lg:mt-0 lg:items-center lg:justify-center">
                <InboxTeaserCard className="-rotate-2 sm:-rotate-3" />
              </div>
            </div>
          </div>
        </section>

        {/* Features — one spotlighted (AI qualification), the rest as
            a compact list, not a grid of identical cards. */}
        <section style={{ backgroundColor: BRAND.porcelain }} className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-10 lg:grid-cols-5 lg:gap-12">
              {/* Spotlight — 3/5 width on desktop */}
              <div className="lg:col-span-3">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ backgroundColor: "rgba(214,0,0,0.1)", color: BRAND.redSafe }}
                >
                  <Flame className="h-3.5 w-3.5" />
                  La función que hace la diferencia
                </span>
                <h2
                  className={`${spaceGrotesk.className} mt-4 text-3xl font-semibold`}
                  style={{ color: BRAND.ink }}
                >
                  Calificación de leads con IA
                </h2>
                <p className="mt-3 max-w-md text-base" style={{ color: "#5B6472" }}>
                  Cada mensaje entrante se analiza y se etiqueta solo — sin que nadie tenga que leer
                  los 200 chats del día para encontrar los 5 que realmente van a comprar.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    🔴 HOT — listo para cerrar
                  </span>
                  <span className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                    🟡 WARM — interesado, falta empujar
                  </span>
                  <span className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">
                    ⚪ COLD — sin urgencia hoy
                  </span>
                </div>
              </div>

              {/* Secondary list — 2/5 width, plain rows, not cards */}
              <div className="lg:col-span-2">
                <ul className="divide-y" style={{ borderColor: "rgba(18,24,42,0.08)" }}>
                  {SECONDARY_FEATURES.map(({ icon: Icon, title, description }) => (
                    <li key={title} className="flex gap-4 py-5 first:pt-0">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: BRAND.redSafe }} />
                      <div>
                        <p className="font-semibold" style={{ color: BRAND.ink }}>
                          {title}
                        </p>
                        <p className="mt-1 text-sm" style={{ color: "#5B6472" }}>
                          {description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex flex-wrap gap-2">
                  {EXTRA_FEATURES.map(({ icon: Icon, label }) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
                      style={{ borderColor: "rgba(18,24,42,0.12)", color: "#5B6472" }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Product preview — a real (stylized) recreation of the
            inbox, not an abstract icon. */}
        <section style={{ backgroundColor: BRAND.signal }} className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-6 text-center">
            <h2 className={`${spaceGrotesk.className} text-3xl font-semibold text-white`}>
              Así se ve por dentro
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white/60">
              Un inbox de verdad, con la calificación de IA sobre cada conversación — no una hoja de
              cálculo ni WhatsApp Web suelto.
            </p>
            <div className="mt-10">
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section style={{ backgroundColor: BRAND.abyss }} className="relative overflow-hidden py-16 sm:py-20">
          <div className="relative z-10 mx-auto max-w-6xl px-6 text-center">
            <h2 className={`${spaceGrotesk.className} text-3xl font-semibold text-white sm:text-4xl`}>
              ¿Listo para que tu WhatsApp venda solo?
            </h2>
            <div className="mt-8 flex justify-center">
              <PrimaryCta className="px-8" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-white/40 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/scaling-logo-mark.png" alt="" className="h-5 w-5 object-contain" />
            <span>© {new Date().getFullYear()} ScalingCRM</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="hover:text-white">
              Iniciar sesión
            </Link>
            <Link href="/signup" className="hover:text-white">
              Crear cuenta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
