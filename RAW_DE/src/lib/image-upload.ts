"use client";

/** Maximale Kantenlänge für OCR-Fotos: genug Details für Text, deutlich kleiner
 * als moderne 12–48 MP-Kameraaufnahmen. */
const MAX_DIMENSION = 3072;
const JPEG_QUALITY = 0.86;

type DrawableImage = {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  close?: () => void;
};

/**
 * Bereitet ein Kamerafoto browserseitig für die Bildanalyse vor.
 *
 * Mobile Browser liefern häufig HEIC/HEIF oder sehr große Bilder mit EXIF-
 * Orientierung. Das Canvas normalisiert diese Fälle auf ein Gemini-sicheres
 * JPEG und reduziert dadurch auch die Base64-/Request-Größe.
 */
export async function normalizeImageForAnalysis(file: File): Promise<File> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }

  try {
    const image = await loadDrawableImage(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      image.close?.();
      return file;
    }
    image.draw(context, width, height);
    image.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;

    return new File([blob], replaceExtension(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    // Safari/ältere Browser können HEIC nicht dekodieren. Nicht abbrechen:
    // der Server erhält die Originaldatei und liefert eine lesbare Meldung.
    return file;
  }
}

async function loadDrawableImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) =>
          context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch {
      // Fallback unten für Safari/ältere Browser.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Bild konnte nicht dekodiert werden."));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) =>
        context.drawImage(image, 0, 0, width, height),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function replaceExtension(name: string): string {
  const base = name.replace(/\.[^.]*$/, "");
  return `${base || "kamera-foto"}.jpg`;
}
