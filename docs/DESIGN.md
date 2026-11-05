# Design: decisões e insights da designer

Fonte: guia "Reveza: contexto do projeto" da Letícia (designer solo do app, Apple Developer Academy), atualizado em **05/11/2026**, e a página **"Reveza · Oficial (clicável)"** do Figma "Designuxo" (arquivo `7BOZjxiPJIfWGRySI6Q3wW`, nó `980-1184`, [link](https://www.figma.com/design/7BOZjxiPJIfWGRySI6Q3wW/Designuxo-%F0%9F%8C%B7?node-id=980-1184)). Essa página é a referência das telas da v1; as outras páginas do Figma (Clicável, Onboarding, Perfil e Ajustes, Notificações, Telas que faltavam, Repetir com o cômodo) são histórico. Quando o guia e outro documento divergirem, vale o guia; o que o app ou o servidor ainda não fazem está em [PENDENCIAS.md](../PENDENCIAS.md).

Escopo: o programa termina em **04/12/2026** com um pitch de 10 minutos em inglês e um vídeo promocional de 1 minuto. Não há plano de continuidade depois disso; o que sobra de roadmap (widgets, Siri, Lembretes, ícone Dark/Tinted) é "se o projeto continuar".

## Como a designer trabalha (para quem for pedir telas)

- Estética iOS nativa: componentes do sistema, **cores semânticas (sem hex no código)**, text styles e Dynamic Type, SF Symbols, alvos de 44 pt, inspiração no app Lembretes.
- Cada tela passa por "pronto para dev" (heurísticas de Nielsen, HIG, estados, acessibilidade), separando o que **bloqueia o dev** do que é backlog.
- Telas sem protótipo no Figma vêm como SwiftUI direto: `NovoComodoView` (Criar/Editar Cômodo) e `ReordenarComodosView`. O vocabulário delas ("Semanal", "Quinzenal", "Mensal", "Personalizado") ainda não segue a regra de repetição abaixo; está em aberto com ela.
- Tom sem acusação. Prazos: "Termina domingo", "Termina em 10 dias", "Termina hoje/amanhã".

## Modelo de produto (como a designer o descreve)

- **Casa** (entra-se por código) > **Cômodos**, cada um com ciclo próprio (semanal por padrão; também a cada 2 semanas, mensal ou personalizado). A cada ciclo o cômodo passa para outra pessoa; havendo mais cômodos que pessoas, alguém fica com dois.
- **Repetição do cômodo** (antes "tarefas do ciclo"): repete junto com o cômodo; o algoritmo divide entre as pessoas do ciclo pelo esforço (Leve, Médio, Intenso) e muda de pessoa a cada rodízio.
- **Repetição própria** (antes "extras", depois "gerais"): periodicidade própria e fila rotativa. Regra da janela: cada vez que a tarefa abre a pessoa tem **2 dias**; não dá para fazer antes de abrir; a próxima janela conta **a partir de quando foi feita**; a tarefa fica com a pessoa até ser feita. Textos: "Começa sábado", "Termina segunda" / "Termina hoje" (negrito com 1 dia ou menos), "Terminou segunda" (nunca "atrasada").
- **Toggle "Repetir com o cômodo"** em Criar/Editar Tarefa (ligado por padrão) define o tipo; não é mais deduzido pela periodicidade. Para o dev: um campo sim/não na tarefa; se o cômodo mudar de periodicidade, as tarefas com o toggle ligado acompanham.
- **Tarefas únicas**: qualquer um pega; quem conclui pula a vez na próxima tarefa de repetição própria. Só quem criou edita ou exclui.
- Só a própria pessoa marca as suas tarefas, em Minhas tarefas ou no detalhe; **a tela do Cômodo é só para ver**. "Feita por você" continua até o ciclo acabar.
- **Cômodo privado**: só participantes veem; os outros "Pedir para entrar" / "Solicitação pendente". Último membro saindo: aviso e exclusão se concordar. Quem criou a casa **não tem poderes** especiais.
- Sair da fila no meio do ciclo mantém as tarefas até o fim do ciclo. Histórico de atividades (edições, exclusões, entradas, saídas) é notificado, para não haver exclusão silenciosa.
- **Diferencial**: método cíclico com cômodos como blocos (das repúblicas da Unicamp, que usam lousas) + filas por esforço + bot de WhatsApp.

## Regras de texto

- **Vocabulário de repetição da Apple** (o do Lembretes), no app inteiro: *Diariamente, Semanalmente, A cada 2 semanas, Mensalmente, A cada 2 meses, Anualmente*. Nunca "Quinzenal", "Todo mês", "Toda semana". Implementação: `RoomDetailText` e `RecurrencePresentation` (Criar Tarefa).
- **Nunca artigo antes do nome do cômodo** (o nome é livre); em texto genérico, "do cômodo". Dúvida aberta: vale para o nome da casa?
- Frases completas no String Catalog, nunca concatenadas; plural pelo próprio catálogo (vale para o app em inglês).
- Dia da semana sem "-feira" ("Termina segunda").
- **Cor de "Terminou"**: vermelho (Accents/Red) **só em Minhas tarefas**, que só a própria pessoa vê. Na tela do Cômodo, que a casa toda vê, o texto fica neutro (cinza): não virar exposição pública.
- Esforço (1–3) é carga interna: nunca mostrar como pontuação.
- Código inválido: "Não achamos uma casa com esse código. Confira com quem te mandou."

## Interações

- **Modais**: X à esquerda, ✓ à direita (desabilitado até ser válido). "Descartar alterações?" só se houve mudança, como menu ancorado ao X, sem "Continuar editando". Ações destrutivas sempre com confirmação; botão destrutivo em lista é linha com texto vermelho.
- **Ajustes** é sheet aberta pela foto do perfil, telas internas por push, sem ✓, só X. Sair da conta não pede confirmação.
- **Menus** (nativos, ancorados ao botão):
  - "+" da Casa: Nova tarefa · Novo cômodo.
  - "⋯" da Casa: Reordenar cômodos · Convidar pessoas (compartilhar do sistema com o código) · Ajustes da casa (abre direto Ajustes › Casa).
  - "⋯" do Cômodo: Editar cômodo · Sair do rodízio · Excluir cômodo (vermelho). Reordenar não fica no cômodo.
- **Tela do Cômodo (v5.1)**: título com subtítulo "Rodízio semanal"; degradê na cor do cômodo; cartão do ciclo ("Você e Henrique L." / "Termina domingo", ícone `repeat`, chevron à direita que desce ao abrir) e, aberto, um segundo cartão com Ciclo, Agora, Depois e Participantes; abas Agora | Todas; seções Repetição do cômodo, Repetição própria e Tarefas únicas, **sem ⓘ e sem TipKit**. Na aba Todas a repetição do cômodo mostra só o esforço e a própria, "⟲ A cada 2 semanas · Intenso" (o ⟲ é `Image(systemName: "repeat")` com rótulo para VoiceOver).
- **Botões da barra**: na Casa, "+" é um círculo azul proeminente e "⋯" um círculo de vidro, do mesmo tamanho (44 pt); no Cômodo, "+" e "⋯" dividem uma cápsula de vidro.
- **Pedir troca**: swipe → sheet com X/✓, tarefas agrupadas por esforço (o mesmo esforço primeiro, com selo). Minhas tarefas mostra "Troca pedida · aguardando Henrique L.". Em Notificações, o pedido é lado a lado e empilha nos tamanhos de acessibilidade.
- **Onboarding**: boas-vindas → Entrar (Apple e e-mail na mesma tela) → Criar conta / Esqueci a senha → Seu perfil → Sua casa → Nome da casa → Primeiros cômodos → Convidar → Ativar notificações. Depois do onboarding, ir para a tela da Casa.

## Resumo da semana (decidido em 04/11; sem backend ainda)

- Escala de 3 níveis: Precisa melhorar / Bom / Ótimo (sem estrelas). Tags genéricas, sempre opcionais, que descrevem o estado e nunca a pessoa; sem texto livre.
- Todos avaliam os cômodos **cujo ciclo terminou naquela semana**, menos o próprio. Resultado sai em 2 dias ou quando todos avaliarem; cada cômodo só mostra resultado com 2 avaliações ou mais; mostra só o resultado, nunca a distribuição.
- As tags do seu cômodo aparecem no próprio Resumo, em "O que foi bom" / "O que pode melhorar", sem nome e sem contagem. Fechar a avaliação no meio não salva nada ("Descartar alterações").
- Entrada em Minhas tarefas: linha compacta no topo (pendente / enviada / pronto).

## WhatsApp

O bot **só responde, nunca manda mensagem primeiro**. Conectar abre o WhatsApp com mensagem pronta. Ajustes › WhatsApp: número, "Abrir conversa", "O que mandar", "Desconectar". Textos canônicos em [WHATSAPP-MENSAGENS.md](WHATSAPP-MENSAGENS.md). O bot ainda escreve "(atrasada)", contra a regra de nunca usar essa palavra.

## Decisões em aberto (com a designer)

- Língua do app no vídeo do pitch (até 11/11): app em português com legendas em inglês, ou app traduzido (String Catalog em inglês pronto antes da gravação).
- "A cada 2 meses" está no guia, mas o menu de Criar Tarefa oferece 3 e 6 meses; "Rodízio mensal" é zona cinza; o picker de Criar Cômodo ainda usa "Semanal/Quinzenal/Mensal".
- "Excluir" ou "Apagar" como verbo padrão (o iOS em português usa "Apagar").
- Ícone do "Resumo da semana pronto" (`list.bullet.clipboard.fill` ou `calendar.badge.checkmark`).
- Tag marcada por uma só pessoa aparece para quem cuidou? Dia em que a avaliação abre. Tarefa única pega por outra pessoa: some ou mostra "Para <nome>"?
- Quem aceita o pedido de entrada em cômodo privado; pedido pendente pode ser cancelado/refeito?
- "Depois" no cartão do ciclo é previsão: escrever "(previsão)"? "Participantes ›" também entra e sai do rodízio? Ordem dos cômodos é pessoal ou da casa (assumido pessoal)? Modo férias vale só a partir do próximo ciclo? Excluir o último cômodo privado: na hora ou no fim do ciclo?
- Comandos exatos do bot do WhatsApp.

## Backlog de telas (designer)

"‹ Casa" no topo da tela do Cômodo; swipe de Minhas tarefas com três ações cortando o título; modo escuro e Dynamic Type grande nas telas novas; card "Rodízio" do Detalhe ("Muda de pessoa a cada rodízio" / "Muda quando o Vidal fizer"); "Como o Reveza funciona" (Ajustes) com uma versão das boas-vindas com "OK" que fecha.

## Publicação e pitch (decidido em 04–05/11)

Cronograma: checklist de envio e Política de Privacidade (4–10/11); textos da página e sessão de gravação (11–17/11); capturas e envio para revisão (18–24/11); vídeo de 1 minuto (25/11–3/12); **pitch em 04/12**. Para os devs: build final estável até 18/11; Apagar conta funcionando (com revogação do token da Apple), Sign in with Apple, conta de teste com casa e cômodos preenchidos e notas para o revisor sobre login, casa e WhatsApp. Uma única sessão de gravação serve para tudo: iPhone 6,9", dados de exemplo limpos (Você, Henrique L., Vidal, Julia C.), barra de status limpa (9:41, bateria cheia).
