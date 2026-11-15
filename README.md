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

## Adversário

Seção **Adversário** no painel: liga/desliga, formação (qualquer atalho, com as funções do atalho) e estilo de jogo. O adversário é calculado com o **mesmo motor** e espelhado (ataca para baixo); aparece como quadrado claro.

| Nossa fase | Adversário | Como |
|---|---|---|
| Defendendo | com a bola, progredindo | fase "ataque" dele, recuada pelo estilo (`shifts.defendendo`) |
| Saindo com a bola | pressionando nossa saída | fase "defendendo" dele, adiantada/recuada pelo estilo (`shifts.saindo`) |
| No ataque | bloco baixo | fase "defendendo" dele com a linha de defensores ancorada perto da própria área (`shifts.ataque.lineY`) |

Cada **estilo** é um conjunto de instruções de equipe (mentalidade, linhas, larguras) mais esses deslocamentos. Estilos incluídos, inspirados nos modelos táticos do jogo: Equilibrado, Pressão alta (Gegenpress), Posse de bola curta (Tiki-Taka), Jogo pelas pontas (Wing Play), Jogo direto (Route One), Contra-ataque e Bloco baixo (retranca). Os números são estimativas minhas; edite `data/opponent.json` para calibrar ou criar estilos.

**Impedimento** (`offside: true`): quem ataca não passa do último defensor de linha rival (o goleiro não conta), e só no campo adversário. Com o adversário ligado, isso pode conter os **nossos** atacantes na linha dele nas fases com bola — o tooltip avisa "contido pela linha de impedimento". Com o adversário desligado, nosso time não muda.

Limitações: o adversário usa as funções do atalho de formação (sem editar função por jogador nem instruções individuais dele) e não reage à posição exata dos nossos jogadores além do impedimento.

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
