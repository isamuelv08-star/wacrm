import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "ScalingCRM — Conversaciones que se convierten en ventas",
  description:
    "El CRM de WhatsApp para equipos que venden por chat: inbox compartido, pipelines, automatizaciones y difusiones. Autoalojable en tu propia infraestructura.",
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
