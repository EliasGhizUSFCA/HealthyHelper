import type { PixelBox } from "./regions";

let scratch: HTMLCanvasElement | null = null;
function canvas(w: number, h: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  return scratch;
}

/** Crop a pixel box from a source image and encode as a JPEG data URL, longest side <= maxSize. */
export function cropToDataUrl(src: CanvasImageSource, box: PixelBox, maxSize = 160, quality = 0.9): string {
  const scale = Math.min(1, maxSize / Math.max(box.w, box.h));
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

/** Downscale an ROI and return its RGBA pixels (for quality metrics). */
export function roiPixels(src: CanvasImageSource, box: PixelBox, size = 128): { data: Uint8ClampedArray; w: number; h: number } {
  const c = canvas(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, box.x, box.y, Math.max(1, box.w), Math.max(1, box.h), 0, 0, size, size);
  return { data: ctx.getImageData(0, 0, size, size).data, w: size, h: size };
}

/** Copy the current video frame into a canvas at native resolution (one consistent snapshot). */
export function captureFrame(video: HTMLVideoElement, target?: HTMLCanvasElement): HTMLCanvasElement {
  const c = target ?? document.createElement("canvas");
  if (c.width !== video.videoWidth) c.width = video.videoWidth;
  if (c.height !== video.videoHeight) c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  return c;
}

export function downloadBlob(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
