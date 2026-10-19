// Endpoint da skill da Alexa: lança produção/perda por voz
const express = require('express');
const { db } = require('../db');
const { produtosAtivos, produtosComEstoque } = require('../consultas');
const { hoje, dataValida, unidadeProducao } = require('../util');
const producao = require('../producao');
const assinatura = require('./assinatura');
const { encontrarProduto, converter, falarQuantidade } = require('./interpretar');

const SKILL_ID = process.env.ALEXA_SKILL_ID;
const SEM_VERIFICACAO = process.env.ALEXA_SEM_VERIFICACAO === 'true';
if (SEM_VERIFICACAO) console.warn('ATENÇÃO: ALEXA_SEM_VERIFICACAO=true. Use só para testes locais, nunca em produção.');

// Quem aparece no histórico como autor dos lançamentos por voz
const reqAlexa = { session: { usuarioNome: 'Alexa' } };

const AJUDA = 'Diga, por exemplo: hoje a produção foi de trinta ovos. Ou: tive dez quilos de aipim. ' +
  'Para perdas: perdi três ovos. E se errar, diga: desfazer.';

function responder(texto, { fim = true, pergunta = null, cartao = false } = {}) {
  const response = { outputSpeech: { type: 'PlainText', text: texto }, shouldEndSession: fim };
  if (pergunta) response.reprompt = { outputSpeech: { type: 'PlainText', text: pergunta } };
  if (cartao) response.card = { type: 'Simple', title: 'Eggsystem', content: texto };
  return { version: '1.0', response };
}

const perguntar = (texto) => responder(texto, { fim: false, pergunta: texto });

// Valor do slot, preferindo o valor resolvido pelo modelo (ex.: sinônimo "kg" -> "quilo").
// Se a Alexa resolveu para mais de um valor, usa o que foi falado e deixa o sistema perguntar.
function slot(intent, nome) {
  const s = intent.slots?.[nome];
  if (!s) return null;
  const resolvido = s.resolutions?.resolutionsPerAuthority?.find((r) => r.status?.code === 'ER_SUCCESS_MATCH');
  const valores = resolvido?.values || [];
  return (valores.length === 1 ? valores[0].value?.name : null) || s.value || null;
}

function lista(nomes, conectivo = 'e') {
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} ${conectivo} ${nomes.at(-1)}` : nomes[0];
}

// "2,75 dúzias, ou 33 ovos" quando produção e venda usam unidades diferentes
function falarEstoque(p) {
  const venda = falarQuantidade(p.estoque, p.unidade);
  return p.unidade_producao ? `${venda}, ou ${falarQuantidade(p.estoque_producao, p.unidade_producao)}` : venda;
}

function falarData(iso) {
  if (iso === hoje()) return 'hoje';
  const [a, m, d] = iso.split('-').map(Number);
  return 'no dia ' + new Date(a, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

function registrar(intent, tipo) {
  const qtd = Number(slot(intent, 'quantidade'));
  const falado = slot(intent, 'produto');
  const unidade = slot(intent, 'unidade');
  if (!(qtd > 0)) return perguntar('Não entendi a quantidade. ' + AJUDA);
  if (!falado) return perguntar('De qual produto? Diga, por exemplo: trinta ovos.');

  const produtos = produtosAtivos();
  const achado = encontrarProduto(falado, produtos);
  if (achado.nenhum) {
    const nomes = produtos.map((p) => p.nome);
    return responder(`Não encontrei o produto ${falado}.` + (nomes.length ? ` Os produtos cadastrados são: ${lista(nomes)}.` : ''));
  }
  if (achado.ambiguos) {
    const nomes = achado.ambiguos.map((p) => p.nome);
    return perguntar(`Qual deles: ${lista(nomes, 'ou')}? Repita com o nome completo.`);
  }

  const { produto } = achado;
  const conversao = converter(qtd, unidade, produto);
  if (conversao.erro) return responder(conversao.erro);

  const dataFalada = slot(intent, 'data');
  const data = dataValida(dataFalada) ? dataFalada : hoje();
  if (data > hoje()) return responder('Não dá para registrar em uma data futura.');

  producao.lancar(reqAlexa, { produto, data, tipo, quantidade: conversao.quantidade, observacao: 'via Alexa' });

  const estoque = produtosComEstoque().find((p) => p.id === produto.id);
  const quanto = falarQuantidade(conversao.quantidade, unidadeProducao(produto));
  const oQue = tipo === 'perda' ? `perda de ${quanto}` : quanto;
  return responder(
    `Anotado: ${oQue} de ${produto.nome}, ${falarData(data)}. Estoque: ${falarEstoque(estoque)}.`,
    { cartao: true }
  );
}

// Remove o último lançamento feito pela Alexa nos últimos 30 minutos
function desfazer() {
  const ultimo = db.prepare(`
    SELECT h.entidade_id AS id
    FROM historico h JOIN producao r ON r.id = h.entidade_id
    WHERE h.usuario = ? AND h.entidade = 'producao' AND h.acao = 'criou'
      AND h.criado_em >= datetime('now', '-30 minutes')
    ORDER BY h.id DESC LIMIT 1
  `).get(reqAlexa.session.usuarioNome);
  if (!ultimo) return responder('Não encontrei nenhum lançamento recente feito por voz para desfazer.');
  const r = producao.excluir(reqAlexa, ultimo.id);
  return responder(`Pronto, removi ${r.tipo === 'perda' ? 'a perda de ' : ''}${falarQuantidade(r.quantidade, r.unidade)} de ${r.produto}.`, { cartao: true });
}

function tratar(corpo) {
  const { request } = corpo;
  switch (request.type) {
    case 'LaunchRequest':
      return perguntar('Oi! O que você quer registrar?');
    case 'SessionEndedRequest':
      return { version: '1.0', response: {} };
    case 'IntentRequest':
      switch (request.intent.name) {
        case 'RegistrarProducaoIntent': return registrar(request.intent, 'producao');
        case 'RegistrarPerdaIntent': return registrar(request.intent, 'perda');
        case 'DesfazerIntent': return desfazer();
        case 'AMAZON.HelpIntent': return perguntar(AJUDA);
        case 'AMAZON.CancelIntent':
        case 'AMAZON.StopIntent':
        case 'AMAZON.NavigateHomeIntent': return responder('Até mais.');
        default: return perguntar('Não entendi. ' + AJUDA);
      }
    default:
      return responder('Não entendi.');
  }
}

const router = express.Router();

router.post('/', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  if (!SKILL_ID) return res.status(404).end();
  let corpo;
  try {
    corpo = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  const skill = corpo?.session?.application?.applicationId || corpo?.context?.System?.application?.applicationId;
  if (skill !== SKILL_ID) return res.status(403).end();
  if (!SEM_VERIFICACAO) {
    try {
      await assinatura.verificar(req.headers, req.body, corpo);
    } catch (err) {
      console.warn('Alexa: requisição recusada:', err.message);
      return res.status(400).end();
    }
  }
  try {
    res.json(tratar(corpo));
  } catch (err) {
    console.error(err);
    res.json(responder('Desculpe, deu um erro ao registrar. Tente pela tela do sistema.'));
  }
});

module.exports = router;
