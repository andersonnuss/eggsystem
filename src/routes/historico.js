const express = require('express');
const { db } = require('../db');

const router = express.Router();

const ENTIDADES = {
  produto: 'Produtos',
  cliente: 'Clientes',
  venda: 'Vendas',
  producao: 'Produção',
  acesso: 'Acessos',
};
const POR_PAGINA = 100;

router.get('/', (req, res) => {
  const entidade = ENTIDADES[req.query.entidade] ? req.query.entidade : null;
  const id = entidade ? Number(req.query.id) || null : null;
  const pagina = Math.max(1, Number(req.query.pagina) || 1);

  const filtros = [];
  const params = [];
  if (entidade) { filtros.push('entidade = ?'); params.push(entidade); }
  if (id) { filtros.push('entidade_id = ?'); params.push(id); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const registros = db.prepare(`
    SELECT *, datetime(criado_em, 'localtime') AS quando
    FROM historico ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA);
  const temMais = registros.length > POR_PAGINA;
  if (temMais) registros.pop();
  for (const r of registros) r.detalhes = r.detalhes ? JSON.parse(r.detalhes) : null;

  res.render('historico', {
    titulo: 'Histórico',
    registros,
    entidades: ENTIDADES,
    entidade,
    id,
    pagina,
    temMais,
  });
});

module.exports = router;
