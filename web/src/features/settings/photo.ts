"use client";

// Foto do perfil (ProfilePhoto.swift): recorta em quadrado, reduz para no máximo 512 px e gera JPEG 0,8 (o servidor
// aceita só JPEG, até 2 MB).

export const PHOTO_SIDE = 512;
const QUALITY = 0.8;

export async function profileJPEG(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const edge = Math.min(bitmap.width, bitmap.height);
  if (edge <= 0) return null;
  const target = Math.min(edge, PHOTO_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const scale = target / edge;
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (target - width) / 2, (target - height) / 2, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", QUALITY));
}
