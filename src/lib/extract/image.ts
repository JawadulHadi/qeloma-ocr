/**
 * Image decoding for every supported format, plus the canvas sizes OCR, AI vision and previews need.
 * Heavy decoders (HEIC, TIFF) load only when such a file shows up.
 */
import { MAX_VISION_BASE64_CHARS, VISION_MAX_EDGE_PX } from '../../../shared/limits';
import type { DetectedFile, FilePreview } from './types';

const UNREADABLE_IMAGE = "This image couldn't be opened. It may be damaged, or saved in a format the browser can't read.";

/** Decoded pages never exceed this edge, which keeps canvases well inside browser memory limits. */
const MAX_DECODE_EDGE = 4000;
/** Tesseract reads small text best when the page is at least this big. */
const OCR_MIN_EDGE = 1600;
const OCR_MAX_UPSCALE = 2.5;
const PREVIEW_MAX_EDGE = 1600;
/** SVGs have no pixel size of their own; they are drawn this big. */
const SVG_RASTER_EDGE = 2000;

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser ran out of memory for images. Close other tabs and try again.');
  return context;
}

/** Draws `source` onto a new white canvas (transparent areas become paper) scaled to fit `maxEdge`. */
export function drawOnWhite(source: CanvasImageSource, width: number, height: number, maxEdge = MAX_DECODE_EDGE): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = createCanvas(width * scale, height * scale);
  const context = context2d(canvas);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function scaleCanvas(canvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (Math.abs(scale - 1) < 0.01) return canvas;
  return drawOnWhite(canvas, canvas.width * scale, canvas.height * scale, Number.POSITIVE_INFINITY);
}

/** Frees a canvas's pixel memory right away instead of waiting for garbage collection. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(UNREADABLE_IMAGE));
    img.src = url;
  });
}

async function decodeWithBrowser(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      return drawOnWhite(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    // Some formats (and older browsers) only decode through <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImageElement(url);
      if (!img.naturalWidth || !img.naturalHeight) throw new Error(UNREADABLE_IMAGE);
      return drawOnWhite(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function decodeHeic(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    // Safari decodes HEIC natively.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      return drawOnWhite(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    const { default: heic2any } = await import('heic2any');
    let converted: Blob | Blob[];
    try {
      converted = await heic2any({ blob, toType: 'image/png' });
    } catch {
      throw new Error("This HEIC photo couldn't be converted. Export it as JPEG and upload that instead.");
    }
    return decodeWithBrowser(Array.isArray(converted) ? converted[0] : converted);
  }
}

/** Every page of a TIFF: multi-page scans are common. */
async function decodeTiff(blob: Blob): Promise<HTMLCanvasElement[]> {
  const UTIF = await import('utif2');
  const buffer = await blob.arrayBuffer();
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (const ifd of UTIF.decode(buffer)) {
      UTIF.decodeImage(buffer, ifd);
      const { width, height } = ifd;
      if (!width || !height) continue;
      const rgba = UTIF.toRGBA8(ifd);
      const full = createCanvas(width, height);
      context2d(full).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, width * height * 4), width, height), 0, 0);
      canvases.push(drawOnWhite(full, width, height));
      releaseCanvas(full);
    }
  } catch {
    canvases.forEach(releaseCanvas);
    throw new Error(UNREADABLE_IMAGE);
  }
  if (canvases.length === 0) throw new Error(UNREADABLE_IMAGE);
  return canvases;
}

async function decodeSvg(blob: Blob): Promise<HTMLCanvasElement> {
  // Served as an <img>, an SVG can't run scripts or load other resources.
  const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
  try {
    const img = await loadImageElement(url);
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 150;
    const scale = SVG_RASTER_EDGE / Math.max(width, height);
    return drawOnWhite(img, width * scale, height * scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes an image file into one canvas per page (only TIFF has several). */
export async function decodeImagePages(file: Blob, detected: DetectedFile): Promise<HTMLCanvasElement[]> {
  switch (detected.mimeType) {
    case 'image/heic':
    case 'image/heif':
      return [await decodeHeic(file)];
    case 'image/tiff':
      return decodeTiff(file);
    case 'image/svg+xml':
      return [await decodeSvg(file)];
    default:
      try {
        return [await decodeWithBrowser(file)];
      } catch {
        throw new Error(UNREADABLE_IMAGE);
      }
  }
}

/** Sized for Tesseract: small images are enlarged (up to 2.5×), huge ones were already capped at decode. */
export function prepareForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest >= OCR_MIN_EDGE) return canvas;
  return scaleCanvas(canvas, Math.min(OCR_MAX_UPSCALE, OCR_MIN_EDGE / longest));
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_IMAGE))), type, quality);
  });
}

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** A JPEG for AI vision: at most VISION_MAX_EDGE_PX on its longest edge and small enough to upload. */
export async function toVisionBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  let scale = Math.min(1, VISION_MAX_EDGE_PX / Math.max(canvas.width, canvas.height));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sized = scaleCanvas(canvas, scale);
    try {
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await canvasToBlob(sized, 'image/jpeg', quality);
        if (base64Length(blob.size) <= MAX_VISION_BASE64_CHARS) return blob;
      }
    } finally {
      if (sized !== canvas) releaseCanvas(sized);
    }
    scale *= 0.75;
  }
  throw new Error('This image is too large for AI vision. Try a smaller image.');
}

/** An object URL of the canvas, at most 1600px on its longest edge. The caller revokes the URL. */
export async function canvasToPreview(canvas: HTMLCanvasElement): Promise<FilePreview> {
  const sized = scaleCanvas(canvas, Math.min(1, PREVIEW_MAX_EDGE / Math.max(canvas.width, canvas.height)));
  try {
    const blob = await canvasToBlob(sized, 'image/jpeg', 0.88);
    return { url: URL.createObjectURL(blob), width: sized.width, height: sized.height };
  } finally {
    if (sized !== canvas) releaseCanvas(sized);
  }
}
