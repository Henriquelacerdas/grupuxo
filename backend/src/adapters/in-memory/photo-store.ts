import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import { PHOTO_CONTENT_TYPE, photoKeyFor, type PhotoStore, type PhotoUploadTarget } from "../../photos/photo-store.ts";

/** Armazenamento de fotos para testes e desenvolvimento: guarda só as chaves "enviadas" e devolve URLs falsas. */
export class InMemoryPhotoStore implements PhotoStore {
  readonly uploaded = new Set<string>();
  readonly removed: string[] = [];

  uploadTarget(userID: UserID, at: Instant): PhotoUploadTarget {
    const key = photoKeyFor(userID);
    return { key, url: `memory://upload/${key}`, headers: { "Content-Type": PHOTO_CONTENT_TYPE }, expiresAt: at + 300_000 };
  }

  /** O teste "envia" a foto chamando isto, como o app faria com o `PUT` no URL de envio. */
  simulateUpload(key: string): void {
    this.uploaded.add(key);
  }

  viewURL(key: string, at: Instant): string {
    return `memory://view/${key}?day=${Math.floor(at / 86_400_000)}`;
  }

  async remove(key: string): Promise<void> {
    this.uploaded.delete(key);
    this.removed.push(key);
  }
}
