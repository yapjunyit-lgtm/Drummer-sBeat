"use client";

import { jsPDF } from "jspdf";

const PAGE_W = 860;
const PAGE_H = 1216;

/* The Bravura music font (base64 data URL), fetched once and embedded into
   the serialised SVG so the isolated SVG image renders the exact same note
   glyphs as the on-screen score. */
let bravuraDataUrl: string | null | undefined;

async function fetchBravura(): Promise<string | null> {
  if (bravuraDataUrl !== undefined) return bravuraDataUrl;
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/@vexflow-fonts/bravura/bravura.woff2"
    );
    if (!res.ok) throw new Error(`font fetch ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    bravuraDataUrl = `data:font/woff2;base64,${btoa(binary)}`;
  } catch {
    bravuraDataUrl = null;
  }
  return bravuraDataUrl;
}

/* Export the main score pages (SVG rendered by VexFlow) to a real A4 PDF.
   Each page is rasterised at 2× from the live SVG so the notation fonts
   resolve, then embedded into a printable A4 document. */
export async function exportScorePdf(
  container: HTMLElement | null,
  fileName: string
): Promise<void> {
  if (!container) throw new Error("Score area not found");
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(".score-page")
  );
  const svgs = pages.map((p) => p.querySelector<SVGSVGElement>("svg"));
  if (pages.length === 0 || svgs.some((s) => !s)) {
    throw new Error("No score pages to export");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const scale = 2;
  const w = PAGE_W * scale;
  const h = PAGE_H * scale;

  for (let i = 0; i < pages.length; i++) {
    const pageEl = pages[i];
    const svg = svgs[i] as SVGSVGElement;

    // Hidden pages may fail to rasterise; reveal them briefly.
    const wasHidden = pageEl.classList.contains("hidden");
    pageEl.classList.remove("hidden");
    await new Promise((r) => requestAnimationFrame(r));

    // Serialise the SVG to an image so the browser rasterises it with the
    // notation fonts (drawing an SVG node directly is not supported). Embed
    // Bravura so the music symbols match the score exactly.
    const font = await fetchBravura();
    const fontStyle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style"
    );
    if (font) {
      fontStyle.textContent = `@font-face{font-family:"Bravura";src:url(${font}) format("woff2");}`;
      svg.prepend(fontStyle);
    }
    const xml = new XMLSerializer().serializeToString(svg);
    fontStyle.remove();
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterisation failed"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    try {
      ctx.drawImage(img, 0, 0, w, h);
    } finally {
      URL.revokeObjectURL(url);
      if (wasHidden) pageEl.classList.add("hidden");
    }

    if (i > 0) doc.addPage();
    doc.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      595.28,
      841.89,
      undefined,
      "FAST"
    );
  }

  doc.save(`${fileName || "score"}.pdf`);
}
