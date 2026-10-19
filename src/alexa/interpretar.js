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

// Palavras sem acento e no singular simples ("Ovos Caipiras" -> ovo, caipira)
function palavras(texto) {
  return semAcento(texto).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

// { produto } | { ambiguos: [...] } | { nenhum: true }
// Ordem de decisão: nome completo falado > palavras exatas > aproximação (prefixo/erro de digitação).
// Ex.: "mel" fica com "Mel de abelha" (palavra exata), não com "Melado" (só prefixo);
// "aipim" com "Aipim de Primeira" e "Aipim de Segunda" pergunta qual.
function encontrarProduto(falado, produtos) {
  const ditas = palavras(falado);
  const candidatos = produtos.filter((p) => semelhanca(falado, p.nome) >= 1);
  if (!candidatos.length) return { nenhum: true };

  const completos = candidatos.filter((p) => palavras(p.nome).every((w) => ditas.includes(w)));
  if (completos.length === 1) return { produto: completos[0] };

  const exatos = candidatos.filter((p) => {
    const doProduto = palavras(p.nome);
    return ditas.every((w) => doProduto.includes(w));
  });
  if (exatos.length === 1) return { produto: exatos[0] };
  if (exatos.length > 1) return { ambiguos: exatos };
  return candidatos.length === 1 ? { produto: candidatos[0] } : { ambiguos: candidatos };
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
