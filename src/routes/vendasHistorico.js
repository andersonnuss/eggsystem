// Histórico de vendas: quanto foi vendido por dia, semana ou mês, comparado com o período anterior.
// Dá para filtrar por produto e/ou por cliente.
const express = require('express');
const { db } = require('../db');
const { produtosAtivos, clientesAtivos } = require('../consultas');
const { hoje, dinheiro, numero } = require('../util');
const { montarBaldes, escala, paraData, somarDias } = require('./graficos');

const router = express.Router();

const PERIODOS = {
  '30d': { nome: '30 dias', grao: 'dia', quantos: 30 },
  '3m': { nome: '3 meses', grao: 'semana', quantos: 13 },
  '6m': { nome: '6 meses', grao: 'semana', quantos: 26 },
  '1a': { nome: '1 ano', grao: 'mes', quantos: 12 },
  '2a': { nome: '2 anos', grao: 'mes', quantos: 24 },
};

// Valor, nº de vendas, quantidade e valor a receber por dia.
// Com produto, só os itens dele; com cliente, só as vendas dele.
function vendasPorDia(produto, cliente, inicio, fim) {
  const params = { inicio, fim };
  if (produto) params.produto = produto.id;
  if (cliente) params.cliente = cliente.id;
  const condCliente = cliente ? 'AND v.cliente_id = :cliente' : '';
  if (!produto) {
    return db.prepare(`
      SELECT data, SUM(total_centavos) AS centavos, COUNT(*) AS vendas, NULL AS quantidade,
             SUM(CASE WHEN pago = 0 THEN total_centavos ELSE 0 END) AS aberto
      FROM vendas v WHERE v.data BETWEEN :inicio AND :fim ${condCliente}
      GROUP BY v.data
    `).all(params);
  }
  return db.prepare(`
    SELECT v.data, SUM(ROUND(i.quantidade * i.preco_unit_centavos)) AS centavos, COUNT(DISTINCT v.id) AS vendas,
           SUM(i.quantidade) AS quantidade,
           SUM(CASE WHEN v.pago = 0 THEN ROUND(i.quantidade * i.preco_unit_centavos) ELSE 0 END) AS aberto
    FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
    WHERE i.produto_id = :produto AND v.data BETWEEN :inicio AND :fim ${condCliente}
    GROUP BY v.data
  `).all(params);
}

