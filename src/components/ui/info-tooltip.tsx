"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Small "ⓘ" affordance for explaining what a feature does, right next
 * to its own label — click (not hover) so it works the same on touch
 * devices. Generic on purpose: the inbox sidebar's Tags/Notes headers
 * are the first callers, but any section header in the app that could
 * use a one-line "what does this do?" can reach for this instead of a
 * one-off tooltip.
 */
export function InfoTooltip({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={title}
        className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-64" side="top" align="start">
        <PopoverTitle className="text-xs">{title}</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed">
          {children}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
