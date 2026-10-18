const express = require('express');
const { db } = require('../db');
const { produtosAtivos } = require('../consultas');
const { parseQuantidade, hoje, dataValida, textoOuNull } = require('../util');

const router = express.Router();

function renderPagina(res, form, erro, status = 200) {
  const registros = db.prepare(`
    SELECT r.*, p.nome AS produto, p.unidade
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
  let erro = null;
  if (!db.prepare('SELECT 1 FROM produtos WHERE id = ?').get(form.produto_id)) erro = 'Escolha um produto.';
  else if (!(qtd > 0)) erro = 'Informe uma quantidade maior que zero.';
  else if (!dataValida(form.data)) erro = 'Data inválida.';
  if (erro) return renderPagina(res, form, erro, 400);

  db.prepare('INSERT INTO producao (produto_id, data, tipo, quantidade, observacao) VALUES (?, ?, ?, ?, ?)')
    .run(form.produto_id, form.data, form.tipo, qtd, form.observacao);
  req.session.aviso = form.tipo === 'perda' ? 'Perda registrada.' : 'Produção registrada.';
  // Mantém data e produto para agilizar vários lançamentos seguidos
  res.redirect(`/producao?data=${form.data}&produto=${form.produto_id}`);
});

router.post('/:id/excluir', (req, res) => {
  db.prepare('DELETE FROM producao WHERE id = ?').run(req.params.id);
  req.session.aviso = 'Registro excluído.';
  res.redirect('/producao');
});

module.exports = router;
