const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
require('./db');
const util = require('./util');
const auth = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET não definido: usando um segredo temporário (o login cai a cada reinício).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
// Muda a cada reinício: força o navegador a baixar CSS/ícone novos após uma atualização
app.locals.versao = Date.now().toString(36);

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'eggsystem',
    secret,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
);

// Variáveis disponíveis em todas as views
app.use((req, res, next) => {
  res.locals.u = util;
  res.locals.caminho = req.path;
  res.locals.usuarioNome = req.session.usuarioNome;
  res.locals.aviso = req.session.aviso;
  delete req.session.aviso;
  next();
});

app.use(auth.router);
app.use(auth.exigirLogin);
app.use('/', require('./routes/painel'));
app.use('/produtos', require('./routes/produtos'));
app.use('/clientes', require('./routes/clientes'));
app.use('/producao', require('./routes/producao'));
app.use('/vendas', require('./routes/vendas'));
app.use('/historico', require('./routes/historico'));

app.use((req, res) => {
  res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Página não encontrada.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('erro', { titulo: 'Erro', mensagem: 'Algo deu errado. Veja o log do servidor.' });
});

app.listen(PORT, () => {
  console.log(`Eggsystem rodando em http://localhost:${PORT}`);
});
