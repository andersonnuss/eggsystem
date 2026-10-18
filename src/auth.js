const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');
const historico = require('./historico');

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

// Login: minúsculas, números, ponto, hífen e sublinhado
function erroUsuario(usuario) {
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    return 'O usuário deve ter de 3 a 30 caracteres: letras minúsculas sem acento, números, ponto, hífen ou sublinhado.';
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ? COLLATE NOCASE').get(usuario)) {
    return 'Já existe um usuário com esse login.';
  }
  return null;
}

function erroSenha(senha, confirmacao) {
  if (senha.length < 8) return 'A senha precisa ter ao menos 8 caracteres.';
  if (senha !== confirmacao) return 'As senhas não conferem.';
  return null;
}

function existeUsuario() {
  return !!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
}

// Confere a cada requisição se o usuário da sessão ainda existe e está ativo
function exigirLogin(req, res, next) {
  const usuario = req.session.usuarioId
    && db.prepare('SELECT id, usuario, nome FROM usuarios WHERE id = ? AND ativo = 1').get(req.session.usuarioId);
  if (usuario) {
    res.locals.usuarioAtual = usuario;
    return next();
  }
  req.session = null;
  res.redirect(existeUsuario() ? '/login' : '/configurar');
}

const router = express.Router();

router.get('/login', (req, res) => {
  if (!existeUsuario()) return res.redirect('/configurar');
  res.render('login', { titulo: 'Entrar', erro: null, usuario: '' });
});

router.post('/login', (req, res) => {
  const usuario = String(req.body.usuario || '').trim();
  const row = db.prepare('SELECT * FROM usuarios WHERE usuario = ? COLLATE NOCASE').get(usuario);
  const senhaOk = row && verificarSenha(String(req.body.senha || ''), row.senha_hash);
  if (!senhaOk || !row.ativo) {
    historico.registrar(req, {
      entidade: 'acesso', acao: 'falhou',
      resumo: `Tentativa de login sem sucesso (usuário "${usuario.slice(0, 50)}"${senhaOk ? ', inativo' : ''}, IP ${req.ip})`,
    });
    const erro = senhaOk ? 'Este usuário está desativado.' : 'Usuário ou senha inválidos.';
    return res.status(401).render('login', { titulo: 'Entrar', erro, usuario });
  }
  req.session.usuarioId = row.id;
  req.session.usuarioNome = row.usuario;
  historico.registrar(req, { entidade: 'acesso', id: row.id, acao: 'entrou', resumo: `Entrou no sistema (IP ${req.ip})` });
  res.redirect('/');
});

router.post('/sair', (req, res) => {
  if (req.session.usuarioId) {
    historico.registrar(req, { entidade: 'acesso', id: req.session.usuarioId, acao: 'saiu', resumo: 'Saiu do sistema' });
  }
  req.session = null;
  res.redirect('/login');
});

// Primeiro acesso: cria o primeiro usuário. Fica indisponível depois disso.
router.get('/configurar', (req, res) => {
  if (existeUsuario()) return res.redirect('/login');
  res.render('configurar', { titulo: 'Primeiro acesso', erro: null, usuario: '', nome: '' });
});

router.post('/configurar', (req, res) => {
  if (existeUsuario()) return res.redirect('/login');
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const nome = String(req.body.nome || '').trim();
  const senha = String(req.body.senha || '');
  const erro = (!nome && 'Informe seu nome.') || erroUsuario(usuario) || erroSenha(senha, req.body.confirmacao);
  if (erro) return res.status(400).render('configurar', { titulo: 'Primeiro acesso', erro, usuario, nome });

  const { lastInsertRowid } = db
    .prepare("INSERT INTO usuarios (usuario, nome, senha_hash, criado_em) VALUES (?, ?, ?, datetime('now'))")
    .run(usuario, nome, hashSenha(senha));
  req.session.usuarioId = Number(lastInsertRowid);
  req.session.usuarioNome = usuario;
  historico.registrar(req, {
    entidade: 'usuario', id: lastInsertRowid, acao: 'criou',
    resumo: `Criou o usuário ${usuario} (${nome}) no primeiro acesso (IP ${req.ip})`,
  });
  res.redirect('/');
});

module.exports = { router, exigirLogin, hashSenha, verificarSenha, erroUsuario, erroSenha };
