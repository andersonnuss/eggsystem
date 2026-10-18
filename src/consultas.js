const { db } = require('./db');

// Estoque = produção - perdas - vendido
const SQL_ESTOQUE = `
  SELECT p.*,
    COALESCE((SELECT SUM(CASE WHEN tipo = 'producao' THEN quantidade ELSE -quantidade END)
              FROM producao WHERE produto_id = p.id), 0)
    - COALESCE((SELECT SUM(quantidade) FROM venda_itens WHERE produto_id = p.id), 0) AS estoque
  FROM produtos p
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

module.exports = { produtosComEstoque, produtosAtivos, clientesAtivos };
