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

function somenteDigitos(s) {
  return String(s ?? '').replace(/\D/g, '');
}

// Valida os dígitos verificadores do CPF (recebe só dígitos)
function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

// "12345678909" -> "123.456.789-09"
function cpf(digitos) {
  if (!digitos) return '';
  return String(digitos).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

// Minúsculas e sem acentos, para comparar nomes
function normalizarNome(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distância de edição (Damerau): inserir, apagar, trocar ou inverter duas letras vizinhas conta 1
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Duas palavras "batem" se uma começa com a outra ou se diferem por poucas letras (erros de digitação)
function palavrasParecidas(a, b) {
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const limite = Math.min(a.length, b.length) >= 6 ? 2 : 1;
  return Math.min(a.length, b.length) >= 4 && distancia(a, b) <= limite;
}

// Pontua o quanto `nome` se parece com o texto digitado (0 = nada)
function semelhanca(digitado, nome) {
  const busca = normalizarNome(digitado).split(' ').filter((p) => p.length >= 2);
  const palavras = normalizarNome(nome).split(' ');
  if (!busca.length) return 0;
  const acertos = busca.filter((b) => palavras.some((p) => palavrasParecidas(b, p))).length;
  return acertos / busca.length;
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
  somenteDigitos,
  cpfValido,
  cpf,
  semelhanca,
};