const somar = (linhas, campo) => linhas.reduce((s, r) => s + (r[campo] || 0), 0);

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (aaaamm) => `${MESES[Number(aaaamm.slice(5, 7)) - 1]}/${aaaamm.slice(0, 4)}`;
const ultimoDia = (aaaamm) => {
  const [a, m] = aaaamm.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const mesAnterior = (aaaamm) => {
  const [a, m] = aaaamm.split('-').map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
};

// Meses que podem ser escolhidos: do mês da primeira venda até o mês atual (mais recente primeiro)
function mesesDisponiveis() {
  const atual = hoje().slice(0, 7);
  const primeira = db.prepare('SELECT MIN(data) AS data FROM vendas').get().data;
  const meses = [];
  for (let m = atual; ; m = mesAnterior(m)) {
    meses.push({ valor: m, nome: nomeMes(m) });
    if (!primeira || m <= primeira.slice(0, 7) || meses.length >= 120) break;
  }
  return meses;
}

// O recorte de datas da tela: um período móvel (ex.: últimos 3 meses) ou um mês escolhido.
// Define as barras, o nome do período e com o que comparar.
function recorte(periodo, mes) {
  if (!mes) {
    const fim = hoje();
    const baldes = montarBaldes(PERIODOS[periodo], fim);
    const inicio = baldes[0].inicio;
    const dias = (paraData(fim) - paraData(inicio)) / 86400000 + 1;
    return {
      baldes,
      grao: PERIODOS[periodo].grao,
      nome: PERIODOS[periodo].nome,
      subtitulo: `últimos ${PERIODOS[periodo].nome}`,
      anterior: { inicio: somarDias(inicio, -dias), fim: somarDias(inicio, -1) },
      rotuloAnterior: { sobre: 'o período anterior', em: 'no período anterior', igual: 'igual ao período anterior' },
      explicacao: 'A comparação usa o mesmo número de dias logo antes do período.',
    };
  }
  // Mês escolhido: barras por dia, até hoje se for o mês atual
  const inicio = `${mes}-01`;
  const fim = ultimoDia(mes) < hoje() ? ultimoDia(mes) : hoje();
  const dias = (paraData(fim) - paraData(inicio)) / 86400000 + 1;
  const completo = fim === ultimoDia(mes);
  // Compara com o mês anterior; se este ainda não acabou, com os mesmos dias do mês anterior
  const ant = mesAnterior(mes);
  const fimAnt = completo || somarDias(`${ant}-01`, dias - 1) > ultimoDia(ant) ? ultimoDia(ant) : somarDias(`${ant}-01`, dias - 1);
  const nomeAnt = completo ? nomeMes(ant) : `${ddmm(`${ant}-01`)} a ${ddmm(fimAnt)}`;
  return {
    baldes: montarBaldes({ grao: 'dia', quantos: dias }, fim),
    grao: 'dia',
    nome: nomeMes(mes),
    subtitulo: nomeMes(mes),
    anterior: { inicio: `${ant}-01`, fim: fimAnt },
    rotuloAnterior: { sobre: nomeAnt, em: `em ${nomeAnt}`, igual: `igual a ${nomeAnt}` },
    explicacao: completo
      ? `A comparação é com ${nomeMes(ant)}.`
      : `O mês ainda não acabou: a comparação é com os mesmos dias de ${nomeMes(ant)} (${nomeAnt}).`,
  };
}

const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

function resumo(produto, cliente, r) {
  const { baldes } = r;
  const inicio = baldes[0].inicio;
  const fim = baldes.at(-1).fim;
  const porDia = vendasPorDia(produto, cliente, inicio, fim);
  for (const b of baldes) {
    const dias = porDia.filter((r) => r.data >= b.inicio && r.data <= b.fim);
    b.centavos = somar(dias, 'centavos');
    b.vendas = somar(dias, 'vendas');
    b.quantidade = somar(dias, 'quantidade');
    b.valor = b.centavos / 100; // o gráfico trabalha em reais
    b.texto = dinheiro(b.centavos);
  }

  const anterior = vendasPorDia(produto, cliente, r.anterior.inicio, r.anterior.fim);

  const total = somar(porDia, 'centavos');
  const melhor = baldes.reduce((m, b) => (b.centavos > m.centavos ? b : m), baldes[0]);
  return {
    baldes,
    total,
    vendas: somar(porDia, 'vendas'),
    quantidade: somar(porDia, 'quantidade'),
    aberto: somar(porDia, 'aberto'),
    totalAnterior: somar(anterior, 'centavos'),
    melhor: melhor.centavos > 0 ? melhor : null,
  };
}

// O que mais vendeu (sem filtro de produto) e quem mais comprou (sem filtro de cliente) no período
function rankings(produto, cliente, inicio, fim) {
  const params = { inicio, fim };
  if (cliente) params.cliente = cliente.id;
  const condCliente = cliente ? 'AND v.cliente_id = :cliente' : '';

  const porProduto = produto ? [] : db.prepare(`
    SELECT p.id, p.nome, p.unidade, SUM(i.quantidade) AS quantidade, SUM(ROUND(i.quantidade * i.preco_unit_centavos)) AS centavos
    FROM venda_itens i JOIN vendas v ON v.id = i.venda_id JOIN produtos p ON p.id = i.produto_id
    WHERE v.data BETWEEN :inicio AND :fim ${condCliente}
    GROUP BY p.id ORDER BY centavos DESC
  `).all(params);

  const topClientes = cliente ? [] : db.prepare(`
    SELECT c.id, c.nome, COUNT(DISTINCT v.id) AS vendas, SUM(ROUND(i.quantidade * i.preco_unit_centavos)) AS centavos
    FROM venda_itens i JOIN vendas v ON v.id = i.venda_id JOIN clientes c ON c.id = v.cliente_id
    WHERE v.data BETWEEN :inicio AND :fim AND (:produto IS NULL OR i.produto_id = :produto)
    GROUP BY c.id ORDER BY centavos DESC LIMIT 5
  `).all({ inicio, fim, produto: produto?.id ?? null });

  return { porProduto, topClientes };
}

// "▲ 12% sobre o período anterior" / "▼ 5% sobre setembro/2026"
function comparacao(total, anterior, rotulo) {
  if (anterior === 0) return total > 0 ? `sem vendas ${rotulo.em}` : null;
  const pct = Math.round(((total - anterior) / anterior) * 100);
  if (pct === 0) return rotulo.igual;
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% sobre ${rotulo.sobre}`;
}

router.get('/', (req, res) => {
  const produtos = produtosAtivos();
  const clientes = clientesAtivos();
  const meses = mesesDisponiveis();
  const periodo = PERIODOS[req.query.periodo] ? req.query.periodo : '3m';
  const mes = meses.some((m) => m.valor === req.query.mes) ? req.query.mes : null; // mês escolhido tem prioridade
  const produto = produtos.find((p) => p.id === Number(req.query.produto)) || null;
  const cliente = clientes.find((c) => c.id === Number(req.query.cliente)) || null;

  const r = recorte(periodo, mes);
  const dados = resumo(produto, cliente, r);
  const { inicio } = dados.baldes[0];
  const fim = dados.baldes.at(-1).fim;
  res.render('vendas/historico', {
    titulo: 'Histórico de vendas',
    produtos,
    clientes,
    meses,
    mes,
    produto,
    cliente,
    periodo,
    periodos: PERIODOS,
    grao: r.grao,
    nomePeriodo: r.nome,
    subtituloPeriodo: r.subtitulo,
    explicacaoComparacao: r.explicacao,
    ...dados,
    ...rankings(produto, cliente, inicio, fim),
    comparacao: comparacao(dados.total, dados.totalAnterior, r.rotuloAnterior),
    qtd: (n) => `${numero(n)} ${produto ? produto.unidade : ''}`.trim(),
    escala: escala(Math.max(...dados.baldes.map((b) => b.valor))),
  });
});

module.exports = router;
