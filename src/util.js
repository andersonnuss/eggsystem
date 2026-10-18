// Dinheiro é guardado em centavos (inteiro) para evitar erros de arredondamento.

function parseDinheiro(texto) {
  if (texto === undefined || texto === null) return 0;
  let s = String(texto).trim().replace(/[R$\s]/g, '');
  if (s === '') return 0;
  // "1.234,56" -> "1234.56"; "12,5" -> "12.5"; "12.50" continua
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

function parseQuantidade(texto) {
  const n = Number(String(texto ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

function dinheiro(centavos) {
  return fmtMoeda.format((centavos || 0) / 100);
}

function numero(n) {
  return fmtNumero.format(n || 0);
}

// Valor para <input> de preço: 1250 -> "12,50"
function dinheiroInput(centavos) {
  return ((centavos || 0) / 100).toFixed(2).replace('.', ',');
}

function hoje() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// "2026-10-17" -> "17/10/2026"
function data(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function dataValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

function textoOuNull(s) {
  const t = String(s ?? '').trim();
  return t === '' ? null : t;
}

function linkWhatsApp(telefone) {
  let digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length <= 11) digitos = '55' + digitos;
  return `https://wa.me/${digitos}`;
}

module.exports = {
  parseDinheiro,
  parseQuantidade,
  dinheiro,
  dinheiroInput,
  numero,
  hoje,
  data,
  dataValida,
  textoOuNull,
  linkWhatsApp,
};
