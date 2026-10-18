const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');
const historico = require('./historico');
const google = require('./google');

// Usuários que entram só com a conta Google não têm senha: guardamos este marcador,
// que nunca confere com nenhuma senha digitada.
const SEM_SENHA = '!';
const temSenha = (row) => !!row && row.senha_hash !== SEM_SENHA;

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
  return loginEmUso(usuario) ? 'Já existe um usuário com esse login.' : null;
}

function loginEmUso(usuario) {
  return !!db.prepare('SELECT 1 FROM usuarios WHERE usuario = ? COLLATE NOCASE').get(usuario);
}

// E-mail opcional (já em minúsculas); não pode repetir entre usuários
function erroEmail(email, idAtual = null) {
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'E-mail inválido.';
  const dono = db.prepare('SELECT usuario FROM usuarios WHERE email = ? AND id IS NOT ?').get(email, idAtual);
  return dono ? `Este e-mail já está cadastrado para o usuário ${dono.usuario}.` : null;
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
  if (req.session.usuarioId) return res.redirect('/'); // já logado (o painel confere se segue ativo)
  const erro = res.locals.cookieBloqueado
    ? 'O servidor não está conseguindo gravar o cookie de sessão (configuração de HTTPS/proxy): o login não vai funcionar. Veja o log do serviço.'
    : null;
  res.render('login', { titulo: 'Entrar', erro, usuario: '' });
});

router.post('/login', (req, res) => {
  const usuario = String(req.body.usuario || '').trim();
  // Aceita o login ou o e-mail cadastrado
  const row = db.prepare(`
    SELECT * FROM usuarios WHERE usuario = ?1 COLLATE NOCASE OR email = ?2
    ORDER BY usuario = ?1 COLLATE NOCASE DESC LIMIT 1
  `).get(usuario, usuario.toLowerCase());
  if (row && !temSenha(row)) {
    historico.registrar(req, {
      entidade: 'acesso', acao: 'falhou',
      resumo: `Tentativa de login com senha de usuário que entra pelo Google (${row.usuario}, IP ${req.ip})`,
    });
    return res.status(401).render('login', {
      titulo: 'Entrar', usuario, erro: 'Este usuário entra com a conta Google: use o botão "Entrar com Google".',
    });
  }
  const senhaOk = row && verificarSenha(String(req.body.senha || ''), row.senha_hash);
  if (!senhaOk || !row.ativo) {
    historico.registrar(req, {
      entidade: 'acesso', acao: 'falhou',
      resumo: `Tentativa de login sem sucesso (usuário "${usuario.slice(0, 50)}"${senhaOk ? ', inativo' : ''}, IP ${req.ip})`,
    });
    const erro = senhaOk ? 'Este usuário está desativado.' : 'Usuário ou senha inválidos.';
    return res.status(401).render('login', { titulo: 'Entrar', erro, usuario });
  }
  entrar(req, res, row, 'senha');
});

function entrar(req, res, row, via) {
  req.session.usuarioId = row.id;
  req.session.usuarioNome = row.usuario;
  historico.registrar(req, {
    entidade: 'acesso', id: row.id, acao: 'entrou',
    resumo: `Entrou no sistema${via === 'google' ? ' com a conta Google' : ''} (IP ${req.ip})`,
  });
  res.redirect('/');
}

// Entrar com Google: só para usuários ativos cujo e-mail cadastrado é o da conta Google
router.get('/auth/google', (req, res, next) => {
  if (!google.configurado()) return next();
  const outroEndereco = google.enderecoCorreto(req);
  if (outroEndereco) return res.redirect(outroEndereco);
  if (res.locals.cookieBloqueado) {
    return res.status(500).render('login', {
      titulo: 'Entrar', usuario: '',
      erro: 'O servidor não está conseguindo gravar o cookie de sessão (configuração de HTTPS/proxy). Veja o log do serviço.',
    });
  }
  res.redirect(google.iniciar(req));
});

router.get('/auth/google/retorno', async (req, res, next) => {
  if (!google.configurado()) return next();
  const falhar = (erro, resumo) => {
    historico.registrar(req, { entidade: 'acesso', acao: 'falhou', resumo: `${resumo} (IP ${req.ip})` });
    res.status(401).render('login', { titulo: 'Entrar', erro, usuario: '' });
  };

  let conta;
  try {
    conta = await google.concluir(req);
  } catch (err) {
    if (err instanceof google.ErroGoogle) return falhar(err.message, `Login com Google sem sucesso: ${err.message}`);
    throw err;
  }
  const row = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(conta.email);
  if (!row) {
    return falhar(
      `A conta Google ${conta.email} não está cadastrada. Peça para incluírem esse e-mail no seu usuário.`,
      `Login com Google de e-mail não cadastrado (${conta.email})`
    );
  }
  if (!row.ativo) return falhar('Este usuário está desativado.', `Login com Google de usuário inativo (${row.usuario})`);
  entrar(req, res, row, 'google');
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

module.exports = {
  router, exigirLogin, hashSenha, verificarSenha, erroUsuario, erroEmail, erroSenha, loginEmUso, SEM_SENHA, temSenha,
};
