"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  ImageOff,
  Loader2,
  Maximize2,
  Mic,
  Pause,
  Play,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { downloadMediaMessage } from "@/lib/media/download";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import { useAudioWaveform } from "@/hooks/use-audio-waveform";

/**
 * The media renderers behind `<MessageBubble>`'s image / video / audio /
 * document cases. Split out of message-bubble.tsx so that file stays a
 * thin content switch — everything here is about the two affordances
 * issue #373 asked for: open it full-size, and save it.
 *
 * Both are less trivial than they look, because the two flavours of
 * `media_url` behave differently in the browser. See
 * `@/lib/media/blob-cache` for the proxy-vs-bucket split and
 * `@/lib/media/download` for why `<a download>` alone isn't enough.
 */

type Translator = ReturnType<typeof useTranslations>;

/** Inline media size cap, shared so the four bubbles can't drift apart. */
const MEDIA_BOX = "max-h-64 max-w-60";

export function MediaUnavailable({
  label,
  t,
}: {
  label: string;
  t: Translator;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

/**
 * Kicks off a download and reports failure as a toast. Kept as a hook so
 * each bubble owns its own in-flight state — a slow 16 MB video shouldn't
 * put a spinner on every other attachment in the thread.
 */
function useMediaDownload(message: Message, t: Translator) {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [downloading, message, t]);

  return { downloading, download };
}

function MediaActionButton({
  icon: Icon,
  label,
  onClick,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      // Own surface rather than inheriting the bubble's, so the same button
      // reads on the muted inbound fill, the primary outbound fill, and on
      // top of an arbitrary photo.
      className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function MediaPlaceholder({
  children,
  pulse = false,
}: {
  children: React.ReactNode;
  /** True while genuinely loading (vs. a terminal "broken" state) —
   *  gives the box a soft shimmer instead of sitting inert, so a slow
   *  attachment reads as "still coming" rather than "did this fail?" */
  pulse?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-40 w-60 items-center justify-center rounded-xl bg-muted",
        pulse && "animate-pulse",
      )}
    >
      {children}
    </div>
  );
}

export function MediaImageBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  /** Opens the thread's lightbox on this message. Omitted ⇒ not clickable. */
  onOpen?: () => void;
  t: Translator;
}) {
  const { src, status } = useMediaBlobUrl(message.media_url);
  // The fetch can succeed and the bytes still not be a decodable image.
  const [broken, setBroken] = useState(false);
  const { downloading, download } = useMediaDownload(message, t);

  if (status === "error" || broken) {
    return (
      <MediaPlaceholder>
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </MediaPlaceholder>
    );
  }

  if (status !== "ready" || !src) {
    return (
      <MediaPlaceholder pulse>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </MediaPlaceholder>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={t("imageAlt")}
      className={cn(
        MEDIA_BOX,
        "animate-in fade-in rounded-xl object-contain shadow-md ring-1 ring-inset ring-foreground/10 duration-300",
      )}
      onError={() => setBroken(true)}
    />
  );

  return (
    <div className="group/media relative w-fit">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t("viewImage")}
          className="block cursor-zoom-in rounded-lg outline-none ring-offset-2 ring-offset-transparent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {image}
        </button>
      ) : (
        image
      )}
      {/* Hover-only: on touch there is no hover, but tapping the image opens
          the viewer, which carries a full-size Download button. */}
      <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover/media:opacity-100 group-focus-within/media:opacity-100">
        <MediaActionButton
          icon={Download}
          label={t("download")}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

export function MediaVideoBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  onOpen?: () => void;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);

  return (
    <div className="relative w-fit">
      {/* Plain URL, not a blob: the element should stream rather than wait
          for up to 16 MB to land — the proxy route this points at now
          forwards Range requests (src/lib/whatsapp/inbound-media.ts's
          proxyInboundMedia), so seeking actually works instead of the
          player stalling until the whole clip buffers. */}
      <video
        src={message.media_url}
        controls
        preload="metadata"
        className={cn(MEDIA_BOX, "animate-in fade-in rounded-xl shadow-md ring-1 ring-inset ring-foreground/10 duration-300")}
      />
      {/* Top-right, clear of the native controls — and always visible, since
          expanding is the only way to watch a clip capped at 15rem wide and
          a touch device gets no hover. */}
      <div className="absolute right-2 top-2 flex gap-1">
        {onOpen && (
          <MediaActionButton
            icon={Maximize2}
            label={t("expandVideo")}
            onClick={onOpen}
          />
        )}
        <MediaActionButton
          icon={Download}
          label={t("download")}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A themed voice-note player, replacing the browser's native
 * `<audio controls>` — which renders with the OS's own chrome
 * (different per browser, never matching the app's dark theme) and
 * looks out of place next to every other custom-styled bubble.
 *
 * The `<audio>` element itself is kept (muted of its native UI via
 * `controls={false}`) purely as the playback engine, driven through a
 * ref; play/pause, seek, and the elapsed/total time readout are all
 * custom-rendered. The scrub track is a real waveform (see
 * `useAudioWaveform`) rather than a flat progress bar — bars already
 * played fill with the primary color, the rest stay a soft neutral
 * tint, same visual language WhatsApp/most modern chat apps use for a
 * voice note, and a click anywhere on it seeks.
 */
export function MediaAudioBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const { peaks } = useAudioWaveform(message.media_url);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  }

  function seekToFraction(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.min(duration, Math.max(0, fraction * duration));
    audio.currentTime = next;
    setCurrentTime(next);
  }

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = waveformRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    seekToFraction((e.clientX - rect.left) / rect.width);
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  // Skeleton bars — a fixed short/tall/short pattern reads as "a
  // waveform is coming" rather than a suspicious flat line, for the
  // moment before decoding finishes (or if it fails entirely; the
  // click-to-seek behavior still works off `duration` either way).
  const displayPeaks = peaks.length > 0 ? peaks : Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 0.35 : 0.6));

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} src={message.media_url} preload="metadata" className="hidden" />
      <div className="flex w-60 items-center gap-2.5 rounded-full bg-background/50 px-2 py-1.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? t("pauseAudio") : t("playAudio")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            ref={waveformRef}
            onClick={handleWaveformClick}
            role="slider"
            aria-label={t("audio")}
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={currentTime}
            className="flex h-5 flex-1 cursor-pointer items-center gap-[2px]"
          >
            {displayPeaks.map((peak, i) => (
              <span
                key={i}
                className={cn(
                  "w-full min-w-[2px] rounded-full transition-colors",
                  i / displayPeaks.length <= progress
                    ? "bg-primary"
                    : peaks.length > 0
                      ? "bg-foreground/20"
                      : "animate-pulse bg-foreground/10",
                )}
                style={{ height: `${Math.max(15, peak * 100)}%` }}
              />
            ))}
          </div>
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <Mic className="h-2.5 w-2.5 shrink-0" />
            {formatAudioTime(playing || currentTime > 0 ? currentTime : duration)}
          </span>
        </div>
      </div>
      <MediaActionButton
        icon={Download}
        label={t("download")}
        onClick={download}
        busy={downloading}
      />
    </div>
  );
}

export function MediaDocumentBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);

  return (
    <div className="flex items-center gap-2">
      <a
        href={message.media_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
      >
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="truncate">{message.content_text || t("document")}</span>
      </a>
      <MediaActionButton
        icon={Download}
        label={t("download")}
        onClick={download}
        busy={downloading}
      />
    </div>
  );
}
