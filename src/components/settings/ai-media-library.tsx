'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, ImageIcon, Video, FileText, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { uploadAccountMedia, deleteAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media';

type MediaKind = 'image' | 'video' | 'document';

interface MediaItem {
  id: string;
  key: string;
  title: string;
  description: string;
  media_kind: MediaKind;
  media_url: string;
  created_at: string;
}

const BUCKET = 'ai-media-library';
const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
};

/** Lowercase, ASCII, "_"/"-" only, capped at 60 chars — mirrors the
 *  DB's own CHECK constraint (migration 072) so a rejected key fails
 *  fast client-side instead of round-tripping to the API first. */
function slugifyKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'item';
}

function kindForFile(file: File): MediaKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

export function AiMediaLibraryCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('Settings.aiMediaLibrary');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Staged file + form, shown once a file is picked; cleared on
  // cancel/save.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/media-library');
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchItems();
  }, [accountId, fetchItems]);

  const pickFile = () => fileInputRef.current?.click();

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const kind = kindForFile(file);
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) {
      toast.error(t('fileTooLarge'));
      return;
    }
    setPendingFile(file);
    const base = file.name.replace(/\.[^.]+$/, '');
    setKey(slugifyKey(base));
    setTitle(base);
    setDescription('');
  };

  const cancelAdd = () => {
    setPendingFile(null);
    setKey('');
    setTitle('');
    setDescription('');
  };

  const save = async () => {
    if (!pendingFile) return;
    const cleanKey = slugifyKey(key);
    if (!title.trim() || !description.trim()) {
      toast.error(t('titleDescriptionRequired'));
      return;
    }
    setSaving(true);
    let uploaded: { publicUrl: string; path: string } | null = null;
    try {
      uploaded = await uploadAccountMedia(BUCKET, pendingFile);
      const res = await fetch('/api/ai/media-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: cleanKey,
          title: title.trim(),
          description: description.trim(),
          media_kind: kindForFile(pendingFile),
          media_url: uploaded.publicUrl,
          storage_path: uploaded.path,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The metadata row failed to save — don't leave an orphaned
        // upload behind.
        await deleteAccountMedia(BUCKET, uploaded.path).catch(() => {});
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
      cancelAdd();
      await fetchItems();
    } catch (err) {
      if (uploaded) await deleteAccountMedia(BUCKET, uploaded.path).catch(() => {});
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: MediaItem) => {
    setRemovingId(item.id);
    try {
      const res = await fetch(`/api/ai/media-library/${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Images className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {items.length === 0 && !pendingFile && (
              <p className="text-sm text-muted-foreground">{t('noItems')}</p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((item) => {
                  const Icon = KIND_ICON[item.media_kind];
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          <code className="rounded bg-muted px-1 py-0.5">{item.key}</code>{' '}
                          {item.description}
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(item)}
                          disabled={removingId === item.id}
                          title={t('remove')}
                        >
                          {removingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && pendingFile && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="truncate text-xs text-muted-foreground">
                  {t('selectedFile', { name: pendingFile.name })}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="media-key">{t('keyLabel')}</Label>
                  <Input
                    id="media-key"
                    value={key}
                    onChange={(e) => setKey(slugifyKey(e.target.value))}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">{t('keyHint')}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="media-title">{t('titleLabel')}</Label>
                  <Input
                    id="media-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="media-description">{t('descriptionLabel')}</Label>
                  <Textarea
                    id="media-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                    rows={2}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">{t('descriptionHint')}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelAdd} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('save')}
                  </Button>
                </div>
              </div>
            )}

            {canEdit && !pendingFile && (
              <div>
                <Button variant="outline" size="sm" onClick={pickFile}>
                  <Plus className="mr-2 h-4 w-4" /> {t('addItem')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/plain"
                  className="hidden"
                  onChange={onFileSelected}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
