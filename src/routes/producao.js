const express = require('express');
const { db, transaction } = require('../db');
const { produtosAtivos } = require('../consultas');
const { parseQuantidade, hoje, dataValida, textoOuNull, numero, unidadeProducao } = require('../util');
const historico = require('../historico');

const router = express.Router();

function renderPagina(res, form, erro, status = 200) {
  const registros = db.prepare(`
    SELECT r.*, p.nome AS produto, COALESCE(p.unidade_producao, p.unidade) AS unidade
    FROM producao r JOIN produtos p ON p.id = r.produto_id
    ORDER BY r.data DESC, r.id DESC
    LIMIT 100
  `).all();
  res.status(status).render('producao/index', {
    titulo: 'Produção',
    produtos: produtosAtivos(),
    registros,
    form,
    erro,
  });
}

// Texto do registro para o histórico, ex.: "+30 ovo de Ovos caipira em 18/10/2026"
function descrever(r) {
  return { produto: r.produto, tipo: r.tipo, data: r.data, quantidade: `${numero(r.quantidade)} ${r.unidade}`, observacao: r.observacao };
}

router.get('/', (req, res) => {
  const data = dataValida(req.query.data) ? req.query.data : hoje();
  const produto_id = Number(req.query.produto) || '';
  renderPagina(res, { data, tipo: 'producao', produto_id, quantidade: '', observacao: '' }, null);
});

router.post('/', (req, res) => {
  const form = {
    data: req.body.data,
    tipo: req.body.tipo === 'perda' ? 'perda' : 'producao',
    produto_id: Number(req.body.produto_id),
    quantidade: req.body.quantidade,
    observacao: textoOuNull(req.body.observacao),
  };
  const qtd = parseQuantidade(form.quantidade);
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(form.produto_id);
  let erro = null;
  if (!produto) erro = 'Escolha um produto.';
  else if (!(qtd > 0)) erro = 'Informe uma quantidade maior que zero.';
  else if (!dataValida(form.data)) erro = 'Data inválida.';
  if (erro) return renderPagina(res, form, erro, 400);

  transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO producao (produto_id, data, tipo, quantidade, observacao) VALUES (?, ?, ?, ?, ?)')
      .run(form.produto_id, form.data, form.tipo, qtd, form.observacao);
    const registro = { ...form, quantidade: qtd, produto: produto.nome, unidade: unidadeProducao(produto) };
    historico.registrar(req, {
      entidade: 'producao', id: lastInsertRowid, acao: 'criou',
      resumo: `Lançou ${form.tipo === 'perda' ? 'perda de' : 'produção de'} ${numero(qtd)} ${registro.unidade} de ${produto.nome}`,
      detalhes: historico.retrato('producao', descrever(registro)),
    });
  });
  req.session.aviso = form.tipo === 'perda' ? 'Perda registrada.' : 'Produção registrada.';
  // Mantém data e produto para agilizar vários lançamentos seguidos
  res.redirect(`/producao?data=${form.data}&produto=${form.produto_id}`);
});

router.post('/:id/excluir', (req, res) => {
  const registro = db.prepare(`
    SELECT r.*, p.nome AS produto, COALESCE(p.unidade_producao, p.unidade) AS unidade
    FROM producao r JOIN produtos p ON p.id = r.produto_id WHERE r.id = ?
  `).get(req.params.id);
  if (registro) {
    transaction(() => {
      db.prepare('DELETE FROM producao WHERE id = ?').run(registro.id);
      historico.registrar(req, {
        entidade: 'producao', id: registro.id, acao: 'excluiu',
        resumo: `Excluiu ${registro.tipo === 'perda' ? 'perda' : 'produção'} de ${numero(registro.quantidade)} ${registro.unidade} de ${registro.produto}`,
        detalhes: historico.retrato('producao', descrever(registro)),
      });
    });
  }
  req.session.aviso = 'Registro excluído.';
  res.redirect('/producao');
});

module.exports = router;
