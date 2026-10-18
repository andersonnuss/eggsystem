// Converte o que foi falado (produto, quantidade, unidade) em um lançamento de produção
const { semelhanca, numero, unidadeProducao } = require('../util');

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Formas faladas -> chave da unidade (a mesma chave das unidades cadastradas nos produtos)
const UNIDADES = {
  ovo: ['ovo', 'ovos'],
  duzia: ['duzia', 'duzias'],
  kg: ['kg', 'quilo', 'quilos', 'kilo', 'kilos', 'quilograma', 'quilogramas'],
  g: ['g', 'grama', 'gramas'],
  litro: ['litro', 'litros', 'l'],
  un: ['un', 'unidade', 'unidades'],
  maco: ['maco', 'macos'],
  pote: ['pote', 'potes'],
  bandeja: ['bandeja', 'bandejas'],
  pacote: ['pacote', 'pacotes'],
};
const PLURAL = {
  ovo: 'ovos', duzia: 'dúzias', kg: 'quilos', g: 'gramas', litro: 'litros',
  un: 'unidades', maco: 'maços', pote: 'potes', bandeja: 'bandejas', pacote: 'pacotes',
};
const SINGULAR = { kg: 'quilo', g: 'grama', un: 'unidade', duzia: 'dúzia', maco: 'maço' };

function chaveUnidade(texto) {
  const t = semAcento(texto);
  for (const [chave, formas] of Object.entries(UNIDADES)) if (formas.includes(t)) return chave;
  return t;
}

// Texto para a Alexa falar: "30 ovos", "1 dúzia", "6,5 quilos"
function falarQuantidade(qtd, unidade) {
  const chave = chaveUnidade(unidade);
  const nome = qtd === 1 ? (SINGULAR[chave] || unidade) : (PLURAL[chave] || unidade);
  return `${numero(qtd)} ${nome}`;
}

// { produto } | { ambiguos: [...] } | { nenhum: true }
function encontrarProduto(falado, produtos) {
  const pontuados = produtos
    .map((p) => ({ p, pontos: semelhanca(falado, p.nome), cobertura: semelhanca(p.nome, falado) }))
    .filter((x) => x.pontos >= 1)
    .sort((a, b) => b.cobertura - a.cobertura);
  if (!pontuados.length) return { nenhum: true };
  if (pontuados.length === 1) return { produto: pontuados[0].p };
  // Vários candidatos: só decide sozinho se um deles bate com o nome inteiro (ex.: "ovos caipira")
  const exatos = pontuados.filter((x) => x.cobertura === 1);
  if (exatos.length === 1) return { produto: exatos[0].p };
  return { ambiguos: (exatos.length ? exatos : pontuados).map((x) => x.p) };
}

// Quantidade falada -> quantidade na unidade de produção do produto
function converter(qtd, unidadeFalada, produto) {
  const producao = unidadeProducao(produto);
  if (!unidadeFalada) return { quantidade: qtd };
  const falada = chaveUnidade(unidadeFalada);
  if (falada === chaveUnidade(producao)) return { quantidade: qtd };
  if (falada === chaveUnidade(produto.unidade)) return { quantidade: qtd * produto.fator };
  const aceitas = [...new Set([producao, produto.unidade])].map((u) => PLURAL[chaveUnidade(u)] || u).join(' ou ');
  return { erro: `${produto.nome} é registrado em ${aceitas}, não em ${unidadeFalada}.` };
}

module.exports = { chaveUnidade, falarQuantidade, encontrarProduto, converter, semAcento, PLURAL };
