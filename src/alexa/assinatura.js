// Verifica que a requisição veio mesmo da Alexa, conforme a documentação da Amazon:
// https://developer.amazon.com/docs/custom-skills/host-a-custom-skill-as-a-web-service.html
const crypto = require('node:crypto');
const tls = require('node:tls');

const TOLERANCIA_MS = 150 * 1000;
const cacheCertificados = new Map(); // url -> { folha, expira }
let raizes = null;

function urlCertificadoValida(texto) {
  let url;
  try { url = new URL(texto); } catch { return false; }
  return url.protocol === 'https:'
    && url.hostname.toLowerCase() === 's3.amazonaws.com'
    && (url.port === '' || url.port === '443')
    && url.pathname.startsWith('/echo.api/'); // new URL já resolve "../"
}

function validoAgora(cert) {
  const agora = Date.now();
  return new Date(cert.validFrom).getTime() <= agora && agora <= new Date(cert.validTo).getTime();
}

function raizesConfiaveis() {
  if (!raizes) raizes = tls.rootCertificates.map((pem) => new crypto.X509Certificate(pem));
  return raizes;
}

function emitidoPorRaiz(cert) {
  return raizesConfiaveis().some((raiz) =>
    raiz.fingerprint256 === cert.fingerprint256 || (cert.checkIssued(raiz) && cert.verify(raiz.publicKey)));
}

// Confere a cadeia folha -> intermediários até chegar numa raiz confiável do sistema.
// A Amazon envia também certificados cruzados antigos no fim da cadeia; paramos na primeira raiz confiável.
function cadeiaValida(certs) {
  const [folha] = certs;
  if (!folha || !folha.subjectAltName?.split(', ').includes('DNS:echo-api.amazon.com')) return false;
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (!validoAgora(cert)) return false;
    if (emitidoPorRaiz(cert)) return true;
    const emissor = certs[i + 1];
    if (!emissor || !emissor.ca || !cert.checkIssued(emissor) || !cert.verify(emissor.publicKey)) return false;
  }
  return false;
}

async function certificadoFolha(url) {
  const emCache = cacheCertificados.get(url);
  if (emCache && emCache.expira > Date.now()) return emCache.folha;

  const resp = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!resp.ok) throw new Error(`certificado indisponível (HTTP ${resp.status})`);
  const pem = await resp.text();
  const certs = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [])
    .map((c) => new crypto.X509Certificate(c));
  if (!cadeiaValida(certs)) throw new Error('cadeia de certificados inválida');

  const folha = certs[0];
  cacheCertificados.set(url, { folha, expira: new Date(folha.validTo).getTime() });
  return folha;
}

// Lança erro se a requisição não for autêntica
async function verificar(headers, corpoBruto, requisicao) {
  const url = headers['signaturecertchainurl'];
  const assinatura = headers['signature-256'];
  if (!url || !assinatura) throw new Error('cabeçalhos de assinatura ausentes');
  if (!urlCertificadoValida(url)) throw new Error('URL do certificado inválida');

  const folha = await certificadoFolha(url);
  const ok = crypto.verify('sha256', corpoBruto, folha.publicKey, Buffer.from(assinatura, 'base64'));
  if (!ok) throw new Error('assinatura não confere');

  const momento = new Date(requisicao?.request?.timestamp).getTime();
  if (!(Math.abs(Date.now() - momento) <= TOLERANCIA_MS)) throw new Error('requisição fora do horário permitido');
}

module.exports = { verificar, urlCertificadoValida, cadeiaValida };
