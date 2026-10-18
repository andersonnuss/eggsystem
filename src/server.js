const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
require('./db');
const util = require('./util');
const auth = require('./auth');
const google = require('./google');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const MODO_COOKIE = ['true', 'false'].includes(process.env.COOKIE_SECURE) ? process.env.COOKIE_SECURE : 'auto';

let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET não definido: usando um segredo temporário (o login cai a cada reinício).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
// Proxies confiáveis (Cloudflare Tunnel, Caddy...): define req.ip e se a conexão original era HTTPS.
// Padrão: só proxies na própria máquina. Ex.: TRUST_PROXY=loopback, 172.17.0.0/16 (cloudflared em Docker).
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', trustProxy === 'true' ? true : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.disable('x-powered-by');
// Muda a cada reinício: força o navegador a baixar CSS/ícone novos após uma atualização
app.locals.versao = Date.now().toString(36);

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
// A Alexa autentica por assinatura (não por login), por isso fica antes da sessão
app.use('/alexa', require('./alexa'));
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'eggsystem',
    secret,
    httpOnly: true,
    sameSite: 'lax',
    secure: MODO_COOKIE === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
);

// COOKIE_SECURE=auto (padrão): cookie "Secure" quando a requisição chegou por HTTPS.
// Com "true" e uma requisição que não parece HTTPS, a biblioteca descarta o cookie em silêncio
// (login e "Entrar com Google" falham), então avisamos no log.
let ultimoAviso = 0;
app.use((req, res, next) => {
  if (MODO_COOKIE === 'auto') {
    req.sessionOptions.secure = req.secure;
  } else if (MODO_COOKIE === 'true' && !req.secure) {
    res.locals.cookieBloqueado = true;
    if (Date.now() - ultimoAviso > 10 * 60 * 1000) {
      ultimoAviso = Date.now();
      console.warn(
        `ATENÇÃO: COOKIE_SECURE=true, mas a requisição chegou como HTTP (IP do proxy ${req.socket.remoteAddress}, ` +
        `X-Forwarded-Proto=${req.get('x-forwarded-proto') || 'ausente'}). O cookie de sessão NÃO será gravado. ` +
        'Use COOKIE_SECURE=auto ou inclua o IP do proxy em TRUST_PROXY.'
      );
    }
  }
  next();
});

// Variáveis disponíveis em todas as views
app.use((req, res, next) => {
  res.locals.u = util;
  res.locals.caminho = req.path;
  res.locals.usuarioNome = req.session.usuarioNome;
  res.locals.aviso = req.session.aviso;
  res.locals.googleAtivo = google.configurado();
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
app.use('/integracoes', require('./routes/integracoes'));
app.use('/usuarios', require('./routes/usuarios'));

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
