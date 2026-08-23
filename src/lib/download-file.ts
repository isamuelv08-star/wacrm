// Shared "trigger a browser download" primitive. Extracted out of
// src/lib/media/download.ts (which needs it for chat attachments) so
// src/lib/pipelines/report.ts can reuse the exact same mechanism for
// CSV exports instead of duplicating it.

/**
 * Programmatic anchor click. An anchor is used rather than
 * `window.open` because it isn't subject to the popup blocker, and
 * because `download` only exists on anchors.
 */
export function clickAnchor(attrs: { href: string; download?: string; target?: string }): void {
  const a = document.createElement("a");
  a.href = attrs.href;
  if (attrs.download) a.download = attrs.download;
  if (attrs.target) {
    a.target = attrs.target;
    a.rel = "noopener noreferrer";
  }
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Saves a Blob to the user's machine under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickAnchor({ href: objectUrl, download: filename });
  } finally {
    // Revoking in the same tick can cancel the download in Safari; a
    // beat later the browser has taken its own reference to the bytes.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
