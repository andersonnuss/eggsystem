const express = require('express');
const { db, transaction } = require('../db');
const { produtosComEstoque, clientesAtivos } = require('../consultas');
const { parseDinheiro, parseQuantidade, hoje, dataValida, textoOuNull, numero, dinheiro } = require('../util');
const historico = require('../historico');

const router = express.Router();

const lista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Venda completa (com nome do cliente e itens) para telas e histórico
function carregarVenda(id) {
  const venda = db.prepare(`
    SELECT v.*, c.nome AS cliente, c.telefone
    FROM vendas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `).get(id);
  if (!venda) return null;
  venda.itens = db.prepare(`
    SELECT i.*, p.nome AS produto, p.unidade
    FROM venda_itens i JOIN produtos p ON p.id = i.produto_id
    WHERE i.venda_id = ?
    ORDER BY i.id
  `).all(venda.id);
  return venda;
}

function retratoVenda(venda) {
  const itens = venda.itens
    .map((i) => `${numero(i.quantidade)} ${i.unidade} ${i.produto} × ${dinheiro(i.preco_unit_centavos)}`)
    .join('; ');
  return historico.retrato('venda', { ...venda, itens });
}

router.get('/', (req, res) => {
  const filtro = req.query.filtro === 'pendentes' ? 'pendentes' : 'todas';
  const where = filtro === 'pendentes' ? 'WHERE v.pago = 0' : '';
  const vendas = db.prepare(`
    SELECT v.*, c.nome AS cliente
    FROM vendas v JOIN clientes c ON c.id = v.cliente_id
    ${where}
    ORDER BY v.data DESC, v.id DESC
    LIMIT 200
  `).all();
  res.render('vendas/lista', { titulo: 'Vendas', vendas, filtro });
});

function renderForm(res, form, erro, status = 200) {
  res.status(status).render('vendas/form', {
    titulo: 'Nova venda',
    clientes: clientesAtivos(),
    produtos: produtosComEstoque({ somenteAtivos: true }),
    form,
    erro,
  });
}

router.get('/nova', (req, res) => {
  renderForm(res, {
    cliente_id: Number(req.query.cliente) || '',
    data: hoje(),
    pago: false,
    observacao: '',
    itens: [{ produto_id: '', quantidade: '', preco: '' }],
  }, null);
});

router.post('/', (req, res) => {
  const produtoIds = lista(req.body.produto_id);
  const quantidades = lista(req.body.quantidade);
  const precos = lista(req.body.preco);

  const form = {
    cliente_id: Number(req.body.cliente_id),
    data: req.body.data,
    pago: !!req.body.pago,
    observacao: textoOuNull(req.body.observacao),
    itens: produtoIds.map((id, i) => ({ produto_id: Number(id) || '', quantidade: quantidades[i] || '', preco: precos[i] || '' })),
  };

  const itens = [];
  let erro = null;
  for (const item of form.itens) {
    if (!item.produto_id && !String(item.quantidade).trim()) continue; // linha vazia
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(item.produto_id);
    const quantidade = parseQuantidade(item.quantidade);
    const preco = String(item.preco).trim() === '' ? produto?.preco_centavos : parseDinheiro(item.preco);
    if (!produto) { erro = 'Escolha o produto em todos os itens.'; break; }
    if (!(quantidade > 0)) { erro = `Quantidade inválida para ${produto.nome}.`; break; }
    if (Number.isNaN(preco)) { erro = `Preço inválido para ${produto.nome}.`; break; }
    itens.push({ produto_id: produto.id, quantidade, preco });
  }
  if (!erro && !db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(form.cliente_id)) erro = 'Escolha o cliente.';
  if (!erro && !dataValida(form.data)) erro = 'Data inválida.';
  if (!erro && !itens.length) erro = 'Adicione ao menos um item.';
  if (erro) {
    if (!form.itens.length) form.itens.push({ produto_id: '', quantidade: '', preco: '' });
    return renderForm(res, form, erro, 400);
  }

  const total = itens.reduce((soma, it) => soma + Math.round(it.quantidade * it.preco), 0);
  const vendaId = transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO vendas (cliente_id, data, total_centavos, pago, data_pagamento, observacao) VALUES (?, ?, ?, ?, ?, ?)')
      .run(form.cliente_id, form.data, total, form.pago ? 1 : 0, form.pago ? form.data : null, form.observacao);
    const inserirItem = db.prepare('INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unit_centavos) VALUES (?, ?, ?, ?)');
    for (const it of itens) inserirItem.run(lastInsertRowid, it.produto_id, it.quantidade, it.preco);
    const venda = carregarVenda(lastInsertRowid);
    historico.registrar(req, {
      entidade: 'venda', id: venda.id, acao: 'criou',
      resumo: `Registrou a venda #${venda.id} para ${venda.cliente} (${dinheiro(venda.total_centavos)})`,
      detalhes: retratoVenda(venda),
    });
    return venda.id;
  });

  req.session.aviso = 'Venda registrada.';
  res.redirect(`/vendas/${vendaId}`);
});

router.get('/:id', (req, res, next) => {
  const venda = carregarVenda(req.params.id);
  if (!venda) return next();
  res.render('vendas/detalhe', { titulo: `Venda #${venda.id}`, venda, itens: venda.itens });
});

router.post('/:id/pagamento', (req, res, next) => {
  const venda = carregarVenda(req.params.id);
  if (!venda) return next();
  const pago = req.body.pago === '1';
  transaction(() => {
    db.prepare("UPDATE vendas SET pago = ?, data_pagamento = CASE WHEN ? THEN date('now', 'localtime') END WHERE id = ?")
      .run(pago ? 1 : 0, pago ? 1 : 0, venda.id);
    historico.registrar(req, {
      entidade: 'venda', id: venda.id, acao: 'alterou',
      resumo: `Marcou a venda #${venda.id} de ${venda.cliente} como ${pago ? 'paga' : 'a receber'}`,
      detalhes: historico.mudancas('venda', venda, { pago: pago ? 1 : 0 }),
    });
  });
  req.session.aviso = pago ? 'Venda marcada como paga.' : 'Venda marcada como a receber.';
  res.redirect(`/vendas/${venda.id}`);
});

router.post('/:id/excluir', (req, res) => {
  const venda = carregarVenda(req.params.id);
  if (venda) {
    transaction(() => {
      db.prepare('DELETE FROM vendas WHERE id = ?').run(venda.id);
      historico.registrar(req, {
        entidade: 'venda', id: venda.id, acao: 'excluiu',
        resumo: `Excluiu a venda #${venda.id} de ${venda.cliente} (${dinheiro(venda.total_centavos)})`,
        detalhes: retratoVenda(venda),
      });
    });
  }
  req.session.aviso = 'Venda excluída.';
  res.redirect('/vendas');
});

module.exports = router;
