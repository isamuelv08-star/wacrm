import { NextResponse } from 'next/server'
import { extractText, getDocumentProxy } from 'unpdf'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

// Same budget as the JSON route (POST /api/ai/knowledge) — a PDF upload
// is one admin action, not a bulk operation.
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB

/**
 * POST /api/ai/knowledge/upload  (admin+)
 *
 * Multipart form: `file` (application/pdf) and optional `title`.
 * Extracts the PDF's text with `unpdf`, then stores + indexes it
 * exactly like a pasted document (POST /api/ai/knowledge).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${MAX_FILE_BYTES / (1024 * 1024)}MB` },
        { status: 400 },
      )
    }

    const titleField = form.get('title')
    const title =
      (typeof titleField === 'string' ? titleField.trim() : '') ||
      file.name.replace(/\.pdf$/i, '').trim() ||
      'Untitled document'

    let content: string
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      const { text } = await extractText(pdf, { mergePages: true })
      content = text.trim()
    } catch (err) {
      console.error('[ai/knowledge/upload POST] pdf parse error:', err)
      return NextResponse.json(
        { error: 'Could not read that PDF — it may be corrupt, encrypted, or scanned images without a text layer' },
        { status: 400 },
      )
    }
    if (!content) {
      return NextResponse.json(
        { error: 'No extractable text found in that PDF (scanned/image-only PDFs are not supported)' },
        { status: 400 },
      )
    }

    const { data: doc, error } = await supabase
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, created_by: userId, title, content })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[ai/knowledge/upload POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save document' }, { status: 500 })
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(supabase, accountId)
    try {
      await ingestDocument(supabase, accountId, { embeddingsApiKey }, doc.id, content)
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'indexing failed'
      console.error('[ai/knowledge/upload POST] ingest error:', err)
      return NextResponse.json(
        {
          success: true,
          id: doc.id,
          title,
          warning: `Saved, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
        },
        { status: 200 },
      )
    }

    if (corrupt) {
      return NextResponse.json({
        success: true,
        id: doc.id,
        title,
        warning:
          'Saved with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
      })
    }
    return NextResponse.json({ success: true, id: doc.id, title })
  } catch (err) {
    return toErrorResponse(err)
  }
}
