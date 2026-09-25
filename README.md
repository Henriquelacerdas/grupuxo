# grupuxo

Aplicativo iOS para distribuir tarefas domésticas, considerando esforço semanal e participação nos cômodos.

- [Descrição do produto](grupuxo/DESCRICAO.md)
- [Arquitetura](grupuxo/ARCHITECTURE.md)
- [Algoritmo e política de entrada/saída](grupuxo/ALGORITHM.md)

Cômodos comuns incluem todos os moradores. Cômodos privados são visíveis para a casa, têm entrada livre e restringem tarefas aos participantes. Sair de um cômodo comum o torna privado; a última saída exige confirmação e exclui o cômodo e suas tarefas. Casa toda permanece comum e não permite saída individual.

Cada cômodo repete n execuções a cada x semanas e tem uma quantidade configurável de responsáveis. Tarefas de mesma periodicidade compartilham essa escala: distribuição gulosa entre responsáveis e ordenação pelo Húngaro respeitam o vínculo. Entradas e saídas reequilibram a casa a partir da próxima segunda-feira, preservando pendências anteriores e seu acesso específico. A persistência usa repositórios mockados; os fluxos estão disponíveis na interface.

## Testes

Com Xcode e o runtime iOS 26.5 instalados:

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
```
