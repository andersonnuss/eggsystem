// Gráfico da produção (ex.: quantidade de ovos) nos últimos 7 dias, 30 dias, 6 meses e 1 ano
const express = require('express');
const { db } = require('../db');
const { produtosAtivos } = require('../consultas');
const { hoje, unidadeProducao } = require('../util');
const { falarQuantidade } = require('../alexa/interpretar'); // "30 ovos", "1 dúzia"

const router = express.Router();

// Datas como "AAAA-MM-DD" em UTC, para somar dias sem problema de fuso/horário de verão
const paraData = (s) => new Date(`${s}T00:00:00Z`);
const paraTexto = (d) => d.toISOString().slice(0, 10);
const somarDias = (s, n) => { const d = paraData(s); d.setUTCDate(d.getUTCDate() + n); return paraTexto(d); };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

// Cada período define seus "baldes" (barras): dia, semana (começa na segunda) ou mês
const PERIODOS = {
  '7d': { nome: '7 dias', grao: 'dia', quantos: 7 },
  '30d': { nome: '30 dias', grao: 'dia', quantos: 30 },
  '6m': { nome: '6 meses', grao: 'semana', quantos: 26 },
  '1a': { nome: '1 ano', grao: 'mes', quantos: 12 },
};

// { grao, quantos }: tipo de balde e quantos, terminando no dia `fim` (inclusive)
function montarBaldes({ grao, quantos }, fim) {
  const baldes = [];
  if (grao === 'dia') {
    for (let i = quantos - 1; i >= 0; i--) {
      const dia = somarDias(fim, -i);
      baldes.push({ inicio: dia, fim: dia, rotulo: ddmm(dia), detalhe: `${SEMANA[paraData(dia).getUTCDay()]}, ${ddmm(dia)}` });
    }
  } else if (grao === 'semana') {
    const segunda = somarDias(fim, -((paraData(fim).getUTCDay() + 6) % 7));
    for (let i = quantos - 1; i >= 0; i--) {
      const ini = somarDias(segunda, -7 * i);
      const fimSemana = i === 0 ? fim : somarDias(ini, 6); // semana atual vai só até hoje
      baldes.push({ inicio: ini, fim: fimSemana, rotulo: ddmm(ini), detalhe: `semana de ${ddmm(ini)} a ${ddmm(fimSemana)}` });
    }
  } else {
    const [ano, mes] = fim.split('-').map(Number);
    for (let i = quantos - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
      const ini = paraTexto(d);
      const ultimo = paraTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
      const rotulo = `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
      baldes.push({ inicio: ini, fim: ultimo < fim ? ultimo : fim, rotulo, detalhe: rotulo });
    }
  }
  return baldes;
}

// Produção (só lançamentos do tipo produção; perdas e ajustes não entram) agrupada nos baldes
function serie(produto, periodo) {
  const fim = hoje();
  const baldes = montarBaldes(PERIODOS[periodo], fim);
  const porDia = db.prepare(`
    SELECT data, SUM(quantidade) AS total FROM producao
    WHERE produto_id = ? AND tipo = 'producao' AND data BETWEEN ? AND ?
    GROUP BY data
  `).all(produto.id, baldes[0].inicio, fim);
  for (const b of baldes) {
    b.valor = porDia.filter((r) => r.data >= b.inicio && r.data <= b.fim).reduce((s, r) => s + r.total, 0);
  }
  const total = baldes.reduce((s, b) => s + b.valor, 0);
  const dias = (paraData(fim) - paraData(baldes[0].inicio)) / 86400000 + 1;
  const melhor = baldes.reduce((m, b) => (b.valor > m.valor ? b : m), baldes[0]);
  return { baldes, total, mediaDia: total / dias, melhor: melhor.valor > 0 ? melhor : null };
}

// Escala do eixo: passo "redondo" (1, 2, 2,5, 5 × 10^n), até 5 divisões, topo logo acima do máximo
function escala(maximo) {
  if (maximo <= 0) return { topo: 4, passo: 1 };
  const bruto = maximo / 5;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto);
  return { topo: Math.ceil(maximo / passo) * passo, passo };
}

router.get('/', (req, res) => {
  const produtos = produtosAtivos();
  const periodo = PERIODOS[req.query.periodo] ? req.query.periodo : '30d';
  // Padrão: o produto lançado em ovos; se não houver, o primeiro
  const produto = produtos.find((p) => p.id === Number(req.query.produto))
    || produtos.find((p) => p.unidade_producao === 'ovo')
    || produtos[0];
  if (!produto) return res.render('graficos', { titulo: 'Gráfico de produção', produto: null, produtos });

  const dados = serie(produto, periodo);
  const unidade = unidadeProducao(produto);
  for (const b of dados.baldes) b.texto = falarQuantidade(b.valor, unidade);
  res.render('graficos', {
    titulo: 'Gráfico de produção',
    produtos,
    produto,
    unidade,
    qtd: (n) => falarQuantidade(Math.round(n * 10) / 10, unidade),
    periodo,
    periodos: PERIODOS,
    ...dados,
    escala: escala(Math.max(...dados.baldes.map((b) => b.valor))),
    grao: PERIODOS[periodo].grao,
  });
});

module.exports = router;
module.exports.montarBaldes = montarBaldes;
module.exports.escala = escala;
module.exports.paraData = paraData;
module.exports.somarDias = somarDias;
