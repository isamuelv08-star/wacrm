import Link from "next/link";
import {
  ArrowRight,
  Inbox,
  KanbanSquare,
  Megaphone,
  Server,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const FEATURES = [
  {
    icon: Inbox,
    title: "Inbox unificado",
    description:
      "Todas las conversaciones de WhatsApp e Instagram de tu equipo en una sola bandeja compartida, sin perder ningún mensaje.",
  },
  {
    icon: KanbanSquare,
    title: "Pipelines de venta",
    description:
      "Organiza tus contactos en pipelines visuales por etapa y da seguimiento antes de que una oportunidad se enfríe.",
  },
  {
    icon: Workflow,
    title: "Automatizaciones",
    description:
      "Flujos y respuestas automáticas que atienden a tus contactos por ti, incluso fuera de horario.",
  },
  {
    icon: Megaphone,
    title: "Difusiones",
    description:
      "Envía campañas de WhatsApp a listas segmentadas de contactos y mide qué tan bien están funcionando.",
  },
] as const;

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img
              src="/scaling-logo-mark.png"
              alt=""
              className="h-7 w-7 object-contain"
            />
            <span className="font-heading text-base font-semibold">
              ScalingCRM
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href="/login" />}>
              Iniciar sesión
            </Button>
            <Button render={<Link href="/signup" />}>Crear cuenta</Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center sm:py-28">
          <h1 className="font-heading max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Conversaciones que se convierten en ventas
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            El CRM de WhatsApp para equipos que venden por chat: inbox
            compartido, pipelines, automatizaciones y difusiones — en un solo
            lugar, autoalojable en tu propia infraestructura.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              className="h-11 px-6"
              render={<Link href="/signup" />}
            >
              Crear cuenta gratis
              <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6"
              render={<Link href="/login" />}
            >
              Iniciar sesión
            </Button>
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <Card key={title}>
                  <CardHeader>
                    <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </span>
                    <CardTitle>{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </span>
              <div>
                <p className="font-heading font-medium">Autoalojable</p>
                <p className="text-sm text-muted-foreground">
                  Tus datos, tu servidor. Instálalo con Docker donde tú
                  decidas.
                </p>
              </div>
            </div>
            <Button render={<Link href="/signup" />}>
              Empezar ahora
              <ArrowRight />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <img
              src="/scaling-logo-mark.png"
              alt=""
              className="h-5 w-5 object-contain"
            />
            <span>© {new Date().getFullYear()} ScalingCRM</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Iniciar sesión
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Crear cuenta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
