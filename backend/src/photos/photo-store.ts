import type { Instant } from "../domain/dates.ts";
import type { UserID } from "../domain/ids.ts";
import type { HttpFetch } from "../http.ts";
import { presignS3Url, type AwsCredentials } from "./s3-presign.ts";

/** Foto do perfil do morador. O objeto vive no S3; o app envia e lê direto por URLs pré-assinadas. */
export interface PhotoUploadTarget {
  /** Chave gravada no perfil depois que o app confirma o envio. */
  readonly key: string;
  readonly url: string;
  /** Cabeçalhos que o app precisa mandar iguais no `PUT`. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Instant;
}

export interface PhotoStore {
  /** URL de envio da foto de `userID` (substitui a anterior: a chave é uma só por morador). */
  uploadTarget(userID: UserID, at: Instant): PhotoUploadTarget;
  /** URL de leitura estável por dia (o app a guarda em cache); `null` se a chave não for uma foto de morador. */
  viewURL(key: string, at: Instant): string;
  remove(key: string): Promise<void>;
}

/** Chave única do morador: enviar de novo sobrescreve, então nunca sobra objeto órfão. */
export const photoKeyFor = (userID: UserID): string => `photos/${userID}`;

export const PHOTO_CONTENT_TYPE = "image/jpeg";
const UPLOAD_SECONDS = 300;
const VIEW_SECONDS = 7 * 24 * 3600;
const DAY = 24 * 3600 * 1000;

export interface S3PhotoStoreOptions {
  readonly bucket: string;
  readonly region: string;
  /** Lidas a cada uso: na Lambda, as credenciais temporárias vêm do ambiente. */
  readonly credentials: () => AwsCredentials;
  /** Só para apagar o objeto (`DELETE` pré-assinado). */
  readonly http: HttpFetch;
}

export class S3PhotoStore implements PhotoStore {
  private readonly options: S3PhotoStoreOptions;

  constructor(options: S3PhotoStoreOptions) {
    this.options = options;
  }

  uploadTarget(userID: UserID, at: Instant): PhotoUploadTarget {
    const key = photoKeyFor(userID);
    const headers = { "Content-Type": PHOTO_CONTENT_TYPE };
    const url = presignS3Url({
      method: "PUT", bucket: this.options.bucket, region: this.options.region, key, at, expiresSeconds: UPLOAD_SECONDS,
      credentials: this.options.credentials(), signedHeaders: headers,
    });
    return { key, url, headers, expiresAt: at + UPLOAD_SECONDS * 1000 };
  }

  /** A assinatura usa o começo do dia (UTC) e vale 7 dias: o URL muda só uma vez por dia e o cache do app funciona. */
  viewURL(key: string, at: Instant): string {
    return presignS3Url({
      method: "GET", bucket: this.options.bucket, region: this.options.region, key, at: Math.floor(at / DAY) * DAY,
      expiresSeconds: VIEW_SECONDS, credentials: this.options.credentials(),
    });
  }

  async remove(key: string): Promise<void> {
    const url = presignS3Url({
      method: "DELETE", bucket: this.options.bucket, region: this.options.region, key, at: Date.now(), expiresSeconds: 60,
      credentials: this.options.credentials(),
    });
    const response = await this.options.http(url, { method: "DELETE" });
    // 204 (apagado) e 404 (já não existe) bastam: apagar é idempotente.
    if (!response.ok && response.status !== 404) throw new Error("photoRemoveFailed");
  }
}
