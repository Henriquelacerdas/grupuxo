// Um bundle ESM por Lambda em `dist/<nome>/index.mjs`. O AWS SDK v3 fica externo: vem no runtime `nodejs22.x`.
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const lambdas = ["api", "webhook", "worker"];
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
for (const name of lambdas) {
  await build({
    entryPoints: [new URL(`../src/main/${name}.ts`, import.meta.url).pathname],
    outfile: new URL(`../dist/${name}/index.mjs`, import.meta.url).pathname,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@aws-sdk/*"],
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });
}
