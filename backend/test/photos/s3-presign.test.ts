import assert from "node:assert/strict";
import { test } from "node:test";
import { presignS3Url, s3Host } from "../../src/photos/s3-presign.ts";

// Exemplo da documentação da AWS ("Authenticating Requests: Using Query Parameters (AWS Signature Version 4)"):
// GET https://examplebucket.s3.amazonaws.com/test.txt, 24/05/2013 00:00:00Z, validade de 86400 s.
test("URL pré-assinada de GET bate com o exemplo oficial da AWS", () => {
  const url = presignS3Url(
    {
      method: "GET", bucket: "examplebucket", region: "us-east-1", key: "test.txt", at: Date.UTC(2013, 4, 24, 0, 0, 0),
      expiresSeconds: 86400, credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    },
    "examplebucket.s3.amazonaws.com",
  );
  assert.equal(
    url,
    "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z" +
      "&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

test("PUT assina o content-type, leva o token de sessão e codifica a chave", () => {
  const url = presignS3Url({
    method: "PUT", bucket: "grupuxo-dev-photos", region: "us-east-1", key: "photos/abc/foto de teste.jpg", at: Date.UTC(2026, 10, 6, 12, 0, 0),
    expiresSeconds: 300, credentials: { accessKeyId: "AKIA", secretAccessKey: "segredo", sessionToken: "token/com+chars" },
    signedHeaders: { "Content-Type": "image/jpeg" },
  });
  assert.ok(url.startsWith("https://grupuxo-dev-photos.s3.us-east-1.amazonaws.com/photos/abc/foto%20de%20teste.jpg?"), url);
  assert.match(url, /X-Amz-SignedHeaders=content-type%3Bhost/);
  assert.match(url, /X-Amz-Security-Token=token%2Fcom%2Bchars/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}$/);
  assert.equal(s3Host("grupuxo-dev-photos", "us-east-1"), "grupuxo-dev-photos.s3.us-east-1.amazonaws.com");
});

test("a mesma entrada gera sempre o mesmo URL e uma chave diferente muda a assinatura", () => {
  const base = {
    method: "GET", bucket: "b", region: "us-east-1", key: "photos/a", at: 0, expiresSeconds: 60,
    credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
  } as const;
  assert.equal(presignS3Url(base), presignS3Url(base));
  assert.notEqual(presignS3Url(base), presignS3Url({ ...base, key: "photos/b" }));
});
