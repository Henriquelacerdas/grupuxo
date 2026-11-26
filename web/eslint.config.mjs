import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "react/no-danger": "error",
    },
  },
  { ignores: [".next/**", "node_modules/**", "public/sw.js", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
];

export default config;
