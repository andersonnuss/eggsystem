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

function resumo(produto, cliente, periodo) {
  const fim = hoje();
  const baldes = montarBaldes(PERIODOS[periodo], fim);
  const inicio = baldes[0].inicio;
  const porDia = vendasPorDia(produto, cliente, inicio, fim);
  for (const b of baldes) {
    const dias = porDia.filter((r) => r.data >= b.inicio && r.data <= b.fim);
    b.centavos = somar(dias, 'centavos');
    b.vendas = somar(dias, 'vendas');
    b.quantidade = somar(dias, 'quantidade');
    b.valor = b.centavos / 100; // o gráfico trabalha em reais
    b.texto = dinheiro(b.centavos);
  }

  // Período anterior com o mesmo número de dias, logo antes deste
  const dias = (paraData(fim) - paraData(inicio)) / 86400000 + 1;
  const anterior = vendasPorDia(produto, cliente, somarDias(inicio, -dias), somarDias(inicio, -1));

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

// "▲ 12% sobre o período anterior"
function comparacao(total, anterior) {
  if (anterior === 0) return total > 0 ? 'sem vendas no período anterior' : null;
  const pct = Math.round(((total - anterior) / anterior) * 100);
  if (pct === 0) return 'igual ao período anterior';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% sobre o período anterior`;
}

router.get('/', (req, res) => {
  const produtos = produtosAtivos();
  const clientes = clientesAtivos();
  const periodo = PERIODOS[req.query.periodo] ? req.query.periodo : '3m';
  const produto = produtos.find((p) => p.id === Number(req.query.produto)) || null;
  const cliente = clientes.find((c) => c.id === Number(req.query.cliente)) || null;

  const dados = resumo(produto, cliente, periodo);
  const { inicio } = dados.baldes[0];
  const fim = dados.baldes.at(-1).fim;
  res.render('vendas/historico', {
    titulo: 'Histórico de vendas',
    produtos,
    clientes,
    produto,
    cliente,
    periodo,
    periodos: PERIODOS,
    grao: PERIODOS[periodo].grao,
    ...dados,
    ...rankings(produto, cliente, inicio, fim),
    comparacao: comparacao(dados.total, dados.totalAnterior),
    qtd: (n) => `${numero(n)} ${produto ? produto.unidade : ''}`.trim(),
    escala: escala(Math.max(...dados.baldes.map((b) => b.valor))),
  });
});

module.exports = router;
