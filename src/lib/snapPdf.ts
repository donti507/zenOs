import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_SNAP_BYTES } from '../../shared/snap';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function renderPdfPage(file: File, pageNumber: number, signal: AbortSignal) {
  const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, stopAtErrors: true });
  const cancel = () => { void loading.destroy(); };
  signal.addEventListener('abort', cancel, { once: true });
  const canvas = document.createElement('canvas');
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const pdf = await loading.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('Choose a page in this PDF.');
    const page = await pdf.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2000 / Math.max(original.width, original.height));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('This PDF page cannot be rendered.');
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render a PDF page.');
    await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the PDF image.')), 'image/jpeg', 0.9));
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (image.size > MAX_SNAP_BYTES) throw new Error('That rendered page is over 5 MB. Try a smaller page or photo.');
    return { image, pages: pdf.numPages };
  } finally {
    signal.removeEventListener('abort', cancel); canvas.width = 0; canvas.height = 0;
    await loading.destroy();
  }
}
