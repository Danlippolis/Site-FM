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
- **Pressão alta** = o Bloco médio inteiro sobe junto (+17, a última linha vai a ~47 m do gol com a linha defensiva padrão), com os atacantes um pouco mais à frente (+3) e o goleiro adiantado. Quem tem "pressionar com mais urgência" (embutido ou instrução) sobe +5 e quem tem "com menos urgência" fica −5, exceto os zagueiros, porque Stopper e Cobertura já têm a própria regra de altura;
- **Bloco baixo** = a última linha ancorada perto da área (y 14) e as distâncias até ela encurtadas a 65% (linhas a ~8–10 m uma da outra), com o atacante mais avançado um pouco à frente para o contra-ataque e o bloco mais estreito.

Nas três fases sem a bola, o bloco se move como um conjunto: com a linha defensiva padrão, ele mede ~37 m no bloco médio, ~40 m na pressão e ~28 m no bloco baixo, do zagueiro ao atacante mais avançado. Dois ajustes de forma valem nelas:
- **volantes à frente da zaga:** quem não é zagueiro fica pelo menos 7 à frente da última linha (6 no bloco baixo), para quem pressiona menos não "entrar" na zaga;
- **linha de 5:** os alas da faixa de volante (WBL/WBR) encaixam na linha de defesa, 2 à frente dela no bloco médio e 1 no bloco baixo. Assim, um 3-5-2 vira 5-1-2-2 sem a bola.

A linha defensiva padrão fica a y 28 (~29 m do gol) no bloco médio, e cada opção mais alta ou mais baixa soma ou tira 5.

Regras de função com a chave de uma fase derivada (`pressao`, `bloco_baixo`, `progressao`) entram como deslocamento extra (`dx`, `dy`); é o que o modo editar regra grava nessas fases. Transições (logo depois de perder/ganhar a bola) ficaram de fora: a posição depende de onde a bola foi perdida.

No desktop, o seletor **Sem a bola / Com a bola / Todas** escolhe os campos exibidos; no celular, as 6 fases ficam em abas.

## Bola de um lado

O seletor **Bola: Esq · Centro · Dir**, acima dos campos, põe a bola num dos lados. O time inteiro desliza para ela:

- **sem a bola** (pressão, blocos médio e baixo): todos se deslocam 35% da distância da bola ao centro, cerca de 7 m com a bola encostada no lado, e quem está no lado oposto ainda fecha 20% em direção ao meio;
- **com a bola** (saída, progressão, ataque): só 15%, cerca de 3 m, e o lado oposto mantém a largura para a virada;
- o goleiro desloca 40% do que o time desloca.

A bola desenhada vai junto. O adversário desliza para o mesmo lado do campo (para ele, a nossa esquerda é a direita dele). Fonte: Book of Roles, na seção do Carrilero ("a formação é sempre relativa à bola: com a bola na esquerda do campo adversário, o time todo desliza um pouco para a esquerda"); o resto é modelagem própria, com os números em `ballSide` no `formations.json`. O lado da bola é opção de visualização: fica salvo no navegador, não entra na tática exportada nem no índice de equilíbrio, que continua medido com a bola no centro.

## Movimentos possíveis

A posição de cada fase é a **média**: num lance, o jogador está quase sempre fora dela, atacando o espaço, recuando para receber ou caindo no corredor. As **setas coloridas** mostram para onde cada jogador costuma ir a partir da posição da fase:

| Cor | Tipo | Exemplos |
|---|---|---|
| amarelo | atacar o espaço | ruptura às costas da defesa (Avançado, Matador, Atacante Interior A), chegada atrasada na área (Box-to-Box, Mezzala, MO A, Segundo Volante), subida pelo corredor e linha de fundo (laterais, alas, Extremo), ataque ao espaço na recuperação (Avançado, Raumdeuter) |
| ciano | recuar / apoiar | recuo para buscar o jogo (Falso 9, Atacante Recuado, Trequartista, Construtor Avançado S), recuo para reciclar (Half-Back), recomposição (Ala Defensivo D, Médio Ala D) |
| rosa | mudar de corredor | cair no corredor entre lateral e zagueiro (Mezzala, Atacante de Pressão A, Mover-se para os corredores), abrir pelos lados (Falso 9, Atacante Completo), cortar para dentro (Atacante Interior, Extremo Invertido, Construtor Aberto), cobrir o lado (Carrilero) |
| branco | conduzir / subir | condução do zagueiro construtor (BPD), do Líbero e do Segundo Volante, subida do volante (S) |
| vermelho | pressionar / cobrir | Stopper e Recuperador saindo da linha, Cobertura recuando, Goleiro-Líbero varrendo as costas da linha |

