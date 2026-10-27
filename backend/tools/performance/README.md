# Benchmark local de leituras

Rode em `backend/`, com as dependências de desenvolvimento instaladas:

```sh
npm run benchmark:reads
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=grupuxo-read.cpuprofile tools/performance/read-latency.ts
```

O script cria uma casa em `America/Sao_Paulo` e acrescenta 1.200 pares de ocorrência/atribuição concluídos ao seed, resultando em 2.513 itens com perfis. O calendário e os IDs são determinísticos. Usa exclusivamente `FakeDynamoClient`, sem rede, SDK, credenciais ou serviços externos. O tempo de preparação fica fora das amostras.

Mede 15 amostras por operação: tarefas do morador; as consultas individuais usadas na tela Casa; e uma leitura pelo snapshot. A escala já está em dia, portanto as leituras não precisam gravar. Emite mediana e p90 em JSON. Os tempos da tela antiga somam as consultas sem latência de rede e não representam o paralelismo da UI no aparelho.

Abra o arquivo `.cpuprofile` num visualizador de perfis CPU compatível com V8. A clonagem e a avaliação de expressões do cliente falso aparecem no perfil; não atribua esse custo ao DynamoDB real. Compare na mesma máquina, versão de Node e tamanho da casa. Os resultados são locais: RTT, cold start, CPU/memória da Lambda e tamanho de resposta precisam de medição separada após publicação autorizada. Resultados de referência em [../../../docs/LATENCIA.md](../../../docs/LATENCIA.md).
