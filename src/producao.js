// Lançamento e exclusão de produção/perda, usados pela tela e pela Alexa
const { db, transaction } = require('./db');
const { numero, unidadeProducao } = require('./util');
const historico = require('./historico');

function descrever(r) {
  return { produto: r.produto, tipo: r.tipo, data: r.data, quantidade: `${numero(r.quantidade)} ${r.unidade}`, observacao: r.observacao };
}

// `quantidade` já na unidade de produção do produto. Devolve o id do lançamento.
function lancar(req, { produto, data, tipo, quantidade, observacao = null }) {
  return transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO producao (produto_id, data, tipo, quantidade, observacao) VALUES (?, ?, ?, ?, ?)')
      .run(produto.id, data, tipo, quantidade, observacao);
    const registro = { tipo, data, quantidade, observacao, produto: produto.nome, unidade: unidadeProducao(produto) };
    historico.registrar(req, {
      entidade: 'producao', id: lastInsertRowid, acao: 'criou',
      resumo: `Lançou ${tipo === 'perda' ? 'perda de' : 'produção de'} ${numero(quantidade)} ${registro.unidade} de ${produto.nome}`,
      detalhes: historico.retrato('producao', descrever(registro)),
    });
    return Number(lastInsertRowid);
  });
}

function buscar(id) {
  return db.prepare(`
    SELECT r.*, p.nome AS produto, COALESCE(p.unidade_producao, p.unidade) AS unidade
    FROM producao r JOIN produtos p ON p.id = r.produto_id WHERE r.id = ?
  `).get(id);
}

// Devolve o registro excluído (ou undefined se não existia)
function excluir(req, id) {
  const registro = buscar(id);
  if (!registro) return undefined;
  transaction(() => {
    db.prepare('DELETE FROM producao WHERE id = ?').run(registro.id);
    historico.registrar(req, {
      entidade: 'producao', id: registro.id, acao: 'excluiu',
      resumo: `Excluiu ${registro.tipo === 'perda' ? 'perda' : 'produção'} de ${numero(registro.quantidade)} ${registro.unidade} de ${registro.produto}`,
      detalhes: historico.retrato('producao', descrever(registro)),
    });
  });
  return registro;
}

module.exports = { lancar, excluir, buscar };
