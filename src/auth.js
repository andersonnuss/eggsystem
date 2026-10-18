const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verificarSenha(senha, armazenado) {
  const [, saltHex, hashHex] = String(armazenado).split(':');
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(hash, esperado);
}

function existeUsuario() {
  return !!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
}

function exigirLogin(req, res, next) {
  if (req.session.usuarioId) return next();
  res.redirect(existeUsuario() ? '/login' : '/configurar');
}

const router = express.Router();

router.get('/login', (req, res) => {
  if (!existeUsuario()) return res.redirect('/configurar');
  res.render('login', { titulo: 'Entrar', erro: null, usuario: '' });
});

router.post('/login', (req, res) => {
  const usuario = String(req.body.usuario || '').trim();
  const row = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
  if (!row || !verificarSenha(String(req.body.senha || ''), row.senha_hash)) {
    return res.status(401).render('login', { titulo: 'Entrar', erro: 'Usuário ou senha inválidos.', usuario });
  }
  req.session.usuarioId = row.id;
  req.session.usuarioNome = row.usuario;
  res.redirect('/');
});

router.post('/sair', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// Primeiro acesso: cria o usuário administrador. Fica indisponível depois disso.
router.get('/configurar', (req, res) => {
  if (existeUsuario()) return res.redirect('/login');
  res.render('configurar', { titulo: 'Primeiro acesso', erro: null, usuario: '' });
});

router.post('/configurar', (req, res) => {
  if (existeUsuario()) return res.redirect('/login');
  const usuario = String(req.body.usuario || '').trim();
  const senha = String(req.body.senha || '');
  let erro = null;
  if (usuario.length < 3) erro = 'O usuário precisa ter ao menos 3 caracteres.';
  else if (senha.length < 8) erro = 'A senha precisa ter ao menos 8 caracteres.';
  else if (senha !== req.body.confirmacao) erro = 'As senhas não conferem.';
  if (erro) return res.status(400).render('configurar', { titulo: 'Primeiro acesso', erro, usuario });

  const { lastInsertRowid } = db
    .prepare('INSERT INTO usuarios (usuario, senha_hash) VALUES (?, ?)')
    .run(usuario, hashSenha(senha));
  req.session.usuarioId = Number(lastInsertRowid);
  req.session.usuarioNome = usuario;
  res.redirect('/');
});

module.exports = { router, exigirLogin };
