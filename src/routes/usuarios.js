// Cadastro de usuários. Todos têm os mesmos acessos; serve para saber quem fez o quê no histórico.
const express = require('express');
const { db, transaction } = require('../db');
const { hashSenha, verificarSenha, erroUsuario, erroSenha } = require('../auth');
const historico = require('../historico');

const router = express.Router();

function buscar(id) {
  return db.prepare("SELECT id, usuario, nome, ativo, date(criado_em, 'localtime') AS cadastro FROM usuarios WHERE id = ?").get(id);
}

function ativos() {
  return db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1').get().n;
}

router.get('/', (req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.usuario, u.nome, u.ativo,
      (SELECT datetime(MAX(criado_em), 'localtime') FROM historico WHERE usuario = u.usuario) AS ultima_atividade
    FROM usuarios u
    ORDER BY u.ativo DESC, COALESCE(u.nome, u.usuario)
  `).all();
  res.render('usuarios/lista', { titulo: 'Usuários', usuarios });
});

router.get('/novo', (req, res) => {
  res.render('usuarios/form', { titulo: 'Novo usuário', usuario: { usuario: '', nome: '' }, erro: null });
});

router.post('/', (req, res) => {
  const usuario = { usuario: String(req.body.usuario || '').trim().toLowerCase(), nome: String(req.body.nome || '').trim() };
  const senha = String(req.body.senha || '');
  const erro = (!usuario.nome && 'Informe o nome.') || erroUsuario(usuario.usuario) || erroSenha(senha, req.body.confirmacao);
  if (erro) return res.status(400).render('usuarios/form', { titulo: 'Novo usuário', usuario, erro });

  transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO usuarios (usuario, nome, senha_hash, criado_em) VALUES (?, ?, ?, datetime('now'))")
      .run(usuario.usuario, usuario.nome, hashSenha(senha));
    historico.registrar(req, {
      entidade: 'usuario', id: lastInsertRowid, acao: 'criou',
      resumo: `Cadastrou o usuário ${usuario.usuario} (${usuario.nome})`,
      detalhes: historico.retrato('usuario', { ...usuario, ativo: 1 }),
    });
  });
  req.session.aviso = `Usuário "${usuario.usuario}" cadastrado. Passe a senha para ${usuario.nome} pessoalmente.`;
  res.redirect('/usuarios');
});

// Trocar a própria senha (exige a senha atual). Fica antes de /:id.
router.get('/minha-senha', (req, res) => {
  res.render('usuarios/senha', { titulo: 'Minha senha', erro: null });
});

router.post('/minha-senha', (req, res) => {
  const row = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuarioId);
  const nova = String(req.body.senha || '');
  let erro = null;
  if (!verificarSenha(String(req.body.atual || ''), row.senha_hash)) erro = 'A senha atual não confere.';
  else erro = erroSenha(nova, req.body.confirmacao);
  if (erro) return res.status(400).render('usuarios/senha', { titulo: 'Minha senha', erro });

  transaction(() => {
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(nova), row.id);
    historico.registrar(req, { entidade: 'usuario', id: row.id, acao: 'alterou', resumo: `Trocou a própria senha (${row.usuario})` });
  });
  req.session.aviso = 'Senha alterada.';
  res.redirect('/usuarios');
});

router.get('/:id', (req, res, next) => {
  const usuario = buscar(req.params.id);
  if (!usuario) return next();
  res.render('usuarios/form', { titulo: 'Editar usuário', usuario, erro: null });
});

router.post('/:id', (req, res, next) => {
  const atual = buscar(req.params.id);
  if (!atual) return next();
  const usuario = { ...atual, nome: String(req.body.nome || '').trim(), ativo: req.body.ativo ? 1 : 0 };
  const senha = String(req.body.senha || '');
  const eu = atual.id === req.session.usuarioId;

  let erro = null;
  if (!usuario.nome) erro = 'Informe o nome.';
  else if (!usuario.ativo && eu) erro = 'Você não pode desativar o seu próprio usuário.';
  else if (!usuario.ativo && atual.ativo && ativos() <= 1) erro = 'Precisa existir ao menos um usuário ativo.';
  else if (senha) erro = erroSenha(senha, req.body.confirmacao);
  if (erro) return res.status(400).render('usuarios/form', { titulo: 'Editar usuário', usuario, erro });

  transaction(() => {
    db.prepare('UPDATE usuarios SET nome = ?, ativo = ? WHERE id = ?').run(usuario.nome, usuario.ativo, atual.id);
    if (senha) db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), atual.id);
    const detalhes = historico.mudancas('usuario', atual, usuario) || {};
    if (senha) detalhes.Senha = { de: '••••', para: 'redefinida' };
    if (Object.keys(detalhes).length) {
      historico.registrar(req, {
        entidade: 'usuario', id: atual.id, acao: 'alterou',
        resumo: `Alterou o usuário ${atual.usuario}${senha ? ' (senha redefinida)' : ''}`,
        detalhes,
      });
    }
  });
  req.session.aviso = 'Usuário atualizado.';
  res.redirect('/usuarios');
});

module.exports = router;
