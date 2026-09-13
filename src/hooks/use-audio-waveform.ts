"use client";

import { useEffect, useState } from "react";

export interface WaveformState {
  /** Normalized 0..1 amplitude per bar, left to right. Empty while loading/failed. */
  peaks: number[];
  status: "loading" | "ready" | "error";
}

const BAR_COUNT = 40;

// One AudioContext for the whole tab — browsers cap how many can exist at
// once, and every voice-note bubble in a long thread would otherwise try
// to create its own.
let sharedContext: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

/** Downsample a decoded channel's samples into `BAR_COUNT` peak values, normalized 0..1. */
function extractPeaks(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / BAR_COUNT));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < BAR_COUNT; i++) {
    const start = i * blockSize;
    let sum = 0;
    for (let j = 0; j < blockSize && start + j < channel.length; j++) {
      sum += Math.abs(channel[start + j]);
    }
    const avg = sum / blockSize;
    peaks.push(avg);
    if (avg > max) max = avg;
  }
  if (max === 0) return peaks.map(() => 0);
  return peaks.map((p) => p / max);
}

/**
 * Decode a short audio file (voice notes only — see the size caveat
 * below) into a fixed-length set of amplitude peaks for a WhatsApp-style
 * waveform bubble, instead of the flat progress bar a native `<audio>`
 * (or a plain `<input type="range">`) gives you.
 *
 * Deliberately NOT used for video/document audio tracks: this fetches
 * the WHOLE file into memory to decode it (Web Audio API has no
 * streaming decode), which is fine for a voice note (opus-encoded,
 * duration-capped by the recorder — realistically well under a
 * megabyte) but would be the exact anti-pattern
 * useMediaBlobUrl's own doc comment warns against for anything larger.
 */
export function useAudioWaveform(url: string | undefined): WaveformState {
  const [state, setState] = useState<WaveformState>({ peaks: [], status: "loading" });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    (async () => {
      try {
        const ctx = getAudioContext();
        if (!ctx) throw new Error("Web Audio API unavailable");
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        setState({ peaks: extractPeaks(audioBuffer), status: "ready" });
      } catch {
        if (!cancelled) setState({ peaks: [], status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
