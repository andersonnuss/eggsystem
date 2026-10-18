// "Entrar com Google" via OAuth 2.0 / OpenID Connect (fluxo de código com PKCE), sem bibliotecas.
// https://developers.google.com/identity/openid-connect/openid-connect
const crypto = require('node:crypto');

const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const EMISSORES = ['https://accounts.google.com', 'accounts.google.com'];
const VALIDADE_MS = 10 * 60 * 1000; // tempo para concluir o login no Google

class ErroGoogle extends Error {}

const aleatorio = () => crypto.randomBytes(32).toString('base64url');

function configurado() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Precisa ser idêntica à cadastrada no Google Cloud. Em produção defina PUBLIC_URL.
function urlRetorno(req) {
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/auth/google/retorno`;
}

// Monta a URL do Google e guarda na sessão o que será conferido na volta
function iniciar(req) {
  const estado = { state: aleatorio(), nonce: aleatorio(), verifier: aleatorio(), criado: Date.now() };
  req.session.google = estado;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: urlRetorno(req),
    response_type: 'code',
    scope: 'openid email profile',
    state: estado.state,
    nonce: estado.nonce,
    code_challenge: crypto.createHash('sha256').update(estado.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${URL_AUTORIZACAO}?${params}`;
}

function iguais(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Confere os dados do id_token. Ele vem direto do Google por HTTPS (troca de código no servidor),
// então a especificação dispensa conferir a assinatura; validamos as afirmações (claims).
function validarIdToken(idToken, nonce) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new ErroGoogle('Resposta do Google inválida.');
  let dados;
  try {
    dados = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    throw new ErroGoogle('Resposta do Google inválida.');
  }
  const publicos = Array.isArray(dados.aud) ? dados.aud : [dados.aud];
  if (!EMISSORES.includes(dados.iss)) throw new ErroGoogle('Emissor do token inválido.');
  if (!publicos.includes(process.env.GOOGLE_CLIENT_ID)) throw new ErroGoogle('Token emitido para outro aplicativo.');
  if (!(Number(dados.exp) * 1000 > Date.now())) throw new ErroGoogle('Token do Google expirado.');
  if (!iguais(dados.nonce, nonce)) throw new ErroGoogle('Token do Google não corresponde a este login.');
  if (dados.email_verified !== true || !dados.email) throw new ErroGoogle('A conta Google não tem e-mail verificado.');
  return { email: String(dados.email).toLowerCase(), nome: dados.name || null };
}

// Trata a volta do Google; devolve { email, nome } ou lança ErroGoogle
async function concluir(req) {
  const estado = req.session.google;
  delete req.session.google; // uso único
  if (req.query.error) throw new ErroGoogle('Login com Google cancelado.');
  if (!estado || Date.now() - estado.criado > VALIDADE_MS || !iguais(req.query.state, estado.state)) {
    throw new ErroGoogle('O login com Google expirou ou não foi iniciado aqui. Tente de novo.');
  }
  if (!req.query.code) throw new ErroGoogle('Resposta do Google sem código de autorização.');

  let resposta;
  try {
    resposta = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: urlRetorno(req),
        grant_type: 'authorization_code',
        code_verifier: estado.verifier,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ErroGoogle('Não foi possível falar com o Google. Tente de novo.');
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    console.warn('Google: troca de código falhou:', resposta.status, corpo.error, corpo.error_description);
    throw new ErroGoogle('O Google recusou o login. Tente de novo.');
  }
  return validarIdToken(corpo.id_token, estado.nonce);
}

module.exports = { configurado, iniciar, concluir, urlRetorno, ErroGoogle };
