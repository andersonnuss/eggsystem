const express = require('express');
const { db, transaction } = require('../db');
const { produtosComEstoque } = require('../consultas');
const { parseDinheiro, parseQuantidade, textoOuNull, numero } = require('../util');
const historico = require('../historico');

const router = express.Router();
const UNIDADES = ['un', 'dúzia', 'bandeja', 'kg', 'g', 'litro', 'maço', 'pote', 'pacote'];
const UNIDADES_PRODUCAO = ['ovo', 'un', 'kg', 'g', 'litro', 'maço', 'pote'];

function lerForm(body) {
  const produto = {
    nome: String(body.nome || '').trim(),
    unidade: textoOuNull(body.unidade) || 'un',
    preco_centavos: parseDinheiro(body.preco),
    unidade_producao: textoOuNull(body.unidade_producao),
    fator: parseQuantidade(body.fator),
  };
  // Sem unidade de produção própria, produção e venda usam a mesma unidade
  if (!produto.unidade_producao || produto.unidade_producao === produto.unidade) {
    produto.unidade_producao = null;
    produto.fator = 1;
  }
  let erro = null;
  if (!produto.nome) erro = 'Informe o nome do produto.';
  else if (Number.isNaN(produto.preco_centavos)) erro = 'Preço inválido.';
  else if (!(produto.fator > 0)) erro = `Informe quantos(as) ${produto.unidade_producao} formam 1 ${produto.unidade}.`;
  return { produto, erro };
}

function renderForm(res, produto, erro, status = 200) {
  res.status(status).render('produtos/form', {
    titulo: produto.id ? 'Editar produto' : 'Novo produto',
    produto,
    unidades: UNIDADES,
    unidadesProducao: UNIDADES_PRODUCAO,
    erro,
  });
}

router.get('/', (req, res) => {
  res.render('produtos/lista', { titulo: 'Produtos', produtos: produtosComEstoque() });
});

router.get('/novo', (req, res) => {
  renderForm(res, { nome: '', unidade: 'dúzia', preco_centavos: 0, unidade_producao: null, fator: 1 }, null);
});

router.post('/', (req, res) => {
  const { produto, erro } = lerForm(req.body);
  if (erro) return renderForm(res, produto, erro, 400);
  transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO produtos (nome, unidade, preco_centavos, unidade_producao, fator) VALUES (?, ?, ?, ?, ?)')
      .run(produto.nome, produto.unidade, produto.preco_centavos, produto.unidade_producao, produto.fator);
    historico.registrar(req, {
      entidade: 'produto', id: lastInsertRowid, acao: 'criou',
      resumo: `Cadastrou o produto ${produto.nome}`,
      detalhes: historico.retrato('produto', { ...produto, ativo: 1 }),
    });
  });
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

  const fatorMudou = produto.fator !== atual.fator;
  transaction(() => {
    db.prepare('UPDATE produtos SET nome = ?, unidade = ?, preco_centavos = ?, unidade_producao = ?, fator = ?, ativo = ? WHERE id = ?')
      .run(produto.nome, produto.unidade, produto.preco_centavos, produto.unidade_producao, produto.fator, produto.ativo, produto.id);
    // A produção já lançada está na unidade de produção antiga: converte para manter o estoque igual
    if (fatorMudou) {
      db.prepare('UPDATE producao SET quantidade = quantidade * ? WHERE produto_id = ?')
        .run(produto.fator / atual.fator, produto.id);
    }
    const detalhes = historico.mudancas('produto', atual, produto);
    if (detalhes) {
      historico.registrar(req, {
        entidade: 'produto', id: produto.id, acao: 'alterou',
        resumo: `Alterou o produto ${produto.nome}` +
          (fatorMudou ? ` (produção anterior convertida ×${numero(produto.fator / atual.fator)})` : ''),
        detalhes,
      });
    }
  });
  req.session.aviso = 'Produto atualizado.';
  res.redirect('/produtos');
});

module.exports = router;
