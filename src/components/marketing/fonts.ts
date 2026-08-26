import { Space_Grotesk } from "next/font/google";

// Display face for landing-page headlines only — deliberately NOT
// wired into the app-wide `--font-heading` token (globals.css), which
// stays Inter for the actual product UI. Scoped here so the marketing
// page can have real typographic personality without touching how
// every dashboard heading renders.
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});
