import type { Message } from "@/types";
import { clickAnchor, downloadBlob } from "@/lib/download-file";
import { loadMediaBlob, MediaResponseError } from "./blob-cache";
import { mediaFilename } from "./filename";

/**
 * Save a chat attachment to the agent's machine.
 *
 * The obvious `<a href={media_url} download>` doesn't work for either kind
 * of media we have: browsers ignore `download` on a cross-origin href (so
 * a `chat-media` bucket URL would just navigate), and inbound media lives
 * behind an auth-gated proxy with no filename in its path. Fetching the
 * bytes ourselves solves both — we get a real `Blob` (already cached by
 * `loadMediaBlob` if the thumbnail or lightbox pulled it) and full control
 * over the filename.
 *
 * Throws so the caller can toast; the only silent path is the new-tab
 * fallback below.
 */
export async function downloadMediaMessage(message: Message): Promise<void> {
  const url = message.media_url;
  if (!url) throw new Error("This message has no attachment.");

  let blob: Blob;
  try {
    blob = await loadMediaBlob(url);
  } catch (error) {
    // A refused *response* is a real failure — inbound media Meta has
    // expired 401s here, and quietly opening a tab onto that error would
    // hide it. Let the caller toast instead.
    if (error instanceof MediaResponseError) throw error;
    // A fetch that never completed is the other case: a bucket with a
    // stricter CORS policy than ours can block the XHR while the browser
    // is still perfectly able to navigate to the object. Handing the URL
    // to a new tab gets the agent to the file, visibly.
    if (openInNewTab(url)) return;
    throw error;
  }

  downloadBlob(blob, mediaFilename(message, blob.type));
}

function openInNewTab(url: string): boolean {
  if (typeof document === "undefined") return false;
  clickAnchor({ href: url, target: "_blank" });
  return true;
}
