# grupuxo

Aplicativo iOS para distribuir tarefas domésticas, considerando esforço semanal e participação nos cômodos.

- [Descrição do produto](grupuxo/DESCRICAO.md)
- [Arquitetura](grupuxo/ARCHITECTURE.md)
- [Algoritmo e política de entrada/saída](grupuxo/ALGORITHM.md)

Entradas e saídas reequilibram as filas da casa a partir da próxima segunda-feira. A semana atual e pendências anteriores preservam seus responsáveis. A persistência atual usa repositórios mockados; os comandos de participação estão disponíveis na camada de domínio.

## Testes

Com Xcode e o runtime iOS 26.5 instalados:

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
```
