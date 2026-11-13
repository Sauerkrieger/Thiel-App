/** MIME-Typen, die Gemini Vision für Inline-Bilddaten akzeptiert. */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/**
 * Ermittelt einen stabilen MIME-Typ auch dann, wenn mobile Browser `file.type`
 * leer oder als application/octet-stream melden.
 */
export function resolveImageMimeType(
  browserType: string,
  fileName: string,
): SupportedImageMimeType | null {
  const type = browserType.toLowerCase().trim();
  if (type === "image/jpg") return "image/jpeg";
  if ((SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(type)) {
    return type as SupportedImageMimeType;
  }

  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return null;
  }
}
