# backend

Backend do Grupuxo em Node.js (22.18 ou superior) + TypeScript: domínio e algoritmo de distribuição portados do `GrupuxoDomain` (Swift) e canal WhatsApp. **Zero dependências de runtime**; dev-dependencies: `typescript` e `@types/node`.

Arquitetura, decisões e estado: [../docs/BACKEND.md](../docs/BACKEND.md). Contrato do algoritmo e verificação cruzada com o Swift: [../docs/ALGORITMO.md](../docs/ALGORITMO.md). Guia de contribuição: [../CLAUDE.md](../CLAUDE.md).

```sh
npm install
npm run typecheck      # tsc --noEmit
npm test               # unitários, contratos e fixtures de referência
npm run test:fixtures  # só as comparações com o Swift
```

- `src/domain/` domínio puro (sem `node:*`, sem I/O, sem relógio global).
- `src/whatsapp/` webhook, worker, vínculo por token, envio pela Graph API, limite de taxa e ports.
- `src/lambdas/` handlers `webhook`, `worker` e `api` (API Gateway HTTP API v2 e SQS), config e composição; sem ponto de entrada ainda.
- `src/auth/` validação do JWT do Cognito (só access token), JWKS e `UserDirectory`.
- `src/http.ts` tipo `HttpFetch` (HTTP de saída injetável).
- `src/adapters/in-memory/` adaptadores para dev e testes.
- `test/fixtures/` casos dourados gerados do Swift; para regenerar: `tools/swift-fixtures/regenerate.sh` (precisa do toolchain Swift).
