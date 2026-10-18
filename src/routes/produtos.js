const express = require('express');
const { db } = require('../db');
const { produtosComEstoque } = require('../consultas');
const { parseDinheiro, textoOuNull } = require('../util');

const router = express.Router();
const UNIDADES = ['un', 'dúzia', 'bandeja', 'kg', 'g', 'litro', 'maço', 'pote', 'pacote'];

function lerForm(body) {
  const produto = {
    nome: String(body.nome || '').trim(),
    unidade: textoOuNull(body.unidade) || 'un',
    preco_centavos: parseDinheiro(body.preco),
  };
  let erro = null;
  if (!produto.nome) erro = 'Informe o nome do produto.';
  else if (Number.isNaN(produto.preco_centavos)) erro = 'Preço inválido.';
  return { produto, erro };
}

function renderForm(res, produto, erro, status = 200) {
  res.status(status).render('produtos/form', {
    titulo: produto.id ? 'Editar produto' : 'Novo produto',
    produto,
    unidades: UNIDADES,
    erro,
  });
}

router.get('/', (req, res) => {
  res.render('produtos/lista', { titulo: 'Produtos', produtos: produtosComEstoque() });
});

router.get('/novo', (req, res) => {
  renderForm(res, { nome: '', unidade: 'dúzia', preco_centavos: 0 }, null);
});

router.post('/', (req, res) => {
  const { produto, erro } = lerForm(req.body);
  if (erro) return renderForm(res, produto, erro, 400);
  db.prepare('INSERT INTO produtos (nome, unidade, preco_centavos) VALUES (?, ?, ?)')
    .run(produto.nome, produto.unidade, produto.preco_centavos);
  req.session.aviso = `Produto "${produto.nome}" cadastrado.`;
  res.redirect('/produtos');
});

router.get('/:id', (req, res, next) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return next();
  renderForm(res, produto, null);
});

router.post('/:id', (req, res, next) => {
  const atual = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!atual) return next();
  const { produto, erro } = lerForm(req.body);
  produto.id = atual.id;
  produto.ativo = req.body.ativo ? 1 : 0;
  if (erro) return renderForm(res, produto, erro, 400);
  db.prepare('UPDATE produtos SET nome = ?, unidade = ?, preco_centavos = ?, ativo = ? WHERE id = ?')
    .run(produto.nome, produto.unidade, produto.preco_centavos, produto.ativo, produto.id);
  req.session.aviso = 'Produto atualizado.';
  res.redirect('/produtos');
});

module.exports = router;
