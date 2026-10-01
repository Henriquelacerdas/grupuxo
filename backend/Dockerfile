# Verifica que o backend (e o GrupuxoDomain) compilam e passam nos testes em Linux, o destino das Lambdas.
# O contexto precisa ser a RAIZ do repositório, porque backend/ depende de grupuxo/Packages/GrupuxoDomain:
#   docker build -f backend/Dockerfile -t grupuxo-backend .
#   docker run --rm grupuxo-backend
FROM swift:6.3

WORKDIR /workspace
COPY grupuxo/Packages/GrupuxoDomain/Package.swift grupuxo/Packages/GrupuxoDomain/Package.swift
COPY grupuxo/Packages/GrupuxoDomain/Sources grupuxo/Packages/GrupuxoDomain/Sources
COPY grupuxo/Packages/GrupuxoDomain/Tests grupuxo/Packages/GrupuxoDomain/Tests
COPY backend/Package.swift backend/Package.resolved backend/
WORKDIR /workspace/backend
# Resolve as dependências numa camada própria, para o cache não depender do código-fonte.
RUN swift package resolve

COPY backend/Sources Sources
COPY backend/Tests Tests

# Compila sem testar (falha o build da imagem se não compilar).
RUN swift build --package-path /workspace/grupuxo/Packages/GrupuxoDomain && swift build

# Padrão: roda a suíte do domínio e a do backend.
CMD ["sh", "-c", "swift test --package-path /workspace/grupuxo/Packages/GrupuxoDomain && swift test"]
