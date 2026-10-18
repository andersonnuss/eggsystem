const express = require('express');
const { db } = require('../db');

const router = express.Router();

const ENTIDADES = {
  produto: 'Produtos',
  cliente: 'Clientes',
  venda: 'Vendas',
  producao: 'Produção',
  usuario: 'Usuários',
  acesso: 'Acessos',
};
const POR_PAGINA = 100;

router.get('/', (req, res) => {
  const entidade = ENTIDADES[req.query.entidade] ? req.query.entidade : null;
  const id = entidade ? Number(req.query.id) || null : null;
  const quem = String(req.query.quem || '').trim() || null; // login de quem fez
  const pagina = Math.max(1, Number(req.query.pagina) || 1);

  const filtros = [];
  const params = [];
  if (entidade) { filtros.push('h.entidade = ?'); params.push(entidade); }
  if (id) { filtros.push('h.entidade_id = ?'); params.push(id); }
  if (quem) { filtros.push('h.usuario = ?'); params.push(quem); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  // Mostra o nome da pessoa; a Alexa (e logins removidos) aparecem como gravados
  const registros = db.prepare(`
    SELECT h.*, datetime(h.criado_em, 'localtime') AS quando, COALESCE(u.nome, h.usuario) AS autor
    FROM historico h LEFT JOIN usuarios u ON u.usuario = h.usuario
    ${where}
    ORDER BY h.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA);
  const nomeQuem = quem && (db.prepare('SELECT nome FROM usuarios WHERE usuario = ?').get(quem)?.nome || quem);
  const temMais = registros.length > POR_PAGINA;
  if (temMais) registros.pop();
  for (const r of registros) r.detalhes = r.detalhes ? JSON.parse(r.detalhes) : null;

  res.render('historico', {
    titulo: 'Histórico',
    registros,
    entidades: ENTIDADES,
    entidade,
    id,
    quem,
    nomeQuem,
    pagina,
    temMais,
  });
});

module.exports = router;
