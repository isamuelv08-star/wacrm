import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The public marketing site now lives at salelid.com, a separate
// project (salelid-web) — this app only serves the authenticated
// product at app.salelid.com, so its own root has nothing public to
// show and just sends visitors to wherever they belong.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
