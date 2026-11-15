# FM23 Positioning Viewer

Site de uma página que desenha a posição aproximada dos 11 jogadores em 3 fases — **Defendendo**, **Saindo com a bola** e **No ataque** — a partir da formação, função/tarefa de cada jogador e instruções de equipe do FM23.

É um **modelo heurístico baseado em regras**, não uma simulação do motor do jogo.

## Como abrir

| Jeito | Comando |
|---|---|
| Arquivo único (funciona com duplo clique, sem servidor) | abrir `dist/fm23-viewer.html` |
| Versão de desenvolvimento (lê `data/*.json` em tempo real) | `npm run serve` → http://localhost:8000 |
| Regerar o arquivo único depois de editar JSON/JS/CSS | `npm run build` |
| Testes do motor | `npm test` |

`index.html` aberto direto do disco (`file://`) não consegue ler os JSON (o navegador bloqueia `fetch` local) — use o servidor ou o `dist/`.

## Fases

São **6 fases**, organizadas por onde está a bola:

| Sem a bola | Com a bola |
|---|---|
| **Pressão alta** — adversário saindo no terço dele | **Saída de bola** — bola com GR/zagueiros |
| **Bloco médio** — bola no meio-campo (chave `defendendo`) | **Progressão** — bola no meio-campo |
| **Bloco baixo** — adversário no nosso terço final | **No ataque** — bola no terço final |

Bloco médio, Saída e Ataque são as fases-base (tabela por faixa + regras das funções). As outras três são **derivadas** (`derive` em `formations.json`):
- **Progressão** = mistura da Saída com o Ataque (`t` 0.45);
- **Pressão alta** = Bloco médio deslocado para frente por faixa (atacantes sobem mais que a defesa), com +5 para quem tem "pressionar com mais urgência" (embutido ou instrução) e −5 para quem tem "com menos urgência";
- **Bloco baixo** = Bloco médio com a linha de defesa ancorada perto da área (y 14), um pouco mais estreito.

Regras de função com a chave de uma fase derivada (`pressao`, `bloco_baixo`, `progressao`) entram como deslocamento extra (`dx`, `dy`); é o que o modo editar regra grava nessas fases. Transições (logo depois de perder/ganhar a bola) ficaram de fora: a posição depende de onde a bola foi perdida.

No desktop, o seletor **Sem a bola / Com a bola / Todas** escolhe os campos exibidos; no celular, as 6 fases ficam em abas.

## Estrutura e medidas

Com **Mostrar linhas de estrutura e medidas** (Visualização), cada campo liga os jogadores de cada linha do time (linha branca; a do adversário, tracejada escura) e mostra:
- **Estrutura** — a forma em linhas, de trás para frente (ex.: 4-2-3-1 sem a bola, 2-4-3-1 na saída);
- **comprimento** do bloco (do jogador de linha mais recuado ao mais avançado), **largura** e **altura da última linha** a partir do próprio gol, em metros (campo 68 × 105);
- com o adversário ligado, a forma e o comprimento dele.

As linhas partem da faixa do slot (defesa, volantes, meio, meia ofensivo, ataque), quebram onde houver um buraco de 8 ou mais em y e se juntam quando ficam a menos de 4 (máximo 5 linhas) — `teamShape` no motor. Por isso um volante que fica a 5 da defesa aparece como linha própria, e um lateral que sobe ao ataque entra na linha de cima.

## Estrutura

```
index.html               página (dev)
src/engine/engine.js     pipeline, efeitos, colisão — funções puras (browser + Node)
src/ui/app.js            interface (vanilla JS + SVG)
src/ui/styles.css
data/formations.json     grade de slots, transformações por fase, atalhos de formação
data/roles.json          funções, slots válidos, tarefas, regras por fase e instruções embutidas
data/team-instructions.json  mentalidade, linha defensiva, linha de pressão, larguras com/sem bola, parâmetros do motor
data/player-instructions.json  instruções individuais (PIs): disponibilidade, exclusões e efeito por fase
data/opponent.json       adversário: correspondência de fases, estilos de jogo e impedimento
data/player-traits.json  características do jogador (traits): disponibilidade, conflitos, quem anula e efeito por fase
scripts/build.js         gera dist/fm23-viewer.html (tudo embutido)
tests/engine.test.js     11 jogadores, validação, clamp, espelhamento, efeitos, colisão, inversa do modo edição
```