- **Seta cheia** é o movimento **principal** da função (o que a define); **tracejada** é **ocasional**. Em *Visualização → Movimentos possíveis* dá para ver só os principais (padrão), todos, ou só os do jogador tocado. Passar o mouse ou tocar num jogador destaca as setas dele e lista os movimentos no detalhe, com a origem: a função, uma instrução individual ou uma característica.
- **Instruções e características mudam o repertório:** *Avançar mais* acrescenta chegada/subida, *Recua para buscar a bola* acrescenta o recuo, *Mover-se para os corredores* acrescenta o corredor, *Manter posição* e *Fica sempre atrás* cortam as corridas para frente. As instruções **embutidas** na função só acrescentam (o BPD tem *Manter posição* embutido para não subir no ataque, mas sai conduzindo).
- **Com o adversário na tela**, a ruptura vai até além da última linha dele e a pressão aponta para o adversário mais próximo ao alcance. Sem espaço (atacante já colado na linha de fundo), a ruptura não aparece.
- **Quem ocupa o espaço:** quando um atacante ou meia recua como movimento principal, o detalhe dele lista quem ataca o espaço que ele deixa, ou avisa que ninguém ataca (o Book of Roles pede corredores de trás para o Falso 9 e o Atacante Recuado).

Os movimentos **não mudam as posições** nem o índice de equilíbrio. A lista de cada função vem da descrição da função no FM23 e do *Book of Roles* (o resumo em `data/role-guide.json`); as **distâncias são estimativas** para desenhar. Os dados estão em `data/movements.json` (tipos, categorias, repertório por função e tarefa, e modificadores por instrução ou característica).

## Sobre a função

O botão **i** ao lado de cada jogador (e o link **Sobre a função →** no detalhe do jogador no campo) abre um guia da função: resumo, o que cada tarefa muda, atributos-chave da tarefa, combinações (clicáveis), riscos e dicas. O seletor no topo do painel mostra qualquer outra função.

Dentro do painel:

- **atributos com explicação** (sublinhados): tocar num deles mostra o que o livro diz sobre ele (páginas 2 a 6, 24 atributos), junto com a régua de comparação entre divisões (9 é a média da divisão mais baixa, mais 2 a cada acesso);
- **tipo de atacante** (só nas funções de atacante): em qual dos três tipos do livro a função entra (criativo, de apoio ou puro, conforme a tarefa) e um quadro com os três tipos, as funções de cada um (clicáveis) e as perguntas do livro para escolher (p. 121–122). O Trequartista e o Atacante de Pressão (D) não entram em nenhum dos tipos, e o painel diz isso.

O conteúdo está em `data/role-guide.json` e é um **resumo próprio** do *Book of Roles* (Daljit Singh, FM23), com a página de origem, e não o texto do livro. A tradução dos atributos é do site e pode não bater exatamente com a do jogo (o nome em inglês aparece ao passar o mouse). O livro não cobre o Zagueiro Aberto nem o Lateral Invertido; para eles o painel mostra só a descrição do site. Se o arquivo não carregar, o site funciona normalmente, só sem o painel.

## Estrutura e medidas

Com **Mostrar linhas de estrutura e medidas** (Visualização), cada campo liga os jogadores de cada linha do time (linha branca; a do adversário, tracejada escura) e mostra:
- **Estrutura** — a forma em linhas, de trás para frente (ex.: 4-2-3-1 sem a bola, 2-4-3-1 na saída);
- **comprimento** do bloco (do jogador de linha mais recuado ao mais avançado), **largura** e **altura da última linha** a partir do próprio gol, em metros (campo 68 × 105);
- com o adversário ligado, a forma e o comprimento dele.

