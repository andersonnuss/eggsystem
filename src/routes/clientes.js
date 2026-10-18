const express = require('express');
const { db } = require('../db');
const { textoOuNull } = require('../util');

const router = express.Router();

function lerForm(body) {
  const cliente = {
    nome: String(body.nome || '').trim(),
    telefone: textoOuNull(body.telefone),
    endereco: textoOuNull(body.endereco),
    observacoes: textoOuNull(body.observacoes),
  };
  return { cliente, erro: cliente.nome ? null : 'Informe o nome do cliente.' };
}

function renderForm(res, cliente, erro, status = 200) {
  res.status(status).render('clientes/form', {
    titulo: cliente.id ? 'Editar cliente' : 'Novo cliente',
    cliente,
    erro,
  });
}

router.get('/', (req, res) => {
  const clientes = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(total_centavos) FROM vendas WHERE cliente_id = c.id AND pago = 0), 0) AS a_receber
    FROM clientes c
    ORDER BY c.ativo DESC, c.nome
  `).all();
  res.render('clientes/lista', { titulo: 'Clientes', clientes });
});

router.get('/novo', (req, res) => {
  renderForm(res, { nome: '', telefone: '', endereco: '', observacoes: '' }, null);
});

router.post('/', (req, res) => {
  const { cliente, erro } = lerForm(req.body);
  if (erro) return renderForm(res, cliente, erro, 400);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO clientes (nome, telefone, endereco, observacoes) VALUES (?, ?, ?, ?)')
    .run(cliente.nome, cliente.telefone, cliente.endereco, cliente.observacoes);
  req.session.aviso = `Cliente "${cliente.nome}" cadastrado.`;
  res.redirect(`/clientes/${lastInsertRowid}`);
});

router.get('/:id', (req, res, next) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return next();
  const vendas = db.prepare('SELECT * FROM vendas WHERE cliente_id = ? ORDER BY data DESC, id DESC LIMIT 50').all(cliente.id);
  const resumo = db.prepare(`
    SELECT COALESCE(SUM(total_centavos), 0) AS total,
           COALESCE(SUM(CASE WHEN pago = 0 THEN total_centavos END), 0) AS a_receber
    FROM vendas WHERE cliente_id = ?
  `).get(cliente.id);
  res.render('clientes/detalhe', { titulo: cliente.nome, cliente, vendas, resumo });
});

router.get('/:id/editar', (req, res, next) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return next();
  renderForm(res, cliente, null);
});

router.post('/:id', (req, res, next) => {
  const atual = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!atual) return next();
  const { cliente, erro } = lerForm(req.body);
  cliente.id = atual.id;
  cliente.ativo = req.body.ativo ? 1 : 0;
  if (erro) return renderForm(res, cliente, erro, 400);
  db.prepare('UPDATE clientes SET nome = ?, telefone = ?, endereco = ?, observacoes = ?, ativo = ? WHERE id = ?')
    .run(cliente.nome, cliente.telefone, cliente.endereco, cliente.observacoes, cliente.ativo, cliente.id);
  req.session.aviso = 'Cliente atualizado.';
  res.redirect(`/clientes/${cliente.id}`);
});

// Marca todas as vendas pendentes do cliente como pagas
router.post('/:id/quitar', (req, res) => {
  const { changes } = db
    .prepare("UPDATE vendas SET pago = 1, data_pagamento = date('now', 'localtime') WHERE cliente_id = ? AND pago = 0")
    .run(req.params.id);
  req.session.aviso = changes ? `${changes} venda(s) marcada(s) como paga(s).` : 'Nada pendente.';
  res.redirect(`/clientes/${req.params.id}`);
});

module.exports = router;
