const { db } = require('./db');

// Quantidade com sinal de um lançamento de produção: produção (+), perda (-), ajuste (já vem com sinal)
const SQL_SINAL = "CASE WHEN tipo = 'perda' THEN -quantidade ELSE quantidade END";

// Estoque na unidade de produção = produção - perdas ± ajustes - (vendido × fator).
// `estoque` sai na unidade de venda; `estoque_producao` na unidade de produção.
const SQL_ESTOQUE = `
  SELECT *, estoque_producao / fator AS estoque
  FROM (
    SELECT p.*,
      COALESCE((SELECT SUM(${SQL_SINAL}) FROM producao WHERE produto_id = p.id), 0)
      - COALESCE((SELECT SUM(quantidade) FROM venda_itens WHERE produto_id = p.id), 0) * p.fator AS estoque_producao
    FROM produtos p
  ) p
`;

function produtosComEstoque({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? 'WHERE p.ativo = 1' : '';
  return db.prepare(`${SQL_ESTOQUE} ${where} ORDER BY p.ativo DESC, p.nome`).all();
}

function produtosAtivos() {
  return db.prepare('SELECT * FROM produtos WHERE ativo = 1 ORDER BY nome').all();
}

function clientesAtivos() {
  return db.prepare('SELECT * FROM clientes WHERE ativo = 1 ORDER BY nome').all();
}

// Todos os movimentos do produto em ordem cronológica, na unidade de produção, com o saldo após cada um.
// No mesmo dia: produção/perda, depois vendas, e por último a contagem (que vale para o fim do dia).
function extrato(produto) {
  const movimentos = db.prepare(`
    SELECT r.id, r.data, r.tipo, ${SQL_SINAL} AS quantidade, r.observacao,
           NULL AS cliente, NULL AS venda_id, CASE WHEN r.tipo = 'ajuste' THEN 3 ELSE 1 END AS ordem
    FROM producao r WHERE r.produto_id = :id
    UNION ALL
    SELECT i.id, v.data, 'venda', -(i.quantidade * :fator), NULL, c.nome, v.id, 2
    FROM venda_itens i
      JOIN vendas v ON v.id = i.venda_id
      JOIN clientes c ON c.id = v.cliente_id
    WHERE i.produto_id = :id
    ORDER BY data, ordem, id
  `).all({ id: produto.id, fator: produto.fator });

  let saldo = 0;
  for (const m of movimentos) {
    saldo += m.quantidade;
    m.saldo = saldo;
  }
  return movimentos;
}

// Saldo (unidade de produção) considerando tudo lançado até o fim do dia informado
function saldoAte(produto, data) {
  const { producao } = db.prepare(`
    SELECT COALESCE(SUM(${SQL_SINAL}), 0) AS producao FROM producao WHERE produto_id = ? AND data <= ?
  `).get(produto.id, data);
  const { vendido } = db.prepare(`
    SELECT COALESCE(SUM(i.quantidade), 0) AS vendido
    FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
    WHERE i.produto_id = ? AND v.data <= ?
  `).get(produto.id, data);
  return producao - vendido * produto.fator;
}

module.exports = { produtosComEstoque, produtosAtivos, clientesAtivos, extrato, saldoAte };