Na mesma linha, vizinhos com mais de 5 de diferença de altura são ligados por um traço pontilhado (jogador escalonado, mas contado na linha). As linhas partem da faixa do slot (defesa, volantes, meio, meia ofensivo, ataque), quebram onde houver um buraco de 8 ou mais em y e se juntam quando ficam a menos de 4 (máximo 5 linhas) — `teamShape` no motor. Por isso um volante que fica a 5 da defesa aparece como linha própria, e um lateral que sobe ao ataque entra na linha de cima.

## Estrutura

```
index.html               página (dev)
src/engine/engine.js     pipeline, efeitos, colisão — funções puras (browser + Node)
src/ui/app.js            interface (vanilla JS + SVG)
src/ui/styles.css
data/formations.json     grade de slots, transformações por fase, atalhos de formação
data/roles.json          funções, slots válidos, tarefas, regras por fase e instruções embutidas
data/team-instructions.json  mentalidade, linha defensiva, linha de pressão (Low/Mid Block, High Press), largura com bola, obrigar a jogar por fora/dentro, cruzamentos, overlap/underlap por lado, parâmetros do motor
data/measurements.json   posições medidas no FM23 (prints do usuário) para comparar com o modelo
tools/measure_pitch.py   acha o campo numa captura do FM23 e desenha a grade de 10% para medir
tools/compare.js         compara o modelo com data/measurements.json (npm run compare)
data/alerts.json         alertas de combinação (texto, página do Book of Roles e função ligada ao guia; a detecção fica em tacticalAlerts)
data/player-instructions.json  instruções individuais (PIs): disponibilidade, exclusões e efeito por fase
data/opponent.json       adversário: correspondência de fases, estilos de jogo e impedimento
data/player-traits.json  características do jogador (traits): disponibilidade, conflitos, quem anula e efeito por fase
data/role-guide.json     guia das funções (painel "Sobre a função"): resumo, tarefas, atributos-chave, combinações, riscos e dicas
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
| Combinações sem risco conhecido | 10 | −35% por alerta de combinação do Book of Roles (ver abaixo) |

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

## Overlap e underlap

Em **Instruções de equipe**, *Corridas pelo lado esquerdo/direito* liga o overlap ou o underlap de cada lado. Vale para o defensor mais recuado do corredor daquele lado (lateral ou ala; o Lateral Invertido fica de fora, porque vira zagueiro) e só nas fases com bola:

- **overlap**: +4 na saída e +6 no ataque, e no ataque vai por fora (no máximo x 14). O Ala Invertido, por exemplo, deixa de fechar e desce pelo lado;
- **underlap**: +4 na saída e +6 no ataque, e no ataque passa por dentro (no mínimo x 26).

A Progressão herda pela mistura. Fonte: Book of Roles (o lateral em Apoio "fica perto da linha do meio" com overlap/underlap; captura da p. 27 com Alas Invertidos em overlap a x ~20). Os números ficam em `flankRuns` no `team-instructions.json`.

## Alertas de combinação

A caixa de avisos do card **Formação** mostra, em verde, riscos de combinação que o *Book of Roles* aponta e que dá para detectar pela escalação, cada um com um link para o guia da função:

| Alerta | Quando dispara |
|---|---|
| Construtor Avançado + overlap | Construtor Avançado no meio com overlap do mesmo lado |
| Mezzala + Extremo Invertido | os dois do mesmo lado |
| Extremo Invertido + Box-to-Box | os dois do mesmo lado |
| Construtor Aberto isolado | 2+ funções dinâmicas no lado oposto (Mezzala/Extremo Invertido/Atacante Interior em Ataque, Ala Invertido, Box-to-Box) |
| Enganche sem movimento | menos de 2 jogadores do meio para frente em Ataque, deambulando ou abrindo pelos canais |
| Avançado sozinho | um só atacante, Avançado, e ninguém aberto em Ataque |
| Regista ignorado | Regista + Zagueiro Simples com mentalidade Positiva ou mais |
| Volante que deambula sem proteção | quem deambula na faixa de volante sem ninguém segurando a posição à frente da defesa |
| Mezzala (A) sem proteção | idem, com Mezzala em Ataque |
| Trequartista na pressão | Trequartista central na meia com linha de pressão alta |
| Ala em Ataque sem largura | Ala (A) ou Ala Completo (A) sem ninguém aberto à frente do mesmo lado |
| Ala Completo (A) sem ajuda | ninguém em Apoio ou Defender do mesmo lado, na faixa de volante, meio ou meia (p. 26) |
| Segundo Atacante contra dois volantes | com o adversário ligado e dois volantes centrais nele |
| Raumdeuter sem sobrecarga | menos de 2 jogadores em Ataque no lado oposto |

Cada alerta tira pontos do critério *Combinações sem risco conhecido* do índice de equilíbrio, então o **✨ Sugerir funções** também passa a evitar essas combinações. Entre os atalhos de formação, só o 3-5-2 dispara um alerta: o ala direito em Ataque como única largura daquele lado, que é o caso descrito no livro.

## Adversário

Seção **Adversário** no painel: liga/desliga, formação (qualquer atalho, com as funções do atalho) e estilo de jogo. O adversário é calculado com o **mesmo motor** e espelhado (ataca para baixo); aparece como quadrado claro.

| Nossa fase | Adversário | Como |
|---|---|---|
| Defendendo | com a bola, progredindo | fase "ataque" dele, recuada pelo estilo (`shifts.defendendo`) |
| Saindo com a bola | pressionando nossa saída | fase "defendendo" dele, adiantada/recuada pelo estilo (`shifts.saindo`) |
| No ataque | bloco baixo | fase "defendendo" dele com a linha de defensores ancorada perto da própria área (`shifts.ataque.lineY`) |

Cada **estilo** é um conjunto de instruções de equipe (mentalidade, linhas, larguras), os deslocamentos acima e as **funções típicas** dos jogadores. Estilos incluídos, inspirados nos modelos táticos do jogo: Equilibrado, Controle de bola (Control Possession), Tiki-Taka, Tiki-Taka vertical, Gegenpress, Atacar pelas alas (Wing Play), Jogo direto (Route One), Contra-ataque e Bloco baixo (retranca).

**Funções do adversário:** trocar a formação ou o estilo aplica as funções típicas do estilo (`roles` por grupo de slots em `data/opponent.json`; ex.: Atacar pelas alas → extremos e alas de ataque; Gegenpress → atacantes de pressão e recuperadores; Tiki-Taka → laterais invertidos, Half-Back, Mezzala e Falso 9). Em **Funções dos jogadores adversários** dá para ajustar função e tarefa jogador a jogador; "Voltar às funções típicas do estilo" desfaz. As escolhas de funções e os números dos estilos são aproximações minhas.

**Impedimento** (`offside: true`): quem ataca não passa do último defensor de linha rival (o goleiro não conta), e só no campo adversário. Em vez de prender cada um exatamente na linha (o que achatava funções diferentes numa linha reta), o site comprime quem passaria dela e quem está nos 15 logo abaixo nesse espaço, proporcionalmente: o mais avançado fica na linha e a ordem entre eles se mantém. Com o adversário ligado, isso pode conter os **nossos** atacantes na linha dele nas fases com bola — o tooltip avisa "contido pela linha de impedimento". Com o adversário desligado, nosso time não muda.

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
8. **Ala Invertido no FM23** — tópico do [FM-Arena](https://fm-arena.com/thread/4615-fm23-inverted-wing-backs-how-they-work/) (lido via resumo de busca; o site bloqueou o acesso direto) e relato no bug tracker oficial da SI de que os Alas Invertidos ficavam abertos no FM23: **só inverte se o slot de volante do seu lado (DMCL/DMCR) estiver livre**; senão, age como Ala na mesma tarefa (`needsFreeSlot` + `fallbackRole` em `roles.json`). Isso muda, por exemplo, o 4-2-3-1 DM Wide, em que os dois volantes ocupam esses slots. O *Book of Roles* (item 10) acrescenta uma condição: sem ponta/meia aberto à frente dele (ML/AML à esquerda, MR/AMR à direita), também age como Ala (`needsOccupiedSlot`). O livro diz "sem pontas/meias abertos nos slots AML/AMR/ML/MR" sem especificar o lado; assumi que vale o do próprio lado.

9. **[Guide to Football — Tactical theory](https://fm.guidetofootball.com/tactical-theory/)**: framework teórico (528 conceitos) do qual vieram os nomes e as definições das notas de estrutura. O próprio site avisa que não foi testado no jogo e que sua aplicação a uma versão do FM é ao FM26.

10. **The Book of Roles, de Daljit Singh (FM23, 2023)** (PDF de 152 páginas enviado pelo usuário; ficou na `main` entre os PRs #17 e #19 e foi removido do repositório por tamanho, 49 MB — continua no histórico, no commit `db1de74`): movimento de cada função por fase, em texto e em ~177 capturas do jogo. As capturas 2D foram medidas: um script acha o campo pelas linhas brancas e desenha uma grade de 10% sobre ele, e a posição da função destacada (círculo vermelho ou legenda) foi lida em coordenadas do site, com a direção de ataque tirada do goleiro de cada time. Cada captura é um instante, não a média, então só entrou o que diverge bastante ou se repete em mais de uma imagem. Ajustes (entre parênteses, o que as capturas mostram):
   - **Lateral (S)** segura na progressão: −6 (y 29–37 com a bola no meio); **Ala (D)** acima do Lateral (S): saída y 30, ataque y 70 (72–74 em três capturas; depois da revisão, o Ala (S) foi a 76 e o Ala Completo (S) a 78, para manter as tarefas em ordem);
   - **Volante (D)** sem "pressionar menos" embutido (sai para pressionar ~20 acima dos zagueiros) e, com o **Âncora**, uns 10 acima dos zagueiros no ataque: y 56 e 55 (+9 a +14);
   - **Half Back** um pouco à frente dos zagueiros no ataque (y 50) e no terço adversário com Alas em Apoio/Ataque (y 64; captura: ~66), efeito `hb_push_with_wingbacks`;
   - **Regista** alto no ataque: y 74 (76–78); **Construtor Móvel** acampa na entrada da área: y 74;
   - **Segundo Volante** sobe já na progressão: (A) saída y 34 e +12 na progressão (~68, "quase na linha do ponta"), ataque y 80; (S) ataque y 70. O +8 na progressão que eu tinha dado ao (S) foi retirado na revisão: vinha de uma captura sem legenda, e o livro mostra o (S) atrás da bola;
   - **Box-to-Box** com o time instalado no campo adversário: y 78 (80); **Carrilero** y 70 no ataque: a captura mostra 78, mas a da p. 63 mostra ele só ~3 acima do Médio Centro (S), e a ordem Médio Centro (S) < Carrilero < Mezzala (S) vale mais que o número absoluto;
   - **Meia Aberto (S)** no meio-espaço: saída x 22 e ataque x 24, y 72 (x 20–33, y 72–83);
   - **Trequartista** recua até o meio-campo na saída: y 40 (29–37; na progressão o modelo dá 57–62, como as capturas);
   - **Segundo Atacante** recua na construção: saída y 46 e −8 na progressão (41–44 nas capturas, na altura da bola);
   - **Atacante Recuado** e **Pivô** recuam para segurar a bola: saída y 56 (S) / 60 (A) (Recuado 58 e Pivô 46–61 na progressão);
   - **Atacante de Pressão** volta para defender: (D) −4 no bloco médio, todas as tarefas −8 no bloco baixo, e (D)/(S) recuam para y 62 na saída (59 na progressão).

   **Revisão geral** (depois de um erro apontado pelo usuário no Segundo Volante): uma tabela com toda função × tarefa × slot × fase, mais duas checagens automáticas (ordem das tarefas e simetria esquerda/direita, ambas agora testes), achou e corrigiu:
   - **Ala Invertido (D)** não fechava para dentro em nenhuma fase: agora vai para a faixa de volante na saída (x 35, y 28) e segura a posição (ataque x 36, y 50);
   - **Construtor Avançado aberto** ficava colado na linha no ataque: agora fecha (x 30), como o livro descreve. Também fecham o **Trequartista aberto** (x 24); e o **Construtor Avançado (S)** na meia central fica no bolsão, na altura do Meia Ofensivo (S);
   - **Matador** ficava à frente do Avançado (93 x 92): o livro diz que o Avançado é o mais avançado, então o Matador foi a 91;
   - **Lateral (D)** ficava na altura dos zagueiros no ataque: agora sobe à intermediária (y 55) para cruzar de trás; **Lateral Simples** e **Lateral Invertido** ficavam abaixo dos zagueiros (40) e agora ficam na linha deles (45 e 44);
   - **Construtor Recuado (D)** no meio ficava mais alto que o (S) na saída: −5 (recurso novo `else` nas regras);
   - **Recuperador (D)** virou o mais recuado do meio quando o Âncora e o Volante (D) subiram: na faixa de volante, +1 no ataque;
   - **Mezzala (S)** abaixo do Carrilero: Mezzala (S) a 74;
   - **Falso 9** recuava menos que o Atacante Recuado: saída 54 (era 58); **Atacante Completo (S)** saída 60 (era 66);
   - **Extremo Defensivo (D)** tinha uma altura absoluta da época da linha a 25, que ficou sem efeito: agora −10 relativo;
   - **Médio Centro (D)** ficava na altura do (S) sem a bola: −3 ("senta mais recuado", pelo livro).

   **Conferidos e mantidos** (as capturas batem com o modelo): Construtor Recuado, Meia Aberto (D) sem a bola, Defensive Winger, Meia Central (S), Mezzala no ataque, Construtor Aberto, Ponta, Enganche, Falso 9, Avançado e Matador.

   **Não aplicado:** as listas de instruções embutidas do livro divergem do site em alguns pontos: sem "deambular" no Avançado, no Atacante Recuado e no Atacante de Pressão (A); sem "corridas pelos canais" no Atacante Completo (S); com "corridas pelos canais" no Raumdeuter; sem "pressionar menos" no Âncora. Como as listas do livro têm erros de copiar e colar (a do Ponta repete a do Meia Aberto), ficam para conferir no jogo. Também ficaram de fora medidas de uma captura só (Mezzala mais aberta na progressão, Meia Ofensivo (S) mais recuado sem a bola, Ala Invertido (S) mais aberto no ataque).

11. **[Página oficial da SI sobre a IA de partida do FM23](https://www.footballmanager.com/features/match-ai-and-animation)** (Sports Interactive, 30/09/2022), a fonte mais próxima do motor. Dela vieram:
   - **instruções de equipe do FM23**: a linha de pressão virou *Low Block / Mid Block / High Press*; a largura defensiva foi substituída por armadilhas de pressão fora do próprio terço (*Obrigar a jogar por fora / por dentro*, nome confirmado num print do jogo do usuário) e por instruções de cruzamento ("set your players to be narrow and defend the cross, or ask your full-backs to stop the cross at the source"); a armadilha de impedimento virou *Drop Off / Hold the Line*, que segundo a SI só afeta os lances no limite e por isso não muda a posição no site;
   - **Mezzala, Construtor Avançado e Médio Centro (Ataque)** "position them higher in the half-spaces during build-up play in certain formations, such as 4-3-3": no site, quando há volante (DMC/DMCL/DMCR), sobem 6 na saída e vão para o meio-espaço (x 31); o tamanho é estimativa;
   - também citados, sem mudança no site: alas numa linha de 5 pressionam mais agressivamente; o Extremo dá largura com mais consistência (o site já o mantém colado na linha).

   O manual oficial (community.sports-interactive.com) e os guias do FM23 no footballmanager.com não puderam ser lidos (bloqueio ou páginas removidas).

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

## Calibrar com dados do FM23

O site não reproduz o motor do jogo (que é fechado); os números são aproximações a partir das fontes acima. Para chegar mais perto, o caminho é medir o próprio FM23:

1. **Táticas:** escolha 2–3 táticas que cubram as funções que você usa e anote, para cada uma, a escalação (slot, função, tarefa) e as instruções de equipe com os mesmos nomes do site.
2. **Capturas:**
   - **posições médias** da partida (tela de análise/Data Hub); se o jogo separar com e sem a bola, mande as duas;
   - **2D por fase** (vários frames de cada, de partidas diferentes): goleiro/zagueiros com a bola (saída), bola no meio-campo com a posse (progressão), bola no terço final (ataque), adversário saindo com a bola no terço dele (pressão alta), adversário com a bola no meio-campo (bloco médio) e no nosso terço (bloco baixo). Campo inteiro na tela, câmera 2D sem zoom, e anote para que lado o seu time ataca.
3. **Medição:** `python3 tools/measure_pitch.py <prints> <saída>` acha o campo e desenha a grade de 10%; as posições lidas vão para `data/measurements.json` (formato descrito no próprio arquivo), com a tática e a fase.
4. **Medidas até agora** (`data/measurements.json`): 7 frames de 3 lances de um Nizza x Milan com o 3-4-2-1 do usuário (76 posições). Os cantos do campo de cada foto são achados automaticamente (validados contra a medição manual) e a perspectiva é corrigida pelos 4 cantos. O que mudou no site por causa delas (padrão repetido em dois lances independentes):
   - **Meia Ofensivo (A)** na saída: fica abaixo do atacante (no jogo, MO − AC = −6, −6, −3, −3) e só o alcança no terço final (+1, +6): saída de +4 para −2 sobre a faixa; o MO (S) foi a −4 para manter a ordem das tarefas;
   - **Construtor Avançado (S)** saindo da meia (AMCL/AMCR) abre para perto do corredor na construção (x 71–84 no jogo): saída x 25/75, **só quando não há ninguém aberto à frente do mesmo lado** (ML/AML ou MR/AMR), que é o contexto medido (`ifSideEmpty`); com um Extremo do mesmo lado fica no meio-espaço. No ataque continua fechando.

   Posições médias de 28 minutos do mesmo jogo (em `averages`; o comparador procura a mistura de fases do modelo que melhor as reproduz): confirmam o MO (A) logo abaixo do atacante e o CJA (S) abaixo do MO; mostram o CJA (S) e o CJ/DLP (S) centrais na média (x 55 e 52) e os alas mais fechados que o modelo, o que pode ser do contexto (largura estreita, obrigar a jogar por fora, Segundo Volante ao lado) e espera outra tática para separar função de contexto.

   Visto mas não aplicado: com o adversário recuado (lance de 16:41), o bloco do Milan inteiro joga ~8–10 mais alto que o modelo; com o adversário mais alto (06:47), bate. A altura do bloco depende de onde o adversário defende, e o site ainda não modela isso.
5. **Comparação:** `npm run compare` mostra, para cada medida, a posição do modelo na mesma tática e o erro, e resume o erro médio por função e por fase. As regras são ajustadas onde o erro for consistente entre medidas, e o teste de `measurements.json` garante que o arquivo continua válido.
6. **Frames contra os movimentos:** o comparador também pega cada frame, tira o deslocamento do bloco inteiro (o time todo subindo ou deslizando para a bola) e, para cada desvio individual de 7 ou mais, procura um movimento previsto da função que aponte para o mesmo lado. Com os 7 frames do Nizza x Milan: 5 de 33 desvios são explicados (subida do Ala S, condução do BPD). Os outros são, na maioria, de **posição** e não de movimento, e se repetem nos lances: os dois BPDs da linha de 3 abrem mais e sobem mais na progressão, o Construtor Recuado (S) desliza para o lado da bola e o MO (A) fica mais baixo na progressão. Ficam anotados para calibrar quando outra tática confirmar.

## A confirmar no jogo

- **Líbero:** Apoio/Ataque no FM23 (spec, FMScout e Seif Khaled); o Rate My Tactic (era FM24) dá Defender/Apoio — provavelmente mudou no FM24.
- Lateral Invertido junto com Half-Back na construção gera uma linha de 4 atrás; o efeito combinado ainda não foi calibrado.
- Os nomes em português das instruções são traduções minhas. Um print do FM23 do usuário (em português de Portugal) confirmou *Obrigar a jogar por fora* e *Impedir cruzamentos*; *por dentro* e *Convidar cruzamentos* seguem o mesmo padrão, sem confirmação.
- Os tamanhos dos efeitos das instruções do FM23 (obrigar a jogar por fora/dentro: fator de largura 0,65/0,85; cruzamentos: laterais 6 para fora ou linha 5 para dentro; meios-espaços na saída: +6) são estimativas; a direção vem da SI.
- Todos os valores numéricos são pontos de partida; calibre com o modo editar regra.

## Fora do escopo (v1)

Transições, bola parada, leitura de arquivos do jogo. Funções/instruções individuais do adversário.
