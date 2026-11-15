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

  var PHASE_HINT = {
    defendendo: 'sem a bola, bloco organizado',
    saindo: 'bola com GR/zagueiros',
    ataque: 'bola no terço final'
  };
  var BAND_LABEL = { GK: 'Goleiro', D: 'Defesa', DM: 'Meio-defensivo / alas', M: 'Meio', AM: 'Meia ofensivo', ST: 'Ataque' };

  var data = null, baseRoles = null, lastComputed = null;
  var state = null;
  var ui = { ghost: false, edit: false, tab: 'defendendo', collapsed: false, selectedSlot: null, piOpen: null };
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
    var f = inline('data-formations'), r = inline('data-roles'), t = inline('data-instructions'), pi = inline('data-player-instructions');
    if (f && r && t && pi) return Promise.resolve({ formations: f, roles: r, instructions: t, playerInstructions: pi });
    var urls = ['data/formations.json', 'data/roles.json', 'data/team-instructions.json', 'data/player-instructions.json'];
    return Promise.all(urls.map(function (u) {
      return fetch(u, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error(u + ': HTTP ' + res.status);
        return res.json();
      });
    })).then(function (a) { return { formations: a[0], roles: a[1], instructions: a[2], playerInstructions: a[3] }; });
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
      flags: flags
    };
  }

  function presetById(id) {
    var list = data.formations.presets;
    return list.find(function (p) { return p.id === id; }) || list[0];
  }

  function defaultState() {
    var pr = presetById(data.formations.defaultPreset);
    return { presetId: pr.id, players: clone(pr.players), ti: defaultTI() };
  }

  function validRoleFor(slot, role, duty) {
    var r = data.roles[role];
    return !!(r && r.slots.indexOf(slot) >= 0 && r.duties[duty]);
  }

  function piDefs() { return (data.playerInstructions && data.playerInstructions.instructions) || {}; }

  /** Remove instruções individuais que não valem para o slot/função atuais. */
  function prunePIs(p) {
    if (!p.instructions || !data.formations.slots[p.slot]) return p;
    var info = E.slotInfo(data.formations, p.slot);
    var kept = E.resolvePlayerInstructions(p, info, piDefs()).applied;
    if (kept.length) p.instructions = kept; else delete p.instructions;
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

  function saveState() { lsSet(LS_STATE, state); lsSet(LS_UI, { ghost: ui.ghost, tab: ui.tab, collapsed: ui.collapsed }); }

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

    var tabs = $('tabs'), fields = $('fields');
    E.PHASES.forEach(function (ph) {
      var label = data.formations.phases[ph].label;
      var tab = el('button', { class: 'tab', role: 'tab', 'data-phase': ph }, label);
      tab.addEventListener('click', function () { ui.tab = ph; syncTabs(); saveState(); });
      tabs.appendChild(tab);

      var card = el('section', { class: 'field-card', 'data-phase': ph });
      var h = el('h3', null, label);
      h.appendChild(el('span', null, PHASE_HINT[ph] + ' · ataca ↑'));
      card.appendChild(h);
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
    legend.appendChild(el('span', null, 'Linhas tracejadas = terços do campo'));

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

    $('exportTactic').addEventListener('click', function () {
      download('tatica-fm23-' + state.presetId + '.json', {
        format: 'fm23pv-tactic', version: 1, presetId: state.presetId, players: state.players, ti: state.ti
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
            return q;
          }),
          ti: Object.assign(defaultTI(), obj.ti || {})
        };
        renderAll(); syncTIForm();
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
      renderAll(); syncTIForm();
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
    ['mentality', 'defensiveLine', 'lineOfEngagement', 'widthInPossession'].forEach(function (key) {
      var def = ins[key];
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

  function syncTIForm() {
    document.querySelectorAll('#tiForm select').forEach(function (s) { s.value = String(state.ti[s.dataset.key]); });
    document.querySelectorAll('#tiForm input[data-flag]').forEach(function (cb) { cb.checked = !!(state.ti.flags || {})[cb.dataset.flag]; });
    $('preset').value = state.presetId;
  }

  function syncTabs() {
    document.querySelectorAll('#tabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.phase === ui.tab)); });
    document.querySelectorAll('#fields .field-card').forEach(function (c) { c.classList.toggle('active', c.dataset.phase === ui.tab); });
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
    svgEl('g', { class: 'ghosts' }, svg);
    svgEl('g', { class: 'ball-layer' }, svg);
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

    // zona de deambulação (Roam): área em que o jogador circula, não um ponto fixo
    zones.textContent = '';
    result.players.forEach(function (cp) {
      if (!cp.roam) return;
      var c = toSvg(cp.x, cp.y);
      var z = svgEl('ellipse', { cx: c[0], cy: c[1], rx: cp.roam * SX, ry: cp.roam * SY, class: 'zone' }, zones);
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
      g.querySelector('.pi-dot').style.display = cp.instructions.length ? '' : 'none';
      g.querySelector('title').textContent = playerTitle(cp) + ' · x ' + fmt(cp.x) + ', y ' + fmt(cp.y);
    });
    players.querySelectorAll('g.pl').forEach(function (g) {
      if (Number(g.dataset.i) >= result.players.length) g.remove();
    });
  }

  function computedFor(svg, index) {
    var ph = svg.dataset.phase;
    return lastComputed && lastComputed[ph] && lastComputed[ph].players[index];
  }

  function onPlayerHover(e) {
    var g = e.currentTarget, svg = g.ownerSVGElement;
    var cp = computedFor(svg, Number(g.dataset.i));
    if (!cp) return;
    svg.querySelectorAll('g.pl.hl').forEach(function (x) { x.classList.remove('hl'); });
    g.classList.add('hl');
    var info = $('info-' + svg.dataset.phase);
    if (!info) return;
    info.textContent = '';
    info.appendChild(el('b', null, cp.num + ' · ' + cp.slot));
    var r = data.roles[cp.role], d = E.DUTIES[cp.duty] || { label: cp.duty, en: cp.duty };
    var txt = ' ' + (r ? r.label + ' (' + r.en + ')' : cp.role) + ' — ' + d.label;
    if (cp.effDuty && cp.effDuty !== cp.duty) txt += ' → ' + (E.DUTIES[cp.effDuty] || { label: cp.effDuty }).label + ' (pela mentalidade)';
    txt += ' · x ' + fmt(cp.x) + ', y ' + fmt(cp.y);
    if (cp.roam) txt += ' · deambula num raio de ~' + fmt(cp.roam);
    if (cp.rule) {
      var keys = Object.keys(cp.rule).filter(function (k) { return k !== 'if' && k !== 'onlyBands'; });
      txt += ' · regra: ' + keys.map(function (k) { return k + ' ' + (Array.isArray(cp.rule[k]) ? cp.rule[k].join('+') : cp.rule[k]); }).join(', ');
    }
    if (cp.instructions.length) txt += ' · instruções: ' + piLabels(cp.instructions);
    info.appendChild(document.createTextNode(txt));
    if (r && r.desc) info.appendChild(el('span', { class: 'desc' }, r.desc));
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
    var ov = E.overrideFromPosition(cp, fx, fy);
    data.roles = E.applyOverride(data.roles, cp.role, cp.duty, d.phase, ov);
    lsSet(LS_ROLES, data.roles);
    renderAll();

    var after = computedFor(d.svg, d.index);
    var r = data.roles[cp.role];
    var msg = 'Regra salva: ' + r.abbr + '-' + cp.duty + ' · ' + data.formations.phases[d.phase].label + ' → ' +
      (ov.x != null ? 'x ' + fmt(ov.x) + ', ' : '') + 'y ' + fmt(ov.y) + ' (vale para todo ' + r.abbr + '-' + cp.duty + ').';
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
      ds.addEventListener('change', function () { p.duty = ds.value; renderAll(); });
      row.appendChild(ds);

      var n = (p.instructions || []).length, open = ui.piOpen === p.slot;
      var pb = el('button', {
        class: 'pi-btn' + (n ? ' has' : '') + (open ? ' open' : ''), type: 'button',
        'aria-expanded': String(open), 'aria-label': 'Instruções individuais ' + p.slot,
        title: n ? 'Instruções: ' + piLabels(p.instructions) : 'Adicionar instruções individuais'
      }, n ? 'PI ' + n : 'PI');
      pb.addEventListener('click', function () { ui.piOpen = open ? null : p.slot; renderPlayerList(); });
      row.appendChild(pb);
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
        var def = defs[k], av = E.piAvailability(def, p, info);
        var lab = el('label', { class: 'check' + (av.ok ? '' : ' disabled'), title: av.ok ? def.en : av.reason });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = current.indexOf(k) >= 0;
        cb.disabled = !av.ok;
        cb.addEventListener('change', function () { togglePI(p, k, cb.checked); });
        lab.appendChild(cb);
        var txt = el('span', { class: 'pi-text' }, def.label + ' (' + def.en + ')');
        if (!av.ok) txt.appendChild(el('small', null, av.reason));
        lab.appendChild(txt);
        box.appendChild(lab);
      });
    });
    if (current.length) {
      var clr = el('button', { class: 'btn small', type: 'button' }, 'Limpar instruções');
      clr.addEventListener('click', function () { delete p.instructions; renderAll(); });
      box.appendChild(clr);
    }
    return box;
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

  function renderValidation(v, extra) {
    var box = $('validation');
    box.textContent = '';
    v.errors.forEach(function (m) { box.appendChild(el('div', { class: 'msg err' }, m)); });
    v.warnings.concat(extra || []).forEach(function (m) { box.appendChild(el('div', { class: 'msg warn' }, m)); });
  }

  // ---------- render geral ----------

  function renderFields() {
    if (!lastComputed) return;
    E.PHASES.forEach(function (ph) {
      var svg = $('pitch-' + ph);
      svg.classList.toggle('editing', ui.edit);
      renderPitch(svg, lastComputed[ph], { ghost: ui.ghost });
    });
    if (anim.on) renderAnimStep();
  }

  function renderAll() {
    var v = E.validate(state.players, data);
    var extra = [];
    if (v.ok) {
      lastComputed = E.computeAll(state.players, data, state.ti);
      E.PHASES.forEach(function (ph) { extra = extra.concat(lastComputed[ph].warnings); });
    }
    renderSlotGrid();
    renderPlayerList();
    renderValidation(v, extra);
    renderFields();
    $('rolesStatus').textContent = lsGet(LS_ROLES)
      ? 'Usando regras personalizadas (salvas neste navegador). Exporte o roles.json para guardar.'
      : 'Usando as regras padrão de data/roles.json.';
    saveState();
  }

  // ---------- animação ----------

  function renderAnimStep() {
    var ph = E.PHASES[anim.step];
    var svg = $('animSvg');
    svg.dataset.phase = ph;
    renderPitch(svg, lastComputed[ph], { ghost: false });
    document.querySelectorAll('#animSteps span').forEach(function (s) { s.classList.toggle('on', s.dataset.phase === ph); });
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
      anim.timer = setInterval(function () { anim.step = (anim.step + 1) % E.PHASES.length; renderAnimStep(); }, 2000);
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

  function init() {
    if (!E) { showFatal('engine.js não carregado'); return; }
    loadData().then(function (d) {
      data = d;
      baseRoles = clone(d.roles);
      var custom = lsGet(LS_ROLES);
      if (isRolesObj(custom)) data.roles = custom;

      var savedUi = lsGet(LS_UI) || {};
      ui.ghost = !!savedUi.ghost;
      ui.collapsed = !!savedUi.collapsed;
      if (E.PHASES.indexOf(savedUi.tab) >= 0) ui.tab = savedUi.tab;

      var saved = lsGet(LS_STATE);
      if (saved && Array.isArray(saved.players) && E.validate(saved.players, data).ok) {
        state = { presetId: saved.presetId, players: saved.players, ti: Object.assign(defaultTI(), saved.ti || {}) };
      } else state = defaultState();

      buildStatic();
      syncTIForm();
      syncTabs();
      renderAll();
    }).catch(showFatal);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
