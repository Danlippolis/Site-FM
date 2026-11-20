/* Painel "Perguntar ao Claude" — só no build do artefato (scripts/build-artifact.js).
 * Lê a tática pelo gancho window.__fm (injetado em app.js no build) e conversa com o Claude
 * pela capacidade `sample` do artefato. Ferramentas: simular e aplicar mudanças na tática. */
(function () {
  'use strict';

  var RULES = [
    'Você é um analista tático de Football Manager 2023 embutido no site "FM23 Positioning Viewer".',
    'O site é um MODELO HEURÍSTICO por regras (não o motor do jogo): desenha a posição média dos 11 jogadores em 6 fases',
    '(Pressão alta, Bloco médio, Bloco baixo sem a bola; Saída de bola, Progressão, No ataque com a bola),',
    'a partir da formação, funções/tarefas, instruções individuais, características e instruções de equipe.',
    'A cada pergunta você recebe o estado atual da tática gerado pelo site, com posições, estrutura, notas e alertas.',
    '',
    'Coordenadas: x de 0 (nossa linha lateral esquerda) a 100 (direita); y de 0 (nossa linha de gol) a 100 (gol adversário).',
    'Em metros: x*0,68 e y*1,05 (campo 68 x 105). Nós atacamos para cima; o adversário ataca para baixo.',
    '',
    'Como responder:',
    '- Português do Brasil, direto, começando pela resposta. Sem introdução nem elogios.',
    '- Use os números do contexto (posições, distâncias, notas, índice de equilíbrio) para justificar. Não invente números.',
    '- Separe o que o modelo do site mostra do que acontece no jogo de verdade quando isso importar.',
    '- Use listas curtas ou tabelas só quando ajudarem. Markdown simples (negrito, listas, tabelas).',
    '- Ao sugerir trocas, use funções e tarefas válidas para o slot (lista no contexto) e diga o porquê.',
    '- Se as ferramentas estiverem disponíveis: use simular_tatica para testar propostas antes de recomendá-las e cite o antes/depois.',
    '  Use aplicar_tatica SOMENTE quando o usuário pedir explicitamente para aplicar/mudar a tática no site.',
    '- Se faltar informação (ex.: atributos dos jogadores, que o site não tem), diga isso em vez de supor.'
  ].join('\n');

  var QUICK = [
    'Analise minha tática: pontos fortes, fracos e riscos.',
    'Onde ela fica vulnerável sem a bola?',
    'Como melhorar a saída de bola?',
    'Sugira até 3 trocas de função, simule e compare.',
    'Explique o que cada jogador do meio-campo faz em cada fase.'
  ];

  var ERR = {
    not_granted: 'O uso do Claude não foi permitido nesta página. Para liberar, use o menu de permissões do artefato.',
    sampling_disabled: 'O Claude não está disponível para esta conta ou organização.',
    not_declared: 'Esta versão da página não tem acesso ao Claude.',
    capability_disabled: 'O Claude não está disponível nesta visualização.',
    capability_removed: 'O Claude não está disponível nesta versão do app.',
    rate_limited: 'Muitas perguntas seguidas ou limite de uso atingido. Espere um pouco e tente de novo.',
    session_expired: 'Sua sessão expirou. Entre de novo no claude.ai e recarregue a página.',
    prompt_too_large: 'A conversa ficou grande demais. Clique em "Limpar" e pergunte de novo.',
    refused: 'O Claude não respondeu a essa pergunta. Tente reformular.',
    empty_completion: 'O Claude não gerou resposta. Tente perguntar de outro jeito.',
    upstream_error: 'A conexão com o Claude falhou no meio. Tente de novo.'
  };
  var FATAL = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

  var sample = null, toolsOk = false;
  var history = [];            // {role, content}: só perguntas e respostas (o contexto vai só no último turno)
  var busy = false, ctl = null, disabled = false;
  var dom = {};

  // ---------- helpers ----------

  function A() { return window.__fm || null; }
  function r1(n) { return Math.round(n); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function roleLabel(key) { var r = A().data.roles[key]; return r ? r.label : key; }
  function dutyLabel(d) { var x = A().E.DUTIES[d]; return x ? x.label : d; }
  function piLabel(k) { var d = A().data.playerInstructions.instructions[k]; return d ? d.label : k; }
  function traitLabel(k) { var d = A().data.playerTraits.traits[k]; return d ? d.label : k; }
  function phaseLabel(ph) { var p = A().data.formations.phases[ph]; return p ? p.label : ph; }

  var TI_KEYS = ['mentality', 'defensiveLine', 'lineOfEngagement', 'widthInPossession', 'defensiveWidth', 'crosses', 'runsLeft', 'runsRight'];

  function oppSetup() {
    var a = A(), opp = a.oppConfig();
    return { opp: opp, cache: opp ? a.E.opponentCache(a.data, opp, a.E.OPP_PHASES) : null };
  }

  // ---------- contexto enviado ao Claude ----------

  function contextText() {
    var a = A();
    if (!a || !a.state || !a.data) return null;
    var E = a.E, data = a.data, st = a.state, lc = a.lastComputed;
    var out = [];
    var preset = a.presetById(st.presetId);
    var v = E.validate(st.players, data);
    var side = { L: 'na esquerda', C: 'no centro', R: 'na direita' }[a.ui.ballSide] || 'no centro';

    out.push('## Formação: ' + (preset ? preset.label : st.presetId) + ' (id ' + st.presetId + ')' + (v.ok ? '' : ' — INVÁLIDA: ' + v.errors.join('; ')));
    out.push('Bola desenhada ' + side + ' (opção de visualização).');

    var nums = {};
    if (lc && lc.defendendo) lc.defendendo.players.forEach(function (p) { nums[p.slot] = p.num; });
    out.push('\n## Jogadores (nº · slot · função (tarefa) [chave] · instruções individuais · características)');
    st.players.forEach(function (p) {
      var line = '#' + (nums[p.slot] || '?') + ' ' + p.slot + ' · ' + roleLabel(p.role) + ' (' + dutyLabel(p.duty) + ') [' + p.role + '/' + p.duty + ']';
      var locked = ((data.roles[p.role] || {}).duties || {})[p.duty];
      locked = locked && locked.locked;
      if (locked && locked.length) line += ' · embutidas: ' + locked.map(piLabel).join(', ');
      if (p.instructions && p.instructions.length) line += ' · PIs: ' + p.instructions.map(piLabel).join(', ');
      if (p.traits && p.traits.length) line += ' · características: ' + p.traits.map(traitLabel).join(', ');
      out.push(line);
    });

    out.push('\n## Instruções de equipe (valor atual; opções por índice)');
    TI_KEYS.forEach(function (k) {
      var def = data.instructions[k];
      if (!def || !def.options || st.ti[k] == null) return;
      var cur = def.options[st.ti[k]];
      out.push(k + ' — ' + def.label + ': ' + (cur ? cur.label : st.ti[k]) + '  (opções: ' + def.options.map(function (o, i) { return i + '=' + o.label; }).join(', ') + ')');
    });
    Object.keys(data.instructions.flags || {}).forEach(function (k) {
      out.push('flag ' + k + ' — ' + data.instructions.flags[k].label + ': ' + ((st.ti.flags || {})[k] ? 'sim' : 'não'));
    });

    if (st.opp && st.opp.enabled) {
      var stl = E.opponentStyle(data, st.opp.styleId);
      out.push('\n## Adversário ligado: ' + a.presetById(st.opp.presetId).label + (stl ? ', estilo ' + stl.label : ''));
    } else out.push('\n## Adversário: desligado (as métricas contra o adversário não entram).');

    if (v.ok) {
      var os = oppSetup();
      var ev = E.evaluateBalance(st.players, data, st.ti, os.cache);
      out.push('\n## Índice de equilíbrio do site: ' + r1(ev.score) + '/100');
      ev.parts.forEach(function (p) { out.push('- ' + p.label + ' (peso ' + p.weight + '): ' + r1(p.score * 100) + '% — ' + p.detail); });

      var alerts = E.tacticalAlerts(st.players, data, st.ti, os.opp ? os.opp.players : null);
      if (alerts.length) {
        out.push('\n## Alertas de combinação (Book of Roles)');
        alerts.forEach(function (al) { out.push('- ' + al.text + (al.page ? ' (p. ' + al.page + ')' : '')); });
      }
    }

    if (lc) {
      var warns = {};
      E.PHASES.forEach(function (ph) { (lc[ph].warnings || []).forEach(function (w) { warns[w] = 1; }); });
      if (Object.keys(warns).length) { out.push('\n## Avisos do motor'); Object.keys(warns).forEach(function (w) { out.push('- ' + w); }); }

      out.push('\n## Fases (posições x,y em 0–100; estrutura; notas 0–100)');
      E.PHASES.forEach(function (ph) {
        var pc = lc[ph]; if (!pc) return;
        var sh = E.teamShape(pc.players), m = sh.metrics;
        var sc = E.structureScores(pc.players, ph, data).scores;
        out.push('\n### ' + phaseLabel(ph) + ' [' + ph + '] — ' + (E.isWithBall(data.formations, ph) ? 'com a bola' : 'sem a bola'));
        if (pc.ball) out.push('bola em ' + r1(pc.ball.x) + ',' + r1(pc.ball.y));
        out.push('estrutura ' + sh.shape + ' · comprimento ' + m.length + ' m · largura ' + m.width + ' m · última linha a ' + m.lastLine + ' m do gol');
        out.push('notas: ' + sc.map(function (s) { return s.label + ' ' + s.value + ' (' + s.detail + ')'; }).join('; '));
        out.push('posições: ' + pc.players.map(function (p) { return '#' + p.num + ' ' + p.slot + ' ' + r1(p.x) + ',' + r1(p.y); }).join(' | '));
        if (pc.opponent) {
          var so = E.teamShape(pc.opponent.players, { attackingDown: true });
          out.push('adversário (' + pc.opponent.label + '): estrutura ' + so.shape + ', comprimento ' + so.metrics.length + ' m; posições: ' +
            pc.opponent.players.map(function (p) { return p.slot + ' ' + r1(p.x) + ',' + r1(p.y); }).join(' | '));
        }
      });
    }

    var g = data.guide;
    if (g && g.roles) {
      out.push('\n## Guia das funções em uso (resumo próprio do Book of Roles, Daljit Singh)');
      var seen = {};
      st.players.forEach(function (p) {
        var key = p.role + '/' + p.duty;
        if (seen[key]) return; seen[key] = 1;
        var e = g.roles[p.role];
        if (!e) return;
        var attrs = Array.isArray(e.attributes) ? e.attributes : (e.attributes || {})[p.duty];
        var parts = [roleLabel(p.role) + ' (' + dutyLabel(p.duty) + ')' + (e.page ? ', p. ' + e.page : '') + ': ' + (e.summary || '')];
        if (e.duties && e.duties[p.duty]) parts.push('tarefa: ' + e.duties[p.duty]);
        if (attrs && attrs.length) parts.push('atributos-chave: ' + attrs.map(function (k) { return (g.attributes[k] || {}).label || k; }).join(', '));
        ['risks', 'tips', 'combos', 'pairs'].forEach(function (k) {
          if (Array.isArray(e[k]) && e[k].length) parts.push(k + ': ' + e[k].map(function (x) { return typeof x === 'string' ? x : JSON.stringify(x); }).join(' / '));
        });
        out.push('- ' + parts.join(' · '));
      });
    }

    out.push('\n## Funções disponíveis (chave — nome — slots — tarefas)');
    Object.keys(data.roles).forEach(function (k) {
      var r = data.roles[k];
      out.push(k + ' — ' + r.label + (r.en ? ' / ' + r.en : '') + ' — ' + (r.slots || []).join(',') + ' — ' + Object.keys(r.duties || {}).join(','));
    });
    out.push('\nInstruções individuais (chave=nome): ' + Object.keys(data.playerInstructions.instructions).map(function (k) { return k + '=' + piLabel(k); }).join('; '));
    out.push('Características (chave=nome): ' + Object.keys(data.playerTraits.traits).map(function (k) { return k + '=' + traitLabel(k); }).join('; '));
    out.push('Formações (id): ' + data.formations.presets.map(function (p) { return p.id; }).join(', '));
    out.push('Slots possíveis: ' + Object.keys(data.formations.slots).join(', '));
    return out.join('\n');
  }

  // ---------- ferramentas ----------

  function resolveRole(v) {
    var roles = A().data.roles, s = String(v || '').trim();
    if (roles[s]) return s;
    var low = s.toLowerCase();
    return Object.keys(roles).find(function (k) {
      return (roles[k].label || '').toLowerCase() === low || (roles[k].en || '').toLowerCase() === low || (roles[k].abbr || '').toLowerCase() === low;
    }) || null;
  }

  function candidate(input) {
    var a = A(), E = a.E, data = a.data;
    var players = a.clone(a.state.players), ti = a.clone(a.state.ti), presetId = a.state.presetId;
    input = input || {};
    if (input.formation) {
      var pr = data.formations.presets.find(function (p) { return p.id === String(input.formation); });
      if (!pr) throw new Error('Formação desconhecida: ' + input.formation + '. Use um id da lista de formações.');
      players = a.clone(pr.players); presetId = pr.id;
    }
    var pis = data.playerInstructions.instructions, trs = data.playerTraits.traits;
    (Array.isArray(input.changes) ? input.changes : []).forEach(function (ch) {
      var slot = String(ch.slot || '').toUpperCase();
      var p = players.find(function (q) { return q.slot === slot; });
      if (!p) throw new Error('Não há jogador no slot ' + slot + '. Slots ocupados: ' + players.map(function (q) { return q.slot; }).join(', '));
      if (ch.to_slot) {
        var to = String(ch.to_slot).toUpperCase();
        if (!data.formations.slots[to]) throw new Error('Slot inexistente: ' + to);
        if (players.some(function (q) { return q !== p && q.slot === to; })) throw new Error('O slot ' + to + ' já está ocupado.');
        p.slot = to;
      }
      if (ch.role != null) {
        var rk = resolveRole(ch.role);
        if (!rk) throw new Error('Função desconhecida: ' + ch.role + '. Use uma chave da lista de funções.');
        if (data.roles[rk].slots.indexOf(p.slot) < 0) throw new Error(roleLabel(rk) + ' não pode jogar em ' + p.slot + ' (slots válidos: ' + data.roles[rk].slots.join(', ') + ').');
        p.role = rk;
        if (ch.duty == null && !data.roles[rk].duties[p.duty]) p.duty = Object.keys(data.roles[rk].duties)[0];
      }
      if (ch.duty != null) {
        var d = String(ch.duty);
        if (!data.roles[p.role].duties[d]) throw new Error('A tarefa ' + d + ' não existe para ' + roleLabel(p.role) + ' (opções: ' + Object.keys(data.roles[p.role].duties).join(', ') + ').');
        p.duty = d;
      }
      if (Array.isArray(ch.instructions)) {
        var bad = ch.instructions.filter(function (k) { return !pis[k]; });
        if (bad.length) throw new Error('Instrução individual desconhecida: ' + bad.join(', '));
        if (ch.instructions.length) p.instructions = ch.instructions.map(String); else delete p.instructions;
      }
      if (Array.isArray(ch.traits)) {
        var badT = ch.traits.filter(function (k) { return !trs[k]; });
        if (badT.length) throw new Error('Característica desconhecida: ' + badT.join(', '));
        if (ch.traits.length) p.traits = ch.traits.map(String); else delete p.traits;
      }
      a.fixPlayer(p);
    });
    var tin = input.team_instructions;
    if (tin && typeof tin === 'object') {
      Object.keys(tin).forEach(function (k) {
        var def = data.instructions[k];
        if (!def || !def.options || TI_KEYS.indexOf(k) < 0) throw new Error('Instrução de equipe desconhecida: ' + k + ' (use: ' + TI_KEYS.join(', ') + ')');
        var val = tin[k], idx = Number(val);
        if (!(idx >= 0 && idx < def.options.length && Math.floor(idx) === idx)) {
          var low = String(val).toLowerCase();
          idx = def.options.findIndex(function (o) { return o.label.toLowerCase() === low || (o.en || '').toLowerCase() === low; });
        }
        if (idx < 0) throw new Error('Valor inválido para ' + k + ': ' + val);
        ti[k] = idx;
      });
    }
    var v = E.validate(players, data);
    if (!v.ok) throw new Error('Tática inválida: ' + v.errors.join('; '));
    return { players: players, ti: ti, presetId: presetId };
  }

  function summary(c) {
    var a = A(), E = a.E, data = a.data, os = oppSetup();
    var ev = E.evaluateBalance(c.players, data, c.ti, os.cache);
    var m = E.computeMatch(c.players, data, Object.assign({}, c.ti, { ballSide: 'C' }), os.opp);
    var fases = {};
    E.PHASES.forEach(function (ph) {
      var sh = E.teamShape(m[ph].players);
      fases[ph] = {
        estrutura: sh.shape, comprimento_m: sh.metrics.length, largura_m: sh.metrics.width, ultima_linha_m: sh.metrics.lastLine,
        notas: E.structureScores(m[ph].players, ph, data).scores.map(function (s) { return s.label + ' ' + s.value; }).join(', ')
      };
    });
    return {
      equilibrio: r1(ev.score),
      criterios: ev.parts.map(function (p) { return p.label + ': ' + r1(p.score * 100) + '% (' + p.detail + ')'; }),
      alertas: E.tacticalAlerts(c.players, data, c.ti, os.opp ? os.opp.players : null).map(function (al) { return al.text; }),
      fases: fases,
      jogadores: c.players.map(function (p) { return p.slot + ' ' + p.role + '/' + p.duty + (p.instructions ? ' PIs:' + p.instructions.join(',') : ''); })
    };
  }

  function describeChange(input) {
    var bits = [];
    if (input.formation) bits.push('formação ' + input.formation);
    (input.changes || []).forEach(function (ch) {
      var s = String(ch.slot || '?').toUpperCase();
      var t = s + (ch.to_slot ? '→' + String(ch.to_slot).toUpperCase() : '');
      var rk = ch.role != null ? resolveRole(ch.role) : null;
      if (rk) t += ' ' + roleLabel(rk);
      if (ch.duty) t += ' (' + dutyLabel(ch.duty) + ')';
      if (Array.isArray(ch.instructions)) t += ' PIs: ' + (ch.instructions.map(piLabel).join(', ') || 'nenhuma');
      bits.push(t);
    });
    if (input.team_instructions) Object.keys(input.team_instructions).forEach(function (k) { bits.push(k + '=' + input.team_instructions[k]); });
    return bits.join(' · ') || 'sem mudanças';
  }

  var CHANGE_SCHEMA = {
    type: 'object',
    properties: {
      formation: { type: 'string', description: 'Opcional: id de formação da lista (troca os 11 pela formação padrão antes das mudanças).' },
      changes: {
        type: 'array',
        description: 'Mudanças por jogador, identificado pelo slot atual.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Slot atual do jogador, ex.: MCL, DR, STC.' },
            to_slot: { type: 'string', description: 'Opcional: mover para este slot vazio.' },
            role: { type: 'string', description: 'Chave da função, ex.: mezzala.' },
            duty: { type: 'string', description: 'Tarefa: D, S, A (ou St/Co para zagueiros, Au quando houver).' },
            instructions: { type: 'array', items: { type: 'string' }, description: 'Lista completa de instruções individuais (chaves). [] remove todas.' },
            traits: { type: 'array', items: { type: 'string' }, description: 'Lista completa de características (chaves). [] remove todas.' }
          },
          required: ['slot']
        }
      },
      team_instructions: { type: 'object', description: 'Opcional: {chave: índice da opção}, ex.: {"defensiveLine": 3}.' }
    }
  };

  function tools(bubble) {
    return [
      {
        name: 'simular_tatica',
        description: 'Testa mudanças na tática SEM alterar o site. Devolve o índice de equilíbrio, critérios, alertas e estrutura/notas de cada fase da tática resultante, e o equilíbrio atual para comparação.',
        inputSchema: CHANGE_SCHEMA,
        execute: function (input) {
          var act = addAct(bubble, 'Simulando', describeChange(input || {}));
          try {
            var c = candidate(input);
            var res = summary(c);
            var cur = summary({ players: A().state.players, ti: A().state.ti });
            res.equilibrio_atual = cur.equilibrio;
            act.appendChild(document.createTextNode('→ equilíbrio ' + cur.equilibrio + ' → ' + res.equilibrio));
            return res;
          } catch (e) { act.appendChild(document.createTextNode('→ erro: ' + e.message)); throw e; }
        }
      },
      {
        name: 'aplicar_tatica',
        description: 'Aplica as mudanças na tática do site (o usuário vê os campos mudarem e pode desfazer). Use só quando o usuário pedir explicitamente para aplicar. Devolve o resumo da tática aplicada.',
        inputSchema: CHANGE_SCHEMA,
        execute: function (input) {
          var a = A();
          var act = addAct(bubble, 'Aplicado', describeChange(input || {}));
          try {
            var c = candidate(input);
            var prev = a.clone(a.state);
            a.state = { presetId: c.presetId, players: c.players, ti: c.ti, opp: a.state.opp };
            a.ui.selectedSlot = null;
            a.renderAll(); a.syncTIForm(); a.syncOppForm();
            var undo = h('button', 'cl-undo', 'Desfazer');
            undo.type = 'button';
            undo.addEventListener('click', function () {
              a.state = prev; a.ui.selectedSlot = null;
              a.renderAll(); a.syncTIForm(); a.syncOppForm();
              undo.disabled = true; undo.textContent = 'Desfeito';
            });
            act.appendChild(undo);
            return summary(c);
          } catch (e) { act.appendChild(document.createTextNode('→ erro: ' + e.message)); throw e; }
        }
      }
    ];
  }

  // ---------- markdown mínimo (texto escapado antes) ----------

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  }
  function md(src) {
    var lines = src.replace(/\r/g, '').split('\n'), html = [], para = [], list = null, i = 0;
    function flushPara() { if (para.length) { html.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<' + list.tag + '>' + list.items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    function cells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
    while (i < lines.length) {
      var l = lines[i], m;
      if (/^```/.test(l)) {
        flushPara(); flushList();
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        html.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); i++; continue;
      }
      if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flushPara(); flushList();
        var head = cells(l), rows = []; i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        html.push('<div class="cl-table"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flushPara(); flushList(); html.push((m[1].length <= 2 ? '<h3>' : '<h4>') + inline(m[2]) + (m[1].length <= 2 ? '</h3>' : '</h4>')); i++; continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); i++; continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); i++; continue; }
      if (/^\s*$/.test(l)) { flushPara(); flushList(); i++; continue; }
      if (/^\s*---+\s*$/.test(l)) { flushPara(); flushList(); i++; continue; }
      flushList(); para.push(l); i++;
    }
    flushPara(); flushList();
    return html.join('');
  }

  // ---------- interface ----------

  function addAct(bubble, verb, text) {
    var box = bubble.querySelector('.cl-acts');
    if (!box) { box = h('div', 'cl-acts'); bubble.insertBefore(box, bubble.querySelector('.cl-md')); }
    var row = h('div', 'cl-act');
    row.appendChild(h('b', null, verb));
    row.appendChild(document.createTextNode(text + ' '));
    box.appendChild(row);
    scrollDown();
    return row;
  }

  function scrollDown() { dom.log.scrollTop = dom.log.scrollHeight; }

  function ctxLine() {
    var a = A();
    if (!a || !a.state) { dom.ctx.textContent = ''; return; }
    var pr = a.presetById(a.state.presetId);
    dom.ctx.textContent = 'O Claude vê: ' + (pr ? pr.label : a.state.presetId) + ', funções, instruções e as 6 fases' + (a.state.opp && a.state.opp.enabled ? ' + adversário' : '') + '.';
  }

  function renderEmpty() {
    dom.log.textContent = '';
    var box = h('div', 'cl-empty');
    box.appendChild(h('p', null, 'Pergunte sobre a tática que está na tela. A cada pergunta o Claude recebe a formação, as funções, as instruções e as posições das 6 fases.'));
    if (toolsOk) box.appendChild(h('p', null, 'Ele pode simular trocas antes de sugerir e, se você pedir, aplicá-las aqui (com botão de desfazer).'));
    var chips = h('div', 'cl-chips');
    QUICK.forEach(function (q) {
      var b = h('button', 'cl-chip', q); b.type = 'button';
      b.addEventListener('click', function () { send(q); });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    dom.log.appendChild(box);
  }

  function setBusy(on) {
    busy = on;
    dom.send.textContent = on ? 'Parar' : 'Enviar';
    dom.send.classList.toggle('cl-send', !on);
    dom.send.classList.toggle('danger', on);
    dom.clear.disabled = on;
    dom.log.querySelectorAll('.cl-chip').forEach(function (b) { b.disabled = on || disabled; });
  }

  function disableAll(msg) {
    disabled = true;
    dom.input.disabled = true; dom.send.disabled = true;
    dom.log.querySelectorAll('.cl-chip').forEach(function (b) { b.disabled = true; });
    var n = h('div', 'cl-note err', msg); dom.log.appendChild(n); scrollDown();
  }

  function send(q) {
    q = String(q || '').trim();
    if (!q || busy || disabled || !sample) return;
    var ctx = contextText();
    if (!ctx) return;
    if (!history.length) dom.log.textContent = '';
    dom.input.value = '';

    dom.log.appendChild(h('div', 'cl-msg user', q));
    var bubble = h('div', 'cl-msg bot');
    bubble.appendChild(h('div', 'cl-who', 'Claude'));
    var body = h('div', 'cl-md');
    body.appendChild(h('span', 'cl-thinking', 'Pensando…'));
    bubble.appendChild(body);
    dom.log.appendChild(bubble);
    scrollDown();

    var past = history.slice(-10);
    history.push({ role: 'user', content: q });
    var turns = [{ role: 'user', content: RULES }].concat(past, [{
      role: 'user',
      content: 'ESTADO ATUAL DA TÁTICA (gerado pelo site agora):\n\n' + ctx + '\n\n---\nPERGUNTA DO USUÁRIO:\n' + q
    }]);

    ctl = new AbortController();
    setBusy(true);
    var pending = null;
    var opts = {
      signal: ctl.signal,
      cache: false,
      modelTier: dom.tier.value,
      onText: function (u) {
        pending = u.text;
        requestAnimationFrame(function () {
          if (pending == null) return;
          body.innerHTML = md(pending); pending = null;
          var near = dom.log.scrollHeight - dom.log.scrollTop - dom.log.clientHeight < 80;
          if (near) scrollDown();
        });
      }
    };
    if (toolsOk) opts.tools = tools(bubble);

    sample(turns, opts).then(function (res) {
      pending = null;
      body.innerHTML = md(res.text);
      history.push({ role: 'assistant', content: res.text });
      if (res.truncated) bubble.appendChild(h('div', 'cl-note', 'Resposta cortada no limite de tamanho. Peça uma parte de cada vez.'));
    }).catch(function (e) {
      pending = null;
      var code = (e && e.code) || 'upstream_error';
      if (e && e.text && code !== 'refused') body.innerHTML = md(e.text);
      else body.textContent = '';
      if (code === 'cancelled') { bubble.appendChild(h('div', 'cl-note', 'Interrompido.')); return; }
      if (FATAL.indexOf(code) >= 0) { disableAll(ERR[code] || ERR.capability_disabled); return; }
      bubble.appendChild(h('div', 'cl-note err', ERR[code] || ERR.upstream_error));
    }).then(function () {
      ctl = null; setBusy(false); scrollDown();
      if (!disabled) dom.input.focus();
    });
  }

  function open() { dom.drawer.hidden = false; dom.fab.hidden = true; ctxLine(); setTimeout(function () { dom.input.focus(); }, 30); }
  function close() { dom.drawer.hidden = true; dom.fab.hidden = false; dom.fab.focus(); }

  function build() {
    var fab = h('button', 'cl-fab'); fab.type = 'button'; fab.hidden = true;
    fab.setAttribute('aria-label', 'Perguntar ao Claude sobre a tática');
    fab.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0l1.6 5.1L15 6.4l-4.4 2.9L11.9 15 8 11.7 4.1 15l1.3-5.7L1 6.4l5.4-1.3z"/></svg><span>Perguntar ao Claude</span>';
    fab.addEventListener('click', open);

    var drawer = h('aside', 'cl-drawer'); drawer.hidden = true;
    drawer.setAttribute('aria-label', 'Perguntar ao Claude');
    var head = h('div', 'cl-head');
    var title = h('h2', null, 'Perguntar ao Claude');
    title.appendChild(h('small', null, 'Análise da tática que está na tela'));
    head.appendChild(title);
    var tier = h('select'); tier.id = 'clTier'; tier.setAttribute('aria-label', 'Profundidade da resposta');
    [['quick', 'Rápido'], ['default', 'Padrão'], ['complex', 'Profundo']].forEach(function (o) {
      var op = h('option', null, o[1]); op.value = o[0]; tier.appendChild(op);
    });
    tier.value = 'default';
    head.appendChild(tier);
    var clear = h('button', 'btn small', 'Limpar'); clear.type = 'button'; clear.style.marginTop = '0';
    clear.addEventListener('click', function () { history = []; renderEmpty(); });
    head.appendChild(clear);
    var x = h('button', 'icon-btn', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
    x.addEventListener('click', close);
    head.appendChild(x);

    var log = h('div', 'cl-log'); log.setAttribute('aria-live', 'polite');
    var compose = h('form', 'cl-compose');
    var input = h('textarea'); input.id = 'clInput'; input.rows = 3;
    input.placeholder = 'Ex.: meu meio-campo fica exposto no contra-ataque?';
    input.setAttribute('aria-label', 'Sua pergunta');
    var row = h('div', 'cl-row');
    var ctx = h('div', 'cl-ctx');
    var sendBtn = h('button', 'btn cl-send', 'Enviar'); sendBtn.type = 'submit';
    row.appendChild(ctx); row.appendChild(sendBtn);
    compose.appendChild(input); compose.appendChild(row);
    compose.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) { if (ctl) ctl.abort(); return; }
      send(input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(input.value); }
    });
    drawer.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    drawer.appendChild(head); drawer.appendChild(log); drawer.appendChild(compose);
    document.body.appendChild(fab); document.body.appendChild(drawer);
    dom = { fab: fab, drawer: drawer, log: log, input: input, send: sendBtn, clear: clear, tier: tier, ctx: ctx };
    renderEmpty();
  }

  // No viewer, confirm() sempre devolve false: troca por "clique de novo para confirmar" no próprio botão.
  (function twoClickConfirm() {
    var last = null, armed = null, timer = null;
    document.addEventListener('click', function (e) { last = e.target.closest ? e.target.closest('button') : null; }, true);
    function disarm() { if (armed) { armed.textContent = armed.dataset.clLabel; armed = null; } clearTimeout(timer); }
    window.confirm = function () {
      var b = last;
      if (!b) return true;
      if (armed === b) { disarm(); return true; }
      disarm();
      armed = b; b.dataset.clLabel = b.textContent; b.textContent = 'Clique de novo para confirmar';
      timer = setTimeout(disarm, 5000);
      return false;
    };
  })();

  function start() {
    build();
    if (!window.claude || typeof window.claude.use !== 'function') return;
    window.claude.use('sample').then(function (s) {
      if (!s) return;
      sample = s;
      return s.limits().catch(function () { return null; }).then(function (lim) {
        toolsOk = !!(lim && lim.tools);
        renderEmpty();
        dom.fab.hidden = !dom.drawer.hidden;
      });
    }).catch(function () { /* sem Claude: o site funciona normalmente */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
