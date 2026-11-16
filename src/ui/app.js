/* FM23 Positioning Viewer — interface (vanilla JS, SVG). Depende de window.FMEngine. */
(function () {
  'use strict';

  var E = window.FMEngine;
  var LS_STATE = 'fm23pv.state.v1';
  var LS_ROLES = 'fm23pv.roles.v1';
  var LS_UI = 'fm23pv.ui.v1';
  var SVGNS = 'http://www.w3.org/2000/svg';

  // Campo desenhado em "metros": 68 × 105, com margem P. x/y normalizados 0–100 são escalados.
  var P = 2.5, SX = 0.68, SY = 1.05, VW = 68 + 2 * P, VH = 105 + 2 * P, R = 2.9;

  var BAND_LABEL = { GK: 'Goleiro', D: 'Defesa', DM: 'Meio-defensivo / alas', M: 'Meio', AM: 'Meia ofensivo', ST: 'Ataque' };

  var data = null, baseRoles = null, lastComputed = null;
  var state = null;
  var ui = { ghost: false, shapes: true, edit: false, tab: 'saindo', group: 'todas', collapsed: false, ballSide: 'C', selectedSlot: null, piOpen: null, info: {}, suggestion: null, undo: null };
  var anim = { on: false, step: 0, timer: null };
  var drag = null;

  // ---------- utilidades ----------

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage indisponível */ }
  }
  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k in e && typeof attrs[k] !== 'string') e[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (text != null) e.textContent = text;
    return e;
  }
  function toSvg(x, y) { return [P + x * SX, P + (100 - y) * SY]; }
  function fromSvg(sx, sy) { return [(sx - P) / SX, 100 - (sy - P) / SY]; }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ''); }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3200);
  }

  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function readJsonFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      input.value = '';
      try { cb(JSON.parse(fr.result)); } catch (e) { toast('Arquivo inválido: ' + e.message, 5000); }
    };
    fr.readAsText(f);
  }

  // ---------- dados ----------

  function loadData() {
    function inline(id) { var s = document.getElementById(id); return s ? JSON.parse(s.textContent) : null; }
    var f = inline('data-formations'), r = inline('data-roles'), t = inline('data-instructions'), pi = inline('data-player-instructions'), op = inline('data-opponent'), tr = inline('data-player-traits');
    if (f && r && t && pi && op && tr) return Promise.resolve({ formations: f, roles: r, instructions: t, playerInstructions: pi, opponent: op, playerTraits: tr, guide: inline('data-role-guide'), alerts: inline('data-alerts') });
    var urls = ['data/formations.json', 'data/roles.json', 'data/team-instructions.json', 'data/player-instructions.json', 'data/opponent.json', 'data/player-traits.json'];
    var vm = document.querySelector('meta[name="fm23pv-version"]');
    var v = vm ? '?v=' + vm.content : '';
    function get(u) {
      return fetch(u + v, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error(u + ': HTTP ' + res.status);
        return res.json();
      });
    }
    // o guia das funções é opcional: sem ele o site funciona, só não mostra o painel
    var optional = ['data/role-guide.json', 'data/alerts.json'].map(function (u) { return get(u).catch(function () { return null; }); });
    return Promise.all(urls.map(get).concat(optional))
      .then(function (a) { return { formations: a[0], roles: a[1], instructions: a[2], playerInstructions: a[3], opponent: a[4], playerTraits: a[5], guide: a[6], alerts: a[7] }; });
  }

  function isRolesObj(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var keys = Object.keys(o);
    return keys.length > 0 && keys.every(function (k) {
      return o[k] && Array.isArray(o[k].slots) && o[k].duties && typeof o[k].duties === 'object' && o[k].label;
    });
  }

  function defaultTI() {
    var ins = data.instructions, flags = {};
    Object.keys(ins.flags || {}).forEach(function (k) { flags[k] = !!ins.flags[k].default; });
    return {
      mentality: ins.mentality.default,
      defensiveLine: ins.defensiveLine.default,
      lineOfEngagement: ins.lineOfEngagement.default,
      widthInPossession: ins.widthInPossession.default,
      defensiveWidth: ins.defensiveWidth ? ins.defensiveWidth.default : undefined,
      crosses: ins.crosses ? ins.crosses.default : undefined,
      runsLeft: ins.runsLeft ? ins.runsLeft.default : undefined,
      runsRight: ins.runsRight ? ins.runsRight.default : undefined,
      flags: flags
    };
  }

  function presetById(id) {
    var list = data.formations.presets;
    return list.find(function (p) { return p.id === id; }) || list[0];
  }

  function defaultState() {
    var pr = presetById(data.formations.defaultPreset);
    return { presetId: pr.id, players: clone(pr.players), ti: defaultTI(), opp: defaultOpp() };
  }

  function defaultOpp() { return clone((data.opponent && data.opponent.default) || { enabled: false }); }

  /** Configuração do adversário para o motor: jogadores do atalho de formação escolhido. */
  function oppConfig() {
    var o = state.opp || {};
    if (!o.enabled) return null;
    ensureOppPlayers();
    return { enabled: true, styleId: o.styleId, players: clone(o.players) };
  }

  /** Funções do adversário: as editadas pelo usuário, ou as típicas do estilo aplicadas à formação. */
  function ensureOppPlayers() {
    var o = state.opp;
    if (Array.isArray(o.players) && o.players.length === 11 && E.validate(o.players, data).ok) return;
    resetOppPlayers();
  }
  function resetOppPlayers() {
    var o = state.opp, pr = presetById(o.presetId);
    o.players = E.styleRoles(clone(pr.players).map(function (p) { return fixRole(p); }), data, o.styleId);
  }

  function validRoleFor(slot, role, duty) {
    var r = data.roles[role];
    return !!(r && r.slots.indexOf(slot) >= 0 && r.duties[duty]);
  }

  function piDefs() { return (data.playerInstructions && data.playerInstructions.instructions) || {}; }

  /** Remove instruções individuais que não valem para o slot/função atuais. */
  function traitDefs() { return (data.playerTraits && data.playerTraits.traits) || {}; }

  function prunePIs(p) {
    if (!data.formations.slots[p.slot]) return p;
    var info = E.slotInfo(data.formations, p.slot);
    if (p.instructions) {
      var kept = E.resolvePlayerInstructions(p, info, piDefs(), data.roles).applied;
      if (kept.length) p.instructions = kept; else delete p.instructions;
    }
    if (p.traits) {
      // características que não existem neste slot saem; as só anuladas por instrução ficam (são do jogador)
      var td = traitDefs();
      var keep = p.traits.filter(function (k) { return td[k] && E.piAvailability(td[k], p, info).ok; });
      if (keep.length) p.traits = keep; else delete p.traits;
    }
    return p;
  }

  /** Garante função/tarefa válidas para o slot (após mover jogador ou importar regras) e PIs compatíveis. */
  function fixPlayer(p) {
    fixRole(p);
    return prunePIs(p);
  }

  function fixRole(p) {
    if (validRoleFor(p.slot, p.role, p.duty)) return p;
    var r = data.roles[p.role];
    if (r && r.slots.indexOf(p.slot) >= 0) { p.duty = Object.keys(r.duties)[0]; return p; }
    var def = data.formations.defaultRoles[p.slot];
    if (def && validRoleFor(p.slot, def[0], def[1])) { p.role = def[0]; p.duty = def[1]; return p; }
    var opts = E.rolesForSlot(data.roles, p.slot);
    if (opts.length) { p.role = opts[0]; p.duty = Object.keys(data.roles[opts[0]].duties)[0]; }
    return p;
  }

  function saveState() { lsSet(LS_STATE, state); lsSet(LS_UI, { ghost: ui.ghost, shapes: ui.shapes, tab: ui.tab, group: ui.group, collapsed: ui.collapsed, ballSide: ui.ballSide }); }

  /** Fases do grupo escolhido (desktop): sem a bola, com a bola ou todas. */
  function groupPhases() {
    var g = data.formations.phaseGroups || {};
    if (ui.group === 'sem' && g.sem) return g.sem;
    if (ui.group === 'com' && g.com) return g.com;
    return E.PHASES;
  }

  // ---------- montagem estática ----------

  function buildStatic() {
    var sel = $('preset');
    data.formations.presets.forEach(function (p) { sel.appendChild(el('option', { value: p.id }, p.label)); });
    $('applyPreset').addEventListener('click', function () {
      var pr = presetById(sel.value);
      state.presetId = pr.id;
      state.players = clone(pr.players).map(fixPlayer);
      ui.selectedSlot = null;
      renderAll();
      toast('Formação ' + pr.label + ' aplicada.');
    });

    buildTIForm();
    buildOppForm();

    var tabs = $('tabs'), fields = $('fields');
    E.PHASES.forEach(function (ph) {
      var label = data.formations.phases[ph].label;
      var tab = el('button', { class: 'tab', role: 'tab', 'data-phase': ph }, label);
      tab.addEventListener('click', function () { ui.tab = ph; syncTabs(); saveState(); });
      tabs.appendChild(tab);

      var card = el('section', { class: 'field-card', 'data-phase': ph });
      var h = el('h3', null, label);
      h.appendChild(el('span', null, (data.formations.phases[ph].hint || '') + ' · ataca ↑'));
      card.appendChild(h);
      card.appendChild(el('p', { class: 'shape-line', id: 'shape-' + ph }));
      card.appendChild(el('div', { class: 'scores', id: 'scores-' + ph }));
      card.appendChild(el('p', { class: 'opp-line', id: 'oppline-' + ph }));
      var svg = svgEl('svg', { class: 'pitch', id: 'pitch-' + ph, role: 'img', 'aria-label': 'Campo — ' + label });
      svg.dataset.phase = ph;
      card.appendChild(svg);
      card.appendChild(el('p', { class: 'info', id: 'info-' + ph }, 'Passe o mouse ou toque num jogador para ver detalhes.'));
      fields.appendChild(card);
      buildPitch(svg);
    });
    buildPitch($('animSvg'));

    var steps = $('animSteps');
    E.PHASES.forEach(function (ph) { steps.appendChild(el('span', { 'data-phase': ph }, data.formations.phases[ph].label)); });

    var legend = $('legend');
    ['GK', 'D', 'DM', 'M', 'AM', 'ST'].forEach(function (b) {
      var s = el('span');
      var i = el('i'); i.style.background = 'var(--b-' + b + ')';
      s.appendChild(i); s.appendChild(document.createTextNode(BAND_LABEL[b]));
      legend.appendChild(s);
    });
    legend.appendChild(el('span', null, '○ bola'));
    legend.appendChild(el('span', null, '• ponto branco = jogador com instruções individuais'));
    legend.appendChild(el('span', null, '◌ área sombreada = zona de deambulação'));
    legend.appendChild(el('span', null, '▢ quadrado claro = adversário (ataca para baixo)'));
    legend.appendChild(el('span', null, '— linhas brancas = linhas do time (estrutura); pontilhado = jogador da mesma linha, escalonado à frente ou atrás'));
    legend.appendChild(el('span', null, 'Linhas tracejadas = terços do campo'));

    document.querySelectorAll('#groups .tab').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.group = b.dataset.group;
        if (groupPhases().indexOf(ui.tab) < 0) ui.tab = groupPhases()[0];
        syncTabs(); saveState();
        if (anim.on) { toggleAnim(); toggleAnim(); }
      });
    });
    $('optShape').checked = ui.shapes;
    $('optShape').addEventListener('change', function (e) { ui.shapes = e.target.checked; renderFields(); saveState(); });
    $('optGhost').checked = ui.ghost;
    $('optGhost').addEventListener('change', function (e) { ui.ghost = e.target.checked; renderFields(); saveState(); });
    $('optEdit').addEventListener('change', function (e) {
      ui.edit = e.target.checked;
      document.querySelectorAll('.fields svg.pitch').forEach(function (s) { s.classList.toggle('editing', ui.edit); });
      if (ui.edit) toast('Modo editar: arraste um jogador para gravar a posição como override da função+tarefa naquela fase.', 5000);
    });

    $('togglePanel').addEventListener('click', function () {
      ui.collapsed = !ui.collapsed;
      $('layout').classList.toggle('collapsed', ui.collapsed);
      saveState();
    });
    $('layout').classList.toggle('collapsed', ui.collapsed);

    $('animate').addEventListener('click', toggleAnim);
    document.querySelectorAll('#ballSide .tab').forEach(function (b) {
      b.addEventListener('click', function () { ui.ballSide = b.dataset.side; syncBallSide(); renderAll(); });
    });
    syncBallSide();
    $('suggestBtn').addEventListener('click', runSuggestion);

    $('exportTactic').addEventListener('click', function () {
      download('tatica-fm23-' + state.presetId + '.json', {
        format: 'fm23pv-tactic', version: 1, presetId: state.presetId, players: state.players, ti: state.ti, opp: state.opp
      });
    });
    $('importTactic').addEventListener('click', function () { $('fileTactic').click(); });
    $('fileTactic').addEventListener('change', function (e) {
      readJsonFile(e.target, function (obj) {
        if (!obj || !Array.isArray(obj.players)) { toast('Arquivo não parece uma tática exportada por este site.', 5000); return; }
        var v = E.validate(obj.players, data);
        if (!v.ok) { toast('Tática inválida: ' + v.errors[0], 6000); return; }
        state = {
          presetId: obj.presetId || state.presetId,
          players: obj.players.map(function (p) {
            var q = { slot: p.slot, role: p.role, duty: p.duty };
            if (Array.isArray(p.instructions) && p.instructions.length) q.instructions = p.instructions.filter(function (k) { return typeof k === 'string'; });
            if (Array.isArray(p.traits) && p.traits.length) q.traits = p.traits.filter(function (k) { return typeof k === 'string'; });
            return q;
          }),
          ti: Object.assign(defaultTI(), obj.ti || {}),
          opp: Object.assign(defaultOpp(), obj.opp || {})
        };
        renderAll(); syncTIForm(); syncOppForm();
        toast('Tática importada.');
      });
    });
    $('exportRoles').addEventListener('click', function () { download('roles.json', data.roles); });
    $('importRoles').addEventListener('click', function () { $('fileRoles').click(); });
    $('fileRoles').addEventListener('change', function (e) {
      readJsonFile(e.target, function (obj) {
        if (!isRolesObj(obj)) { toast('roles.json inválido: cada função precisa de label, slots e duties.', 6000); return; }
        data.roles = obj;
        lsSet(LS_ROLES, obj);
        state.players.forEach(fixPlayer);
        renderAll();
        toast('Regras importadas (' + Object.keys(obj).length + ' funções).');
      });
    });
    $('resetTactic').addEventListener('click', function () {
      if (!confirm('Voltar para a formação e instruções padrão?')) return;
      state = defaultState();
      ui.selectedSlot = null;
      renderAll(); syncTIForm(); syncOppForm();
    });
    $('resetRoles').addEventListener('click', function () {
      if (!confirm('Descartar todas as regras editadas/importadas e voltar ao data/roles.json original?')) return;
      data.roles = clone(baseRoles);
      lsSet(LS_ROLES, null);
      state.players.forEach(fixPlayer);
      renderAll();
      toast('Regras restauradas.');
    });

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }

  function buildTIForm() {
    var form = $('tiForm'), ins = data.instructions;
    ['mentality', 'defensiveLine', 'lineOfEngagement', 'widthInPossession', 'defensiveWidth', 'crosses', 'runsLeft', 'runsRight'].forEach(function (key) {
      var def = ins[key];
      if (!def) return;
      var lab = el('label', null, def.label + ' (' + def.en + ')');
      var s = el('select', { 'data-key': key });
      def.options.forEach(function (o, i) { s.appendChild(el('option', { value: String(i) }, o.label + (o.en ? ' (' + o.en + ')' : ''))); });
      s.addEventListener('change', function () { state.ti[key] = Number(s.value); renderAll(); });
      lab.appendChild(s);
      form.appendChild(lab);
    });
    Object.keys(ins.flags || {}).forEach(function (k) {
      var lab = el('label', { class: 'check' });
      var cb = el('input', { type: 'checkbox', 'data-flag': k });
      cb.addEventListener('change', function () { state.ti.flags[k] = cb.checked; renderAll(); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(ins.flags[k].label));
      form.appendChild(lab);
    });
  }

  function buildOppForm() {
    var form = $('oppForm'), cfg = data.opponent;
    if (!cfg) { $('oppEnabled').closest('.card').hidden = true; return; }
    var lf = el('label', null, 'Formação do adversário');
    var fs = el('select', { id: 'oppPreset' });
    data.formations.presets.forEach(function (p) { fs.appendChild(el('option', { value: p.id }, p.label)); });
    fs.addEventListener('change', function () { state.opp.presetId = fs.value; resetOppPlayers(); renderAll(); syncOppForm(); });
    lf.appendChild(fs); form.appendChild(lf);

    var ls = el('label', null, 'Estilo de jogo do adversário');
    var ss = el('select', { id: 'oppStyle' });
    cfg.styles.forEach(function (st) {
      var extra = st.inspiredBy && st.inspiredBy !== st.label ? ' (' + st.inspiredBy + ')' : '';
      ss.appendChild(el('option', { value: st.id }, st.label + extra));
    });
    ss.addEventListener('change', function () { state.opp.styleId = ss.value; resetOppPlayers(); renderAll(); syncOppForm(); });
    ls.appendChild(ss); form.appendChild(ls);
    form.appendChild(el('p', { class: 'hint', id: 'oppDesc' }));

    var det = el('details', { class: 'opp-roles' });
    det.appendChild(el('summary', null, 'Funções dos jogadores adversários'));
    det.appendChild(el('p', { class: 'hint' }, 'Trocar a formação ou o estilo aplica as funções típicas do estilo. Depois disso, ajuste jogador a jogador.'));
    det.appendChild(el('div', { class: 'player-list', id: 'oppPlayers' }));
    var rb = el('button', { class: 'btn small', type: 'button' }, 'Voltar às funções típicas do estilo');
    rb.addEventListener('click', function () { resetOppPlayers(); renderAll(); syncOppForm(); toast('Funções típicas do estilo aplicadas ao adversário.'); });
    det.appendChild(rb);
    form.appendChild(det);

    $('oppEnabled').addEventListener('change', function (e) { state.opp.enabled = e.target.checked; renderAll(); syncOppForm(); });
  }

  function renderOppPlayers() {
    var list = $('oppPlayers');
    if (!list) return;
    ensureOppPlayers();
    list.textContent = '';
    var f = data.formations, ps = state.opp.players;
    ps.map(function (p, i) { return i; })
      .sort(function (a, b) { return E.slotOrder(f, ps[a].slot) - E.slotOrder(f, ps[b].slot); })
      .forEach(function (i) {
        var p = ps[i];
        var row = el('div', { class: 'prow opp-row' });
        row.appendChild(el('span', { class: 'num opp-num' }, ''));
        row.appendChild(el('span', { class: 'slotname' }, p.slot));
        var rs = el('select', { 'aria-label': 'Função adversário ' + p.slot });
        E.rolesForSlot(data.roles, p.slot)
          .sort(function (a, b) { return data.roles[a].label.localeCompare(data.roles[b].label, 'pt-BR'); })
          .forEach(function (k) { var r = data.roles[k]; rs.appendChild(el('option', { value: k }, r.label + ' (' + r.en + ')')); });
        rs.value = p.role;
        rs.addEventListener('change', function () {
          p.role = rs.value;
          if (!data.roles[p.role].duties[p.duty]) p.duty = Object.keys(data.roles[p.role].duties)[0];
          renderAll(); renderOppPlayers();
        });
        row.appendChild(rs);
        var ds = el('select', { 'aria-label': 'Tarefa adversário ' + p.slot });
        Object.keys(data.roles[p.role].duties).forEach(function (d) { ds.appendChild(el('option', { value: d }, (E.DUTIES[d] || { label: d }).label)); });
        ds.value = p.duty;
        ds.addEventListener('change', function () { p.duty = ds.value; renderAll(); });
        row.appendChild(ds);
        row.appendChild(el('span'));
        list.appendChild(row);
      });
  }

  function syncOppForm() {
    if (!data.opponent) return;
    var o = state.opp;
    renderOppPlayers();
    $('oppEnabled').checked = !!o.enabled;
    $('oppPreset').value = o.presetId;
    $('oppStyle').value = o.styleId;
    $('oppForm').classList.toggle('off', !o.enabled);
    var st = E.opponentStyle(data, o.styleId);
    var ins = data.instructions;
    $('oppDesc').textContent = st ? st.desc + ' Instruções: mentalidade ' + ins.mentality.options[st.ti.mentality].label.toLowerCase() +
      ', linha defensiva ' + ins.defensiveLine.options[st.ti.defensiveLine].label.toLowerCase() +
      ', linha de pressão ' + ins.lineOfEngagement.options[st.ti.lineOfEngagement].label.toLowerCase() + '.' : '';
  }

  function syncTIForm() {
    document.querySelectorAll('#tiForm select').forEach(function (s) { s.value = String(state.ti[s.dataset.key]); });
    document.querySelectorAll('#tiForm input[data-flag]').forEach(function (cb) { cb.checked = !!(state.ti.flags || {})[cb.dataset.flag]; });
    $('preset').value = state.presetId;
  }

  function syncBallSide() {
    document.querySelectorAll('#ballSide .tab').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.side === ui.ballSide)); });
  }

  function syncTabs() {
    var shown = groupPhases();
    document.querySelectorAll('#groups .tab').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.group === ui.group)); });
    document.querySelectorAll('#tabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.phase === ui.tab)); });
    document.querySelectorAll('#fields .field-card').forEach(function (c) {
      c.classList.toggle('active', c.dataset.phase === ui.tab);
      c.classList.toggle('out-group', shown.indexOf(c.dataset.phase) < 0);
    });
  }

  // ---------- campo SVG ----------

  function buildPitch(svg) {
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
    var id = svg.id;
    var defs = svgEl('defs', {}, svg);
    var m = svgEl('marker', { id: 'ah-' + id, viewBox: '0 0 6 6', refX: '5', refY: '3', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M0,0 L6,3 L0,6 z', class: 'arrowhead' }, m);

    svgEl('rect', { x: 0, y: 0, width: VW, height: VH, class: 'stripe-b' }, svg);
    for (var i = 0; i < 10; i++) {
      svgEl('rect', { x: P, y: P + i * 10.5, width: 68, height: 10.5, class: i % 2 ? 'stripe-b' : 'stripe-a' }, svg);
    }
    var cx = P + 34, top = P, bot = P + 105;
    var g = svgEl('g', {}, svg);
    svgEl('line', { x1: P, x2: P + 68, y1: P + 35, y2: P + 35, class: 'third' }, g);
    svgEl('line', { x1: P, x2: P + 68, y1: P + 70, y2: P + 70, class: 'third' }, g);
    svgEl('rect', { x: P, y: P, width: 68, height: 105, class: 'ln' }, g);
    svgEl('line', { x1: P, x2: P + 68, y1: P + 52.5, y2: P + 52.5, class: 'ln' }, g);
    svgEl('circle', { cx: cx, cy: P + 52.5, r: 9.15, class: 'ln' }, g);
    svgEl('circle', { cx: cx, cy: P + 52.5, r: 0.4, class: 'spot' }, g);
    // áreas, pequenas áreas, marcas do pênalti, meia-luas e gols
    svgEl('rect', { x: cx - 20.16, y: top, width: 40.32, height: 16.5, class: 'ln' }, g);
    svgEl('rect', { x: cx - 20.16, y: bot - 16.5, width: 40.32, height: 16.5, class: 'ln' }, g);
    svgEl('rect', { x: cx - 9.16, y: top, width: 18.32, height: 5.5, class: 'ln' }, g);
    svgEl('rect', { x: cx - 9.16, y: bot - 5.5, width: 18.32, height: 5.5, class: 'ln' }, g);
    svgEl('circle', { cx: cx, cy: top + 11, r: 0.35, class: 'spot' }, g);
    svgEl('circle', { cx: cx, cy: bot - 11, r: 0.35, class: 'spot' }, g);
    svgEl('path', { d: 'M' + (cx - 7.31) + ',' + (top + 16.5) + ' A9.15,9.15 0 0 0 ' + (cx + 7.31) + ',' + (top + 16.5), class: 'ln' }, g);
    svgEl('path', { d: 'M' + (cx - 7.31) + ',' + (bot - 16.5) + ' A9.15,9.15 0 0 1 ' + (cx + 7.31) + ',' + (bot - 16.5), class: 'ln' }, g);
    svgEl('rect', { x: cx - 3.66, y: top - 1.6, width: 7.32, height: 1.6, class: 'ln' }, g);
    svgEl('rect', { x: cx - 3.66, y: bot, width: 7.32, height: 1.6, class: 'ln' }, g);

    svgEl('g', { class: 'zones' }, svg);
    svgEl('g', { class: 'shapes' }, svg);
    svgEl('g', { class: 'ghosts' }, svg);
    svgEl('g', { class: 'ball-layer' }, svg);
    svgEl('g', { class: 'opps' }, svg);
    svgEl('g', { class: 'players' }, svg);
  }

  function abbrFont(len) { return len <= 3 ? 1.9 : len === 4 ? 1.68 : len === 5 ? 1.45 : 1.25; }

  function playerTitle(cp) {
    var r = data.roles[cp.role], d = E.DUTIES[cp.duty] || { label: cp.duty, en: cp.duty };
    return cp.num + ' · ' + cp.slot + ' — ' + (r ? r.label + ' (' + r.en + ')' : cp.role) + ' · ' + d.label + ' (' + d.en + ')' +
      (cp.instructions.length ? ' · Instruções: ' + piLabels(cp.instructions) : '');
  }
  function piLabels(keys) { return keys.map(function (k) { return piDefs()[k] ? piDefs()[k].label : k; }).join(', '); }

  function renderPitch(svg, result, opts) {
    var players = svg.querySelector('.players');
    var ghosts = svg.querySelector('.ghosts');
    var ballLayer = svg.querySelector('.ball-layer');
    var zones = svg.querySelector('.zones');
    var shapes = svg.querySelector('.shapes');

    // linhas de estrutura: liga os jogadores de cada linha do time (e do adversário, mais discreto)
    shapes.textContent = '';
    if (opts.shapes) {
      [[result.players, false], [result.opponent ? result.opponent.players : null, true]].forEach(function (t) {
        if (!t[0]) return;
        E.teamShape(t[0], { attackingDown: t[1] }).lines.forEach(function (line) {
          // liga os vizinhos (por x) da mesma linha: traço cheio quando estão quase na mesma altura,
          // pontilhado quando um está escalonado (mais de 5 à frente ou atrás), mas ainda conta na mesma linha
          for (var i = 1; i < line.length; i++) {
            var a = line[i - 1], b = line[i];
            var stagger = Math.abs(a.y - b.y) > 5;
            var ca = toSvg(a.x, a.y), cb = toSvg(b.x, b.y);
            svgEl('line', { x1: ca[0], y1: ca[1], x2: cb[0], y2: cb[1], class: (t[1] ? 'shape-line-opp' : 'shape-line-us') + (stagger ? ' stagger' : '') }, shapes);
          }
        });
      });
    }

    // zona de deambulação (Roam): área em que o jogador circula, não um ponto fixo
    zones.textContent = '';
    result.players.forEach(function (cp) {
      if (!cp.zone) return;
      var c = toSvg(cp.x, cp.y);
      var z = svgEl('ellipse', { cx: c[0], cy: c[1], rx: cp.zone.rx * SX, ry: cp.zone.ry * SY, class: 'zone' }, zones);
      z.style.stroke = 'var(--b-' + cp.band + ')';
      z.style.fill = 'var(--b-' + cp.band + ')';
    });

    ghosts.textContent = '';
    if (opts.ghost) {
      result.players.forEach(function (cp) {
        var a = toSvg(cp.baseX, cp.baseY), b = toSvg(cp.x, cp.y);
        svgEl('circle', { cx: a[0], cy: a[1], r: R, class: 'ghost' }, ghosts);
        var vx = b[0] - a[0], vy = b[1] - a[1], d = Math.sqrt(vx * vx + vy * vy);
        if (d > 2 * R + 0.8) {
          var ux = vx / d, uy = vy / d;
          svgEl('line', {
            x1: a[0] + ux * R, y1: a[1] + uy * R, x2: b[0] - ux * (R + 0.4), y2: b[1] - uy * (R + 0.4),
            class: 'arrow', 'marker-end': 'url(#ah-' + svg.id + ')'
          }, ghosts);
        }
      });
    }

    ballLayer.textContent = '';
    if (result.ball) {
      var bp = toSvg(result.ball.x, result.ball.y);
      svgEl('circle', { cx: bp[0], cy: bp[1], r: 0.95, class: 'ball' }, ballLayer);
    }

    result.players.forEach(function (cp) {
      var g = players.querySelector('g.pl[data-i="' + cp.index + '"]');
      if (!g) {
        g = svgEl('g', { class: 'pl', 'data-i': cp.index }, players);
        svgEl('circle', { r: R, class: 'pc' }, g);
        svgEl('text', { class: 'ab' }, g);
        svgEl('circle', { cx: 2.35, cy: -2.35, r: 1.05, class: 'nb' }, g);
        svgEl('text', { x: 2.35, y: -2.3, class: 'no' }, g);
        svgEl('circle', { cx: -2.35, cy: 2.35, r: 0.75, class: 'pi-dot' }, g);
        svgEl('title', {}, g);
        g.addEventListener('pointerenter', onPlayerHover);
        g.addEventListener('pointerleave', onPlayerLeave);
        g.addEventListener('click', onPlayerHover);
        g.addEventListener('pointerdown', onDragStart);
      }
      var r = data.roles[cp.role];
      var label = (r ? r.abbr : '?') + '-' + cp.duty;
      var p = toSvg(cp.x, cp.y);
      g.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
      g.setAttribute('data-band', cp.band);
      g.querySelector('.pc').style.fill = 'var(--b-' + cp.band + ')';
      var t = g.querySelector('.ab');
      t.textContent = label;
      t.setAttribute('font-size', abbrFont(label.length));
      g.querySelector('.no').textContent = cp.num;
      g.querySelector('.pi-dot').style.display = cp.instructions.length || cp.traits.length ? '' : 'none';
      g.querySelector('title').textContent = playerTitle(cp) + ' · x ' + fmt(cp.x) + ', y ' + fmt(cp.y);
    });
    players.querySelectorAll('g.pl').forEach(function (g) {
      if (Number(g.dataset.i) >= result.players.length) g.remove();
    });
    renderOpponent(svg, result.opponent);
  }

  function renderOpponent(svg, opp) {
    var layer = svg.querySelector('.opps');
    var list = opp ? opp.players : [];
    list.forEach(function (cp) {
      var g = layer.querySelector('g.op[data-i="' + cp.index + '"]');
      if (!g) {
        g = svgEl('g', { class: 'op', 'data-i': cp.index }, layer);
        svgEl('rect', { x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1.1, class: 'oc' }, g);
        svgEl('text', { class: 'oab' }, g);
        svgEl('title', {}, g);
        g.addEventListener('pointerenter', onOppHover);
        g.addEventListener('click', onOppHover);
      }
      var r = data.roles[cp.role];
      var label = (r ? r.abbr : '?') + '-' + cp.duty;
      var p = toSvg(cp.x, cp.y);
      g.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
      var t = g.querySelector('.oab');
      t.textContent = label;
      t.setAttribute('font-size', abbrFont(label.length) * 0.9);
      g.querySelector('title').textContent = 'Adversário · ' + cp.slot + ' — ' + (r ? r.label + ' (' + r.en + ')' : cp.role);
    });
    layer.querySelectorAll('g.op').forEach(function (g) {
      if (Number(g.dataset.i) >= list.length) g.remove();
    });
  }

  function onOppHover(e) {
    var g = e.currentTarget;
    showOppInfo(g.ownerSVGElement, Number(g.dataset.i));
  }

  function showOppInfo(svg, index) {
    var ph = svg.dataset.phase;
    var opp = lastComputed && lastComputed[ph] && lastComputed[ph].opponent;
    var cp = opp && opp.players[index];
    var info = $('info-' + ph);
    if (!cp || !info) return;
    ui.info[ph] = { team: 'opp', index: index };
    var r = data.roles[cp.role], d = E.DUTIES[cp.duty] || { label: cp.duty };
    info.textContent = '';
    info.appendChild(el('b', null, 'Adversário · ' + cp.slot));
    info.appendChild(document.createTextNode(' ' + (r ? r.label + ' (' + r.en + ')' : cp.role) + ' — ' + d.label +
      ' · ' + opp.label + (opp.style ? ' · estilo ' + opp.style.label : '') + (cp.offside ? ' · contido pela linha de impedimento' : '')));
  }

  function computedFor(svg, index) {
    var ph = svg.dataset.phase;
    return lastComputed && lastComputed[ph] && lastComputed[ph].players[index];
  }

  function onPlayerHover(e) {
    var g = e.currentTarget, svg = g.ownerSVGElement;
    svg.querySelectorAll('g.pl.hl').forEach(function (x) { x.classList.remove('hl'); });
    g.classList.add('hl');
    showPlayerInfo(svg, Number(g.dataset.i));
  }

  /** Texto de detalhes do jogador; guardado em ui.info para ser atualizado quando a tática muda. */
  function showPlayerInfo(svg, index) {
    var cp = computedFor(svg, index);
    var info = $('info-' + svg.dataset.phase);
    if (!cp || !info) return;
    ui.info[svg.dataset.phase] = { team: 'us', index: index };
    info.textContent = '';
    info.appendChild(el('b', null, cp.num + ' · ' + cp.slot));
    var r = data.roles[cp.role], d = E.DUTIES[cp.duty] || { label: cp.duty, en: cp.duty };
    var txt = ' ' + (r ? r.label + ' (' + r.en + ')' : cp.role) + ' — ' + d.label;
    if (cp.effDuty && cp.effDuty !== cp.duty) txt += ' → ' + (E.DUTIES[cp.effDuty] || { label: cp.effDuty }).label + ' (pela mentalidade)';
    txt += ' · x ' + fmt(cp.x) + ', y ' + fmt(cp.y);
    if (cp.zone) txt += cp.zone.rx > cp.zone.ry ? ' · circula pelos corredores (±' + fmt(cp.zone.rx) + ' na largura)' : ' · deambula num raio de ~' + fmt(cp.zone.rx);
    if (cp.locked && cp.locked.length) txt += ' · embutidas na função: ' + piLabels(cp.locked);
    if (cp.offside) txt += ' · contido pela linha de impedimento do adversário';
    if (cp.run) {
      var runDef = (data.instructions.flankRuns || {})[cp.run];
      txt += ' · ' + (runDef && runDef.label ? runDef.label : cp.run) + ' (instrução de equipe)';
    }
    if (cp.fallback) {
      txt += ' · ' + (cp.fallbackWhy === 'no_wide_ahead' ? 'sem ponta/meia aberto à frente' : 'sem slot de volante livre ao lado') +
        ': age como ' + (data.roles[cp.fallback] ? data.roles[cp.fallback].label : cp.fallback) + ' (comportamento do FM23)';
    }
    if (cp.rule) {
      var keys = Object.keys(cp.rule).filter(function (k) { return k !== 'if' && k !== 'onlyBands' && k !== 'locked'; });
      txt += ' · regra: ' + keys.map(function (k) { return k + ' ' + (Array.isArray(cp.rule[k]) ? cp.rule[k].join('+') : cp.rule[k]); }).join(', ');
    }
    if (cp.instructions.length) txt += ' · instruções: ' + piLabels(cp.instructions);
    if (cp.traits.length) txt += ' · características: ' + cp.traits.map(function (k) { return traitDefs()[k].label; }).join(', ');
    info.appendChild(document.createTextNode(txt));
    if (r && r.desc) info.appendChild(el('span', { class: 'desc' }, r.desc));
    if (r && data.guide) {
      var gl = el('button', { class: 'link-btn', type: 'button' }, 'Sobre a função →');
      gl.addEventListener('click', function () { openGuide(cp.role, cp.duty); });
      info.appendChild(gl);
    }
  }

  // ---------- guia das funções (Book of Roles) ----------

  var guideState = { role: null, duty: null };

  function guideAttrs(entry, duty) {
    var a = entry.attributes;
    if (!a) return [];
    if (Array.isArray(a)) return a;
    return a[duty] || a[Object.keys(a)[0]] || [];
  }

  function openGuide(role, duty) {
    var dlg = $('guide');
    if (!data.guide || !dlg) return;
    var sel = $('guideRole');
    if (!sel.options.length) {
      Object.keys(data.roles)
        .sort(function (a, b) { return data.roles[a].label.localeCompare(data.roles[b].label, 'pt-BR'); })
        .forEach(function (k) { sel.appendChild(el('option', { value: k }, data.roles[k].label + ' (' + data.roles[k].en + ')')); });
      sel.addEventListener('change', function () { openGuide(sel.value, null); });
      $('guideClose').addEventListener('click', function () { dlg.close(); });
      // clique no fundo escuro fecha
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    }
    var roleDef = data.roles[role];
    if (!roleDef) return;
    guideState.role = role;
    guideState.duty = roleDef.duties[duty] ? duty : Object.keys(roleDef.duties)[0];
    sel.value = role;
    renderGuide();
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
    $('guideBody').scrollTop = 0;
  }

  /** Tipos de atacante (Book of Roles): onde esta função entra e o panorama dos três tipos. */
  function renderForwardTypes(section, role, duty) {
    var ft = data.guide.forwardTypes;
    var fs = section('Tipo de atacante');
    var mine = [];
    ft.types.forEach(function (t) {
      t.roles.forEach(function (r) {
        if (r.role === role && (!r.duty || r.duty === duty)) mine.push({ type: t, entry: r });
      });
    });
    if (mine.length) {
      var ul = el('ul');
      mine.forEach(function (m) {
        var li = el('li');
        li.appendChild(el('b', null, m.type.label + ': '));
        li.appendChild(document.createTextNode(m.entry.note));
        ul.appendChild(li);
      });
      fs.appendChild(ul);
    } else {
      fs.appendChild(el('p', { class: 'guide-note' }, 'O livro não põe esta função' + (data.roles[role].duties[duty] && Object.keys(data.roles[role].duties).length > 1 ? ', nesta tarefa,' : '') + ' em nenhum dos três tipos.'));
    }
    var det = el('details', { class: 'guide-details' });
    det.appendChild(el('summary', null, 'Os três tipos e como escolher'));
    det.appendChild(el('p', null, ft.intro));
    ft.types.forEach(function (t) {
      var p = el('p');
      p.appendChild(el('b', null, t.label + '. '));
      p.appendChild(document.createTextNode(t.desc + ' '));
      t.roles.forEach(function (r, i) {
        var other = data.roles[r.role];
        if (!other) return;
        var b = el('button', { class: 'link-btn', type: 'button' }, other.label + (r.duty ? ' (' + (E.DUTIES[r.duty] || { label: r.duty }).label + ')' : ''));
        b.addEventListener('click', function () { openGuide(r.role, r.duty || null); });
        p.appendChild(b);
        p.appendChild(document.createTextNode(i < t.roles.length - 1 ? ', ' : '.'));
      });
      det.appendChild(p);
    });
    det.appendChild(el('p', { class: 'guide-sub' }, 'Perguntas para escolher:'));
    var q = el('ul');
    ft.questions.forEach(function (x) { q.appendChild(el('li', null, x)); });
    det.appendChild(q);
    if (ft.note) det.appendChild(el('p', { class: 'guide-hint' }, ft.note + ' (Book of Roles, p. ' + ft.page + ')'));
    fs.appendChild(det);
  }

  function renderGuide() {
    var g = data.guide, role = guideState.role, duty = guideState.duty;
    var roleDef = data.roles[role], entry = g.roles[role] || { notCovered: true };
    $('guideTitle').textContent = roleDef.label + (roleDef.abbr ? ' · ' + roleDef.abbr : '');

    var duties = $('guideDuties');
    duties.textContent = '';
    Object.keys(roleDef.duties).forEach(function (d) {
      var b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(d === duty) }, (E.DUTIES[d] || { label: d }).label);
      b.addEventListener('click', function () { guideState.duty = d; renderGuide(); });
      duties.appendChild(b);
    });

    var body = $('guideBody');
    body.textContent = '';
    function section(title) {
      var s = el('section', { class: 'guide-sec' });
      s.appendChild(el('h3', null, title));
      body.appendChild(s);
      return s;
    }
    function list(parent, items) {
      var ul = el('ul');
      items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      parent.appendChild(ul);
    }

    if (entry.notCovered) {
      body.appendChild(el('p', { class: 'guide-note' }, 'O Book of Roles não cobre esta função.'));
      if (roleDef.desc) body.appendChild(el('p', null, roleDef.desc));
      return;
    }

    body.appendChild(el('p', { class: 'guide-summary' }, entry.summary));

    var ds = section('Tarefas');
    var dl = el('dl', { class: 'guide-duty-list' });
    Object.keys(entry.duties || {}).forEach(function (d) {
      var dt = el('dt', d === duty ? { class: 'on' } : null, (E.DUTIES[d] || { label: d }).label);
      var dd = el('dd', d === duty ? { class: 'on' } : null, entry.duties[d]);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    ds.appendChild(dl);

    var attrs = guideAttrs(entry, duty);
    if (attrs.length) {
      var perDuty = !Array.isArray(entry.attributes);
      var as = section('Atributos-chave' + (perDuty ? ' (' + (E.DUTIES[duty] || { label: duty }).label + ')' : ''));
      var chips = el('div', { class: 'attr-chips' });
      var descBox = el('p', { class: 'attr-desc', hidden: true });
      attrs.forEach(function (k) {
        var a = g.attributes[k] || { label: k, en: k };
        if (!a.desc) { chips.appendChild(el('span', { class: 'attr', title: a.en }, a.label)); return; }
        // com explicação do livro: toque/clique mostra (no celular não existe "passar o mouse")
        var b = el('button', { class: 'attr has-desc', type: 'button', title: a.en, 'aria-expanded': 'false' }, a.label);
        b.addEventListener('click', function () {
          var open = b.getAttribute('aria-expanded') === 'true';
          chips.querySelectorAll('.attr.has-desc').forEach(function (x) { x.setAttribute('aria-expanded', 'false'); });
          if (open) { descBox.hidden = true; return; }
          b.setAttribute('aria-expanded', 'true');
          descBox.textContent = '';
          descBox.appendChild(el('b', null, a.label + ' (' + a.en + '): '));
          descBox.appendChild(document.createTextNode(a.desc));
          descBox.hidden = false;
        });
        chips.appendChild(b);
      });
      as.appendChild(chips);
      as.appendChild(descBox);
      if (g.attributesNote) as.appendChild(el('p', { class: 'guide-hint' }, 'Toque num atributo sublinhado para ver a explicação. ' + g.attributesNote));
    }

    if (g.forwardTypes && (roleDef.slots || []).some(function (sl) { return /^ST/.test(sl); })) renderForwardTypes(section, role, duty);

    if (entry.combos && entry.combos.length) {
      var cs = section('Combina com');
      var ul = el('ul', { class: 'guide-combos' });
      entry.combos.forEach(function (c) {
        var li = el('li');
        var other = data.roles[c.role];
        var b = el('button', { class: 'link-btn', type: 'button' }, other ? other.label : c.role);
        b.addEventListener('click', function () { openGuide(c.role, null); });
        li.appendChild(b);
        li.appendChild(document.createTextNode(' — ' + c.why));
        ul.appendChild(li);
      });
      cs.appendChild(ul);
    }

    if (entry.risks && entry.risks.length) list(section('Riscos'), entry.risks);
    if (entry.tips && entry.tips.length) list(section('Dicas'), entry.tips);

    var src = g.source || {};
    body.appendChild(el('p', { class: 'guide-source' },
      'Fonte: ' + src.title + ' (' + src.author + ', ' + src.game + ')' + (entry.page ? ', p. ' + entry.page : '') + '. ' + (src.note || '')));
  }
  function onPlayerLeave(e) { e.currentTarget.classList.remove('hl'); }

  // ---------- modo editar regra (arrastar) ----------

  function clientToSvg(svg, cx, cy) {
    var pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  function onDragStart(e) {
    var g = e.currentTarget, svg = g.ownerSVGElement;
    if (!ui.edit || svg.id === 'animSvg') return;
    e.preventDefault();
    drag = { g: g, svg: svg, phase: svg.dataset.phase, index: Number(g.dataset.i), pointerId: e.pointerId, moved: false };
    g.classList.add('dragging');
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var p = clientToSvg(drag.svg, e.clientX, e.clientY);
    p[0] = Math.max(P, Math.min(P + 68, p[0]));
    p[1] = Math.max(P, Math.min(P + 105, p[1]));
    drag.pos = p; drag.moved = true;
    drag.g.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
  }
  function onDragCancel() {
    if (!drag) return;
    drag.g.classList.remove('dragging');
    drag = null;
    renderFields();
  }
  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag; drag = null;
    d.g.classList.remove('dragging');
    if (!d.moved) return;
    var cp = computedFor(d.svg, d.index);
    var n = fromSvg(d.pos[0], d.pos[1]);
    var fx = E.clamp(n[0], 2, 98), fy = E.clamp(n[1], 2, 98);
    var derived = !!data.formations.phases[d.phase].derive;
    var ov = derived ? E.deltaFromPosition(cp, fx, fy) : E.overrideFromPosition(cp, fx, fy);
    data.roles = E.applyOverride(data.roles, cp.role, cp.duty, d.phase, ov);
    lsSet(LS_ROLES, data.roles);
    renderAll();

    var after = computedFor(d.svg, d.index);
    var r = data.roles[cp.role];
    var msg = 'Regra salva: ' + r.abbr + '-' + cp.duty + ' · ' + data.formations.phases[d.phase].label + ' → ' +
      (derived ? (ov.dx != null ? 'dx ' + fmt(ov.dx) + ', ' : '') + 'dy ' + fmt(ov.dy) + ' (deslocamento extra desta fase)'
               : (ov.x != null ? 'x ' + fmt(ov.x) + ', ' : '') + 'y ' + fmt(ov.y)) + ' (vale para todo ' + r.abbr + '-' + cp.duty + ').';
    if (cp.side === 'C') msg += ' Slot central: só o y é gravado.';
    if (after && Math.hypot(after.x - fx, after.y - fy) > 1.5) msg += ' Atenção: um efeito ou a colisão alterou a posição final.';
    toast(msg, 6000);
  }

  // ---------- painel ----------

  function renderSlotGrid() {
    var grid = $('slotGrid'), f = data.formations;
    grid.textContent = '';
    var bySlot = {}, nums = E.numberPlayers(state.players, f);
    state.players.forEach(function (p, i) { bySlot[p.slot] = { p: p, num: nums[i] }; });
    var lookup = {};
    Object.keys(f.slots).forEach(function (s) { lookup[f.slots[s].band + ':' + f.slots[s].lane] = s; });

    ['ST', 'AM', 'M', 'DM', 'D', 'GK'].forEach(function (band) {
      E.LANE_ORDER.forEach(function (lane) {
        var slot = lookup[band + ':' + lane];
        if (!slot) { grid.appendChild(el('div', { class: 'slot empty-cell', 'aria-hidden': 'true' })); return; }
        var occ = bySlot[slot];
        var b = el('button', { class: 'slot', 'data-slot': slot, 'data-band': band, type: 'button' });
        if (occ) {
          var r = data.roles[occ.p.role];
          b.classList.add('filled');
          b.style.background = 'var(--b-' + band + ')';
          b.style.borderColor = 'var(--b-' + band + ')';
          b.appendChild(document.createTextNode((r ? r.abbr : '?') + '-' + occ.p.duty));
          b.appendChild(el('small', null, slot));
          b.title = occ.num + ' · ' + slot + ' — ' + (r ? r.label : occ.p.role);
          if (ui.selectedSlot === slot) b.classList.add('selected');
        } else {
          b.textContent = slot;
          if (ui.selectedSlot) b.classList.add('target');
          b.title = ui.selectedSlot ? 'Mover ' + ui.selectedSlot + ' para ' + slot : slot;
        }
        b.addEventListener('click', function () { onSlotClick(slot); });
        grid.appendChild(b);
      });
    });
  }

  function onSlotClick(slot) {
    var idx = state.players.findIndex(function (p) { return p.slot === slot; });
    var selIdx = state.players.findIndex(function (p) { return p.slot === ui.selectedSlot; });
    if (idx >= 0) {
      if (ui.selectedSlot === slot) ui.selectedSlot = null;
      else if (selIdx >= 0 && (slot === 'GK') === (ui.selectedSlot === 'GK')) {
        // troca dois jogadores de linha de lugar
        var a = state.players[selIdx], b = state.players[idx];
        var t = a.slot; a.slot = b.slot; b.slot = t;
        fixPlayer(a); fixPlayer(b);
        ui.selectedSlot = null;
      } else ui.selectedSlot = slot;
    } else if (selIdx >= 0) {
      if (ui.selectedSlot === 'GK' || slot === 'GK') { toast('O goleiro só pode ocupar o slot GK.'); return; }
      var cnt = state.players.filter(function (p) {
        var s = data.formations.slots[p.slot], t2 = data.formations.slots[slot];
        return p.slot !== ui.selectedSlot && s.band === t2.band && ['CL', 'C', 'CR'].indexOf(s.lane) >= 0;
      }).length;
      if (['CL', 'C', 'CR'].indexOf(data.formations.slots[slot].lane) >= 0 && cnt >= 3) { toast('No máximo 3 jogadores centrais por faixa.'); return; }
      state.players[selIdx].slot = slot;
      fixPlayer(state.players[selIdx]);
      ui.selectedSlot = null;
    } else return;
    renderAll();
  }

  function renderPlayerList() {
    var list = $('playerList'), f = data.formations;
    list.textContent = '';
    var nums = E.numberPlayers(state.players, f);
    var order = state.players.map(function (p, i) { return i; })
      .sort(function (a, b) { return E.slotOrder(f, state.players[a].slot) - E.slotOrder(f, state.players[b].slot); });

    order.forEach(function (i) {
      var p = state.players[i], band = f.slots[p.slot].band;
      var row = el('div', { class: 'prow' });
      var num = el('span', { class: 'num', 'data-band': band }, String(nums[i]));
      num.style.background = 'var(--b-' + band + ')';
      row.appendChild(num);
      row.appendChild(el('span', { class: 'slotname' }, p.slot));

      var rs = el('select', { 'aria-label': 'Função ' + p.slot });
      E.rolesForSlot(data.roles, p.slot)
        .sort(function (a, b) { return data.roles[a].label.localeCompare(data.roles[b].label, 'pt-BR'); })
        .forEach(function (k) {
          var r = data.roles[k];
          rs.appendChild(el('option', { value: k }, r.label + ' (' + r.en + ')' + (r.uncertain ? ' ⚠' : '')));
        });
      rs.value = p.role;
      rs.addEventListener('change', function () {
        p.role = rs.value;
        if (!data.roles[p.role].duties[p.duty]) p.duty = Object.keys(data.roles[p.role].duties)[0];
        prunePIs(p);
        renderAll();
      });
      row.appendChild(rs);

      var ds = el('select', { 'aria-label': 'Tarefa ' + p.slot });
      Object.keys((data.roles[p.role] || { duties: {} }).duties).forEach(function (d) {
        ds.appendChild(el('option', { value: d }, (E.DUTIES[d] || { label: d }).label));
      });
      ds.value = p.duty;
      ds.addEventListener('change', function () { p.duty = ds.value; prunePIs(p); renderAll(); });
      row.appendChild(ds);

      var n = (p.instructions || []).length + (p.traits || []).length, open = ui.piOpen === p.slot;
      var pb = el('button', {
        class: 'pi-btn' + (n ? ' has' : '') + (open ? ' open' : ''), type: 'button',
        'aria-expanded': String(open), 'aria-label': 'Instruções individuais ' + p.slot,
        title: n ? 'Instruções e características: ' + piLabels((p.instructions || []).concat()) + ((p.traits || []).length ? ' · ' + p.traits.map(function (k) { return (traitDefs()[k] || { label: k }).label; }).join(', ') : '') : 'Instruções individuais e características do jogador'
      }, n ? 'PI ' + n : 'PI');
      pb.addEventListener('click', function () { ui.piOpen = open ? null : p.slot; renderPlayerList(); });
      row.appendChild(pb);
      if (data.guide) {
        var gb = el('button', { class: 'guide-btn', type: 'button', 'aria-label': 'Sobre a função de ' + p.slot, title: 'Sobre a função: atributos, combinações e riscos' }, 'i');
        gb.addEventListener('click', function () { openGuide(p.role, p.duty); });
        row.appendChild(gb);
      }
      list.appendChild(row);
      if (open) list.appendChild(renderPIBox(p));
    });
  }

  function renderPIBox(p) {
    var defs = piDefs(), groups = (data.playerInstructions && data.playerInstructions.groups) || {};
    var info = E.slotInfo(data.formations, p.slot);
    var box = el('div', { class: 'pi-box' });
    var current = p.instructions || [];
    Object.keys(groups).forEach(function (gk) {
      var keys = Object.keys(defs).filter(function (k) { return defs[k].group === gk; });
      if (!keys.length) return;
      box.appendChild(el('div', { class: 'pi-group' }, groups[gk]));
      keys.forEach(function (k) {
        var def = defs[k], av = E.piAvailability(def, p, info, data.roles, k);
        var lab = el('label', { class: 'check' + (av.ok ? '' : ' disabled') + (av.locked ? ' locked' : ''), title: def.note || def.en });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = current.indexOf(k) >= 0 || !!av.locked;
        cb.disabled = !av.ok;
        cb.addEventListener('change', function () { togglePI(p, k, cb.checked); });
        lab.appendChild(cb);
        var txt = el('span', { class: 'pi-text' }, def.label + ' (' + def.en + ')');
        if (!av.ok) txt.appendChild(el('small', null, av.reason));
        lab.appendChild(txt);
        box.appendChild(lab);
      });
    });
    renderTraitsSection(box, p, info);
    if (current.length || (p.traits || []).length) {
      var clr = el('button', { class: 'btn small', type: 'button' }, 'Limpar instruções e características');
      clr.addEventListener('click', function () { delete p.instructions; delete p.traits; renderAll(); });
      box.appendChild(clr);
    }
    return box;
  }

  /** Seção "Características do jogador" (Player Traits do manual do FM23) dentro do painel PI. */
  function renderTraitsSection(box, p, info) {
    var defs = traitDefs(), keys = Object.keys(defs);
    if (!keys.length) return;
    box.appendChild(el('div', { class: 'pi-group' }, 'Características do jogador (traits)'));
    var active = E.resolvePlayerInstructions(p, info, piDefs(), data.roles).applied.concat(E.lockedFor(data.roles, p));
    var res = E.resolveTraits(p, info, defs, active);
    var why = {};
    res.ignored.forEach(function (i) { why[i.key] = i.reason; });
    var current = p.traits || [];
    keys.forEach(function (k) {
      var def = defs[k], av = E.piAvailability(def, p, info);
      var on = current.indexOf(k) >= 0;
      var lab = el('label', { class: 'check' + (av.ok ? '' : ' disabled'), title: def.official || def.en });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = on;
      cb.disabled = !av.ok;
      cb.addEventListener('change', function () { toggleTrait(p, k, cb.checked); });
      lab.appendChild(cb);
      var txt = el('span', { class: 'pi-text' }, def.label + ' (' + def.en + ')');
      if (!av.ok) txt.appendChild(el('small', null, av.reason));
      else if (on && why[k]) txt.appendChild(el('small', { class: 'warn-note' }, 'sem efeito: ' + why[k]));
      lab.appendChild(txt);
      box.appendChild(lab);
    });
  }

  function toggleTrait(p, key, on) {
    var defs = traitDefs(), list = (p.traits || []).filter(function (k) { return k !== key; });
    if (on) {
      list = list.filter(function (k) {
        return (defs[key].excludes || []).indexOf(k) < 0 && ((defs[k] || {}).excludes || []).indexOf(key) < 0;
      });
      list.push(key);
    }
    if (list.length) p.traits = list; else delete p.traits;
    renderAll();
  }

  /** Liga/desliga uma PI; ao ligar, desliga as mutuamente exclusivas (como no jogo). */
  function togglePI(p, key, on) {
    var defs = piDefs(), list = (p.instructions || []).filter(function (k) { return k !== key; });
    if (on) {
      list = list.filter(function (k) {
        return (defs[key].excludes || []).indexOf(k) < 0 && ((defs[k] || {}).excludes || []).indexOf(key) < 0;
      });
      list.push(key);
    }
    if (list.length) p.instructions = list; else delete p.instructions;
    renderAll();
  }

  // ---------- equilíbrio e sugestão de funções ----------

  function roleName(r, d) {
    var role = data.roles[r];
    return (role ? role.label : r) + ' (' + (E.DUTIES[d] || { label: d }).label + ')';
  }

  function oppLabel() {
    var st = E.opponentStyle(data, state.opp.styleId);
    return presetById(state.opp.presetId).label + (st ? ' ' + st.label : '');
  }

  function renderBalanceLine() {
    var line = $('balanceLine');
    if (!E.validate(state.players, data).ok) { line.textContent = ''; return; }
    var opp = oppConfig();
    var ev = E.evaluateBalance(state.players, data, state.ti, opp ? E.opponentCache(data, opp, E.OPP_PHASES) : null);
    line.textContent = 'Equilíbrio da tática: ' + Math.round(ev.score) + '/100' + (opp ? ' contra o adversário (' + oppLabel() + ')' : '');
    line.title = ev.parts.map(function (p) { return p.label + ': ' + Math.round(p.score * 100) + '% — ' + p.detail; }).join('\n');
  }

  function runSuggestion() {
    var box = $('suggestBox');
    box.hidden = false;
    box.textContent = 'Calculando…';
    setTimeout(function () {
      var opp = oppConfig();
      ui.suggestion = E.suggestRoles(state.players, data, state.ti, { maxChanges: 6, opponent: opp });
      ui.suggestion.oppLabel = opp ? oppLabel() : null;
      ui.suggestion.base = clone(state.players);
      renderSuggestion();
    }, 20);
  }

  function renderSuggestion() {
    var box = $('suggestBox'), sug = ui.suggestion;
    box.textContent = '';
    if (!sug) { box.hidden = true; return; }
    box.hidden = false;
    var head = el('div', { class: 'sg-head' });
    var title = el('div');
    title.appendChild(el('b', null, 'Equilíbrio ' + Math.round(sug.before.score) + ' → ' + Math.round(sug.after.score)));
    title.appendChild(el('small', { class: 'sg-ctx' }, sug.oppLabel ? 'considerando o adversário: ' + sug.oppLabel : 'sem adversário (ligue-o na seção Adversário para considerá-lo)'));
    head.appendChild(title);
    var close = el('button', { class: 'icon-btn sg-close', type: 'button', 'aria-label': 'Fechar sugestões' }, '×');
    close.addEventListener('click', function () { ui.suggestion = null; renderSuggestion(); });
    head.appendChild(close);
    box.appendChild(head);

    var table = el('div', { class: 'sg-parts' });
    sug.before.parts.forEach(function (p, i) {
      if (p.vsOpp && !(i > 0 && sug.before.parts[i - 1].vsOpp)) table.appendChild(el('div', { class: 'pi-group' }, 'Contra o adversário'));
      var a = Math.round(p.score * 100), b = Math.round(sug.after.parts[i].score * 100);
      var row = el('div', { class: 'sg-part' + (b > a ? ' up' : b < a ? ' down' : '') , title: sug.after.parts[i].detail });
      row.appendChild(el('span', null, p.label));
      row.appendChild(el('span', { class: 'sg-val' }, a === b ? a + '%' : a + '% → ' + b + '%'));
      table.appendChild(row);
    });
    box.appendChild(table);

    if (!sug.changes.length) {
      box.appendChild(el('p', { class: 'hint' }, 'Nenhuma troca de função melhora o equilíbrio desta tática. 👍'));
      return;
    }
    box.appendChild(el('div', { class: 'pi-group' }, 'Trocas sugeridas (na ordem em que foram encontradas)'));
    var checks = [];
    sug.changes.forEach(function (c) {
      var lab = el('label', { class: 'check sg-change' });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = true;
      checks.push(cb);
      lab.appendChild(cb);
      var txt = el('span', { class: 'pi-text' });
      txt.appendChild(el('b', null, c.slot + ': '));
      txt.appendChild(document.createTextNode(roleName(c.from.role, c.from.duty) + ' → ' + roleName(c.to.role, c.to.duty) + '  (+' + c.gain + ')'));
      if (c.improved && c.improved.length) txt.appendChild(el('small', null, 'melhora: ' + c.improved.join(', ').toLowerCase()));
      lab.appendChild(txt);
      box.appendChild(lab);
    });
    var row = el('div', { class: 'row sg-actions' });
    var apply = el('button', { class: 'btn primary small', type: 'button' }, 'Aplicar selecionadas');
    apply.addEventListener('click', function () {
      ui.undo = clone(state.players);
      sug.changes.forEach(function (c, k) {
        if (!checks[k].checked) return;
        var p = state.players[c.index];
        if (!p || p.slot !== c.slot) return;
        p.role = c.to.role; p.duty = c.to.duty;
        fixPlayer(p);
      });
      ui.suggestion = null;
      renderSuggestion();
      renderAll();
      showUndo();
    });
    row.appendChild(apply);
    box.appendChild(row);
    box.appendChild(el('p', { class: 'hint' }, 'O índice é heurístico: mede corredores ocupados e presença na área no ataque, proteção atrás da bola, linhas de passe na saída, compactação sem a bola, jogadores empilhados e tarefas (referência 3 D · 4 S · 3 A do manual)' +
      (sug.oppLabel ? '; contra o adversário, também jogadores entre as linhas dele, superioridade nas pontas, jogadores livres, atacantes dele vigiados e não amontoar na linha dele' : '') + '. Confira no jogo.'));
  }

  function showUndo() {
    var box = $('suggestBox');
    box.hidden = false;
    box.textContent = '';
    var row = el('div', { class: 'row sg-actions' });
    row.appendChild(el('span', { class: 'hint' }, 'Funções aplicadas.'));
    var undo = el('button', { class: 'btn small', type: 'button' }, 'Desfazer');
    undo.addEventListener('click', function () {
      if (ui.undo) state.players = ui.undo;
      ui.undo = null;
      box.hidden = true;
      renderAll();
      toast('Funções restauradas.');
    });
    var ok = el('button', { class: 'btn small', type: 'button' }, 'OK');
    ok.addEventListener('click', function () { ui.undo = null; box.hidden = true; });
    row.appendChild(undo); row.appendChild(ok);
    box.appendChild(row);
  }

  function renderValidation(v, extra, alerts) {
    var box = $('validation');
    box.textContent = '';
    v.errors.forEach(function (m) { box.appendChild(el('div', { class: 'msg err' }, m)); });
    v.warnings.concat(extra || []).forEach(function (m) { box.appendChild(el('div', { class: 'msg warn' }, m)); });
    (alerts || []).forEach(function (a) {
      var m = el('div', { class: 'msg tip' });
      m.appendChild(el('span', { class: 'tip-tag' }, 'Combinação'));
      m.appendChild(document.createTextNode(' ' + a.text + ' '));
      if (data.guide && a.role && data.roles[a.role]) {
        var b = el('button', { class: 'link-btn', type: 'button', title: 'Book of Roles, p. ' + a.page }, 'Ver ' + data.roles[a.role].label + ' →');
        b.addEventListener('click', function () { openGuide(a.role, null); });
        m.appendChild(b);
      }
      box.appendChild(m);
    });
  }

  // ---------- render geral ----------

  function renderFields() {
    if (!lastComputed) return;
    E.PHASES.forEach(function (ph) {
      var line = $('oppline-' + ph), o = lastComputed[ph].opponent;
      if (!line) return;
      line.textContent = o ? 'Adversário ' + presetById(state.opp.presetId).label + ' · ' + (o.style ? o.style.label : '') + ' · ' + o.label + ' (ataca ↓)' : '';
      line.hidden = !o;
    });
    E.PHASES.forEach(function (ph) {
      var svg = $('pitch-' + ph);
      svg.classList.toggle('editing', ui.edit);
      renderPitch(svg, lastComputed[ph], { ghost: ui.ghost, shapes: ui.shapes });
      var sl = $('shape-' + ph);
      if (sl) {
        var sh = E.teamShape(lastComputed[ph].players), m = sh.metrics;
        var txt = 'Estrutura ' + sh.shape + ' · comprimento ' + m.length + ' m · largura ' + m.width + ' m · última linha a ' + m.lastLine + ' m do gol';
        var o = lastComputed[ph].opponent;
        if (o) {
          var so = E.teamShape(o.players, { attackingDown: true });
          txt += ' — adversário ' + so.shape + ', ' + so.metrics.length + ' m';
        }
        sl.textContent = txt;
        sl.hidden = !ui.shapes;
      }
      renderScores(ph);
    });
    if (anim.on) renderAnimStep();
    // reescreve os detalhes do jogador selecionado com os valores novos
    E.PHASES.forEach(function (ph) {
      var sel = ui.info[ph], svg = $('pitch-' + ph);
      if (!sel || !svg) return;
      if (sel.team === 'opp') {
        if (lastComputed[ph].opponent) showOppInfo(svg, sel.index); else { ui.info[ph] = null; $('info-' + ph).textContent = 'Passe o mouse ou toque num jogador para ver detalhes.'; }
      } else showPlayerInfo(svg, sel.index);
    });
  }

  var SCORE_DEFS = {
    penetracao: 'Penetração: quão bem o time está posicionado para entrar no espaço — quão avançados estão os jogadores e quanto se comprometem a ir além.',
    solidez: 'Solidez: quanto o time se mantém sólido atacando — profundidade das posições e contenção do avanço. É o contrapeso da penetração.',
    apoio: 'Apoio: se o posicionamento vertical dá suporte ao ataque e mantém o time junto (sem buracos entre linhas, gente perto da bola).',
    pressao: 'Pressão: quantos jogadores estão posicionados para disputar a bola e quão comprometidos estão com isso (não é a altura do bloco).',
    cobertura: 'Cobertura: quanto do time fica atrás da bola protegendo o espaço onde o adversário jogaria.',
    compactacao: 'Compactação: quão juntos os jogadores ficam e quão curto é o bloco, da frente até a última linha.'
  };

  /** Notas de estrutura da fase (framework do Guide to Football) em três barras. */
  function renderScores(ph) {
    var box = $('scores-' + ph);
    if (!box || !lastComputed) return;
    box.textContent = '';
    box.hidden = !ui.shapes;
    if (!ui.shapes) return;
    E.structureScores(lastComputed[ph].players, ph, data).scores.forEach(function (sc) {
      var item = el('div', { class: 'score', title: SCORE_DEFS[sc.key] + '\n' + sc.detail + '\n(framework: Guide to Football, tactical theory)' });
      var head = el('div', { class: 'score-head' });
      head.appendChild(el('span', null, sc.label));
      head.appendChild(el('b', null, String(sc.value)));
      item.appendChild(head);
      var bar = el('div', { class: 'score-bar' });
      var fill = el('i');
      fill.style.width = sc.value + '%';
      bar.appendChild(fill);
      item.appendChild(bar);
      box.appendChild(item);
    });
  }

  function renderAll() {
    var v = E.validate(state.players, data);
    var extra = [], alerts = [];
    if (v.ok) {
      var opp = oppConfig();
      // o lado da bola é opção de visualização: entra no cálculo das posições, não no índice de equilíbrio
      lastComputed = E.computeMatch(state.players, data, Object.assign({}, state.ti, { ballSide: ui.ballSide }), opp);
      E.PHASES.forEach(function (ph) { extra = extra.concat(lastComputed[ph].warnings); });
      alerts = E.tacticalAlerts(state.players, data, state.ti, opp ? opp.players : null);
    }
    renderSlotGrid();
    renderPlayerList();
    renderValidation(v, extra, alerts);
    renderBalanceLine();
    // sugestão calculada para outra tática fica desatualizada
    if (ui.suggestion && JSON.stringify(ui.suggestion.base) !== JSON.stringify(state.players)) { ui.suggestion = null; renderSuggestion(); }
    renderFields();
    $('rolesStatus').textContent = lsGet(LS_ROLES)
      ? 'Usando regras personalizadas (salvas neste navegador). Exporte o roles.json para guardar.'
      : 'Usando as regras padrão de data/roles.json.';
    saveState();
  }

  // ---------- animação ----------

  function renderAnimStep() {
    var phs = groupPhases(), ph = phs[anim.step % phs.length];
    var svg = $('animSvg');
    svg.dataset.phase = ph;
    renderPitch(svg, lastComputed[ph], { ghost: false, shapes: ui.shapes });
    document.querySelectorAll('#animSteps span').forEach(function (s) {
      s.classList.toggle('on', s.dataset.phase === ph);
      s.hidden = phs.indexOf(s.dataset.phase) < 0;
    });
  }

  function toggleAnim() {
    anim.on = !anim.on;
    $('animView').hidden = !anim.on;
    $('fields').hidden = anim.on;
    $('tabs').style.visibility = anim.on ? 'hidden' : '';
    $('animate').textContent = anim.on ? '■ Parar' : '▶ Animar';
    clearInterval(anim.timer);
    if (anim.on) {
      anim.step = 0;
      renderAnimStep();
      anim.timer = setInterval(function () { anim.step = (anim.step + 1) % groupPhases().length; renderAnimStep(); }, 2000);
    }
  }

  // ---------- início ----------

  function showFatal(err) {
    var box = el('div', { class: 'fatal' });
    box.appendChild(el('strong', null, 'Não foi possível carregar os dados. '));
    box.appendChild(document.createTextNode(
      'Se você abriu o index.html direto do disco (file://), o navegador bloqueia a leitura de data/*.json. ' +
      'Rode um servidor local na pasta do projeto (python3 -m http.server 8000) ou use o arquivo único dist/fm23-viewer.html. Detalhe: ' +
      (err && err.message ? err.message : err)));
    document.querySelector('.main').prepend(box);
  }

  /**
   * Se a página veio de um cache antigo (o GitHub Pages não deixa configurar o tempo de cache),
   * compara com version.json publicado e recarrega uma vez com ?v=<versão nova>.
   */
  function checkFreshVersion() {
    var vm = document.querySelector('meta[name="fm23pv-version"]');
    if (!vm || location.protocol === 'file:' || !window.fetch) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version || j.version === vm.content) return;
        var key = 'fm23pv.reloaded.' + j.version;
        try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* sem storage */ }
        location.replace(location.pathname + '?v=' + j.version + location.hash);
      })
      .catch(function () { /* offline: segue com a versão atual */ });
  }

  function init() {
    if (!E) { showFatal('engine.js não carregado'); return; }
    checkFreshVersion();
    loadData().then(function (d) {
      data = d;
      baseRoles = clone(d.roles);
      var custom = lsGet(LS_ROLES);
      if (isRolesObj(custom)) data.roles = custom;

      var savedUi = lsGet(LS_UI) || {};
      ui.ghost = !!savedUi.ghost;
      ui.collapsed = !!savedUi.collapsed;
      if (E.PHASES.indexOf(savedUi.tab) >= 0) ui.tab = savedUi.tab;
      if (['sem', 'com', 'todas'].indexOf(savedUi.group) >= 0) ui.group = savedUi.group;
      if (savedUi.shapes === false) ui.shapes = false;
      if (['L', 'C', 'R'].indexOf(savedUi.ballSide) >= 0) ui.ballSide = savedUi.ballSide;

      var saved = lsGet(LS_STATE);
      if (saved && Array.isArray(saved.players) && E.validate(saved.players, data).ok) {
        state = { presetId: saved.presetId, players: saved.players, ti: Object.assign(defaultTI(), saved.ti || {}), opp: Object.assign(defaultOpp(), saved.opp || {}) };
      } else state = defaultState();

      buildStatic();
      syncTIForm();
      syncOppForm();
      syncTabs();
      renderAll();
    }).catch(showFatal);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
