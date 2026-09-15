import { cn } from "@/lib/utils"

/** The app's mark (`/logo-mark.png`), centered in a soft circle — the
 *  shared visual anchor for "important moment" surfaces (confirm
 *  dialogs, invite links, feature intros) so they read as the app's
 *  own voice rather than a generic browser/system prompt. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10",
        className,
      )}
    >
      <img src="/logo-mark.png" alt="" className="size-5 object-contain" />
    </div>
  )
}