## Calibração

- Edite `data/roles.json` (regras por função+tarefa+fase: `x`, `y` absolutos ou `dx`, `dy`; `effects`; `if` p/ flag; `onlyBands`). `x` é sempre escrito para o lado esquerdo e espelhado à direita.
- Ou, no site, ative **Modo editar regra**, arraste um jogador e depois **Exportar roles.json**. As edições ficam no `localStorage` até você exportar/resetar.
- Novos efeitos: `FMEngine.registerEffect('nome', function (players, phase, source) { ... })`.

## Instruções individuais (PIs)

Botão **PI** ao lado de cada jogador abre as instruções disponíveis para aquele slot/função/tarefa. Marcar uma instrução desmarca a oposta (ex.: Avançar mais × Manter posição), como no jogo. As instruções **embutidas na função** aparecem marcadas e travadas, e as que conflitam com elas ficam indisponíveis. Jogadores com PIs ganham um ponto branco no campo.

| Instrução | Efeito inicial |
|---|---|
| Avançar mais (Get Further Forward) | saindo dy +3, ataque dy +6 |
| Manter posição (Hold Position) | saindo dy −2, ataque dy −8 |
| Deambular / sair da posição (Roam From Position) | zona de raio 6 / 8 (saindo / ataque); não para GK nem defensores |
| Abrir mais (Stay Wider) | jogador aberto (DL/DR, alas, ML/MR, AML/AMR) cola na linha lateral (x 5 / 4); os demais abrem 4 / 6 |
| Fechar mais (Sit Narrower) | para dentro 4 / 7 |
| Cortar para dentro com a bola (Cut Inside With Ball) | ataque: para dentro 5 |
| Correr pela lateral com a bola (Run Wide With Ball) | ataque: para fora 4 |
| Mover-se para os corredores (Move Into Channels) | meio, meia e ataque. CL/CR: para fora 5 / 10. Slot central: zona horizontal de ±12 / ±18 (os dois corredores). Abertos: para dentro 4 / 6 |
| Cruzar da linha de fundo / Cruzar de trás | ataque dy +3 / −5 |
| Pressionar com mais / menos urgência (Trigger Press More/Less) | defendendo dy +3 / −3 |

Formato em `data/player-instructions.json`: `phases.<fase>` aceita `dx`, `dy`, `inside` (rumo ao centro, nunca cruza o meio), `outside`, `roam`, `touchline`, `centerSpread` e `wideInside`. Disponibilidade por `bands`, `notBands`, `lanes`, `sides`; exclusão mútua por `excludes`. As PIs entram como deltas depois da regra da função, então o modo editar regra continua gravando só a parte da função.

### Instruções embutidas (`locked`)

Cada tarefa em `roles.json` pode ter `"locked": [...]` com as instruções que a função já traz no jogo. Elas:
- bloqueiam a mesma instrução e a oposta no painel PI;
- geram a **zona** de Deambular/corredores (o deslocamento delas já está nas regras de posição da função, então não é aplicado de novo).

Deambular vem embutido em 15 combinações: Regista, Construtor Móvel, Box-to-Box, Mezzala (S/A), Ala Completo (S/A), Ala Invertido (S/A), Construtor Aberto (S/A), Trequartista, Raumdeuter, Segundo Atacante, Atacante Recuado (S/A), Avançado, Atacante Completo (S/A) e Atacante de Pressão (A).

## Características do jogador (traits)

No painel **PI** de cada jogador há a seção **Características do jogador**, com as características do manual oficial do FM23 (seção Players → Player Traits) que mudam a posição. Ficaram de fora as que não mudam a posição (chute, passe, drible, faltas etc.).

