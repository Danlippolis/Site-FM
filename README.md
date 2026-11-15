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
| Deambular / sair da posição (Roam From Position) | zona de raio 6 / 8 (saindo / ataque); não para GK nem defensores |
| Manter posição (Hold Position) | saindo dy −2, ataque dy −8 |
| Abrir mais (Stay Wider) | para fora 4 / 6 (saindo / ataque) |
| Fechar mais (Sit Narrower) | para dentro 4 / 7 |
| Cortar para dentro com a bola (Cut Inside With Ball) | ataque: para dentro 5 |
| Correr pela lateral com a bola (Run Wide With Ball) | ataque: para fora 4 |
| Mover-se para os corredores (Move Into Channels) | para fora 4 / 8 (só AM/ST em CL/CR) |
| Cruzar da linha de fundo / Cruzar de trás | ataque dy +3 / −5 |
| Pressionar mais / menos (Close Down More/Less) | defendendo dy +3 / −3 |

Formato em `data/player-instructions.json`: `phases.<fase>` aceita `dx`, `dy`, `inside` (rumo ao centro, nunca cruza o meio) e `outside`. Disponibilidade por `bands`, `notBands`, `lanes`, `sides`, `excludeRoles`; exclusão mútua por `excludes`. As PIs entram como deltas depois da regra da função, então o modo editar regra continua gravando só a parte da função.

**A confirmar no jogo:** os valores são estimativas minhas; a disponibilidade por função é aproximada (ex.: no FM algumas PIs ficam travadas por função); os nomes em português são traduções minhas, não necessariamente os da localização oficial. Traits continuam fora do escopo.

## Deambular (Roam From Position)

Deambular não tem posição fixa: o jogador circula para achar espaço. Por isso o site desenha uma **zona** (elipse tracejada) em volta da posição média, só nas fases com bola, em vez de mover o ponto.
- Embutido na função (campo `roam` em `roles.json`): Trequartista (10), Construtor Móvel (8), Raumdeuter (8), Regista (6), Atacante Completo (6) e Líbero (A) no ataque (6).
- Como instrução individual: raio 6 na saída e 8 no ataque. Exclui "Manter posição" e fica indisponível para as funções que já deambulam.

## Base da pesquisa

As descrições (`desc`) e as regras das funções que a spec deixou vazias vêm de leitura qualitativa, principalmente do [guia de funções do FMScout](https://www.fmscout.com/a-guide-to-player-roles-in-football-manager.html) (atualizado para o FM22) e do [guia de pares e combinações](https://www.fmscout.com/a-tactical-guide-pairs-and-combinations.html). **Nenhuma fonte pública dá coordenadas**: a descrição ("recua um pouco", "sobe para pressionar") foi convertida por mim em números, que servem de ponto de partida para calibrar. O fórum da Sports Interactive, o FMInside e o Passion4FM bloqueiam acesso automatizado e não foram lidos.

Pontos que a pesquisa mudou ou levantou:
- **Stopper / Cobertura** dos zagueiros agora têm efeito: Stopper sobe 3 sem a bola; Cobertura recua 3.
- **Automático** (laterais, alas, médio centro, médio ala) segue a mentalidade, como o guia descreve: Muito Defensiva e Defensiva → D; Cautelosa a Positiva → S; Ofensiva e Muito Ofensiva → A (`engine.autoDutyByMentality`). O mapeamento exato é estimativa minha.
- **Half-Back:** as fontes divergem. O guia de funções diz que ele vira um zagueiro a mais com a bola (o que a spec usa); o guia de pares, mais antigo, diz que recua entre os zagueiros quando o time perde a bola. Mantive a spec.
- **Regista, Construtor Móvel, Trequartista, Raumdeuter e Atacante Completo** são descritos com liberdade posicional. Só o Trequartista tem fonte afirmando que o Deambular é travado na função; para os outros é inferência.

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
