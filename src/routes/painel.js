const express = require('express');
const { db } = require('../db');
const { produtosComEstoque } = require('../consultas');
const { hoje } = require('../util');

const router = express.Router();

router.get('/', (req, res) => {
  const mes = hoje().slice(0, 7); // "2026-10"
  const numeros = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN substr(data, 1, 7) = ? THEN total_centavos END), 0) AS vendido_mes,
      COUNT(CASE WHEN substr(data, 1, 7) = ? THEN 1 END) AS vendas_mes,
      COALESCE(SUM(CASE WHEN pago = 1 AND substr(data_pagamento, 1, 7) = ? THEN total_centavos END), 0) AS recebido_mes,
      COALESCE(SUM(CASE WHEN pago = 0 THEN total_centavos END), 0) AS a_receber
    FROM vendas
  `).get(mes, mes, mes);

  const devedores = db.prepare(`
    SELECT c.id, c.nome, SUM(v.total_centavos) AS total, MIN(v.data) AS desde
    FROM vendas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.pago = 0
    GROUP BY c.id
    ORDER BY total DESC
    LIMIT 10
  `).all();

  res.render('painel', {
    titulo: 'Painel',
    mes,
    numeros,
    devedores,
    estoque: produtosComEstoque({ somenteAtivos: true }),
  });
});

module.exports = router;
