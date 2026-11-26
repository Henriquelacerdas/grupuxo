"use client";

// Foto do perfil escolhida no primeiro passo: recortada em quadrado e reduzida para JPEG de até 512 px no
// navegador (o BFF aceita até 2 MB, só JPEG). Sobe depois que a casa existe, como no app.

const SIDE = 512;

export async function squareJPEG(file: File): Promise<Blob | null> {
  if (!file.type.startsWith("image/")) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const crop = Math.min(bitmap.width, bitmap.height);
  const side = Math.min(SIDE, crop);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
}
