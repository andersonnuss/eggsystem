// Gera o "Interaction Model" (JSON) para colar no Alexa Developer Console, idioma pt-BR.
// Os produtos ativos entram como valores do slot PRODUTO, para a Alexa reconhecê-los melhor.
const { produtosAtivos } = require('../consultas');

const INVOCACAO = process.env.ALEXA_INVOCACAO || 'meu sítio';

const AMOSTRAS_PRODUCAO = [
  '{quantidade} {produto}',
  '{quantidade} {unidade} de {produto}',
  '{data} {quantidade} {produto}',
  '{data} {quantidade} {unidade} de {produto}',
  'produção de {quantidade} {produto}',
  'produção de {quantidade} {unidade} de {produto}',
  'a produção de {quantidade} {produto}',
  'a produção foi de {quantidade} {produto}',
  'a produção foi de {quantidade} {unidade} de {produto}',
  '{data} a produção de {quantidade} {produto}',
  '{data} a produção de {quantidade} {unidade} de {produto}',
  '{data} a produção foi de {quantidade} {produto}',
  '{data} a produção foi de {quantidade} {unidade} de {produto}',
  'tive {quantidade} {produto}',
  'tive {quantidade} {unidade} de {produto}',
  '{data} tive {quantidade} {produto}',
  '{data} tive {quantidade} {unidade} de {produto}',
  'colhi {quantidade} {produto}',
  'colhi {quantidade} {unidade} de {produto}',
  '{data} colhi {quantidade} {produto}',
  '{data} colhi {quantidade} {unidade} de {produto}',
  'registrar {quantidade} {produto}',
  'registrar {quantidade} {unidade} de {produto}',
  'registrar produção de {quantidade} {produto}',
  'registrar produção de {quantidade} {unidade} de {produto}',
  'anotar {quantidade} {produto}',
  'anotar {quantidade} {unidade} de {produto}',
];

const AMOSTRAS_PERDA = [
  'perdi {quantidade} {produto}',
  'perdi {quantidade} {unidade} de {produto}',
  '{data} perdi {quantidade} {produto}',
  '{data} perdi {quantidade} {unidade} de {produto}',
  'quebraram {quantidade} {produto}',
  '{data} quebraram {quantidade} {produto}',
  'quebrou {quantidade} {produto}',
  'perda de {quantidade} {produto}',
  'perda de {quantidade} {unidade} de {produto}',
  '{data} perda de {quantidade} {produto}',
  'registrar perda de {quantidade} {produto}',
  'registrar perda de {quantidade} {unidade} de {produto}',
];

const UNIDADES_FALADAS = [
  ['ovo', ['ovos']],
  ['dúzia', ['dúzias']],
  ['quilo', ['quilos', 'kg', 'quilograma', 'quilogramas', 'kilo', 'kilos']],
  ['grama', ['gramas']],
  ['litro', ['litros']],
  ['unidade', ['unidades']],
  ['maço', ['maços']],
  ['pote', ['potes']],
  ['bandeja', ['bandejas']],
  ['pacote', ['pacotes']],
];

const SLOTS = [
  { name: 'quantidade', type: 'AMAZON.NUMBER' },
  { name: 'unidade', type: 'UNIDADE' },
  { name: 'produto', type: 'PRODUTO' },
  { name: 'data', type: 'AMAZON.DATE' },
];

const usaSlot = (amostras) => SLOTS.filter((s) => amostras.some((a) => a.includes(`{${s.name}}`)));

const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

// "Ovos Caipiras" -> sinônimos "ovos", "ovo", "ovo caipira"
function sinonimos(nome) {
  const minusculo = nome.toLowerCase();
  const [primeira, ...resto] = minusculo.split(/\s+/);
  const variacoes = new Set([primeira, singular(primeira)]);
  if (resto.length) variacoes.add([primeira, ...resto].map(singular).join(' '));
  variacoes.delete(minusculo);
  return [...variacoes];
}

function gerar() {
  const produtos = produtosAtivos();
  // Sinônimo que serve para mais de um produto (ex.: "aipim" em "Aipim de Primeira" e "de Segunda")
  // fica de fora: assim a Alexa repassa o que foi falado e o sistema pergunta qual é.
  const todos = produtos.map((p) => sinonimos(p.nome));
  const contagem = new Map();
  for (const lista of todos) for (const s of lista) contagem.set(s, (contagem.get(s) || 0) + 1);
  const nomes = new Set(produtos.map((p) => p.nome.toLowerCase()));
  const valoresProduto = produtos.length
    ? produtos.map((p, i) => ({
      name: { value: p.nome, synonyms: todos[i].filter((s) => contagem.get(s) === 1 && !nomes.has(s)) },
    }))
    : [{ name: { value: 'ovos', synonyms: ['ovo'] } }];

  return {
    interactionModel: {
      languageModel: {
        invocationName: INVOCACAO,
        intents: [
          { name: 'RegistrarProducaoIntent', slots: usaSlot(AMOSTRAS_PRODUCAO), samples: AMOSTRAS_PRODUCAO },
          { name: 'RegistrarPerdaIntent', slots: usaSlot(AMOSTRAS_PERDA), samples: AMOSTRAS_PERDA },
          {
            name: 'DesfazerIntent', slots: [],
            samples: ['desfazer', 'desfaz', 'desfazer o último', 'apagar o último', 'apaga o último',
              'cancelar o último lançamento', 'remover o último lançamento', 'errei'],
          },
          { name: 'AMAZON.HelpIntent', samples: [] },
          { name: 'AMAZON.CancelIntent', samples: [] },
          { name: 'AMAZON.StopIntent', samples: [] },
          { name: 'AMAZON.NavigateHomeIntent', samples: [] },
          { name: 'AMAZON.FallbackIntent', samples: [] },
        ],
        types: [
          { name: 'PRODUTO', values: valoresProduto },
          { name: 'UNIDADE', values: UNIDADES_FALADAS.map(([value, synonyms]) => ({ name: { value, synonyms } })) },
        ],
      },
    },
  };
}

module.exports = { gerar, INVOCACAO };
