/* Estudos · Método 4.2 — site estático. Dados no Google Sheets via Apps Script (ou modo demonstração). */
'use strict';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const pct = (v, d = 0) => (v === null || v === undefined || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%');
const fmt1 = (v) => (v === null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const KEY_DIA = 86400000;
const isoHoje = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const toUTC = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const dias = (a, b) => Math.round((toUTC(b) - toUTC(a)) / KEY_DIA);
const addDias = (s, n) => new Date(toUTC(s) + n * KEY_DIA).toISOString().slice(0, 10);
const br = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const splitIds = (s) => String(s ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const LS = {
  get(k, def) { try { const v = localStorage.getItem('estudos.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('estudos.' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

const CHAVES = { Config: 'chave', Disciplinas: 'cod', Aulas: 'id', Topicos: 'id', Editais: 'id', Bancas: 'nome', Diario: 'uid' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- armazenamento / sincronização ----------
const store = {
  dados: null,
  fila: LS.get('fila', []),
  conexao: LS.get('conexao', { url: '', chave: '' }),
  estado: 'ok',
  get demo() { return !this.conexao.url; },

  async iniciar() {
    this.dados = LS.get('dados', null);
    if (this.demo) {
      if (!this.dados) this.dados = await (await fetch('demo.json')).json();
      this.salvarLocal();
      return;
    }
    if (this.dados) render();
    await this.recarregar();
  },

  async api(corpo) {
    const r = await fetch(this.conexao.url, { method: 'POST', body: JSON.stringify({ ...corpo, chave: this.conexao.chave }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || 'Erro no servidor');
    return j;
  },

  async recarregar() {
    if (this.demo) return;
    try {
      await this.enviarFila();
      const j = await this.api({ acao: 'carregar' });
      this.dados = j.dados;
      this.fila.forEach((op) => this.aplicar(op)); // mantém o que ainda não subiu
      this.salvarLocal();
      this.estado = 'ok';
    } catch (e) {
      this.estado = navigator.onLine ? 'err' : 'off';
      if (!this.dados) throw e;
      console.warn(e);
    }
    atualizarSync();
  },

  aplicar(op) {
    const lista = this.dados[op.aba] || (this.dados[op.aba] = []);
    const k = CHAVES[op.aba];
    if (op.acao === 'gravar') {
      op.linhas.forEach((lin) => {
        const i = lista.findIndex((r) => String(r[k]) === String(lin[k]));
        if (i >= 0) lista[i] = { ...lista[i], ...lin }; else lista.push({ ...lin });
      });
    } else if (op.acao === 'apagar') {
      const s = new Set(op.ids.map(String));
      this.dados[op.aba] = lista.filter((r) => !s.has(String(r[k])));
    }
  },

  async mudar(op) {
    this.aplicar(op);
    this.salvarLocal();
    if (!this.demo) { this.fila.push(op); LS.set('fila', this.fila); this.enviarFila(); }
    render();
  },
  gravar(aba, linhas) { return this.mudar({ acao: 'gravar', aba, linhas }); },
  apagar(aba, ids) { return this.mudar({ acao: 'apagar', aba, ids }); },

  async enviarFila() {
    if (this.demo || this._enviando) return;
    this._enviando = true;
    try {
      while (this.fila.length) {
        await this.api(this.fila[0]);
        this.fila.shift(); LS.set('fila', this.fila);
      }
      this.estado = 'ok';
    } catch (e) {
      this.estado = navigator.onLine ? 'err' : 'off';
      console.warn(e);
    } finally { this._enviando = false; atualizarSync(); }
  },

  salvarLocal() { LS.set('dados', this.dados); },
};

function atualizarSync() {
  const el = $('#sync');
  if (store.demo) { el.textContent = 'modo demonstração'; el.className = 'sync off'; return; }
  const p = store.fila.length;
  if (store.estado === 'off') { el.textContent = `offline${p ? ` · ${p} pendente(s)` : ''}`; el.className = 'sync off'; }
  else if (store.estado === 'err') { el.textContent = `erro ao sincronizar${p ? ` · ${p} pendente(s)` : ''}`; el.className = 'sync err'; }
  else { el.textContent = p ? `enviando ${p}…` : 'sincronizado'; el.className = 'sync'; }
}
window.addEventListener('online', () => store.enviarFila());
window.addEventListener('offline', () => { store.estado = 'off'; atualizarSync(); });

// ---------- motor do Método 4.2 ----------
function calcular(D) {
  const C = {}; (D.Config || []).forEach((r) => { C[r.chave] = r.valor; });
  const cfg = {
    inicio: String(C.data_inicio || isoHoje()).slice(0, 10),
    hoje: String(C.hoje_manual || '').slice(0, 10) || isoHoje(),
    horasDia: num(C.horas_dia) ?? 3, minDisc: num(C.min_disc) ?? 90,
    qFix: num(C.q_fixacao) ?? 10, qRev: num(C.q_revisao) ?? 30,
    diasSemana: num(C.dias_semana) ?? 6, vel: num(C.vel_leitura) ?? 25,
    dT: num(C.dias_teoria) ?? 4, dR: num(C.dias_revisao) ?? 2, maxDisc: num(C.disc_por_grupo) ?? 3,
    metaNucleo: num(C.meta_nucleo) ?? 0.8,
  };
  cfg.sessoesDia = cfg.horasDia * 60 / cfg.minDisc;
  cfg.metaHorasSemana = cfg.horasDia * cfg.diasSemana;
  cfg.pagsSessao = Math.max(1, Math.round(cfg.minDisc * 0.75 / 60 * cfg.vel));
  const diff = dias(cfg.inicio, cfg.hoje);
  cfg.semana = Math.max(1, Math.floor(diff / 7) + 1);
  cfg.dia = (((diff % 7) + 7) % 7) + 1;
  cfg.tipoDia = cfg.dia <= cfg.dT ? 'TEORIA' : cfg.dia <= cfg.dT + cfg.dR ? 'REVISÃO' : 'DESCANSO';
  cfg.grupo = cfg.dia === 7 || cfg.dia % 2 === 1 ? 'A' : 'B';

  const discs = [...(D.Disciplinas || [])].map((d) => ({ ...d, meta: num(d.meta) ?? 0.7, ordem: num(d.ordem) ?? 99, batidas_previas: num(d.batidas_previas) ?? 0 }))
    .sort((a, b) => a.ordem - b.ordem);
  const discMap = Object.fromEntries(discs.map((d) => [d.cod, d]));
  const cont = { A: 0, B: 0 };
  discs.forEach((d) => { d.seq = d.grupo === 'A' || d.grupo === 'B' ? ++cont[d.grupo] : null; });

  const aulas = (D.Aulas || []).map((a, i) => {
    const g = num(a.pag_ini) ?? 1, h = num(a.pag_fim) ?? g;
    return { ...a, idx: i, G: g, H: h, I: h - g + 1, ordem: num(a.ordem) ?? i, incl: String(a.incluir || 'S').toUpperCase() !== 'N', regs: [] };
  });
  const aulaMap = Object.fromEntries(aulas.map((a) => [a.id, a]));

  // Diário enriquecido
  const diario = [...(D.Diario || [])].map((r) => ({ ...r, data: String(r.data).slice(0, 10) }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.criado_em) < String(b.criado_em) ? -1 : 1));
  const vistosDia = new Set();
  const conclPorAula = {};
  diario.forEach((r) => {
    const a = aulaMap[r.aula_id];
    const dd = dias(cfg.inicio, r.data);
    r.semana = Math.floor(dd / 7) + 1;
    r.diaCiclo = (((dd % 7) + 7) % 7) + 1;
    r.tipo = r.diaCiclo <= cfg.dT ? 'Teoria' : r.diaCiclo <= cfg.dT + cfg.dR ? 'Revisão' : 'Extra';
    r.cod = a ? a.cod : String(r.aula_id).split('-')[0];
    r.pi = num(r.pag_ini); r.pf = num(r.pag_fim);
    r.paginas = r.pi !== null && r.pf !== null ? r.pf - r.pi + 1 : 0;
    r.min = num(r.minutos) ?? 0; r.q = num(r.questoes) ?? 0; r.ac = num(r.acertos) ?? 0;
    r.primeiro = !vistosDia.has(r.data); vistosDia.add(r.data);
    r.concluiu = String(r.terminei).toUpperCase() === 'S' || (a && r.pf !== null && r.pf >= a.H);
    r.batida = (conclPorAula[r.aula_id] || 0) + 1;
    if (r.concluiu) conclPorAula[r.aula_id] = (conclPorAula[r.aula_id] || 0) + 1;
    if (a) a.regs.push(r);
  });

  // Estado de cada aula
  aulas.forEach((a) => {
    const d = discMap[a.cod] || { meta: 0.7, batidas_previas: 0 };
    const regs = a.regs;
    a.N = regs.length;
    const concl = regs.filter((r) => r.concluiu).length;
    a.O = concl + d.batidas_previas;
    a.P = concl + 1;
    const atuais = regs.filter((r) => r.batida === a.P && r.pf !== null);
    a.Q = a.N && atuais.length ? Math.max(...atuais.map((r) => r.pf)) : 0;
    a.R = Math.max(a.G, a.Q + 1);
    a.S = Math.max(0, a.H - a.R + 1);
    a.T = a.N ? Math.max(...regs.map((r) => r.semana)) : 0;
    const ult = regs.filter((r) => r.semana === a.T);
    a.U = a.T ? ult.reduce((s, r) => s + r.q, 0) : 0;
    a.V = a.T ? ult.reduce((s, r) => s + r.ac, 0) : 0;
    a.W = a.U ? a.V / a.U : null;
    a.X = d.meta;
    a.status = !a.incl ? 'Opcional (fora)' : a.W !== null && a.W < a.X ? 'Reestudar'
      : a.Q > 0 ? 'Em andamento' : a.O > 0 ? `Concluída (${a.O}ª batida)` : 'Não iniciada';
    a.rank = !a.incl ? 9e6 : (a.status === 'Reestudar' ? 0 : a.status === 'Em andamento' ? 1 : 2) * 100000 + a.O * 1000 + a.ordem;
    a.feitas = a.P > 1 ? a.I : a.Q > 0 ? Math.min(a.I, a.Q - a.G + 1) : 0;
    const pis = ult.filter((r) => r.pi !== null).map((r) => r.pi), pfs = ult.filter((r) => r.pf !== null).map((r) => r.pf);
    a.reestPags = a.status === 'Reestudar' && pis.length ? `págs ${Math.min(...pis)} a ${Math.max(...pfs)}` : '';
    const sem = regs.filter((r) => r.semana === cfg.semana);
    a.nestaSemana = sem.length > 0;
    a.pagsSemana = sem.length && sem.some((r) => r.pi !== null)
      ? `${Math.min(...sem.filter((r) => r.pi !== null).map((r) => r.pi))}–${Math.max(...sem.filter((r) => r.pf !== null).map((r) => r.pf))}` : '';
    a.proxima = a.status === 'Reestudar' ? `REESTUDAR ${a.reestPags} (acerto ${pct(a.W)})`
      : `Ler págs ${a.R} a ${Math.min(a.H, a.R + cfg.pagsSessao - 1)}${a.H - a.R + 1 <= cfg.pagsSessao ? ' (fim da aula)' : ''}`;
    a.topicosIds = splitIds(a.topicos);
  });

  // Fila por disciplina
  const fila = {};
  aulas.forEach((a) => { (fila[a.cod] = fila[a.cod] || []).push(a); });
  Object.values(fila).forEach((l) => l.sort((x, y) => x.rank - y.rank || x.idx - y.idx));

  // Tópicos (edital verticalizado) e vínculos
  const topicos = (D.Topicos || []).map((t) => ({ ...t, aulas: [], editaisIds: splitIds(t.editais), qcIds: splitIds(t.qc_subject_ids) }));
  const topMap = Object.fromEntries(topicos.map((t) => [t.id, t]));
  aulas.forEach((a) => a.topicosIds.forEach((tid) => { if (topMap[tid]) topMap[tid].aulas.push(a); }));
  topicos.forEach((t) => {
    const inc = t.aulas.filter((a) => a.incl);
    const vista = (a) => a.O > 0 && a.status !== 'Reestudar' && a.status !== 'Em andamento';
    t.status = !t.aulas.length ? 'Sem aula (lacuna)' : !inc.length ? 'Opcional'
      : inc.every(vista) ? 'Visto' : inc.some((a) => vista(a) || a.Q > 0) ? 'Parcial' : 'Não visto';
  });
  aulas.forEach((a) => { a.qcIds = [...new Set(a.topicosIds.flatMap((tid) => (topMap[tid] ? topMap[tid].qcIds : [])))]; });

  // Disciplinas: totais
  discs.forEach((d) => {
    const inc = (fila[d.cod] || []).filter((a) => a.incl);
    d.pagsTeoria = inc.reduce((s, a) => s + a.I, 0);
    d.pagsFeitas = inc.reduce((s, a) => s + a.feitas, 0);
    d.cobertura = d.pagsTeoria ? d.pagsFeitas / d.pagsTeoria : 0;
    d.reestudar = (fila[d.cod] || []).filter((a) => a.status === 'Reestudar').length;
    const regs = diario.filter((r) => r.cod === d.cod);
    d.horas = regs.reduce((s, r) => s + r.min, 0) / 60;
    d.questoes = regs.reduce((s, r) => s + r.q, 0);
    d.acerto = d.questoes ? regs.reduce((s, r) => s + r.ac, 0) / d.questoes : null;
    d.batidaMin = inc.length ? Math.min(...inc.map((a) => a.O)) : null;
    d.noCiclo = d.grupo === 'A' || d.grupo === 'B';
    d.previsao = d.pagsTeoria && d.noCiclo ? addDias(cfg.hoje, Math.ceil((d.pagsTeoria - d.pagsFeitas) / (2 * cfg.pagsSessao)) * 7) : '';
    d.situacao = !d.pagsTeoria ? (d.noCiclo ? '⚠ Mapear curso' : '') : d.noCiclo
      ? (!d.questoes ? 'Sem questões ainda' : d.acerto < d.meta ? '⚠ Abaixo da meta' : d.cobertura >= 1 ? '► Concluída: trocar' : '✔ Ok')
      : (d.questoes ? 'Fora do ciclo' : '');
  });

  // Semanas
  const semanas = [];
  for (let s = 1; s <= cfg.semana; s++) {
    const rs = diario.filter((r) => r.semana === s);
    const q = rs.reduce((x, r) => x + r.q, 0);
    semanas.push({
      s, inicio: addDias(cfg.inicio, (s - 1) * 7), horas: rs.reduce((x, r) => x + r.min, 0) / 60,
      pags: rs.reduce((x, r) => x + r.paginas, 0), q, ac: rs.reduce((x, r) => x + r.ac, 0),
      dias: rs.filter((r) => r.primeiro).length,
    });
    const u = semanas[semanas.length - 1]; u.acerto = q ? u.ac / q : null;
  }

  const editais = (D.Editais || []).map((e) => {
    const tops = topicos.filter((t) => t.editaisIds.includes(e.id));
    const vistos = tops.filter((t) => t.status === 'Visto').length;
    return { ...e, topicos: tops, vistos, cobertura: tops.length ? vistos / tops.length : null,
      qcIds: [...new Set(tops.flatMap((t) => t.qcIds))] };
  }).sort((a, b) => (num(a.prioridade) ?? 9) - (num(b.prioridade) ?? 9));

  return { cfg, discs, discMap, aulas, aulaMap, fila, diario, topicos, topMap, semanas, editais };
}

// ---------- links do QConcursos ----------
function linkQC(ids, { elite = false, bancas = null } = {}) {
  const lista = [...new Set(ids.map(String).filter(Boolean))];
  if (!lista.length) return null;
  const p = new URLSearchParams();
  lista.forEach((id) => p.append('subject_ids[]', id));
  const bs = bancas ?? (store.dados.Bancas || []).filter((b) => String(b.usar).toUpperCase() === 'S' && num(b.qc_id) !== null).map((b) => b.qc_id);
  bs.forEach((b) => p.append('examining_board_ids[]', b));
  p.append('exclude_outdated', 'true'); p.append('exclude_nullified', 'true');
  return `https://${elite ? 'elite' : 'www'}.qconcursos.com/questoes-de-concursos/questoes?${p.toString()}`;
}
function botaoQC(ids, rotulo = 'Caderno QC') {
  const u = linkQC(ids);
  return u ? `<a class="btn peq" target="_blank" rel="noopener" href="${esc(u)}" title="${ids.length} assunto(s) do QConcursos">${esc(rotulo)}</a>`
    : `<span class="btn peq off" title="Tópicos desta aula ainda sem IDs do QConcursos (aba Edital)">${esc(rotulo)}</span>`;
}

const clsStatus = (s) => (s === 'Reestudar' || s.startsWith('⚠') || s === 'Sem aula (lacuna)' ? 'st-bad'
  : s.startsWith('Concluída') || s === 'Visto' || s.startsWith('✔') ? 'st-ok' : s === 'Em andamento' || s === 'Parcial' ? 'st-warn' : 'muted');

// ---------- telas ----------
let view = LS.get('view', 'hoje');
let M = null;
const filtros = LS.get('filtros', { material: '', topDisc: 'CPUB', topEdital: '' });

function render() {
  if (!store.dados) return;
  M = calcular(store.dados);
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.view === view));
  const aviso = $('#aviso');
  aviso.hidden = !store.demo;
  aviso.innerHTML = 'Modo demonstração: as alterações ficam só neste navegador. Conecte sua planilha em <b>Config › Conexão</b>.';
  $('#app').innerHTML = (VIEWS[view] || VIEWS.hoje)();
  atualizarSync();
  if (view === 'registrar') ligarRegistro();
}

const VIEWS = {
  hoje() {
    const { cfg } = M;
    const fazer = cfg.tipoDia === 'TEORIA' ? `~${Math.round(cfg.minDisc * 0.75)} min de leitura + ${cfg.qFix} questões por disciplina`
      : cfg.tipoDia === 'REVISÃO' ? `${cfg.qRev} questões por disciplina (assuntos da semana) + revisar só o que errou`
        : 'Descanso. Olhe o Painel. Abaixo: o que vem no Dia 1 (Grupo A).';
    const discs = M.discs.filter((d) => d.grupo === cfg.grupo && d.seq).slice(0, cfg.maxDisc);
    const reest = M.aulas.filter((a) => a.status === 'Reestudar');
    const sem = M.semanas[M.semanas.length - 1] || { horas: 0, pags: 0, q: 0, acerto: null };
    return `
      <div class="grid">
        <div class="kpi"><div class="l">Hoje</div><div class="v">${br(cfg.hoje)}</div></div>
        <div class="kpi"><div class="l">Semana · dia do ciclo</div><div class="v">${cfg.semana} · ${cfg.dia} de 7</div></div>
        <div class="kpi"><div class="l">Tipo · grupo</div><div class="v">${cfg.tipoDia} · ${cfg.grupo}</div></div>
      </div>
      <div class="card" style="margin-top:12px"><b>Fazer:</b> ${esc(fazer)}</div>
      ${reest.length ? `<div class="card"><h3 class="st-bad">Reestudo pendente (${reest.length})</h3>${reest.map((a) => `<div>${esc(a.cod)} · ${esc(a.aula)} — ${esc(a.reestPags)} (acerto ${pct(a.W)})</div>`).join('')}</div>` : ''}
      ${discs.map((d, i) => cardDisciplina(d, i + 1)).join('') || '<div class="card">Nenhuma disciplina neste grupo. Ajuste os grupos em Config.</div>'}
      <div class="card"><h3>Pulso da semana</h3>
        <div class="grid">
          <div><div class="l muted small">Horas</div><b>${fmt1(sem.horas)} h de ${fmt1(cfg.metaHorasSemana)} h</b></div>
          <div><div class="l muted small">Páginas</div><b>${sem.pags}</b></div>
          <div><div class="l muted small">Questões</div><b>${sem.q} · ${pct(sem.acerto)}</b></div>
        </div></div>`;
  },

  registrar() {
    const opts = M.discs.map((d) => {
      const l = (M.fila[d.cod] || []).filter((a) => a.incl || a.N);
      return l.length ? `<optgroup label="${esc(d.nome)}">${[...l].sort((x, y) => x.ordem - y.ordem).map((a) => `<option value="${esc(a.id)}">${esc(a.id)} · ${esc(a.aula)} — ${esc(String(a.titulo).slice(0, 60))}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const ult = [...M.diario].reverse().slice(0, 30);
    return `
      <div class="duas">
        <div class="card">
          <h3>Cronômetro</h3>
          <div class="cron" id="cron">00:00:00</div>
          <div class="linha" style="margin-top:8px">
            <button class="btn" data-acao="cron-iniciar" id="btnCron">Iniciar</button>
            <button class="btn sec" data-acao="cron-zerar">Zerar</button>
            <button class="btn sec" data-acao="cron-usar">Usar no registro</button>
          </div>
          <p class="muted small">O tempo continua contando mesmo se você fechar a página.</p>
        </div>
        <div class="card">
          <h3>Registrar sessão</h3>
          <form id="fReg">
            <div class="campos">
              <label>Data<input type="date" name="data" value="${M.cfg.hoje}" required></label>
              <label style="grid-column:1/-1">Aula<select name="aula_id" required>${opts}</select></label>
              <label>Pág. início<input type="number" name="pag_ini" min="0"></label>
              <label>Pág. fim<input type="number" name="pag_fim" min="0"></label>
              <label>Minutos líquidos<input type="number" name="minutos" min="0"></label>
              <label>Questões<input type="number" name="questoes" min="0"></label>
              <label>Acertos<input type="number" name="acertos" min="0"></label>
              <label>Terminei a aula?<select name="terminei"><option value="">auto</option><option>S</option><option>N</option></select></label>
              <label style="grid-column:1/-1">Observações / o que errei<textarea name="obs"></textarea></label>
            </div>
            <p class="small muted" id="regInfo"></p>
            <button class="btn" type="submit">Salvar</button>
          </form>
        </div>
      </div>
      <h2>Últimos registros</h2>
      <div class="card tab-wrap"><table>
        <tr><th>Data</th><th>Sem.</th><th>Tipo</th><th>Aula</th><th class="num">Págs</th><th class="num">Min</th><th class="num">Q</th><th class="num">%</th><th>Obs.</th><th></th></tr>
        ${ult.map((r) => `<tr><td>${br(r.data)}</td><td>${r.semana}</td><td>${r.tipo}</td><td>${esc(r.aula_id)}${r.concluiu ? ' ✔' : ''}</td>
          <td class="num">${r.pi ?? ''}–${r.pf ?? ''}</td><td class="num">${r.min}</td><td class="num">${r.q ? `${r.ac}/${r.q}` : ''}</td>
          <td class="num">${r.q ? pct(r.ac / r.q) : ''}</td><td class="small">${esc(r.obs)}</td>
          <td><button class="btn peq sec" data-acao="apagar-reg" data-id="${esc(r.uid)}">apagar</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nenhum registro ainda.</td></tr>'}
      </table></div>`;
  },

  painel() {
    const { cfg, semanas } = M;
    const D = M.diario;
    const ref = Math.max(1, cfg.semana - 1);
    const s = semanas.find((x) => x.s === ref) || { horas: 0, dias: 0, pags: 0, q: 0, acerto: null };
    const metaPag = cfg.dT * cfg.pagsSessao * cfg.sessoesDia;
    const metaQ = (cfg.dT * cfg.qFix + cfg.dR * cfg.qRev) * cfg.sessoesDia;
    const reest = M.aulas.filter((a) => a.status === 'Reestudar').length;
    const fila = M.discs.filter((d) => d.grupo === 'Fila').sort((a, b) => a.ordem - b.ordem)[0];
    const troca = M.discs.some((d) => d.noCiclo && d.cobertura >= 1);
    const q = D.reduce((x, r) => x + r.q, 0), ac = D.reduce((x, r) => x + r.ac, 0);
    const linha = (rot, val, ok, msgOk, msgNo) => `<tr><td>${rot}</td><td>${val}</td><td class="${ok ? 'st-ok' : 'st-bad'}">${ok ? '✔ ' + msgOk : '✖ ' + msgNo}</td></tr>`;
    return `
      <div class="grid">
        <div class="kpi"><div class="l">Horas totais</div><div class="v">${fmt1(D.reduce((x, r) => x + r.min, 0) / 60)}</div></div>
        <div class="kpi"><div class="l">Horas na semana</div><div class="v">${fmt1((semanas[semanas.length - 1] || {}).horas || 0)}</div></div>
        <div class="kpi"><div class="l">Páginas lidas</div><div class="v">${D.reduce((x, r) => x + r.paginas, 0)}</div></div>
        <div class="kpi"><div class="l">Questões</div><div class="v">${q}</div></div>
        <div class="kpi"><div class="l">% acerto geral</div><div class="v">${pct(q ? ac / q : null)}</div></div>
        <div class="kpi"><div class="l">Aulas p/ reestudar</div><div class="v">${reest}</div></div>
      </div>
      <h2>${cfg.semana === 1 ? 'Cobrança — semana 1 (parcial; a cobrança real começa na semana 2)' : `Cobrança da semana ${ref}`}</h2>
      <div class="card tab-wrap"><table>
        ${linha('Horas', `${fmt1(s.horas)} h de ${fmt1(cfg.metaHorasSemana)} h`, s.horas >= 0.9 * cfg.metaHorasSemana, 'Dentro da meta', 'Abaixo da meta — recupere no próximo ciclo')}
        ${linha('Dias estudados', `${s.dias} de ${cfg.diasSemana}`, s.dias >= cfg.diasSemana, 'Constância ok', 'Faltaram dias — constância vem antes de volume')}
        ${linha('Páginas lidas', `${s.pags} de ~${Math.round(metaPag)}`, s.pags >= 0.8 * metaPag, 'Ritmo de leitura ok', 'Leitura abaixo do previsto — a previsão de término atrasa')}
        ${linha('Questões / acerto', `${s.q} | ${pct(s.acerto)}`, s.q >= 0.8 * metaQ, 'Volume de questões ok', `Poucas questões — meta ≈ ${Math.round(metaQ)}/semana`)}
        ${linha('Reestudo pendente', `${reest} aula(s)`, reest === 0, 'Nada pendente', 'Refaça antes de avançar (aparece no topo de Hoje)')}
        <tr><td>Rodízio</td><td>${fila ? 'Próxima da fila: ' + esc(fila.nome) : 'Fila vazia'}</td><td>${troca ? '► Disciplina do ciclo com 100% — troque pela próxima (Config)' : 'Ciclo atual em andamento'}</td></tr>
      </table></div>
      <h2>Por disciplina</h2>
      <div class="card tab-wrap"><table>
        <tr><th>Cód.</th><th>Disciplina</th><th>Grupo</th><th class="num">Págs</th><th>Cobertura</th><th class="num">Reest.</th><th class="num">Horas</th><th class="num">Questões</th><th class="num">% acerto</th><th class="num">Meta</th><th class="num">Batida</th><th>Previsão</th><th>Situação</th></tr>
        ${M.discs.map((d) => `<tr><td>${esc(d.cod)}</td><td>${esc(d.nome)}</td><td>${esc(d.grupo)}</td><td class="num">${d.pagsFeitas}/${d.pagsTeoria}</td>
          <td style="min-width:90px"><div class="barra"><i style="width:${Math.min(100, d.cobertura * 100)}%"></i></div><span class="small">${pct(d.cobertura)}</span></td>
          <td class="num">${d.reestudar || ''}</td><td class="num">${fmt1(d.horas)}</td><td class="num">${d.questoes}</td><td class="num">${pct(d.acerto)}</td>
          <td class="num">${pct(d.meta)}</td><td class="num">${d.batidaMin ?? ''}</td><td>${br(d.previsao)}</td><td class="${clsStatus(d.situacao)}">${esc(d.situacao)}</td></tr>`).join('')}
      </table><p class="small muted">Previsão = páginas que faltam ÷ (2 sessões por semana × ${cfg.pagsSessao} págs por sessão). Só para disciplinas do ciclo.</p></div>
      <h2>Evolução semanal</h2>
      <div class="card">${graficoSemanas(semanas, cfg.metaHorasSemana)}
        <div class="tab-wrap"><table><tr><th>Semana</th><th>Início</th><th class="num">Horas</th><th class="num">Aderência</th><th class="num">Páginas</th><th class="num">Questões</th><th class="num">% acerto</th><th class="num">Dias</th></tr>
        ${[...semanas].reverse().map((w) => `<tr><td>${w.s}</td><td>${br(w.inicio)}</td><td class="num">${fmt1(w.horas)}</td><td class="num">${pct(w.horas / cfg.metaHorasSemana)}</td><td class="num">${w.pags}</td><td class="num">${w.q}</td><td class="num">${pct(w.acerto)}</td><td class="num">${w.dias}</td></tr>`).join('')}
        </table></div></div>`;
  },

  material() {
    const f = filtros.material || (M.discs.find((d) => d.seq) || M.discs[0] || {}).cod;
    const lista = [...(M.fila[f] || [])].sort((a, b) => a.ordem - b.ordem);
    return `
      <div class="linha entre"><h2>Material (aulas na ordem de estudo)</h2>
        <select id="selMat" style="max-width:320px">${M.discs.map((d) => `<option value="${esc(d.cod)}" ${d.cod === f ? 'selected' : ''}>${esc(d.nome)} (${(M.fila[d.cod] || []).length})</option>`).join('')}</select></div>
      ${!lista.length ? '<div class="card">Curso desta disciplina ainda não mapeado.</div>' : `
      <div class="card tab-wrap"><table>
        <tr><th class="num">#</th><th>Aula</th><th>Conteúdo</th><th class="num">Págs</th><th>Status</th><th class="num">Faltam</th><th class="num">% últ. sem.</th><th>Tópicos</th><th>Incluir</th><th></th></tr>
        ${lista.map((a) => `<tr><td class="num">${a.ordem}</td><td>${esc(a.aula)}<div class="small muted">${esc(a.fonte)}</div></td>
          <td>${esc(a.titulo)}${a.obs ? `<div class="small muted">${esc(a.obs)}</div>` : ''}</td>
          <td class="num">${a.G}–${a.H}</td><td class="${clsStatus(a.status)}">${esc(a.status)}</td><td class="num">${a.S}</td><td class="num">${pct(a.W)}</td>
          <td>${a.topicosIds.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</td>
          <td><input type="checkbox" data-acao="incluir" data-id="${esc(a.id)}" ${a.incl ? 'checked' : ''}></td>
          <td>${botaoQC(a.qcIds, 'QC')}${a.link ? ` <a class="btn peq sec" target="_blank" rel="noopener" href="${esc(a.link)}">abrir</a>` : ''}</td></tr>`).join('')}
      </table></div>`}`;
  },

  edital() {
    const fd = filtros.topDisc || 'CPUB';
    const fe = filtros.topEdital || '';
    let tops = M.topicos.filter((t) => (fd === '*' || t.cod === fd) && (!fe || t.editaisIds.includes(fe)));
    const idsEd = M.editais.map((e) => e.id).join(' ');
    return `
      <h2>Editais-alvo</h2>
      <div class="grid">${M.editais.map((e) => `<div class="card" style="margin:0">
        <div class="linha entre"><b>${esc(e.nome)}</b><span class="chip">${esc(e.grupo)}</span></div>
        <div class="small muted">${esc(e.cargo)} · ${esc(e.banca)}</div>
        ${e.situacao ? `<div class="small">${esc(e.situacao)}</div>` : ''}
        <div style="margin:6px 0"><div class="barra"><i style="width:${(e.cobertura || 0) * 100}%"></i></div>
          <span class="small">${e.topicos.length ? `${e.vistos}/${e.topicos.length} tópicos vistos` : 'tópicos ainda não vinculados'}</span></div>
        <div class="linha">${botaoQC(e.qcIds, 'Caderno do edital')}${e.link ? `<a class="btn peq sec" target="_blank" rel="noopener" href="${esc(e.link)}">fonte</a>` : ''}</div>
      </div>`).join('')}</div>
      <h2>Edital verticalizado × aulas × QConcursos</h2>
      <div class="linha" style="margin-bottom:8px">
        <select id="selTopDisc" style="max-width:300px"><option value="*">Todas as disciplinas</option>${M.discs.map((d) => `<option value="${esc(d.cod)}" ${d.cod === fd ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}</select>
        <select id="selTopEd" style="max-width:220px"><option value="">Todos os editais</option>${M.editais.map((e) => `<option value="${esc(e.id)}" ${e.id === fe ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select>
      </div>
      <p class="small muted">Editais: códigos separados por espaço (${esc(idsEd)}). IDs QC: números de assunto do QConcursos separados por espaço.</p>
      <div class="card tab-wrap"><table>
        <tr><th>ID</th><th>Tópico</th><th>Inc.</th><th class="num">% cobr.</th><th>Aulas</th><th>Status</th><th>Editais</th><th>IDs QC</th><th></th></tr>
        ${tops.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.topico)}<div class="small muted">${esc(t.bloco)}</div></td><td>${esc(t.incidencia)}</td>
          <td class="num">${num(t.pct) !== null ? pct(num(t.pct), 1) : ''}</td>
          <td>${t.aulas.map((a) => `<span class="chip" title="${esc(a.titulo)}">${esc(a.aula)}</span>`).join('') || `<span class="small muted">${esc(t.onde_estudar)}</span>`}</td>
          <td class="${clsStatus(t.status)}">${esc(t.status)}</td>
          <td><input class="ids" data-acao="top-editais" data-id="${esc(t.id)}" value="${esc(t.editais)}" style="min-width:140px"></td>
          <td><input class="ids" data-acao="top-qc" data-id="${esc(t.id)}" value="${esc(t.qc_subject_ids)}" style="min-width:110px"></td>
          <td>${botaoQC(t.qcIds, 'QC')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nenhum tópico neste filtro.</td></tr>'}
      </table></div>`;
  },

  config() {
    const D = store.dados;
    const c = store.conexao;
    return `
      <h2>Conexão com a planilha</h2>
      <div class="card"><form id="fCon"><div class="campos">
        <label style="grid-column:1/-1">URL do Apps Script (termina em /exec)<input name="url" value="${esc(c.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label style="grid-column:1/-1">Chave de acesso<input name="chave" value="${esc(c.chave)}" type="password" autocomplete="off"></label></div>
        <div class="linha" style="margin-top:10px"><button class="btn" type="submit">Salvar e conectar</button>
        ${c.url ? '<button class="btn sec" type="button" data-acao="recarregar">Recarregar da planilha</button><button class="btn sec" type="button" data-acao="desconectar">Desconectar</button>' : ''}</div>
      </form></div>
      <h2>Parâmetros do ciclo</h2>
      <div class="card tab-wrap"><table>${(D.Config || []).map((r) => `<tr><td>${esc(r.descricao || r.chave)}</td>
        <td style="width:200px"><input data-acao="cfg" data-id="${esc(r.chave)}" value="${esc(r.chave === 'data_inicio' || r.chave === 'hoje_manual' ? String(r.valor || '').slice(0, 10) : r.valor)}" ${r.chave === 'data_inicio' || r.chave === 'hoje_manual' ? 'type="date"' : ''}></td></tr>`).join('')}</table></div>
      <h2>Disciplinas, grupos e metas</h2>
      <p class="small muted">Grupo: A, B, Fila, Pausada ou Concluída. A e B alternam nos dias do ciclo.</p>
      <div class="card tab-wrap"><table>
        <tr><th>Cód.</th><th>Disciplina</th><th>Grupo</th><th>Ordem</th><th>Meta</th><th>Batidas antes</th><th>Onde cai</th></tr>
        ${M.discs.map((d) => `<tr><td>${esc(d.cod)}</td><td>${esc(d.nome)}</td>
          <td><select data-acao="disc" data-campo="grupo" data-id="${esc(d.cod)}">${['A', 'B', 'Fila', 'Pausada', 'Concluída'].map((g) => `<option ${g === d.grupo ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
          <td><input type="number" style="width:70px" data-acao="disc" data-campo="ordem" data-id="${esc(d.cod)}" value="${d.ordem}"></td>
          <td><input type="number" step="0.05" style="width:80px" data-acao="disc" data-campo="meta" data-id="${esc(d.cod)}" value="${d.meta}"></td>
          <td><input type="number" style="width:70px" data-acao="disc" data-campo="batidas_previas" data-id="${esc(d.cod)}" value="${d.batidas_previas}"></td>
          <td class="small">${esc(d.onde_cai)}</td></tr>`).join('')}
      </table></div>
      <h2>Bancas no filtro do QConcursos</h2>
      <div class="card tab-wrap"><table><tr><th>Banca</th><th>ID no QConcursos</th><th>Usar</th></tr>
        ${(D.Bancas || []).map((b) => `<tr><td>${esc(b.nome)}</td><td><input class="ids" style="width:100px" data-acao="banca" data-campo="qc_id" data-id="${esc(b.nome)}" value="${esc(b.qc_id)}"></td>
          <td><input type="checkbox" data-acao="banca" data-campo="usar" data-id="${esc(b.nome)}" ${String(b.usar).toUpperCase() === 'S' ? 'checked' : ''}></td></tr>`).join('')}
      </table><p class="small muted">Bancas sem ID ficam fora do filtro. Para descobrir o ID: filtre a banca no QConcursos e copie o número de <code>examining_board_ids[]</code> da barra de endereço.</p></div>
      <h2>Backup</h2>
      <div class="card linha"><button class="btn sec" data-acao="backup">Baixar backup (JSON)</button>
        ${store.demo ? '<button class="btn sec" data-acao="reset-demo">Restaurar dados de demonstração</button>' : ''}</div>
      <h2>Importar pacote</h2>
      <div class="card"><p class="small muted">Arquivo JSON no formato <code>{"Aulas": [...], "Topicos": [...]}</code>. Cada linha é gravada pela chave da aba (cria se não existir, atualiza só as colunas enviadas).</p>
        <input type="file" id="arqPacote" accept=".json,application/json"></div>`;
  },
};

function cardDisciplina(d, n) {
  const { cfg } = M;
  const fila = (M.fila[d.cod] || []).filter((a) => a.incl);
  const prox = fila[0];
  const semana = (M.fila[d.cod] || []).filter((a) => a.nestaSemana).sort((a, b) => a.idx - b.idx);
  let acao;
  if (!fila.length) acao = '⚠ Curso desta disciplina ainda não mapeado (aba Material).';
  else if (cfg.tipoDia === 'REVISÃO') acao = `► HOJE: ${cfg.qRev} questões das aulas desta semana e revise só o que errar`;
  else acao = `${cfg.tipoDia === 'DESCANSO' ? 'Próximo: ' : '► HOJE: '}${prox.aula} — ${prox.proxima}`;
  const qcIds = cfg.tipoDia === 'REVISÃO' ? [...new Set(semana.flatMap((a) => a.qcIds))] : prox ? prox.qcIds : [];
  return `<div class="card">
    <div class="linha entre"><h3>${n}. ${esc(d.nome)}</h3><span class="small muted">${cfg.minDisc} min · meta ${pct(d.meta)} · cobertura ${pct(d.cobertura)}</span></div>
    <div class="acao ${prox && prox.status === 'Reestudar' ? 'reest' : ''}">${esc(acao)}</div>
    <div class="linha">${prox ? `<button class="btn peq" data-acao="registrar-aula" data-id="${esc(prox.id)}">Registrar esta aula</button>` : ''}
      ${botaoQC(qcIds, cfg.tipoDia === 'REVISÃO' ? 'Caderno QC da semana' : 'Caderno QC da aula')}</div>
    <div class="duas" style="margin-top:10px">
      <div><div class="small muted">Fila de aulas (teoria)</div><table>${fila.slice(0, 4).map((a) => `<tr><td>${esc(a.aula)}</td><td>${esc(String(a.titulo).slice(0, 70))}</td><td class="small ${clsStatus(a.status)}">${esc(a.status)} · faltam ${a.S} págs</td></tr>`).join('')}</table></div>
      <div><div class="small muted">Aulas desta semana (revisão)</div><table>${semana.map((a) => `<tr><td>${esc(a.aula)}</td><td>${esc(String(a.titulo).slice(0, 60))}</td><td class="num">${esc(a.pagsSemana)}</td><td class="num">${pct(a.W)}</td></tr>`).join('') || '<tr><td class="muted small">Nada ainda nesta semana.</td></tr>'}</table></div>
    </div></div>`;
}

function graficoSemanas(semanas, meta) {
  const ult = semanas.slice(-12);
  if (!ult.length) return '';
  const W = 640, H = 170, pad = 28, bw = (W - pad * 2) / ult.length;
  const max = Math.max(meta, ...ult.map((s) => s.horas), 1);
  const y = (v) => H - 20 - (v / max) * (H - 40);
  const bars = ult.map((s, i) => `<rect x="${pad + i * bw + bw * 0.18}" y="${y(s.horas)}" width="${bw * 0.64}" height="${H - 20 - y(s.horas)}" rx="3" fill="var(--bar)"><title>Semana ${s.s}: ${fmt1(s.horas)} h</title></rect>
    <text x="${pad + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">S${s.s}</text>`).join('');
  return `<div class="small muted">Horas por semana (linha = meta de ${fmt1(meta)} h)</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Horas por semana">${bars}
    <line x1="${pad}" x2="${W - pad}" y1="${y(meta)}" y2="${y(meta)}" stroke="var(--warn)" stroke-dasharray="4 3"/></svg>`;
}

// ---------- cronômetro ----------
const cron = {
  st: LS.get('cron', { inicio: null, acumulado: 0 }),
  ms() { return this.st.acumulado + (this.st.inicio ? Date.now() - this.st.inicio : 0); },
  salvar() { LS.set('cron', this.st); },
  alternar() { if (this.st.inicio) { this.st.acumulado = this.ms(); this.st.inicio = null; } else this.st.inicio = Date.now(); this.salvar(); this.pintar(); },
  zerar() { this.st = { inicio: null, acumulado: 0 }; this.salvar(); this.pintar(); },
  pintar() {
    const el = $('#cron'); if (!el) return;
    const s = Math.floor(this.ms() / 1000);
    el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
    const b = $('#btnCron'); if (b) b.textContent = this.st.inicio ? 'Pausar' : this.ms() ? 'Continuar' : 'Iniciar';
  },
};
setInterval(() => cron.pintar(), 1000);

let preAula = null;
function ligarRegistro() {
  cron.pintar();
  const f = $('#fReg'); if (!f) return;
  const sel = f.aula_id;
  const sugerida = preAula || (() => {
    const d = M.discs.find((x) => x.grupo === M.cfg.grupo && x.seq);
    const l = d ? (M.fila[d.cod] || []).filter((a) => a.incl) : [];
    return l[0] ? l[0].id : null;
  })();
  if (sugerida) sel.value = sugerida;
  preAula = null;
  const info = () => {
    const a = M.aulaMap[sel.value];
    if (!a) return;
    $('#regInfo').textContent = `${a.status} · teoria págs ${a.G}–${a.H} · próxima pág. ${a.R} · sugestão: ${a.proxima}`;
    f.pag_ini.value = a.R;
    f.pag_fim.value = Math.min(a.H, a.R + M.cfg.pagsSessao - 1);
  };
  sel.addEventListener('change', info); info();
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    ['pag_ini', 'pag_fim', 'minutos', 'questoes', 'acertos'].forEach((k) => { v[k] = num(v[k]) ?? ''; });
    const q = num(v.questoes), ac = num(v.acertos);
    if (q !== null && ac !== null && ac > q) { toast('Acertos maior que questões.'); return; }
    if (num(v.pag_ini) !== null && num(v.pag_fim) !== null && num(v.pag_fim) < num(v.pag_ini)) { toast('Página final menor que a inicial.'); return; }
    store.gravar('Diario', [{ uid: uid(), ...v, criado_em: new Date().toISOString() }]);
    toast('Sessão registrada.');
  });
}

async function importarPacote(arquivo) {
  const ABAS = ['Config', 'Disciplinas', 'Aulas', 'Topicos', 'Editais', 'Bancas'];
  let pac;
  try { pac = JSON.parse(await arquivo.text()); } catch (e) { toast('Arquivo não é um JSON válido.'); return; }
  const abas = ABAS.filter((a) => Array.isArray(pac[a]) && pac[a].length);
  if (!abas.length) { toast('Nenhuma aba reconhecida no pacote.'); return; }
  const resumo = abas.map((a) => `${a}: ${pac[a].length} linha(s)`).join('\n');
  if (!confirm(`Importar?\n${resumo}`)) return;
  for (const a of abas) await store.gravar(a, pac[a]);
  toast(`Pacote importado (${abas.join(', ')}).`);
}

// ---------- eventos ----------
document.addEventListener('click', async (ev) => {
  const nav = ev.target.closest('#abas button');
  if (nav) { view = nav.dataset.view; LS.set('view', view); render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-acao]');
  if (!el) return;
  const a = el.dataset.acao, id = el.dataset.id;
  if (a === 'cron-iniciar') cron.alternar();
  else if (a === 'cron-zerar') cron.zerar();
  else if (a === 'cron-usar') { const f = $('#fReg'); if (f) f.minutos.value = Math.round(cron.ms() / 60000); }
  else if (a === 'registrar-aula') { preAula = id; view = 'registrar'; LS.set('view', view); render(); }
  else if (a === 'apagar-reg') { if (confirm('Apagar este registro?')) store.apagar('Diario', [id]); }
  else if (a === 'recarregar') { await store.recarregar(); render(); toast('Dados recarregados.'); }
  else if (a === 'desconectar') { if (confirm('Desconectar e voltar ao modo demonstração? Os dados continuam na planilha.')) { store.conexao = { url: '', chave: '' }; LS.set('conexao', store.conexao); LS.set('dados', null); store.dados = null; await store.iniciar(); render(); } }
  else if (a === 'reset-demo') { if (confirm('Apagar as alterações locais e restaurar a demonstração?')) { LS.set('dados', null); store.dados = null; await store.iniciar(); render(); } }
  else if (a === 'backup') {
    const blob = new Blob([JSON.stringify(store.dados, null, 1)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `estudos-backup-${isoHoje()}.json`; link.click();
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'arqPacote' && el.files[0]) { importarPacote(el.files[0]); el.value = ''; return; }
  if (el.id === 'selMat') { filtros.material = el.value; LS.set('filtros', filtros); render(); return; }
  if (el.id === 'selTopDisc') { filtros.topDisc = el.value; LS.set('filtros', filtros); render(); return; }
  if (el.id === 'selTopEd') { filtros.topEdital = el.value; LS.set('filtros', filtros); render(); return; }
  const a = el.dataset.acao, id = el.dataset.id;
  if (a === 'incluir') store.gravar('Aulas', [{ id, incluir: el.checked ? 'S' : 'N' }]);
  else if (a === 'top-qc') store.gravar('Topicos', [{ id, qc_subject_ids: splitIds(el.value).join(' ') }]);
  else if (a === 'top-editais') store.gravar('Topicos', [{ id, editais: splitIds(el.value).map((x) => x.toUpperCase()).join(' ') }]);
  else if (a === 'cfg') store.gravar('Config', [{ chave: id, valor: el.value }]);
  else if (a === 'disc') store.gravar('Disciplinas', [{ cod: id, [el.dataset.campo]: el.type === 'number' ? num(el.value) : el.value }]);
  else if (a === 'banca') store.gravar('Bancas', [{ nome: id, [el.dataset.campo]: el.type === 'checkbox' ? (el.checked ? 'S' : 'N') : el.value }]);
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'fCon') return;
  ev.preventDefault();
  const v = Object.fromEntries(new FormData(ev.target).entries());
  const novo = { url: v.url.trim(), chave: v.chave.trim() };
  const anterior = store.conexao;
  store.conexao = novo;
  try {
    const j = await store.api({ acao: 'carregar' });
    LS.set('conexao', novo);
    store.dados = j.dados; store.fila = []; LS.set('fila', []); store.salvarLocal(); store.estado = 'ok';
    toast('Conectado à planilha.'); render();
  } catch (e) {
    store.conexao = anterior;
    toast('Não conectou: ' + e.message);
  }
});

// ---------- tema ----------
function aplicarTema(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
aplicarTema(LS.get('tema', null));
$('#btnTema').addEventListener('click', () => {
  const escuro = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const t = escuro ? 'light' : 'dark'; LS.set('tema', t); aplicarTema(t);
});

// ---------- início ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
store.iniciar().then(render).catch((e) => { $('#app').innerHTML = `<div class="card st-bad">Erro ao carregar: ${esc(e.message)}</div>`; });
