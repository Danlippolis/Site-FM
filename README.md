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
data/roles.json          funções, slots válidos, tarefas e regras por fase
data/team-instructions.json  mentalidade, linha defensiva, linha de pressão, largura, parâmetros do motor
data/player-instructions.json  instruções individuais (PIs): disponibilidade, exclusões e efeito por fase
scripts/build.js         gera dist/fm23-viewer.html (tudo embutido)
tests/engine.test.js     11 jogadores, validação, clamp, espelhamento, efeitos, colisão, inversa do modo edição
```

## Calibração

- Edite `data/roles.json` (regras por função+tarefa+fase: `x`, `y` absolutos ou `dx`, `dy`; `effects`; `if` p/ flag; `onlyBands`). `x` é sempre escrito para o lado esquerdo e espelhado à direita.
- Ou, no site, ative **Modo editar regra**, arraste um jogador e depois **Exportar roles.json**. As edições ficam no `localStorage` até você exportar/resetar.
- Novos efeitos: `FMEngine.registerEffect('nome', function (players, phase, source) { ... })`.

## Instruções individuais (PIs)

Botão **PI** ao lado de cada jogador abre as instruções disponíveis para aquele slot/função. Marcar uma instrução desmarca a oposta (ex.: Avançar mais × Manter posição), como no jogo. Jogadores com PIs ganham um ponto branco no campo e as instruções aparecem no tooltip.

| Instrução | Efeito inicial |
|---|---|
| Avançar mais (Get Further Forward) | saindo dy +3, ataque dy +6 |
| Manter posição (Hold Position) | saindo dy −2, ataque dy −8 |
| Abrir mais (Stay Wider) | para fora 4 / 6 (saindo / ataque) |
| Fechar mais (Sit Narrower) | para dentro 4 / 7 |
| Cortar para dentro com a bola (Cut Inside With Ball) | ataque: para dentro 5 |
| Correr pela lateral com a bola (Run Wide With Ball) | ataque: para fora 4 |
| Mover-se para os corredores (Move Into Channels) | para fora 4 / 8 (só AM/ST em CL/CR) |
| Cruzar da linha de fundo / Cruzar de trás | ataque dy +3 / −5 |
| Pressionar mais / menos (Close Down More/Less) | defendendo dy +3 / −3 |

Formato em `data/player-instructions.json`: `phases.<fase>` aceita `dx`, `dy`, `inside` (rumo ao centro, nunca cruza o meio) e `outside`. Disponibilidade por `bands`, `notBands`, `lanes`, `sides`, `excludeRoles`; exclusão mútua por `excludes`. As PIs entram como deltas depois da regra da função, então o modo editar regra continua gravando só a parte da função.

**A confirmar no jogo:** os valores são estimativas minhas; a disponibilidade por função é aproximada (ex.: no FM algumas PIs ficam travadas por função); os nomes em português são traduções minhas, não necessariamente os da localização oficial. "Sair da posição" (Roam) ficou de fora por não ter efeito posicional determinístico; traits continuam fora do escopo.

## Decisões que diferem/complementam a spec

1. **Ordem do pipeline:** as instruções de equipe são aplicadas *depois* do override da função, como deslocamento. Assim mentalidade/linha/largura continuam valendo para funções com posição absoluta (ex.: Lateral (S) no ataque `y 62` vira `y 67` com mentalidade Ofensiva).
2. **Colisão medida em metros** (`collisionAspect: [0.68, 1.05]`), não em unidades normalizadas: 6 unidades em `x` são só ~4 m e os círculos se sobrepunham. Para o comportamento literal da spec, use `[1, 1]`.
3. **Slots centrais** (DC, DMC, MC, AMC, STC) ignoram `x`/`dx` das regras — não há lado para espelhar. Só `y` vale.
4. **Construtor Recuado (D)** dividindo os DCs é uma flag nas instruções de equipe (só para DLP na faixa DM).
5. **Tarefas dos zagueiros** usam códigos próprios: `D` Defender, `St` Stopper, `Co` Cobertura (o `S` da spec colidia com Apoio). Outros: `S` Apoio, `A` Ataque, `Au` Automático.
6. **4-2-3-1** aparece em duas versões: *Wide* (MCL/MCR) e *DM Wide* (DMCL/DMCR). **4-3-1-2 losango** usa DMC + MCL + MCR + AMC.
7. Na fase **Defendendo** a linha defensiva move todo o bloco exceto o goleiro.

## A confirmar no jogo

- Zagueiro Simples (No-Nonsense CB): a spec lista D/Co; acho que no FM23 ele também tem Stopper — não incluí.
- Líbero: slots e tarefas (marcado com ⚠ no seletor).
- Lateral Invertido (Inverted Full-Back, D): não está na spec e não incluí.
- Todos os valores numéricos são os iniciais da spec; funções sem linha na tabela começam sem ajuste.

## Fora do escopo (v1)

Traits, lado da bola, adversário, transições, bola parada, leitura de arquivos do jogo.
