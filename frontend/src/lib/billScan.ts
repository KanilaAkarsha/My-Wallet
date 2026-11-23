/**
 * On-device bill scanning: images -> tesseract.js OCR, PDFs -> text layer (pdf.js), falling back
 * to rendering pages + OCR for scanned PDFs. Nothing is sent to a server for OCR; heavy libs are
 * loaded lazily so they never affect the initial bundle.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_EDGE = 2000;
const MAX_PDF_PAGES = 3;

export interface ScanResult { text: string; /** file to attach (downscaled JPEG for photos, original for PDFs) */ attachment: File; source: 'ocr' | 'pdf-text' | 'pdf-ocr' }
export type Progress = (label: string, pct: number) => void;

export function isPdf(f: File) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }

/** Downscale + re-encode so phone photos (often 8–15 MB) fit the 5 MB upload cap and OCR faster. */
export async function prepareImage(file: File): Promise<File> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Could not read this image. Try a JPEG or PNG.');
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  for (const q of [0.88, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  throw new Error('Image is too large even after compression.');
}

async function ocr(image: Blob | HTMLCanvasElement, onProgress: Progress, label: string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress(label, m.progress); },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally { await worker.terminate(); }
}

async function loadPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

export async function scanFile(file: File, onProgress: Progress = () => {}): Promise<ScanResult> {
  if (isPdf(file)) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('PDF is larger than 5 MB. Please use a smaller file or a photo.');
    onProgress('Reading PDF', 0);
    const pdf = await loadPdf(file);
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    let text = '';
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // keep rows together: break line when the y position changes
      let lastY: number | undefined;
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2) text += '\n'; else if (text && !text.endsWith('\n')) text += ' ';
        text += it.str; lastY = y;
      }
      text += '\n';
    }
    if (text.replace(/\s/g, '').length >= 30) return { text, attachment: file, source: 'pdf-text' };
    // scanned PDF: render pages and OCR them
    let ocrText = '';
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvas, viewport: vp }).promise;
      ocrText += (await ocr(canvas, onProgress, `Scanning page ${i}/${pages}`)) + '\n';
    }
    return { text: ocrText, attachment: file, source: 'pdf-ocr' };
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Unsupported file. Use a JPEG, PNG, WebP or PDF.');
  onProgress('Preparing image', 0);
  const img = await prepareImage(file);
  const text = await ocr(img, onProgress, 'Reading text');
  return { text, attachment: img, source: 'ocr' };
}
