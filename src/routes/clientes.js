const express = require('express');
const { db } = require('../db');
const { textoOuNull, somenteDigitos, cpfValido, semelhanca } = require('../util');

const router = express.Router();

function lerForm(body, idAtual = null) {
  const cliente = {
    nome: String(body.nome || '').trim(),
    cpf: somenteDigitos(body.cpf) || null,
    telefone: textoOuNull(body.telefone),
    endereco: textoOuNull(body.endereco),
    observacoes: textoOuNull(body.observacoes),
  };
  let erro = null;
  if (!cliente.nome) erro = 'Informe o nome do cliente.';
  else if (cliente.cpf && !cpfValido(cliente.cpf)) erro = 'CPF inválido. Confira os números.';
  else if (cliente.cpf) {
    const dono = db.prepare('SELECT id, nome FROM clientes WHERE cpf = ? AND id IS NOT ?').get(cliente.cpf, idAtual);
    if (dono) erro = `Este CPF já está cadastrado para ${dono.nome}.`;
  }
  return { cliente, erro };
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
  renderForm(res, { nome: '', cpf: '', telefone: '', endereco: '', observacoes: '' }, null);
});

// Usado pelo formulário enquanto o nome é digitado: devolve clientes com nome parecido
router.get('/busca', (req, res) => {
  const nome = String(req.query.nome || '').trim();
  const ignorar = Number(req.query.ignorar) || null;
  if (nome.length < 2) return res.json([]);
  const parecidos = db.prepare('SELECT id, nome, cpf, telefone, ativo FROM clientes').all()
    .filter((c) => c.id !== ignorar)
    .map((c) => ({ ...c, pontos: semelhanca(nome, c.nome) }))
    .filter((c) => c.pontos >= 0.5)
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome))
    .slice(0, 5)
    .map(({ pontos, ...c }) => c);
  res.json(parecidos);
});

router.post('/', (req, res) => {
  const { cliente, erro } = lerForm(req.body);
  if (erro) return renderForm(res, cliente, erro, 400);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO clientes (nome, cpf, telefone, endereco, observacoes) VALUES (?, ?, ?, ?, ?)')
    .run(cliente.nome, cliente.cpf, cliente.telefone, cliente.endereco, cliente.observacoes);
  req.session.aviso = `Cliente "${cliente.nome}" cadastrado.`;
  res.redirect(`/clientes/${lastInsertRowid}`);
});

router.get('/:id', (req, res, next) => {
  // criado_em é gravado em UTC; converte para a data local
  const cliente = db.prepare("SELECT *, date(criado_em, 'localtime') AS cadastro FROM clientes WHERE id = ?").get(req.params.id);
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
  const { cliente, erro } = lerForm(req.body, atual.id);
  cliente.id = atual.id;
  cliente.ativo = req.body.ativo ? 1 : 0;
  if (erro) return renderForm(res, cliente, erro, 400);
  db.prepare('UPDATE clientes SET nome = ?, cpf = ?, telefone = ?, endereco = ?, observacoes = ?, ativo = ? WHERE id = ?')
    .run(cliente.nome, cliente.cpf, cliente.telefone, cliente.endereco, cliente.observacoes, cliente.ativo, cliente.id);
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
