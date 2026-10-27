import { MAX_SNAP_BYTES } from '../../shared/snap';
export const SNAP_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
export async function prepareSnapFile(file: File, page: number, signal: AbortSignal): Promise<{ image: Blob; pages: number }> {
  if (!file.size || file.size > MAX_SNAP_BYTES) throw new Error('Choose a photo or PDF up to 5 MB.');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (file.type === 'application/pdf') {
    const { renderPdfPage } = await import('./snapPdf');
    return renderPdfPage(file, page, signal);
  }
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP photo or a PDF.');
  return { image: file, pages: 1 };
}
