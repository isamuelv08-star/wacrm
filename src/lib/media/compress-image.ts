/**
 * Shrink a photo in the browser before it's uploaded to chat-media: a
 * 12 MP phone photo (3–5 MB) becomes a ~200–400 KB JPEG at 1600 px,
 * which is more than WhatsApp itself shows. Saves Storage and makes
 * sends faster. Anything that isn't a still JPEG/PNG/WebP, is already
 * small, or would not get smaller is returned unchanged.
 */

const MAX_SIDE = 1600
const QUALITY = 0.82
const SKIP_BELOW_BYTES = 400 * 1024
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function compressImageForChat(file: File): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || file.size < SKIP_BELOW_BYTES) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // JPEG has no transparency — paint PNG/WebP cutouts on white, not black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
