// Cadastro de usuários. Todos têm os mesmos acessos; serve para saber quem fez o quê no histórico.
// Forma de acesso: "google" (entra com a conta Google do e-mail, sem senha) ou "senha" (login e senha).
const express = require('express');
const { db, transaction } = require('../db');
const auth = require('../auth');
const historico = require('../historico');
const google = require('../google');

const router = express.Router();

const lerEmail = (body) => String(body.email || '').trim().toLowerCase() || null;
const lerAcesso = (body) => (body.acesso === 'google' ? 'google' : 'senha');

function buscar(id) {
  return db.prepare(`
    SELECT id, usuario, nome, email, ativo, date(criado_em, 'localtime') AS cadastro,
      CASE WHEN senha_hash = ? THEN 'google' ELSE 'senha' END AS acesso
    FROM usuarios WHERE id = ?
  `).get(auth.SEM_SENHA, id);
}

function renderForm(res, titulo, usuario, erro, status = 200) {
  res.status(status).render('usuarios/form', { titulo, usuario, erro, googleAtivo: google.configurado() });
}

function ativos() {
  return db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1').get().n;
}

router.get('/', (req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.usuario, u.nome, u.email, u.ativo,
      CASE WHEN u.senha_hash = ? THEN 'google' ELSE 'senha' END AS acesso,
      (SELECT datetime(MAX(criado_em), 'localtime') FROM historico WHERE usuario = u.usuario) AS ultima_atividade
    FROM usuarios u
    ORDER BY u.ativo DESC, COALESCE(u.nome, u.usuario)
  `).all(auth.SEM_SENHA);
  res.render('usuarios/lista', { titulo: 'Usuários', usuarios, googleAtivo: google.configurado() });
});

router.get('/novo', (req, res) => {
  renderForm(res, 'Novo usuário', { usuario: '', nome: '', email: '', acesso: 'google' }, null);
});

router.post('/', (req, res) => {
  const acesso = lerAcesso(req.body);
  const usuario = { nome: String(req.body.nome || '').trim(), email: lerEmail(req.body), acesso };
  // Quem entra pelo Google é identificado pelo próprio e-mail
  usuario.usuario = acesso === 'google' ? usuario.email || '' : String(req.body.usuario || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  let erro = (!usuario.nome && 'Informe o nome.') || auth.erroEmail(usuario.email);
  if (!erro && acesso === 'google') {
    if (!usuario.email) erro = 'Informe o e-mail da conta Google (ex.: maria@gmail.com).';
    else if (auth.loginEmUso(usuario.usuario)) erro = 'Já existe um usuário com esse e-mail como login.';
  } else if (!erro) {
    erro = auth.erroUsuario(usuario.usuario) || auth.erroSenha(senha, req.body.confirmacao);
  }
  if (erro) return renderForm(res, 'Novo usuário', usuario, erro, 400);

  transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO usuarios (usuario, nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, datetime('now'))")
      .run(usuario.usuario, usuario.nome, usuario.email, acesso === 'google' ? auth.SEM_SENHA : auth.hashSenha(senha));
    historico.registrar(req, {
      entidade: 'usuario', id: lastInsertRowid, acao: 'criou',
      resumo: `Cadastrou o usuário ${usuario.nome} (${usuario.usuario})`,
      detalhes: historico.retrato('usuario', { ...usuario, ativo: 1 }),
    });
  });
  req.session.aviso = acesso === 'google'
    ? `${usuario.nome} já pode entrar com a conta Google ${usuario.email}.`
    : `Usuário "${usuario.usuario}" cadastrado. Passe a senha para ${usuario.nome} pessoalmente.`;
  res.redirect('/usuarios');
});

// Trocar a própria senha (exige a senha atual). Fica antes de /:id.
router.get('/minha-senha', (req, res) => {
  const row = buscar(req.session.usuarioId);
  res.render('usuarios/senha', { titulo: 'Minha senha', erro: null, viaGoogle: row.acesso === 'google', email: row.email });
});

router.post('/minha-senha', (req, res) => {
  const row = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuarioId);
  if (!auth.temSenha(row)) return res.redirect('/usuarios/minha-senha');
  const nova = String(req.body.senha || '');
  let erro = null;
  if (!auth.verificarSenha(String(req.body.atual || ''), row.senha_hash)) erro = 'A senha atual não confere.';
  else erro = auth.erroSenha(nova, req.body.confirmacao);
  if (erro) return res.status(400).render('usuarios/senha', { titulo: 'Minha senha', erro, viaGoogle: false, email: row.email });

  transaction(() => {
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(auth.hashSenha(nova), row.id);
    historico.registrar(req, { entidade: 'usuario', id: row.id, acao: 'alterou', resumo: `Trocou a própria senha (${row.usuario})` });
  });
  req.session.aviso = 'Senha alterada.';
  res.redirect('/usuarios');
});

router.get('/:id', (req, res, next) => {
  const usuario = buscar(req.params.id);
  if (!usuario) return next();
  renderForm(res, 'Editar usuário', usuario, null);
});

router.post('/:id', (req, res, next) => {
  const atual = buscar(req.params.id);
  if (!atual) return next();
  const usuario = {
    ...atual,
    nome: String(req.body.nome || '').trim(),
    email: lerEmail(req.body),
    acesso: lerAcesso(req.body),
    ativo: req.body.ativo ? 1 : 0,
  };
  const senha = String(req.body.senha || '');
  const eu = atual.id === req.session.usuarioId;
  const paraGoogle = usuario.acesso === 'google';

  let erro = null;
  if (!usuario.nome) erro = 'Informe o nome.';
  else if (!usuario.ativo && eu) erro = 'Você não pode desativar o seu próprio usuário.';
  else if (!usuario.ativo && atual.ativo && ativos() <= 1) erro = 'Precisa existir ao menos um usuário ativo.';
  else if (paraGoogle && !usuario.email) erro = 'Para entrar com o Google, informe o e-mail da conta Google.';
  else if (paraGoogle && eu && atual.acesso !== 'google' && !google.configurado()) {
    erro = 'O login com Google ainda não está configurado no servidor. Se mudar agora, você não conseguirá entrar.';
  } else if (!paraGoogle && atual.acesso === 'google' && !senha) {
    erro = 'Para usar usuário e senha, defina uma senha.';
  } else {
    erro = auth.erroEmail(usuario.email, atual.id) || (!paraGoogle && senha ? auth.erroSenha(senha, req.body.confirmacao) : null);
  }
  if (erro) return renderForm(res, 'Editar usuário', usuario, erro, 400);

  transaction(() => {
    db.prepare('UPDATE usuarios SET nome = ?, email = ?, ativo = ? WHERE id = ?').run(usuario.nome, usuario.email, usuario.ativo, atual.id);
    if (paraGoogle) db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(auth.SEM_SENHA, atual.id);
    else if (senha) db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(auth.hashSenha(senha), atual.id);
    const detalhes = historico.mudancas('usuario', atual, usuario) || {};
    const senhaRedefinida = !paraGoogle && senha && atual.acesso === 'senha';
    if (senhaRedefinida) detalhes.Senha = { de: '••••', para: 'redefinida' };
    if (Object.keys(detalhes).length) {
      historico.registrar(req, {
        entidade: 'usuario', id: atual.id, acao: 'alterou',
        resumo: `Alterou o usuário ${usuario.nome}${senhaRedefinida ? ' (senha redefinida)' : ''}`,
        detalhes,
      });
    }
  });
  req.session.aviso = 'Usuário atualizado.';
  res.redirect('/usuarios');
});

module.exports = router;
