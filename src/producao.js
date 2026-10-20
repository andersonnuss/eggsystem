// Lançamento e exclusão de produção, perda e ajuste de estoque, usados pela tela e pela Alexa
const { db, transaction } = require('./db');
const { numero, unidadeProducao } = require('./util');
const historico = require('./historico');
const { saldoAte } = require('./consultas');

// Ajuste mostra o sinal (+5 / −3); produção e perda são sempre positivas
const qtdTexto = (r) => `${r.tipo === 'ajuste' && r.quantidade > 0 ? '+' : ''}${numero(r.quantidade)} ${r.unidade}`;
const NOMES = { producao: 'produção', perda: 'perda', ajuste: 'ajuste de estoque' };

function descrever(r) {
  return { produto: r.produto, tipo: r.tipo, data: r.data, quantidade: qtdTexto(r), observacao: r.observacao };
}

// `quantidade` já na unidade de produção do produto (com sinal, se for ajuste). Devolve o id do lançamento.
function lancar(req, { produto, data, tipo, quantidade, observacao = null, resumo = null }) {
  return transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO producao (produto_id, data, tipo, quantidade, observacao) VALUES (?, ?, ?, ?, ?)')
      .run(produto.id, data, tipo, quantidade, observacao);
    const registro = { tipo, data, quantidade, observacao, produto: produto.nome, unidade: unidadeProducao(produto) };
    historico.registrar(req, {
      entidade: 'producao', id: lastInsertRowid, acao: 'criou',
      resumo: resumo || `Lançou ${NOMES[tipo]} de ${qtdTexto(registro)} de ${produto.nome}`,
      detalhes: historico.retrato('producao', descrever(registro)),
    });
    return Number(lastInsertRowid);
  });
}

// Contagem física: lança a diferença entre o contado e o saldo do sistema no fim do dia `data`.
// Devolve { diferenca, saldoAnterior } (diferenca 0 = já conferia, nada é lançado).
function contar(req, { produto, data, contado, observacao = null }) {
  const saldoAnterior = saldoAte(produto, data);
  const diferenca = Math.round((contado - saldoAnterior) * 1000) / 1000;
  if (diferenca !== 0) {
    const un = unidadeProducao(produto);
    const obs = [`Contagem: ${numero(contado)} ${un} (sistema tinha ${numero(saldoAnterior)})`, observacao].filter(Boolean).join(' · ');
    lancar(req, {
      produto, data, tipo: 'ajuste', quantidade: diferenca, observacao: obs,
      resumo: `Contagem de ${produto.nome}: ${numero(contado)} ${un} (ajuste de ${diferenca > 0 ? '+' : ''}${numero(diferenca)} ${un})`,
    });
  }
  return { diferenca, saldoAnterior };
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
      resumo: `Excluiu ${NOMES[registro.tipo]} de ${qtdTexto(registro)} de ${registro.produto}`,
      detalhes: historico.retrato('producao', descrever(registro)),
    });
  });
  return registro;
}

module.exports = { lancar, contar, excluir, buscar };