| Característica | Efeito inicial |
|---|---|
| Avança sempre que possível (Gets Forward Whenever Possible) | saindo dy +2, ataque dy +5 |
| Entra na área adversária (Gets Into Opposition Area) | ataque dy +4 |
| Chega atrasado na área (Arrives Late In Opponents' Area) | ataque dy +4 (volante, meio, meia ofensivo) |
| Fica sempre atrás (Stays Back At All Times) | saindo dy −3, ataque dy −8 |
| Corre nas costas da defesa (Makes Runs In Behind) | saindo e ataque dy +3 (meio, meia ofensivo, ataque) |
| Recua para buscar a bola (Comes Deep To Get Ball) | saindo dy −6, ataque dy −5 (meia ofensivo, ataque) |
| Move-se para os corredores / Não se move para os corredores | como a instrução individual / remove a zona e o deslocamento de corredor |
| Corta para dentro (duas pontas / esquerda / direita) | saindo para dentro 2, ataque 6; a da esquerda só vale à esquerda |
| Cola na linha lateral (Hugs Line) | jogador aberto colado na linha lateral |
| Sai jogando da defesa (Brings Ball Out Of Defence) | defensor sobe dy +5 na saída |
| Joga com os pés (Plays Ball With Feet) | goleiro sobe dy +3 na saída |

Como no jogo, a característica pode ser **anulada por uma instrução** (individual ou embutida na função), definida em `overriddenBy`. Exemplos: "Avança sempre que possível" num Lateral (Defender), que tem "Manter posição" embutido; "Cola na linha lateral" num Atacante Interior, que corta para dentro. O painel mostra "sem efeito" nesses casos. Os números são estimativas; o manual só define o comportamento.

## Notas de estrutura (Penetração, Solidez, Apoio · Pressão, Cobertura, Compactação)

Abaixo da linha de estrutura de cada campo aparecem três notas de 0 a 100, com os nomes e definições do framework de [teoria tática do Guide to Football](https://fm.guidetofootball.com/tactical-theory/) (*attacking structure scores* e *out-of-possession structure scores*). O framework é um modelo teórico próprio do site, "não testado no motor do jogo"; aqui ele organiza a leitura. As fórmulas são minhas e usam só as posições da fase, a bola da fase e as tarefas/instruções de cada jogador (`structureScores` no motor):

| Fase | Nota | Como mede |
|---|---|---|
| com a bola | **Penetração** | altura média dos 4 mais avançados, quantos chegam ao terço final e quantos têm compromisso de avançar (tarefa Ataque, Avançar mais, Deambular, características de chegada) |
| com a bola | **Solidez** | quantos ficam atrás da linha da bola (ideal 4) e quantos têm contenção (Defender, Manter posição, Fica sempre atrás) |
| com a bola | **Apoio** | maior buraco entre as linhas do time (ideal até ~15 m) e quantos estão a até 15 m da bola |
| sem a bola | **Pressão** | quantos estão a até 25 m da bola e quantos têm pressão embutida/instruída ou tarefa Stopper (mede quem disputa a bola, não a altura do bloco) |
| sem a bola | **Cobertura** | altura da última linha e quantos ficam no próprio campo |
| sem a bola | **Compactação** | comprimento e largura do bloco e distância média ao companheiro mais próximo |

As notas aparecem junto com as linhas de estrutura (opção "Mostrar linhas de estrutura e medidas").

## Sugerir funções (equilíbrio da tática)

No card **Funções e tarefas**, a linha *Equilíbrio da tática: N/100* mostra o índice atual (passe o mouse para ver cada critério). O botão **✨ Sugerir funções** procura trocas de função+tarefa, sem mudar a formação, que aumentam esse índice. Ele mostra cada troca com o ganho e o critério que melhorou; você aplica as que quiser e pode **desfazer**.

| Critério | Peso | Como mede (nas fases-base) |
|---|---|---|
| Corredores ocupados no ataque | 20 | quantos dos 5 corredores têm jogador no terço final |
| Presença na área | 10 | 2–3 jogadores dentro da área no ataque |
| Proteção atrás da bola | 15 | 3–4 jogadores de linha atrás no ataque |
| Linhas de passe na saída | 10 | corredores com opção de passe entre a defesa e o meio na saída |
| Compactação sem a bola | 15 | bloco médio com até 40 m de comprimento |
| Jogadores sem se empilhar | 15 | pares a menos de 8 m entre si com a bola |
| Tarefas equilibradas | 15 | distância de 3 Defender · 4 Apoio · 3 Ataque (referência do manual para mentalidade e fluidez equilibradas) |

**Com o adversário ligado**, o índice inclui também 5 critérios contra ele, medidos com os dois times nas mesmas fases (com impedimento):

| Critério | Peso | Como mede |
|---|---|---|
| Jogadores entre as linhas dele | 15 | quantos dos nossos ficam entre a defesa e a linha seguinte dele, na progressão e no ataque (ideal 2–3) |
| Superioridade nas pontas | 10 | em cada lado, nós em mais (ou igual) número que ele no terço final |
| Jogadores livres de marcação | 15 | quantos dos nossos, do meio para frente, estão a 7 m ou mais do adversário mais próximo (ideal 3+) |
| Atacantes dele vigiados | 15 | os 3 jogadores mais avançados dele com um dos nossos a até 10 m, no bloco médio e no bloco baixo |
| Sem amontoar na linha dele | 5 | no máximo 2 dos nossos contidos na linha de impedimento no ataque |

O adversário não depende das nossas funções, então é calculado uma vez e reaproveitado em todas as tentativas da busca (cerca de meio segundo no total).

A busca é gulosa: a cada rodada aplica a troca que mais melhora o índice (até 6 trocas, ganho mínimo 2 pontos, para evitar trocas marginais). Instruções individuais e características são mantidas (as que deixam de valer na nova função são removidas ao aplicar). O índice é uma heurística de boas práticas, não uma avaliação do motor do jogo; os pesos ficam em `evaluateBalance` no motor.

## Adversário

Seção **Adversário** no painel: liga/desliga, formação (qualquer atalho, com as funções do atalho) e estilo de jogo. O adversário é calculado com o **mesmo motor** e espelhado (ataca para baixo); aparece como quadrado claro.

| Nossa fase | Adversário | Como |
|---|---|---|
| Defendendo | com a bola, progredindo | fase "ataque" dele, recuada pelo estilo (`shifts.defendendo`) |
| Saindo com a bola | pressionando nossa saída | fase "defendendo" dele, adiantada/recuada pelo estilo (`shifts.saindo`) |
| No ataque | bloco baixo | fase "defendendo" dele com a linha de defensores ancorada perto da própria área (`shifts.ataque.lineY`) |

Cada **estilo** é um conjunto de instruções de equipe (mentalidade, linhas, larguras), os deslocamentos acima e as **funções típicas** dos jogadores. Estilos incluídos, inspirados nos modelos táticos do jogo: Equilibrado, Controle de bola (Control Possession), Tiki-Taka, Tiki-Taka vertical, Gegenpress, Atacar pelas alas (Wing Play), Jogo direto (Route One), Contra-ataque e Bloco baixo (retranca).

**Funções do adversário:** trocar a formação ou o estilo aplica as funções típicas do estilo (`roles` por grupo de slots em `data/opponent.json`; ex.: Atacar pelas alas → extremos e alas de ataque; Gegenpress → atacantes de pressão e recuperadores; Tiki-Taka → laterais invertidos, Half-Back, Mezzala e Falso 9). Em **Funções dos jogadores adversários** dá para ajustar função e tarefa jogador a jogador; "Voltar às funções típicas do estilo" desfaz. As escolhas de funções e os números dos estilos são aproximações minhas.

**Impedimento** (`offside: true`): quem ataca não passa do último defensor de linha rival (o goleiro não conta), e só no campo adversário. Com o adversário ligado, isso pode conter os **nossos** atacantes na linha dele nas fases com bola — o tooltip avisa "contido pela linha de impedimento". Com o adversário desligado, nosso time não muda.

Limitações: o adversário não tem instruções individuais nem características, e não reage à posição exata dos nossos jogadores além do impedimento.

## Fontes

1. **Manual oficial do FM23, seção Tactics** (Sports Interactive; PDF enviado pelo usuário). Confirmou:
   - a formação na tela é a forma **defensiva** sem a bola;
   - a mentalidade muda a tarefa **Automático** (`engine.autoDutyByMentality`: Muito Defensiva/Defensiva → D, Cautelosa a Positiva → S, Ofensiva/Muito Ofensiva → A; os cortes são estimativa minha);
   - cada PI é um **modificador** da instrução já definida pela função+tarefa;
   - a **linha defensiva** também define a altura dos defensores **com a bola** (`engine.defLineWithBallFactor`);
   - existe **Largura defensiva** (Defensive Width) — adicionada com 3 níveis (fatores 0.65 / 0.75 / 0.85; o número de níveis é estimativa);
   - "Abrir mais" leva os abertos "as close to the touchline as possible"; "Mover-se para os corredores" vale para jogadores centrais e deixa abertos (ex.: Raumdeuter) fecharem por dentro;
   - no FM23 o nome é **Trigger Press**, não Close Down.
2. **Tabela de funções do [Rate My Tactic](https://ratemytactic.web.app/en)** (ferramenta da comunidade, era FM24 — mesmas funções do FM23). Base para as instruções embutidas por função+tarefa, para incluir o **Lateral Invertido** e o **Stopper do Zagueiro Simples**. Usada como referência; os dados deles não estão copiados no repositório.
3. **[Guia de funções do FMScout](https://www.fmscout.com/a-guide-to-player-roles-in-football-manager.html)** (FM22) e **[guia de pares e combinações](https://www.fmscout.com/a-tactical-guide-pairs-and-combinations.html)**: descrições (`desc`) e regras das funções que a spec deixou vazias.

4. **[Guia de funções do FM23/FM24 de Seif Khaled](https://seifkhaled.me/player-roles-guide-for-football-manager-2023/)** (PDF enviado pelo usuário): lista as **instruções ocultas** de cada função (goleiros, defensores, meio-campistas). Delas vieram: o DLP vem buscar a bola na saída ("collect the ball more"), o Box-to-Box volta mais ("track back more"), o Construtor Avançado e o Carrilero ganham zona de corridas laterais ("make more lateral runs"), o Half-Back recua com a bola ("drop deep more", confirmando a spec) e o Líbero do FM23 tem tarefas Apoio/Ataque. O guia lista "Move Into Channels" embutido na Mezzala; o Rate My Tactic usa a mesma marcação para Trequartista, Segundo Atacante, Atacante Recuado, Avançado, Atacante Completo e Atacante de Pressão (A), então assumi que também está embutido neles (inferência). As imagens do guia (mapas de calor) não vieram no PDF.

5. **Manual oficial do FM23, seção Players** (PDF enviado pelo usuário): definições oficiais das características do jogador (Player Traits), usadas em `data/player-traits.json`, e a regra de que instruções podem anular características.

6. **Manual oficial do FM23: Football Glossary, Playing a Match e Your Squad** (PDFs enviados pelo usuário). O glossário define *channel* como o espaço entre zagueiro e lateral (a zona de corredor foi ampliada para alcançá-lo) e confirma a regra de impedimento usada (não há impedimento no próprio campo). "Playing a Match" confirma o comportamento do Atacante Interior com "Cortar para dentro" (sai da linha lateral para o centro com a bola). Os demais trechos não tratam de posição.

7. **FMScout — Book of Roles (zagueiros e goleiros, de Rashidi), "Strikers in-depth", "How to press", "How to defend" e "FM24 Roles and Combinations"**:
   - o **Zagueiro com Bola** sai jogando com a bola por padrão (desde o FM20) e conduz até o meio antes de passar → sobe 3 na saída (2 com Cobertura);
   - **estrutura de pressão**: um 4-2-3-1 tende a pressionar em **4-4-2** → na Pressão alta, com um centroavante só e um meia central, o meia sobe ao lado dele e os meias abertos recuam para a linha do meio (`pressShape`);
   - **zona à frente da defesa** ("golden zone") → critério novo no índice de equilíbrio (peso 10);
   - **tipo de atacante x linha do adversário**: contra linha alta rendem os de ruptura (Avançado, Matador, Atacante de Pressão, Completo); contra linha baixa, os de ligação/referência (Recuado, Pivô, Falso 9, Trequartista, Completo) → critério novo contra o adversário (peso 5; neutro contra linha padrão).
8. **Ala Invertido no FM23** — tópico do [FM-Arena](https://fm-arena.com/thread/4615-fm23-inverted-wing-backs-how-they-work/) (lido via resumo de busca; o site bloqueou o acesso direto) e relato no bug tracker oficial da SI de que os Alas Invertidos ficavam abertos no FM23: **só inverte se o slot de volante do seu lado (DMCL/DMCR) estiver livre**; senão, age como Ala na mesma tarefa (`needsFreeSlot` + `fallbackRole` em `roles.json`). Isso muda, por exemplo, o 4-2-3-1 DM Wide, em que os dois volantes ocupam esses slots.

9. **[Guide to Football — Tactical theory](https://fm.guidetofootball.com/tactical-theory/)**: framework teórico (528 conceitos) do qual vieram os nomes e as definições das notas de estrutura. O próprio site avisa que não foi testado no jogo e que sua aplicação a uma versão do FM é ao FM26.

**Nenhuma fonte dá coordenadas.** As descrições ("recua um pouco", "sobe para pressionar") foram convertidas por mim em números, que servem de ponto de partida para calibrar. O fórum da SI, o FMInside, o Passion4FM e o sortitoutsi bloqueiam acesso automatizado e não foram lidos.

## Decisões que diferem/complementam a spec

1. **Ordem do pipeline:** as instruções de equipe são aplicadas *depois* do override da função, como deslocamento. Assim mentalidade/linha/largura continuam valendo para funções com posição absoluta (ex.: Lateral (S) no ataque `y 62` vira `y 67` com mentalidade Ofensiva).
2. **Colisão medida em metros** (`collisionAspect: [0.68, 1.05]`), não em unidades normalizadas: 6 unidades em `x` são só ~4 m e os círculos se sobrepunham. Para o comportamento literal da spec, use `[1, 1]`.
3. **Slots centrais** (DC, DMC, MC, AMC, STC) ignoram `x`/`dx` das regras — não há lado para espelhar. Só `y` vale.
4. **Construtor Recuado (D)** dividindo os DCs é uma flag nas instruções de equipe (só para DLP na faixa DM).
5. **Tarefas dos zagueiros** usam códigos próprios: `D` Defender, `St` Stopper, `Co` Cobertura (o `S` da spec colidia com Apoio). Outros: `S` Apoio, `A` Ataque, `Au` Automático.
6. **4-2-3-1** aparece em duas versões: *Wide* (MCL/MCR) e *DM Wide* (DMCL/DMCR). **4-3-1-2 losango** usa DMC + MCL + MCR + AMC.
7. Na fase **Defendendo** a linha defensiva move todo o bloco exceto o goleiro; nas fases com bola, move só a linha D.
8. **Lateral Invertido** (fora da spec): vira terceiro zagueiro na construção (x 20, y 15) e o efeito `ifb_back_three` desliza os DCs 10 para o outro lado.
9. **Zagueiro Simples** ganhou a tarefa Stopper (fora da spec).

## A confirmar no jogo

- **Líbero:** Apoio/Ataque no FM23 (spec, FMScout e Seif Khaled); o Rate My Tactic (era FM24) dá Defender/Apoio — provavelmente mudou no FM24.
- Lateral Invertido junto com Half-Back na construção gera uma linha de 4 atrás; o efeito combinado ainda não foi calibrado.
- Os nomes em português das instruções são traduções minhas.
- Todos os valores numéricos são pontos de partida; calibre com o modo editar regra.

## Fora do escopo (v1)

Lado da bola, transições, bola parada, leitura de arquivos do jogo. Funções/instruções individuais do adversário.
