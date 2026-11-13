"use client";

/* eslint-disable @next/next/no-img-element */
export function HeatmapViewer({ input, heatmap, opacity, show, label }: { input: string; heatmap: string; opacity: number; show: boolean; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <figure>
        <figcaption className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Model input</figcaption>
        <img src={input} alt={`${label} model input`} className="aspect-square w-full rounded border border-zinc-700 object-contain [image-rendering:pixelated]" />
      </figure>
      <figure>
        <figcaption className="mb-0.5 text-[9px] uppercase tracking-wider text-violet-400">Overlay · approximate attribution</figcaption>
        <div className="relative aspect-square w-full overflow-hidden rounded border border-violet-800">
          <img src={input} alt="" className="absolute inset-0 h-full w-full object-contain [image-rendering:pixelated]" />
          {show && <img src={heatmap} alt={`${label} Grad-CAM heatmap`} className="absolute inset-0 h-full w-full object-contain" style={{ opacity }} />}
        </div>
      </figure>
    </div>
  );
}

/** Composite input + heatmap into a PNG blob (for local diagnostic snapshots). */
export async function compositePng(input: string, heatmap: string, opacity: number): Promise<Blob> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  const [a, b] = await Promise.all([load(input), load(heatmap)]);
  const w = a.naturalWidth;
  const h = a.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w * 2;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(a, 0, 0, w, h);
  ctx.drawImage(a, w, 0, w, h);
  ctx.globalAlpha = opacity;
  ctx.drawImage(b, w, 0, w, h);
  return new Promise((res) => c.toBlob((blob) => res(blob!), "image/png"));
}
