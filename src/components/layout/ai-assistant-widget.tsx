"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bot, Loader2, Send, Sparkles, UserCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Sidebar "ask your CRM" box — a subtle entry point that opens a
 * small premium chat popover talking to `/api/ai/assistant` about
 * this account's own live data (hot leads, sales vs goal, alerts...).
 * Reuses the account's already-configured BYO AI key (Setup at
 * /agents); shows a quiet CTA there instead of an error wall when
 * nothing's configured yet.
 */
export function AiAssistantWidget({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("Sidebar.assistant");
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setSending(true);
    setNotConfigured(false);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          setNotConfigured(true);
          setTurns(turns);
        } else {
          setTurns([
            ...next,
            { role: "assistant", content: data.error ?? t("replyError") },
          ]);
        }
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: "assistant",
          content:
            typeof data.reply === "string" && data.reply.trim()
              ? data.reply
              : t("replyError"),
        },
      ]);
    } catch {
      setTurns([...next, { role: "assistant", content: t("reachError") }]);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-2 text-left transition-colors hover:border-primary/30 hover:from-primary/15",
          collapsed && "lg:justify-center lg:px-0",
        )}
        title={collapsed ? t("trigger") : undefined}
      >
        <span className="relative flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="size-3.5" />
        </span>
        <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
          <span className="block truncate text-sm font-medium text-foreground">
            {t("trigger")}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {t("triggerHint")}
          </span>
        </span>
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="end"
        sideOffset={10}
        className="flex h-[26rem] w-[22rem] flex-col gap-0 overflow-hidden p-0"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {t("title")}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="themed-scrollbar flex-1 space-y-3 overflow-y-auto p-3"
        >
          {notConfigured ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
              <Bot className="mb-1 size-7 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {t("notConfigured")}
              </p>
              <Button variant="link" size="sm" render={<Link href="/agents" />}>
                {t("goToSetup")}
              </Button>
            </div>
          ) : turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
              <Bot className="mb-1 size-7 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground/80">
                <li>{t("exampleHot")}</li>
                <li>{t("exampleGoal")}</li>
              </ul>
            </div>
          ) : (
            turns.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-1.5",
                  turn.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {turn.role === "assistant" && (
                  <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
                )}
                <div
                  className={cn(
                    "max-w-[82%] rounded-xl px-3 py-1.5 text-[13px] leading-relaxed",
                    turn.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
                {turn.role === "user" && (
                  <UserCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot className="size-4 text-primary" />
              <Loader2 className="size-3.5 animate-spin" />
              {t("thinking")}
            </div>
          )}
        </div>

        {/* Composer */}
        {!notConfigured && (
          <div className="flex shrink-0 items-end gap-1.5 border-t border-border p-2.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("placeholder")}
              rows={1}
              className="themed-scrollbar max-h-24 flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              onClick={send}
              disabled={!input.trim() || sending}
              className="h-8 w-8 shrink-0 p-0"
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
