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
  const discs = [...(D.Disciplinas || [])].map((d) => ({ ...d, meta: num(d.meta) ?? 0.7, ordem: num(d.ordem) ?? 99, batidas_previas: num(d.batidas_previas) ?? 0 }))
    .sort((a, b) => a.ordem - b.ordem);
  const discMap = Object.fromEntries(discs.map((d) => [d.cod, d]));
  const cont = { A: 0, B: 0 };
  discs.forEach((d) => { d.seq = d.grupo === 'A' || d.grupo === 'B' ? ++cont[d.grupo] : null; });

  const aulas = (D.Aulas || []).map((a, i) => {
    const g = num(a.pag_ini) ?? 1, h = num(a.pag_fim) ?? g;
    // Videoaula (fonte contém "vídeo"): pag_ini/pag_fim são minutos do vídeo; sessão = 75% do tempo da disciplina.
    const video = /v[ií]deo/i.test(String(a.fonte || ''));
    return { ...a, idx: i, G: g, H: h, I: h - g + 1, ordem: num(a.ordem) ?? i, incl: String(a.incluir || 'S').toUpperCase() !== 'N', regs: [],
      video, un: video ? 'min' : 'págs', sess: video ? Math.max(1, Math.round(cfg.minDisc * 0.75)) : cfg.pagsSessao };
  });
  const aulaMap = Object.fromEntries(aulas.map((a) => [a.id, a]));

  // Ciclo por progresso, não por calendário (Método 4.2): A, B, A, B (teoria), A, B (revisão), descanso.
  // Cada "dia do ciclo" é um bloco: assim que TODAS as disciplinas do bloco têm registro, o ciclo passa
  // na hora para o próximo bloco — no mesmo dia, se der tempo. Bloco incompleto continua aberto no dia
  // seguinte, com o que já foi feito marcado. Não há atraso nem reestudo.
  // Descanso (dia 7): é o dia de calendário seguinte ao fechamento do dia 6; passa sozinho depois dele.
  // Se você registrar uma disciplina do Grupo A durante o descanso, a nova semana começa ali.
  const tipoDe = (dia) => (dia <= cfg.dT ? 'TEORIA' : dia <= cfg.dT + cfg.dR ? 'REVISÃO' : 'DESCANSO');
  const grupoDe = (dia) => (dia === 7 || dia % 2 === 1 ? 'A' : 'B');
  const discsDoDia = (dia) => (dia === 7 ? [] : discs.filter((d) => d.grupo === grupoDe(dia) && d.seq).slice(0, cfg.maxDisc).map((d) => d.cod));
  const contaEstudo = (r) => !/-HIST$/.test(String(r.aula_id)) && !String(r.uid || '').startsWith('visto-') && r.obs !== 'Marcada como já estudada';
  const codDe = (r) => (aulaMap[r.aula_id] ? aulaMap[r.aula_id].cod : /-REV$/.test(String(r.aula_id)) ? String(r.aula_id).split('-')[0] : null);
  const chaveReg = (r) => String(r.uid || `${String(r.data).slice(0, 10)}|${r.criado_em}|${r.aula_id}`);
  const ordemReg = (a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.criado_em) < String(b.criado_em) ? -1 : String(a.criado_em) > String(b.criado_em) ? 1 : 0);
  const regsCiclo = (D.Diario || []).map((r) => ({ r, data: String(r.data).slice(0, 10) }))
    .filter((x) => x.data >= cfg.inicio && x.data <= cfg.hoje)
    .map((x) => ({ ...x, criado_em: x.r.criado_em, cod: contaEstudo(x.r) ? codDe(x.r) : null })).sort(ordemReg);
  const posDe = {}; // chave do registro -> { dia, semana }
  const semIni = [null, cfg.inicio];
  const fechados = []; // blocos concluídos: { dia, semana, data }
  let pos = 1, sem = 1, feitos = new Set(), slotIni = cfg.inicio, descansoEm = null;
  const avancar = (data) => {
    fechados.push({ dia: pos, semana: sem, data });
    pos++; feitos = new Set(); slotIni = data;
    if (pos === 7) descansoEm = addDias(data, 1);
  };
  const novaSemana = (data) => { pos = 1; sem++; feitos = new Set(); semIni[sem] = data; slotIni = data; descansoEm = null; };
  const passarDescanso = (data) => { if (pos === 7 && data > descansoEm) novaSemana(addDias(descansoEm, 1)); };
  regsCiclo.forEach((x) => {
    passarDescanso(x.data);
    if (pos === 7 && x.cod && discsDoDia(1).includes(x.cod)) novaSemana(x.data);
    posDe[chaveReg(x.r)] = { dia: pos, semana: sem, conta: !!x.cod };
    if (pos === 7 || !x.cod) return;
    const cods = discsDoDia(pos);
    if (cods.length && !cods.includes(x.cod)) return; // fora do bloco atual: conta nas horas, não fecha o bloco
    feitos.add(x.cod);
    if (!cods.length || cods.every((c) => feitos.has(c))) avancar(x.data);
  });
  passarDescanso(cfg.hoje);
  cfg.semana = sem;
  cfg.dia = pos;
  cfg.tipoDia = tipoDe(cfg.dia);
  cfg.grupo = grupoDe(cfg.dia);
  cfg.slotIni = slotIni; // dia de calendário em que o bloco atual abriu
  cfg.descansoEm = descansoEm;
  cfg.fechados = fechados;
  cfg.fechadosHoje = fechados.filter((f) => f.data === cfg.hoje).map((f) => ({ ...f, tipo: tipoDe(f.dia), grupo: grupoDe(f.dia) }));
  cfg.posDe = posDe; cfg.chaveReg = chaveReg; cfg.semIni = semIni; cfg.tipoDe = tipoDe; cfg.grupoDe = grupoDe;

  // Diário enriquecido
  const diario = [...(D.Diario || [])].map((r) => ({ ...r, data: String(r.data).slice(0, 10) }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.criado_em) < String(b.criado_em) ? -1 : 1));
  const vistosDia = new Set();
  const conclPorAula = {};
  diario.forEach((r) => {
    const a = aulaMap[r.aula_id];
    const dd = dias(cfg.inicio, r.data);
    const sl = posDe[chaveReg(r)];
    r.semana = sl ? sl.semana : Math.max(1, Math.floor(dd / 7) + 1);
    r.diaCiclo = sl ? sl.dia : (((dd % 7) + 7) % 7) + 1;
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
    // Sem reestudo: nota baixa não trava a fila nem passa aula na frente — é corrigida nos dias de revisão.
    a.abaixoMeta = a.W !== null && a.W < a.X;
    a.status = !a.incl ? 'Opcional (fora)'
      : a.Q > 0 ? 'Em andamento' : a.O > 0 ? `Concluída (${a.O}ª batida)` : 'Não iniciada';
    a.rank = !a.incl ? 9e6 : (a.status === 'Em andamento' ? 1 : 2) * 100000 + a.O * 1000 + a.ordem;
    a.feitas = a.P > 1 ? a.I : a.Q > 0 ? Math.min(a.I, a.Q - a.G + 1) : 0;
    const sem = regs.filter((r) => r.semana === cfg.semana);
    a.nestaSemana = sem.length > 0;
    a.pagsSemana = sem.length && sem.some((r) => r.pi !== null)
      ? `${Math.min(...sem.filter((r) => r.pi !== null).map((r) => r.pi))}–${Math.max(...sem.filter((r) => r.pf !== null).map((r) => r.pf))}` : '';
    a.proxima = `${a.video ? 'Assistir min' : 'Ler págs'} ${a.R} a ${Math.min(a.H, a.R + a.sess - 1)}${a.H - a.R + 1 <= a.sess ? ' (fim da aula)' : ''}${a.video ? videosNoTrecho(a.obs, a.R, Math.min(a.H, a.R + a.sess - 1)) : ''}`;
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
    const vista = (a) => a.O > 0 && a.status !== 'Em andamento';
    t.status = !t.aulas.length ? 'Sem aula (lacuna)' : !inc.length ? 'Opcional'
      : inc.every(vista) ? 'Visto' : inc.some((a) => vista(a) || a.Q > 0) ? 'Parcial' : 'Não visto';
    // Edital pintado (Método 4.2): leituras = menor nº de batidas concluídas entre as aulas do tópico;
    // estudo reverso = registros no Diário com aula_id "<tópico>-REV" (ids de tópico podem coincidir com ids de aula).
    t.leituras = inc.length ? Math.min(...inc.map((a) => (vista(a) ? a.O : 0))) : 0;
    t.reversos = diario.filter((r) => r.aula_id === `${t.id}-REV`).length;
    t.nivel = t.reversos ? 3 + Math.min(2, t.reversos) : Math.min(3, t.leituras);
  });
  aulas.forEach((a) => { a.qcIds = [...new Set(a.topicosIds.flatMap((tid) => (topMap[tid] ? topMap[tid].qcIds : [])))]; });

  // Disciplinas: totais
  discs.forEach((d) => {
    const inc = (fila[d.cod] || []).filter((a) => a.incl);
    d.pagsTeoria = inc.reduce((s, a) => s + a.I, 0);
    d.pagsFeitas = inc.reduce((s, a) => s + a.feitas, 0);
    d.cobertura = d.pagsTeoria ? d.pagsFeitas / d.pagsTeoria : 0;
    const regs = diario.filter((r) => r.cod === d.cod);
    d.horas = regs.reduce((s, r) => s + r.min, 0) / 60;
    d.questoes = regs.reduce((s, r) => s + r.q, 0);
    d.acerto = d.questoes ? regs.reduce((s, r) => s + r.ac, 0) / d.questoes : null;
    d.batidaMin = inc.length ? Math.min(...inc.map((a) => a.O)) : null;
    d.noCiclo = d.grupo === 'A' || d.grupo === 'B';
    d.manut = d.grupo === 'Manutenção' || d.grupo === 'Concluída';
    d.ultimo = regs.reduce((m, r) => (r.data > m ? r.data : m), '');
    d.qcIds = [...new Set(topicos.filter((t) => t.cod === d.cod).flatMap((t) => t.qcIds))];
    d.previsao = d.pagsTeoria && d.noCiclo ? addDias(cfg.hoje, Math.ceil((d.pagsTeoria - d.pagsFeitas) / (2 * (inc[0] ? inc[0].sess : cfg.pagsSessao))) * 7) : '';
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
      s, inicio: semIni[s] || addDias(cfg.inicio, (s - 1) * 7), horas: rs.reduce((x, r) => x + r.min, 0) / 60,
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

// Legenda do edital pintado (cores das planilhas do Método 4.2)
const NIVEIS = [
  { rot: 'Não lido', cor: '', tx: '' },
  { rot: '1ª leitura', cor: '#FFFF00', tx: '#000' }, { rot: '2ª leitura', cor: '#FFC000', tx: '#000' },
  { rot: '3ª leitura', cor: '#FF0000', tx: '#fff' },
  { rot: '1º estudo reverso', cor: '#00B050', tx: '#fff' }, { rot: '2º estudo reverso', cor: '#0070C0', tx: '#fff' },
];
const chipNivel = (n) => (n ? `<span class="chip" style="background:${NIVEIS[n].cor};color:${NIVEIS[n].tx};border-color:${NIVEIS[n].cor}">${NIVEIS[n].rot}</span>`
  : '<span class="chip">Não lido</span>');

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
    const descanso = cfg.tipoDia === 'DESCANSO';
    const fazer = cfg.tipoDia === 'TEORIA' ? `~${Math.round(cfg.minDisc * 0.75)} min de leitura + ${cfg.qFix} questões por disciplina`
      : cfg.tipoDia === 'REVISÃO' ? `revisar TODAS as disciplinas do Grupo ${cfg.grupo}: ${cfg.qRev} questões por disciplina (assuntos da semana) e corrigir o que errar`
        : cfg.descansoEm > cfg.hoje ? `Semana ${cfg.semana} fechada. Descanso em ${br(cfg.descansoEm)}. Abaixo: o que vem no Dia 1 (Grupo A) — se estudar uma disciplina do Grupo A antes, a nova semana começa na hora.`
          : 'Descanso. Olhe o Painel. Abaixo: o que vem no Dia 1 (Grupo A).';
    const discs = M.discs.filter((d) => d.grupo === cfg.grupo && d.seq).slice(0, cfg.maxDisc);
    const feitas = descanso ? [] : discs.filter((d) => feitoNoBloco(d.cod).length);
    const nomeBloco = (f) => `Dia ${f.dia} · ${f.tipo === 'REVISÃO' ? 'Revisão' : 'Teoria'} ${f.grupo}`;
    const sem = M.semanas[M.semanas.length - 1] || { horas: 0, pags: 0, q: 0, acerto: null };
    return `
      <div class="grid">
        <div class="kpi"><div class="l">Hoje</div><div class="v">${br(cfg.hoje)}</div></div>
        <div class="kpi"><div class="l">Semana · dia do ciclo</div><div class="v">${cfg.semana} · ${cfg.dia} de 7</div>${!descanso && cfg.slotIni < cfg.hoje ? `<div class="small muted">bloco aberto desde ${br(cfg.slotIni)}</div>` : ''}</div>
        <div class="kpi"><div class="l">Tipo · grupo</div><div class="v">${descanso ? 'DESCANSO' : `${cfg.tipoDia} · ${cfg.grupo}`}</div>${!descanso && discs.length ? `<div class="small muted">${feitas.length} de ${discs.length} disciplinas feitas</div>` : ''}</div>
      </div>
      ${cfg.fechadosHoje.length ? `<div class="card" style="margin-top:12px"><div class="acao feito">✔ Hoje você concluiu: ${cfg.fechadosHoje.map((f) => esc(nomeBloco(f))).join(' · ')}${descanso ? '' : ` — agora segue o Dia ${cfg.dia} (Grupo ${cfg.grupo}). Estude se tiver tempo; se não, ele continua aqui amanhã.`}</div></div>` : ''}
      <div class="card" style="margin-top:12px"><b>${descanso ? 'Descanso:' : 'Fazer:'}</b> ${esc(fazer)}</div>
      ${discs.map((d, i) => cardDisciplina(d, i + 1)).join('') || '<div class="card">Nenhuma disciplina neste grupo. Ajuste os grupos em Config.</div>'}
      ${cardExtra()}
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
          <div class="linha entre"><div class="cron" id="cron">00:00:00</div><div id="cronPausa" class="small"></div></div>
          <div id="cronInfo"></div>
          <div class="linha" style="margin-top:8px">
            <button class="btn" data-acao="cron-iniciar" id="btnCron">Iniciar</button>
            <button class="btn sec" data-acao="cron-zerar">Zerar</button>
            <button class="btn sec" data-acao="cron-usar">Usar no registro</button>
          </div>
          <p class="muted small">Conta só o tempo líquido; "Pausar" mede as pausas (aviso ao fim do bloco e se a pausa passar de ${PAUSA_MAX_MIN} min). Continua contando mesmo se você fechar a página. "Usar no registro" leva os minutos e o resumo das pausas.</p>
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
      <div class="card" id="cardExtra">
        <h3>Conteúdo extra / questões avulsas</h3>
        <p class="small muted">Questões ou leitura fora da aula do dia (revisão de manutenção, GranQuestões, TEC, QC). Entra nas horas e no % de acerto da disciplina, sem mexer na fila de aulas.</p>
        <form id="fExtra"><div class="campos">
          <label>Data<input type="date" name="data" value="${M.cfg.hoje}" required></label>
          <label>Disciplina<select name="cod" required>${M.discs.map((d) => `<option value="${esc(d.cod)}" ${d.cod === preExtra ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}</select></label>
          <label>Minutos<input type="number" name="minutos" min="0"></label>
          <label>Questões<input type="number" name="questoes" min="0"></label>
          <label>Acertos<input type="number" name="acertos" min="0"></label>
          <label style="grid-column:1/-1">Assunto / observações<input name="obs"></label>
        </div><button class="btn" type="submit">Salvar extra</button></form>
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
        ${resumoPausas(D)}
      </div>
      <h2>Desempenho por matéria</h2>
      <div class="card">${graficoAcertoDisc(M.discs)}</div>
      <div class="duas">
        <div class="card"><h3>Acerto por semana</h3>${graficoAcertoSemanas(semanas)}</div>
        <div class="card"><h3>Constância (últimas 16 semanas)</h3>${graficoConstancia(D, cfg.hoje)}</div>
      </div>
      <div class="card"><h3>Edital pintado por matéria</h3>${graficoEdital(M.discs, M.topicos)}</div>
      <div class="card"><h3>Horas líquidas por matéria</h3>${graficoHorasDisc(M.discs)}</div>
      <div class="linha" style="margin-top:10px"><button class="btn sec" data-acao="exportar">Exportar meta da semana + edital pintado (Excel)</button></div>
      <h2>${cfg.semana === 1 ? 'Cobrança — semana 1 (parcial; a cobrança real começa na semana 2)' : `Cobrança da semana ${ref}`}</h2>
      <div class="card tab-wrap"><table>
        ${linha('Horas', `${fmt1(s.horas)} h de ${fmt1(cfg.metaHorasSemana)} h`, s.horas >= 0.9 * cfg.metaHorasSemana, 'Dentro da meta', 'Abaixo da meta — recupere no próximo ciclo')}
        ${linha('Dias estudados', `${s.dias} de ${cfg.diasSemana}`, s.dias >= cfg.diasSemana, 'Constância ok', 'Faltaram dias — constância vem antes de volume')}
        ${linha('Páginas lidas', `${s.pags} de ~${Math.round(metaPag)}`, s.pags >= 0.8 * metaPag, 'Ritmo de leitura ok', 'Leitura abaixo do previsto — a previsão de término atrasa')}
        ${linha('Questões / acerto', `${s.q} | ${pct(s.acerto)}`, s.q >= 0.8 * metaQ, 'Volume de questões ok', `Poucas questões — meta ≈ ${Math.round(metaQ)}/semana`)}
        <tr><td>Rodízio</td><td>${fila ? 'Próxima da fila: ' + esc(fila.nome) : 'Fila vazia'}</td><td>${troca ? '► Disciplina do ciclo com 100% — troque pela próxima (Config)' : 'Ciclo atual em andamento'}</td></tr>
      </table></div>
      <h2>Por disciplina</h2>
      <div class="card tab-wrap"><table>
        <tr><th>Cód.</th><th>Disciplina</th><th>Grupo</th><th class="num">Págs</th><th>Cobertura</th><th class="num">Horas</th><th class="num">Questões</th><th class="num">% acerto</th><th class="num">Meta</th><th class="num">Batida</th><th>Previsão</th><th>Situação</th></tr>
        ${M.discs.map((d) => `<tr><td>${esc(d.cod)}</td><td>${esc(d.nome)}</td><td>${esc(d.grupo)}</td><td class="num">${d.pagsFeitas}/${d.pagsTeoria}</td>
          <td style="min-width:90px"><div class="barra"><i style="width:${Math.min(100, d.cobertura * 100)}%"></i></div><span class="small">${pct(d.cobertura)}</span></td>
          <td class="num">${fmt1(d.horas)}</td><td class="num">${d.questoes}</td><td class="num">${pct(d.acerto)}</td>
          <td class="num">${pct(d.meta)}</td><td class="num">${d.batidaMin ?? ''}</td><td>${br(d.previsao)}</td><td class="${clsStatus(d.situacao)}">${esc(d.situacao)}</td></tr>`).join('')}
      </table><p class="small muted">Previsão = páginas que faltam ÷ (2 sessões por semana × ${cfg.pagsSessao} págs por sessão). Só para disciplinas do ciclo.</p></div>
      <h2>Evolução semanal</h2>
      <div class="card">${graficoSemanas(semanas, cfg.metaHorasSemana)}
        <div class="tab-wrap"><table><tr><th>Semana</th><th>Início</th><th class="num">Horas</th><th class="num">Aderência</th><th class="num">Páginas</th><th class="num">Questões</th><th class="num">% acerto</th><th class="num">Dias</th></tr>
        ${[...semanas].reverse().map((w) => `<tr><td>${w.s}</td><td>${br(w.inicio)}</td><td class="num">${fmt1(w.horas)}</td><td class="num">${pct(w.horas / cfg.metaHorasSemana)}</td><td class="num">${w.pags}</td><td class="num">${w.q}</td><td class="num">${pct(w.acerto)}</td><td class="num">${w.dias}</td></tr>`).join('')}
        </table></div></div>
      ${historicoPorData()}`;
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
          <td>${a.incl ? `<button class="btn peq sec" data-acao="ja-estudei" data-id="${esc(a.id)}" title="Marcar como já estudada (conta uma batida)">já estudei</button> ` : ''}${botaoQC(a.qcIds, 'QC')}${a.link ? ` <a class="btn peq sec" target="_blank" rel="noopener" href="${esc(a.link)}">abrir</a>` : ''}</td></tr>`).join('')}
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
      <div class="linha entre" style="margin-bottom:8px">
        <div class="linha">${NIVEIS.slice(1).map((n, i) => `${chipNivel(i + 1)}`).join('')}
          <span class="small muted">${tops.length ? NIVEIS.map((n, i) => `${n.rot}: ${tops.filter((t) => t.nivel === i).length}`).join(' · ') : ''}</span></div>
        <button class="btn peq sec" data-acao="exportar">Exportar meta + edital (Excel)</button></div>
      <div class="card tab-wrap"><table>
        <tr><th>ID</th><th>Tópico</th><th>Inc.</th><th class="num">% cobr.</th><th>Aulas</th><th>Status</th><th>Nível</th><th>Editais</th><th>IDs QC</th><th></th></tr>
        ${tops.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.topico)}<div class="small muted">${esc(t.bloco)}</div></td><td>${esc(t.incidencia)}</td>
          <td class="num">${num(t.pct) !== null ? pct(num(t.pct), 1) : ''}</td>
          <td>${t.aulas.map((a) => `<span class="chip" title="${esc(a.titulo)}">${esc(a.aula)}</span>`).join('') || `<span class="small muted">${esc(t.onde_estudar)}</span>`}</td>
          <td class="${clsStatus(t.status)}">${esc(t.status)}</td>
          <td style="white-space:nowrap">${chipNivel(t.nivel)}
            <button class="btn peq sec" data-acao="reverso" data-id="${esc(t.id)}" title="Registrar estudo reverso (questões primeiro) deste tópico">+ reverso</button></td>
          <td><input class="ids" data-acao="top-editais" data-id="${esc(t.id)}" value="${esc(t.editais)}" style="min-width:140px"></td>
          <td><input class="ids" data-acao="top-qc" data-id="${esc(t.id)}" value="${esc(t.qc_subject_ids)}" style="min-width:110px"></td>
          <td>${botaoQC(t.qcIds, 'QC')}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nenhum tópico neste filtro.</td></tr>'}
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
      <p class="small muted">Grupo: A, B, Fila, Manutenção, Pausada ou Concluída. A e B alternam nos dias do ciclo. Manutenção e Concluída entram no rodízio de "Conteúdo extra / revisão" (a menos recente primeiro).</p>
      <div class="card tab-wrap"><table>
        <tr><th>Cód.</th><th>Disciplina</th><th>Grupo</th><th>Ordem</th><th>Meta</th><th>Batidas antes</th><th>Onde cai</th></tr>
        ${M.discs.map((d) => `<tr><td>${esc(d.cod)}</td><td>${esc(d.nome)}</td>
          <td><select data-acao="disc" data-campo="grupo" data-id="${esc(d.cod)}">${['A', 'B', 'Fila', 'Manutenção', 'Pausada', 'Concluída'].map((g) => `<option ${g === d.grupo ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
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

// Espaço "Conteúdo extra / questões" do dia: sugere a disciplina de manutenção estudada há mais tempo.
function cardExtra() {
  const { cfg } = M;
  if (cfg.tipoDia === 'DESCANSO') return '';
  const manut = M.discs.filter((d) => d.manut).sort((a, b) => (a.ultimo < b.ultimo ? -1 : a.ultimo > b.ultimo ? 1 : a.ordem - b.ordem));
  const hoje = M.diario.filter((r) => r.data === cfg.hoje && /-EXTRA$/.test(r.aula_id));
  const sug = manut[0];
  const q = cfg.tipoDia === 'REVISÃO' ? cfg.qRev : cfg.qFix;
  const txt = sug ? `${sug.nome} — ${q} questões${sug.ultimo ? ` (última vez: ${br(sug.ultimo)})` : ' (ainda sem registro)'}`
    : 'Nenhuma disciplina em Manutenção. Marque em Config as que já estudou para entrarem neste rodízio.';
  return `<div class="card"><div class="linha entre"><h3>${cfg.tipoDia === 'REVISÃO' ? 'Revisão de manutenção' : 'Conteúdo extra / questões'} <span class="small muted">(opcional)</span></h3>
      <span class="small muted">${manut.length} em manutenção</span></div>
    ${hoje.length ? hoje.map((r) => `<div class="acao feito">✔ Extra hoje: ${esc((M.discMap[r.cod] || {}).nome || r.cod)} · ${r.q ? `${r.ac}/${r.q} (${pct(r.ac / r.q)})` : ''} ${r.min ? `· ${r.min} min` : ''}</div>`).join('') : ''}
    <div class="acao">${sug ? '► ' : ''}${esc(txt)}</div>
    <div class="linha"><button class="btn peq" data-acao="registrar-extra" data-id="${esc(sug ? sug.cod : '')}">Registrar extra</button>
      ${sug ? botaoQC(sug.qcIds, 'Caderno QC da disciplina') : ''}</div></div>`;
}

// Bloco de vídeos: obs traz "V23 Título (0–44) | V24 ..."; devolve os vídeos que caem no trecho de minutos.
function videosNoTrecho(obs, ini, fim) {
  const vs = [...String(obs || '').matchAll(/V(\d+) ([^|]*?) \((\d+)–(\d+)\)/g)]
    .filter((m) => +m[4] >= ini && +m[3] < fim).map((m) => `V${m[1]} ${m[2]}`);
  return vs.length ? ` · ${vs.join(', ')}` : '';
}

// Nome do curso de origem a partir do link do Gran (código do curso na URL).
const CURSOS_GRAN = {
  'yzG90gOCk40=': 'SEFAZ-CE', 'qti8/5d3OKw=': 'Receita Federal', 'iDEf+zZRbFE=': 'SEFAZ-AL', 'r42jj7Zmlag=': 'ISS Caruaru',
  'RCO5GdOmXTE=': 'Gramática Completa (Elias Santana)', 'F9o6cvavlps=': 'SEFAZ-SE', 'SmYLqvcuGm0=': 'SEFAZ-SE', 'PFS+YydpceU=': 'SEFAZ-SE',
};
function cursoDaAula(a) {
  const m = String(a && a.link || '').match(/\/codigo\/([^/]+)\//);
  if (!m) return '';
  let c = m[1]; try { c = decodeURIComponent(c); } catch { /* mantém */ }
  return CURSOS_GRAN[c] ? `Gran · ${CURSOS_GRAN[c]}` : 'Gran';
}
function botaoAula(a) {
  if (!a || !a.link) return '';
  const curso = cursoDaAula(a);
  return `<a class="btn peq sec" target="_blank" rel="noopener" href="${esc(a.link)}" title="${esc(`${a.aula} — ${a.titulo}`)}">▶ Abrir aula${curso ? ` (${esc(curso.replace('Gran · ', ''))})` : ''}</a>`;
}

// Registros (aula ou estudo reverso) de uma disciplina dentro do bloco atual do ciclo.
function feitoNoBloco(cod) {
  const { cfg } = M;
  return (M.diario || []).filter((r) => r.semana === cfg.semana && r.diaCiclo === cfg.dia && r.data <= cfg.hoje && r.cod === cod
    && (cfg.posDe[cfg.chaveReg(r)] || {}).conta);
}

function cardDisciplina(d, n, pend) {
  const { cfg } = M;
  const tipoDia = pend ? pend.tipo : cfg.tipoDia;
  const fila = (M.fila[d.cod] || []).filter((a) => a.incl);
  const prox = fila[0];
  const semana = (M.fila[d.cod] || []).filter((a) => a.nestaSemana).sort((a, b) => a.idx - b.idx);
  // Registro desta disciplina no bloco atual do ciclo: o card mostra como cumprida em vez de pular para a próxima aula.
  // Vale o que foi registrado neste bloco, mesmo que ele tenha aberto em dias de calendário anteriores.
  const feitoHoje = tipoDia === 'DESCANSO' ? [] : feitoNoBloco(d.cod);
  const ultHoje = feitoHoje[feitoHoje.length - 1];
  const aulaHoje = ultHoje ? M.aulaMap[ultHoje.aula_id] : null;
  let acao;
  if (ultHoje) {
    const pags = ultHoje.pi !== null && ultHoje.pf !== null ? ` · ${aulaHoje ? aulaHoje.un : 'págs'} ${ultHoje.pi}–${ultHoje.pf}` : '';
    const q = ultHoje.q ? ` · ${ultHoje.ac}/${ultHoje.q} (${pct(ultHoje.ac / ultHoje.q)})` : '';
    acao = `✔ FEITO NESTE BLOCO${ultHoje.data < cfg.hoje ? ` (${br(ultHoje.data)})` : ''}: ${aulaHoje ? aulaHoje.aula : ultHoje.aula_id}${pags}${q}`;
  } else if (!fila.length) acao = '⚠ Curso desta disciplina ainda não mapeado (aba Material).';
  else if (tipoDia === 'REVISÃO') acao = `► ${pend ? 'PENDENTE' : 'HOJE'}: revisar os assuntos abaixo + ${cfg.qRev} questões, corrigindo o que errar`;
  else acao = `${pend ? '► PENDENTE: ' : tipoDia === 'DESCANSO' ? 'Próximo: ' : '► HOJE: '}${prox.aula} — ${prox.proxima}`;
  const rev = tipoDia === 'REVISÃO' ? assuntosParaRevisar(d.cod) : null;
  const qcIds = rev ? [...new Set(rev.itens.flatMap((x) => x.a.qcIds))]
    : aulaHoje ? aulaHoje.qcIds : prox ? prox.qcIds : [];
  const alvo = aulaHoje || prox;
  const ref = alvo && tipoDia !== 'REVISÃO' ? `<div class="small muted">📚 ${esc([cursoDaAula(alvo) || alvo.fonte, alvo.aula, alvo.titulo].filter(Boolean).join(' · '))}</div>` : '';
  const botoes = ultHoje && rev
    ? '<span class="small muted">Para revisar mais uma aula, use "Registrar" na linha dela.</span>'
    : ultHoje
    ? `${botaoAula(aulaHoje)}${prox ? `<span class="small muted">Próximo estudo: ${esc(prox.aula)} — ${esc(prox.proxima)}</span>
       <button class="btn peq sec" data-acao="registrar-aula" data-id="${esc(prox.id)}">Registrar outra</button>${prox !== aulaHoje ? botaoAula(prox) : ''}` : ''}`
    : rev ? (rev.itens[0] ? `<button class="btn peq" data-acao="registrar-revisao" data-id="${esc(rev.itens[0].a.id)}">Registrar revisão</button>` : '')
    : prox ? `${botaoAula(prox)}<button class="btn peq" data-acao="registrar-aula" data-id="${esc(prox.id)}">Registrar esta aula</button>
       <button class="btn peq sec" data-acao="ja-estudei" data-id="${esc(prox.id)}" title="Já estudei antes: conta como batida concluída e passa para a próxima">Já estudei</button>` : '';
  return `<div class="card">
    <div class="linha entre"><h3>${pend ? `⏳ ${esc(d.nome)} <span class="small st-bad">pendente de ${br(pend.data)}</span>` : `${n}. ${esc(d.nome)}`}</h3><span class="small muted">${cfg.minDisc} min · meta ${pct(d.meta)} · cobertura ${pct(d.cobertura)}</span></div>
    <div class="acao ${ultHoje ? 'feito' : ''}">${esc(acao)}</div>
    ${ref}
    <div class="linha">${botoes}
      ${botaoQC(qcIds, tipoDia === 'REVISÃO' ? 'Caderno QC da semana' : 'Caderno QC da aula')}</div>
    ${rev ? blocoRevisao(rev) : `<div class="duas" style="margin-top:10px">
      <div><div class="small muted">Fila de aulas (teoria)</div><table>${fila.slice(0, 4).map((a) => `<tr><td>${a.link ? `<a target="_blank" rel="noopener" href="${esc(a.link)}">${esc(a.aula)}</a>` : esc(a.aula)}</td><td>${esc(String(a.titulo).slice(0, 70))}${cursoDaAula(a) ? ` <span class="small muted">(${esc(cursoDaAula(a).replace('Gran · ', ''))})</span>` : ''}</td><td class="small ${clsStatus(a.status)}">${esc(a.status)} · faltam ${a.S} ${a.un}</td></tr>`).join('')}</table></div>
      <div><div class="small muted">Aulas desta semana (revisão)</div><table>${semana.map((a) => `<tr><td>${esc(a.aula)}</td><td>${esc(String(a.titulo).slice(0, 60))}</td><td class="num">${esc(a.pagsSemana)}</td><td class="num">${pct(a.W)}</td></tr>`).join('') || '<tr><td class="muted small">Nada ainda nesta semana.</td></tr>'}</table></div>
    </div>`}</div>`;
}

// Assuntos para revisar (dias de revisão): as aulas desta disciplina estudadas nos dias de TEORIA da semana
// atual do ciclo. Se não houve teoria dela nesta semana, mostra as últimas aulas estudadas.
function assuntosParaRevisar(cod) {
  const { cfg } = M;
  const daAula = (r) => r.cod === cod && M.aulaMap[r.aula_id] && ehSessao(r);
  let regs = M.diario.filter((r) => daAula(r) && r.semana === cfg.semana && r.diaCiclo <= cfg.dT && r.data <= cfg.hoje);
  let semanaAtual = true;
  if (!regs.length) {
    semanaAtual = false;
    const ult = [...new Set(M.diario.filter((r) => daAula(r) && r.data <= cfg.hoje && !(r.semana === cfg.semana && r.diaCiclo > cfg.dT)).map((r) => r.aula_id))].slice(-2);
    regs = M.diario.filter((r) => daAula(r) && ult.includes(r.aula_id) && !(r.semana === cfg.semana && r.diaCiclo > cfg.dT));
  }
  const porAula = {};
  regs.forEach((r) => {
    const x = porAula[r.aula_id] = porAula[r.aula_id] || { a: M.aulaMap[r.aula_id], pis: [], pfs: [], q: 0, ac: 0, datas: new Set(), obs: [] };
    if (r.pi !== null) x.pis.push(r.pi);
    if (r.pf !== null) x.pfs.push(r.pf);
    x.q += r.q; x.ac += r.ac; x.datas.add(r.data);
    const o = String(r.obs || '').replace(/\s*\|?\s*Pausas: \d+ \(\d+ min\)/, '').trim();
    if (o) x.obs.push(o);
  });
  // revisões já registradas nesta semana (dias de revisão), por aula
  const revisadas = new Set(M.diario.filter((r) => r.cod === cod && r.semana === cfg.semana && r.diaCiclo > cfg.dT && r.diaCiclo <= cfg.dT + cfg.dR).map((r) => r.aula_id));
  const itens = Object.values(porAula).sort((x, y) => x.a.idx - y.a.idx).map((x) => ({ ...x, revisada: revisadas.has(x.a.id) }));
  return { itens, semanaAtual };
}

function blocoRevisao(rev) {
  if (!rev.itens.length) return '<div class="acao" style="margin-top:10px">Nenhuma aula desta disciplina registrada ainda. Faça as questões da disciplina e registre como extra.</div>';
  const linhas = rev.itens.map((x) => {
    const a = x.a;
    const trecho = x.pis.length && x.pfs.length ? `${a.un} ${Math.min(...x.pis)}–${Math.max(...x.pfs)}` : '';
    const tops = a.topicosIds.map((t) => M.topMap[t]).filter(Boolean);
    return `<tr><td>${x.revisada ? '✔ ' : ''}<b>${esc(a.aula)}</b><div class="small muted">${[...x.datas].sort().map(br).join(', ')}</div></td>
      <td>${esc(a.titulo)}${tops.length ? `<div class="small muted">Edital: ${tops.map((t) => esc(t.topico)).join(' · ')}</div>` : ''}${x.obs.length ? `<div class="small">📝 ${esc(x.obs.join(' · '))}</div>` : ''}</td>
      <td class="num small">${esc(trecho)}</td><td class="num small">${x.q ? `${x.ac}/${x.q} · ${pct(x.ac / x.q)}` : '—'}</td>
      <td>${botaoAula(a)} <button class="btn peq sec" data-acao="registrar-revisao" data-id="${esc(a.id)}">Registrar</button></td></tr>`;
  }).join('');
  return `<div style="margin-top:10px"><div class="small muted">${rev.semanaAtual ? 'O que revisar — assuntos estudados nos dias de teoria desta semana' : 'Nada desta disciplina na teoria desta semana — revise as últimas aulas estudadas'}</div>
    <div class="tab-wrap"><table><tr><th>Aula</th><th>Assunto</th><th class="num">Trecho visto</th><th class="num">Questões</th><th></th></tr>${linhas}</table></div></div>`;
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

// ---------- gráficos de evolução (SVG inline, sem bibliotecas) ----------
const W_G = 640;
const escTxt = (s, n) => esc(String(s).length > n ? String(s).slice(0, n - 1) + '…' : s);

// Barras horizontais: linhas [{rot, v (0–1 ou valor), max, cor, dir, tip, marca}]
function barrasH(linhas, { lab = 190, alt = 22, fmt = (v) => v, max } = {}) {
  if (!linhas.length) return '<p class="small muted">Sem dados ainda.</p>';
  const H = linhas.length * alt + 8, x0 = lab, w = W_G - lab - 90;
  const mx = max ?? Math.max(...linhas.map((l) => l.v), 1e-9);
  const els = linhas.map((l, i) => {
    const y = 4 + i * alt, bw = Math.max(1, (l.v / mx) * w);
    const marca = l.marca !== undefined ? `<line x1="${x0 + (l.marca / mx) * w}" x2="${x0 + (l.marca / mx) * w}" y1="${y + 1}" y2="${y + alt - 5}" stroke="var(--tx)" stroke-width="2"/>` : '';
    return `<g><title>${esc(l.tip || '')}</title><text x="${x0 - 6}" y="${y + alt / 2 + 3}" text-anchor="end">${escTxt(l.rot, 28)}</text>
      <rect x="${x0}" y="${y + 3}" width="${w}" height="${alt - 9}" rx="3" fill="var(--chip)"/>
      <rect x="${x0}" y="${y + 3}" width="${bw}" height="${alt - 9}" rx="3" fill="${l.cor || 'var(--bar)'}"/>${marca}
      <text x="${x0 + w + 6}" y="${y + alt / 2 + 3}">${esc(l.dir ?? fmt(l.v))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W_G} ${H}" width="100%" class="g" role="img">${els}</svg>`;
}

// % de acerto por disciplina x meta (inclui histórico importado do Gran/QC)
function graficoAcertoDisc(discs) {
  const l = discs.filter((d) => d.questoes > 0).sort((a, b) => a.acerto - b.acerto).map((d) => ({
    rot: d.nome, v: d.acerto, marca: d.meta, cor: d.acerto < d.meta ? 'var(--bad)' : 'var(--ok)',
    dir: `${pct(d.acerto)} · ${d.questoes} q`, tip: `${d.nome}: ${pct(d.acerto)} em ${d.questoes} questões (meta ${pct(d.meta)})`,
  }));
  return `<div class="small muted">Vermelho = abaixo da meta (traço preto). Ordenado do pior para o melhor.</div>${barrasH(l, { max: 1 })}`;
}

// Horas líquidas por disciplina (do Diário)
function graficoHorasDisc(discs) {
  const tot = discs.reduce((s, d) => s + d.horas, 0);
  const l = discs.filter((d) => d.horas > 0).sort((a, b) => b.horas - a.horas)
    .map((d) => ({ rot: d.nome, v: d.horas, dir: `${fmt1(d.horas)} h · ${pct(d.horas / tot)}`, tip: `${d.nome}: ${fmt1(d.horas)} h` }));
  return barrasH(l);
}

// Edital pintado: distribuição dos tópicos por nível, por disciplina
function graficoEdital(discs, topicos) {
  const ds = discs.filter((d) => d.grupo !== 'Pausada').map((d) => ({ d, ts: topicos.filter((t) => t.cod === d.cod) })).filter((x) => x.ts.length);
  if (!ds.length) return '<p class="small muted">Sem tópicos cadastrados.</p>';
  const lab = 190, alt = 22, w = W_G - lab - 70, H = ds.length * alt + 8;
  const els = ds.map(({ d, ts }, i) => {
    const y = 4 + i * alt; let x = lab;
    const segs = NIVEIS.map((n, k) => {
      const c = ts.filter((t) => t.nivel === k).length; if (!c) return '';
      const sw = (c / ts.length) * w, r = `<rect x="${x}" y="${y + 3}" width="${sw}" height="${alt - 9}" fill="${n.cor || 'var(--chip)'}"><title>${esc(`${d.nome} — ${n.rot}: ${c} de ${ts.length}`)}</title></rect>`;
      x += sw; return r;
    }).join('');
    const lidos = ts.filter((t) => t.nivel > 0).length;
    return `<text x="${lab - 6}" y="${y + alt / 2 + 3}" text-anchor="end">${escTxt(d.nome, 28)}</text>${segs}<text x="${lab + w + 6}" y="${y + alt / 2 + 3}">${pct(lidos / ts.length)}</text>`;
  }).join('');
  const leg = NIVEIS.map((n) => `<span class="chip" style="background:${n.cor || 'var(--chip)'};color:${n.tx || 'var(--tx)'}">${esc(n.rot)}</span>`).join(' ');
  return `<div class="small muted">% à direita = tópicos com ao menos 1 leitura.</div><svg viewBox="0 0 ${W_G} ${H}" width="100%" class="g" role="img">${els}</svg><div>${leg}</div>`;
}

// % de acerto e questões por semana do ciclo
function graficoAcertoSemanas(semanas) {
  const ult = semanas.slice(-12);
  if (!ult.some((s) => s.q)) return '<p class="small muted">Sem questões registradas nas semanas do ciclo.</p>';
  const H = 170, pad = 28, bw = (W_G - pad * 2) / ult.length, maxQ = Math.max(...ult.map((s) => s.q), 1);
  const y = (v) => H - 20 - v * (H - 40);
  const bars = ult.map((s, i) => `<rect x="${pad + i * bw + bw * 0.25}" y="${y(s.q / maxQ)}" width="${bw * 0.5}" height="${H - 20 - y(s.q / maxQ)}" rx="2" fill="var(--bar2)"><title>Semana ${s.s}: ${s.q} questões</title></rect>
    <text x="${pad + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">S${s.s}</text>`).join('');
  const pts = ult.map((s, i) => (s.q ? [pad + i * bw + bw / 2, y(s.acerto), s] : null)).filter(Boolean);
  const linha = pts.length > 1 ? `<polyline fill="none" stroke="var(--pri)" stroke-width="2" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}"/>` : '';
  const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--pri)"><title>Semana ${p[2].s}: ${pct(p[2].acerto)} em ${p[2].q} questões</title></circle><text x="${p[0]}" y="${p[1] - 8}" text-anchor="middle">${pct(p[2].acerto)}</text>`).join('');
  return `<div class="small muted">Linha = % de acerto · barras = nº de questões · tracejado = 70%</div>
    <svg viewBox="0 0 ${W_G} ${H}" width="100%" class="g" role="img">${bars}<line x1="${pad}" x2="${W_G - pad}" y1="${y(0.7)}" y2="${y(0.7)}" stroke="var(--warn)" stroke-dasharray="4 3"/>${linha}${dots}</svg>`;
}

// Constância: minutos estudados por dia nas últimas 16 semanas (mapa de calor)
function graficoConstancia(diario, hoje) {
  const porDia = {};
  diario.filter((r) => !/-HIST$/.test(String(r.aula_id))).forEach((r) => { porDia[r.data] = (porDia[r.data] || 0) + r.min; });
  const semanasN = 16, cel = 14, gap = 3, x0 = 30, y0 = 16;
  const fim = hoje, ini = addDias(fim, -(semanasN * 7 - 1));
  // alinha o início numa segunda-feira
  const dow = (s) => (new Date(toUTC(s)).getUTCDay() + 6) % 7;
  const ini2 = addDias(ini, -dow(ini));
  const tot = dias(ini2, fim) + 1, cols = Math.ceil(tot / 7);
  let cells = '', estudados = 0;
  for (let k = 0; k < tot; k++) {
    const d = addDias(ini2, k), m = porDia[d] || 0, c = Math.floor(k / 7), r = k % 7;
    if (m) estudados++;
    const op = !m ? 0 : m < 60 ? 0.3 : m < 120 ? 0.55 : m < 180 ? 0.8 : 1;
    cells += `<rect x="${x0 + c * (cel + gap)}" y="${y0 + r * (cel + gap)}" width="${cel}" height="${cel}" rx="3" fill="${m ? 'var(--ok)' : 'var(--chip)'}" fill-opacity="${m ? op : 1}"><title>${br(d)}: ${m} min</title></rect>`;
  }
  const rot = ['seg', '', 'qua', '', 'sex', '', 'dom'].map((t, r) => (t ? `<text x="0" y="${y0 + r * (cel + gap) + 11}">${t}</text>` : '')).join('');
  const W = x0 + cols * (cel + gap), H = y0 + 7 * (cel + gap);
  return `<div class="small muted">${estudados} de ${tot} dias com estudo · mais escuro = mais minutos (até 1 h, 2 h, 3 h, 3 h+)</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W * 1.6}px" role="img">${rot}${cells}</svg>`;
}

// ---------- histórico por data (monitoramento, independente do ciclo) ----------
// Período escolhido no Painel; padrão: últimos 30 dias. Compara com o período anterior de mesmo tamanho.
const PERIODOS = { 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias', mes: 'Este mês', tudo: 'Tudo' };
function periodoHist() {
  const { cfg } = M;
  const p = filtros.histPer || '30';
  if (p === 'custom' && filtros.histIni && filtros.histFim) return { ini: filtros.histIni <= filtros.histFim ? filtros.histIni : filtros.histFim, fim: filtros.histIni <= filtros.histFim ? filtros.histFim : filtros.histIni, p };
  if (p === 'mes') return { ini: cfg.hoje.slice(0, 8) + '01', fim: cfg.hoje, p };
  if (p === 'tudo') {
    const datas = M.diario.map((r) => r.data).filter(Boolean).sort();
    return { ini: datas[0] && datas[0] < cfg.inicio ? datas[0] : cfg.inicio, fim: cfg.hoje, p };
  }
  const n = Number(p) || 30;
  return { ini: addDias(cfg.hoje, -(n - 1)), fim: cfg.hoje, p: String(n) };
}

// Só sessões reais de estudo (fica de fora histórico importado e aula marcada como "já estudei").
const ehSessao = (r) => !/-HIST$/.test(String(r.aula_id)) && !String(r.uid || '').startsWith('visto-') && r.obs !== 'Marcada como já estudada';

function resumoPeriodo(ini, fim) {
  const rs = M.diario.filter((r) => ehSessao(r) && r.data >= ini && r.data <= fim);
  const q = rs.reduce((s, r) => s + r.q, 0), ac = rs.reduce((s, r) => s + r.ac, 0);
  const datas = new Set(rs.map((r) => r.data));
  const min = rs.reduce((s, r) => s + r.min, 0);
  return {
    rs, dias: datas.size, total: dias(ini, fim) + 1, horas: min / 60, mediaDia: datas.size ? min / 60 / datas.size : 0,
    discs: new Set(rs.map((r) => r.cod)).size, sessoes: rs.length, pags: rs.reduce((s, r) => s + r.paginas, 0), q, ac, acerto: q ? ac / q : null,
    blocos: M.cfg.fechados.filter((f) => f.data >= ini && f.data <= fim).length,
  };
}

function historicoPorData() {
  const { cfg } = M;
  const { ini, fim, p } = periodoHist();
  const n = dias(ini, fim) + 1;
  const A = resumoPeriodo(ini, fim);
  const B = resumoPeriodo(addDias(ini, -n), addDias(ini, -1));
  const nome = (cod) => (M.discMap[cod] || {}).nome || cod;
  // variação em relação ao período anterior
  const delta = (a, b, fmt, ehPct) => {
    if (a === null || b === null || (!ehPct && !b && !a)) return '';
    const d = a - b;
    if (Math.abs(d) < 1e-9) return '<div class="small muted">= anterior</div>';
    return `<div class="small ${d > 0 ? 'st-ok' : 'st-bad'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs anterior</div>`;
  };
  const pp = (v) => `${(v * 100).toFixed(0)} p.p.`;
  const kpi = (rot, val, dl) => `<div class="kpi"><div class="l">${rot}</div><div class="v">${val}</div>${dl}</div>`;
  const semana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const dow = (s) => semana[new Date(toUTC(s)).getUTCDay()];
  const rotBloco = (f) => `${f.dia}${cfg.tipoDe(f.dia) === 'REVISÃO' ? 'R' : ''}${cfg.grupoDe(f.dia)}`;

  // por data (mais recente primeiro)
  const porData = {};
  A.rs.forEach((r) => { (porData[r.data] = porData[r.data] || []).push(r); });
  const linhasData = Object.keys(porData).sort().reverse().map((d) => {
    const rs = porData[d];
    const q = rs.reduce((s, r) => s + r.q, 0), ac = rs.reduce((s, r) => s + r.ac, 0);
    const cods = [...new Set(rs.map((r) => r.cod))];
    const blocos = cfg.fechados.filter((f) => f.data === d);
    return `<tr><td>${br(d)} <span class="small muted">${dow(d)}</span></td>
      <td class="small">${cods.map((c) => `<span class="chip" title="${esc(nome(c))}">${esc(c)}</span>`).join(' ')}</td>
      <td class="num">${cods.length}</td><td class="num">${rs.length}</td><td class="num">${fmt1(rs.reduce((s, r) => s + r.min, 0) / 60)}</td>
      <td class="num">${rs.reduce((s, r) => s + r.paginas, 0) || ''}</td><td class="num">${q || ''}</td><td class="num">${q ? pct(ac / q) : ''}</td>
      <td class="small">${blocos.map((f) => `<span class="chip" title="Semana ${f.semana}, dia ${f.dia} do ciclo">${rotBloco(f)}</span>`).join(' ')}</td></tr>`;
  }).join('');

  // por disciplina no período
  const porDisc = {};
  A.rs.forEach((r) => { const x = porDisc[r.cod] = porDisc[r.cod] || { min: 0, s: 0, q: 0, ac: 0, pags: 0, dias: new Set() }; x.min += r.min; x.s++; x.q += r.q; x.ac += r.ac; x.pags += r.paginas; x.dias.add(r.data); });
  const linhasDisc = Object.entries(porDisc).sort((a, b) => b[1].min - a[1].min).map(([c, x]) => `<tr><td>${esc(nome(c))}</td><td class="num">${x.dias.size}</td><td class="num">${x.s}</td>
    <td class="num">${fmt1(x.min / 60)}</td><td class="num">${x.pags || ''}</td><td class="num">${x.q || ''}</td><td class="num">${x.q ? pct(x.ac / x.q) : ''}</td></tr>`).join('');

  return `
    <h2>Histórico por data</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">Monitoramento do que você estudou em cada data, separado do ciclo. Escolha o período; os números comparam com o período anterior do mesmo tamanho (${br(addDias(ini, -n))} a ${br(addDias(ini, -1))}).</p>
      <div class="linha">
        ${Object.entries(PERIODOS).map(([k, t]) => `<button class="btn peq ${p === k ? '' : 'sec'}" data-acao="hist-periodo" data-id="${k}">${t}</button>`).join('')}
        <label class="small">De <input type="date" id="histIni" value="${ini}"></label>
        <label class="small">Até <input type="date" id="histFim" value="${fim}"></label>
      </div>
    </div>
    <div class="grid">
      ${kpi('Dias com estudo', `${A.dias} de ${A.total}`, delta(A.dias, B.dias, (v) => `${v} dia(s)`))}
      ${kpi('Horas líquidas', fmt1(A.horas), delta(A.horas, B.horas, (v) => `${fmt1(v)} h`))}
      ${kpi('Média por dia estudado', `${fmt1(A.mediaDia)} h`, delta(A.mediaDia, B.mediaDia, (v) => `${fmt1(v)} h`))}
      ${kpi('Disciplinas estudadas', A.discs, delta(A.discs, B.discs, (v) => v))}
      ${kpi('Sessões registradas', A.sessoes, delta(A.sessoes, B.sessoes, (v) => v))}
      ${kpi('Blocos do ciclo concluídos', A.blocos, delta(A.blocos, B.blocos, (v) => v))}
      ${kpi('Páginas', A.pags, delta(A.pags, B.pags, (v) => v))}
      ${kpi('Questões · acerto', `${A.q} · ${pct(A.acerto)}`, delta(A.acerto, B.acerto, pp, true))}
    </div>
    <div class="card tab-wrap"><h3>Por disciplina no período</h3><table>
      <tr><th>Disciplina</th><th class="num">Dias</th><th class="num">Sessões</th><th class="num">Horas</th><th class="num">Páginas</th><th class="num">Questões</th><th class="num">% acerto</th></tr>
      ${linhasDisc || '<tr><td colspan="7" class="muted">Nenhum estudo no período.</td></tr>'}
    </table></div>
    <div class="card tab-wrap"><h3>Dia a dia</h3><table>
      <tr><th>Data</th><th>Disciplinas</th><th class="num">Qtde</th><th class="num">Sessões</th><th class="num">Horas</th><th class="num">Páginas</th><th class="num">Questões</th><th class="num">% acerto</th><th>Blocos fechados</th></tr>
      ${linhasData || '<tr><td colspan="9" class="muted">Nenhum estudo no período.</td></tr>'}
    </table><p class="small muted">Só aparecem as datas com estudo. Blocos fechados: dia do ciclo + grupo (ex.: 1A = teoria do Grupo A; 5RA = revisão do Grupo A).</p></div>`;
}

// Pausas registradas pelo cronômetro (campo obs "Pausas: n (x min)")
function resumoPausas(diario) {
  const rs = diario.map((r) => ({ r, m: String(r.obs || '').match(/Pausas: (\d+) \((\d+) min\)/) })).filter((x) => x.m);
  if (!rs.length) return '';
  const liq = rs.reduce((s, x) => s + x.r.min, 0), pau = rs.reduce((s, x) => s + +x.m[2], 0), n = rs.reduce((s, x) => s + +x.m[1], 0);
  return `<div class="kpi"><div class="l">Pausas (${rs.length} sessões cronometradas)</div><div class="v">${fmt1(n / rs.length)} / sessão</div>
    <div class="small muted">${Math.round(pau / Math.max(1, n))} min por pausa · tempo líquido ${pct(liq / Math.max(1, liq + pau))}</div></div>`;
}

// ---------- cronômetro ----------
// Monitor de pausas: tempo líquido (só estudando) x tempo em pausa. Avisa no fim do bloco e quando a pausa passa do limite.
const PAUSA_MAX_MIN = 10;
const hms = (ms) => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':'); };
const cron = {
  st: { inicio: null, acumulado: 0, pausaIni: null, pausas: 0, pausado: 0, avBloco: false, avPausa: false, ...LS.get('cron', {}) },
  ms() { return this.st.acumulado + (this.st.inicio ? Date.now() - this.st.inicio : 0); },
  pausaAtual() { return this.st.pausaIni ? Date.now() - this.st.pausaIni : 0; },
  pausaMs() { return this.st.pausado + this.pausaAtual(); },
  salvar() { LS.set('cron', this.st); },
  alternar() {
    const st = this.st, agora = Date.now();
    if (st.inicio) { st.acumulado = this.ms(); st.inicio = null; st.pausaIni = agora; st.pausas++; }
    else { if (st.pausaIni) { st.pausado += agora - st.pausaIni; st.pausaIni = null; } st.inicio = agora; st.avPausa = false; }
    this.salvar(); this.pintar();
  },
  zerar() { this.st = { inicio: null, acumulado: 0, pausaIni: null, pausas: 0, pausado: 0, avBloco: false, avPausa: false }; this.salvar(); this.pintar(); },
  resumo() { return this.st.pausas ? `Pausas: ${this.st.pausas} (${Math.round(this.pausaMs() / 60000)} min)` : ''; },
  pintar() {
    const st = this.st, liq = this.ms(), bloco = ((M && M.cfg && M.cfg.minDisc) || 90) * 60000;
    // Avisos (mesmo fora da tela de registro)
    if (st.inicio && liq >= bloco && !st.avBloco) { st.avBloco = true; this.salvar(); toast(`Bloco de ${Math.round(bloco / 60000)} min líquidos concluído — faça a pausa (água, banheiro, alongar).`); }
    if (st.pausaIni && this.pausaAtual() >= PAUSA_MAX_MIN * 60000 && !st.avPausa) { st.avPausa = true; this.salvar(); toast(`A pausa passou de ${PAUSA_MAX_MIN} min — hora de voltar.`); }
    const el = $('#cron'); if (!el) return;
    el.textContent = hms(liq);
    const b = $('#btnCron'); if (b) b.textContent = st.inicio ? 'Pausar' : liq ? 'Continuar' : 'Iniciar';
    const p = $('#cronPausa');
    if (p) {
      const pa = this.pausaAtual(), longa = pa >= PAUSA_MAX_MIN * 60000;
      p.innerHTML = st.pausaIni ? `<span class="${longa ? 'st-bad' : 'st-warn'}">⏸ Em pausa há ${hms(pa).slice(3)}${longa ? ' — volte!' : ''}</span>` : st.inicio ? '<span class="st-ok">● Estudando</span>' : '';
    }
    const inf = $('#cronInfo');
    if (inf) {
      const tot = liq + this.pausaMs(), ef = tot ? liq / tot : null;
      inf.innerHTML = `<div class="barra" title="Bloco: ${Math.round(liq / 60000)} de ${Math.round(bloco / 60000)} min"><i style="width:${Math.min(100, (liq / bloco) * 100)}%"></i></div>
        <div class="small muted" style="margin-top:4px">Bloco ${Math.round(liq / 60000)}/${Math.round(bloco / 60000)} min · ${st.pausas} pausa(s) · ${Math.round(this.pausaMs() / 60000)} min pausado · tempo líquido ${pct(ef)}</div>`;
    }
  },
};
setInterval(() => cron.pintar(), 1000);

let preAula = null;
let preExtra = null;
let preRevisao = false;
function ligarRegistro() {
  cron.pintar();
  const fx = $('#fExtra');
  if (fx) {
    if (preExtra !== null) { $('#cardExtra').scrollIntoView({ block: 'start' }); preExtra = null; }
    fx.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(fx).entries());
      const q = num(v.questoes), ac = num(v.acertos);
      if (q !== null && ac !== null && ac > q) { toast('Acertos maior que questões.'); return; }
      store.gravar('Diario', [{ uid: uid(), data: v.data, aula_id: `${v.cod}-EXTRA`, pag_ini: '', pag_fim: '', minutos: num(v.minutos) ?? '',
        questoes: q ?? '', acertos: ac ?? '', terminei: '', obs: `Extra${v.obs ? ': ' + v.obs : ''}`, criado_em: new Date().toISOString() }]);
      toast('Extra registrado.');
    });
  }
  const f = $('#fReg'); if (!f) return;
  const sel = f.aula_id;
  const sugerida = preAula || (() => {
    const doBloco = M.discs.filter((x) => x.grupo === M.cfg.grupo && x.seq).slice(0, M.cfg.maxDisc);
    const d = doBloco.find((x) => !feitoNoBloco(x.cod).length) || doBloco[0];
    const l = d ? (M.fila[d.cod] || []).filter((a) => a.incl) : [];
    return l[0] ? l[0].id : null;
  })();
  if (sugerida) sel.value = sugerida;
  preAula = null;
  const info = () => {
    const a = M.aulaMap[sel.value];
    if (!a) return;
    $('#regInfo').textContent = a.video
      ? `${a.status} · videoaula: nos campos de página use os MINUTOS do vídeo (${a.G}–${a.H}) · próximo min ${a.R} · sugestão: ${a.proxima}`
      : `${a.status} · teoria págs ${a.G}–${a.H} · próxima pág. ${a.R} · sugestão: ${a.proxima}`;
    f.pag_ini.value = a.R;
    f.pag_fim.value = Math.min(a.H, a.R + a.sess - 1);
  };
  sel.addEventListener('change', info); info();
  if (preRevisao || M.cfg.tipoDia === 'REVISÃO') {
    // Revisão: não avança páginas da aula (campos de página vazios); conta questões e tempo.
    const limpar = () => { f.pag_ini.value = ''; f.pag_fim.value = ''; if (!f.obs.value) f.obs.value = 'Revisão'; };
    limpar(); sel.addEventListener('change', limpar);
    $('#regInfo').textContent = 'Revisão: deixe as páginas em branco (não avança a aula). Informe minutos, questões e acertos.';
  }
  preRevisao = false;
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

// Aula estudada fora do app: grava no Diário uma batida concluída (sem páginas, minutos ou questões).
function marcarEstudada(id) {
  const a = M.aulaMap[id];
  if (!a) return;
  const sug = addDias(M.cfg.hoje, -7);
  const r = prompt(`Marcar "${a.aula} — ${a.titulo}" como já estudada.\nData em que estudou (dd/mm/aaaa):`, br(sug));
  if (r === null) return;
  const m = r.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) { toast('Data inválida. Use dd/mm/aaaa.'); return; }
  const data = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  store.gravar('Diario', [{ uid: uid(), data, aula_id: id, pag_ini: '', pag_fim: '', minutos: '', questoes: '', acertos: '',
    terminei: 'S', obs: 'Marcada como já estudada', criado_em: new Date().toISOString() }]);
  toast(`${a.aula} marcada como estudada.`);
}

// Estudo reverso: questões primeiro sobre um tópico do edital (gravado no Diário com aula_id = "<tópico>-REV").
function registrarReverso(tid) {
  const t = M.topMap[tid];
  if (!t) return;
  const r = prompt(`Estudo reverso — ${t.id} ${t.topico}\nInforme: questões acertos minutos (ex.: 30 24 60)`, `${M.cfg.qRev} `);
  if (r === null) return;
  const [q, ac, min] = r.trim().split(/[\s,;]+/).map((x) => num(x));
  if (q === null || q === undefined || ac === null || ac === undefined || ac > q) { toast('Informe questões e acertos (acertos ≤ questões).'); return; }
  store.gravar('Diario', [{ uid: uid(), data: M.cfg.hoje, aula_id: `${t.id}-REV`, pag_ini: '', pag_fim: '', minutos: min ?? '', questoes: q, acertos: ac,
    terminei: 'S', obs: `Estudo reverso (${t.reversos + 1}º)`, criado_em: new Date().toISOString() }]);
  toast(`${t.reversos + 1}º estudo reverso registrado.`);
}

// Exporta a meta da semana e o edital pintado no formato das planilhas do Método 4.2 (abre no Excel).
function exportarMeta() {
  const { cfg } = M;
  const s = cfg.semana;
  const ini = cfg.semIni[s] || addDias(cfg.inicio, (s - 1) * 7);
  const td = (v, st = '') => `<td style="border:1px solid #999;${st}">${esc(v ?? '')}</td>`;
  const th = (v) => `<th style="border:1px solid #999;background:#1f5f8b;color:#fff">${esc(v)}</th>`;
  let linhas = '';
  // Os 7 dias (blocos) desta semana do ciclo; a data de cada linha é a do registro (um bloco pode levar
  // mais de um dia de calendário, e um dia de calendário pode fechar mais de um bloco).
  for (let dia = 1; dia <= 7; dia++) {
    const tipo = cfg.tipoDe(dia);
    const g = cfg.grupoDe(dia);
    const ord = tipo === 'TEORIA' ? g : tipo === 'REVISÃO' ? 'R' + g.toLowerCase() : 'Descanso';
    const regs = M.diario.filter((r) => r.semana === s && r.diaCiclo === dia && cfg.posDe[cfg.chaveReg(r)]);
    const data = dia === 7 && cfg.descansoEm && cfg.semana === s ? cfg.descansoEm : regs.length ? regs[0].data : '';
    const plan = tipo === 'DESCANSO' ? [] : M.discs.filter((d) => d.grupo === g && d.seq).slice(0, cfg.maxDisc);
    const usados = new Set();
    const linha = (rot, disc, r) => {
      if (r) usados.add(r);
      const a = r && M.aulaMap[r.aula_id];
      const assunto = !r ? (tipo === 'REVISÃO' ? `Fazer ${cfg.qRev} questões e revisar o que errar` : '')
        : a ? `${a.titulo}${r.obs ? ' — ' + r.obs : ''}` : /-REV$/.test(r.aula_id) && M.topMap[r.aula_id.slice(0, -4)]
          ? `${M.topMap[r.aula_id.slice(0, -4)].topico} — ${r.obs}` : r.obs;
      return `<tr>${td(br(r ? r.data : data))}${td(ord)}${td(rot)}${td(disc)}${td(cfg.minDisc)}${td(a ? a.aula : '')}${td(assunto)}
        ${td(r && r.paginas ? r.paginas : '')}${td(r && r.min ? r.min : '')}${td(r && r.q ? r.q : '')}${td(r && r.q ? r.ac : '')}${td(r && r.q ? pct(r.ac / r.q) : '')}</tr>`;
    };
    if (tipo === 'DESCANSO' && !regs.length) { linhas += `<tr>${td(br(data))}${td(ord)}${td('')}${td('Descanso')}${td('')}${td('')}${td('')}${td('')}${td('')}${td('')}${td('')}${td('')}</tr>`; continue; }
    plan.forEach((d) => {
      const rs = regs.filter((r) => r.cod === d.cod && M.aulaMap[r.aula_id]);
      if (!rs.length) linhas += linha(`${d.nome} + ${tipo === 'REVISÃO' ? cfg.qRev : cfg.qFix} questões`, d.nome, null);
      rs.forEach((r) => { linhas += linha(`${d.nome} + ${tipo === 'REVISÃO' ? cfg.qRev : cfg.qFix} questões`, d.nome, r); });
    });
    regs.filter((r) => !usados.has(r)).forEach((r) => {
      const nome = (M.discMap[r.cod] || {}).nome || r.cod;
      const rot = /-EXTRA$/.test(r.aula_id) ? 'Conteúdo extra/questões' : /-REV$/.test(r.aula_id) ? 'Estudo reverso' : 'Fora do ciclo do dia';
      linhas += linha(rot, nome, r);
    });
  }
  const tops = M.topicos.filter((t) => (M.discMap[t.cod] || {}).grupo !== 'Pausada');
  const ed = tops.map((t) => `<tr>${td((M.discMap[t.cod] || {}).nome || t.cod)}${td(t.id)}${td(t.topico)}
    ${td(NIVEIS[t.nivel].rot, t.nivel ? `background:${NIVEIS[t.nivel].cor};color:${NIVEIS[t.nivel].tx}` : '')}${td(t.leituras)}${td(t.reversos)}${td(t.editaisIds.join(' '))}</tr>`).join('');
  const legenda = NIVEIS.slice(1).map((n) => td(n.rot, `background:${n.cor};color:${n.tx};font-weight:bold`)).join('');
  const html = `<html><head><meta charset="utf-8"></head><body>
    <h2>CICLO DE ESTUDOS - META ${String(s).padStart(2, '0')}</h2>
    <p>Semana ${s}: ${br(ini)} a ${br(addDias(ini, 6))} · ${fmt1(cfg.horasDia)} h/dia · blocos de ${cfg.minDisc} min</p>
    <table><tr>${['Data', 'Ord', 'Disciplina (meta)', 'Disciplina', 'CH (min)', 'Aula / vídeo', 'Assunto visto', 'Páginas', 'Minutos', 'Qtde questões', 'Qtde acertos', '% acerto'].map(th).join('')}</tr>${linhas}</table>
    <br><h2>CONTEÚDO PROGRAMÁTICO (edital pintado)</h2>
    <table><tr>${legenda}</tr></table><br>
    <table><tr>${['Disciplina', 'ID', 'Tópico', 'Nível', 'Leituras', 'Estudos reversos', 'Editais'].map(th).join('')}</tr>${ed}</table>
    </body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Meta ${String(s).padStart(2, '0')} - semana de ${br(ini).replace(/\//g, '-')}.xls`;
  link.click();
  toast('Meta exportada.');
}

async function importarPacote(arquivo) {
  const ABAS = ['Config', 'Disciplinas', 'Aulas', 'Topicos', 'Editais', 'Bancas', 'Diario'];
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
  else if (a === 'cron-usar') {
    const f = $('#fReg');
    if (f) {
      f.minutos.value = Math.round(cron.ms() / 60000);
      const r = cron.resumo();
      if (r && f.obs && !/Pausas: /.test(f.obs.value)) f.obs.value = [f.obs.value, r].filter(Boolean).join(' | ');
    }
  }
  else if (a === 'registrar-aula') { preAula = id; view = 'registrar'; LS.set('view', view); render(); }
  else if (a === 'registrar-revisao') { preAula = id; preRevisao = true; view = 'registrar'; LS.set('view', view); render(); }
  else if (a === 'ja-estudei') marcarEstudada(id);
  else if (a === 'registrar-extra') { preExtra = id || ''; view = 'registrar'; LS.set('view', view); render(); }
  else if (a === 'reverso') registrarReverso(id);
  else if (a === 'exportar') exportarMeta();
  else if (a === 'hist-periodo') { filtros.histPer = id; LS.set('filtros', filtros); render(); }
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
  if (el.id === 'histIni' || el.id === 'histFim') {
    const atual = periodoHist();
    filtros.histIni = el.id === 'histIni' ? el.value || atual.ini : atual.ini;
    filtros.histFim = el.id === 'histFim' ? el.value || atual.fim : atual.fim;
    filtros.histPer = 'custom'; LS.set('filtros', filtros); render(); return;
  }
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
