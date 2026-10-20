const { db } = require('./db');
const util = require('./util');

// Campos de cada entidade que aparecem no histórico: chave -> [rótulo, formatador]
const texto = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const simNao = (v) => (v ? 'sim' : 'não');

const CAMPOS = {
  produto: {
    nome: ['Nome', texto],
    unidade: ['Unidade de venda', texto],
    preco_centavos: ['Preço', util.dinheiro],
    unidade_producao: ['Unidade de produção', texto],
    fator: ['Unidades de produção por unidade de venda', util.numero],
    ativo: ['Ativo', simNao],
  },
  cliente: {
    nome: ['Nome', texto],
    cpf: ['CPF', (v) => texto(util.cpf(v))],
    telefone: ['Telefone', texto],
    endereco: ['Endereço', texto],
    observacoes: ['Observações', texto],
    ativo: ['Ativo', simNao],
  },
  usuario: {
    usuario: ['Login', texto],
    nome: ['Nome', texto],
    email: ['E-mail', texto],
    acesso: ['Forma de acesso', (v) => (v === 'google' ? 'conta Google' : 'usuário e senha')],
    ativo: ['Ativo', simNao],
  },
  producao: {
    produto: ['Produto', texto],
    tipo: ['Tipo', (v) => ({ perda: 'perda/consumo', ajuste: 'ajuste por contagem' }[v] || 'produção')],
    data: ['Data', util.data],
    quantidade: ['Quantidade', texto],
    observacao: ['Observação', texto],
  },
  venda: {
    cliente: ['Cliente', texto],
    data: ['Data', util.data],
    total_centavos: ['Total', util.dinheiro],
    pago: ['Pago', simNao],
    observacao: ['Observação', texto],
    itens: ['Itens', texto],
  },
};

// Foto legível de um registro (para "criou" e "excluiu")
function retrato(entidade, registro) {
  const resultado = {};
  for (const [chave, [rotulo, fmt]] of Object.entries(CAMPOS[entidade] || {})) {
    if (registro[chave] !== undefined) resultado[rotulo] = fmt(registro[chave]);
  }
  return resultado;
}

// Só o que mudou entre dois registros (para "alterou"); null se nada mudou
function mudancas(entidade, antes, depois) {
  const resultado = {};
  for (const [chave, [rotulo, fmt]] of Object.entries(CAMPOS[entidade] || {})) {
    if (depois[chave] === undefined) continue;
    const de = fmt(antes[chave]);
    const para = fmt(depois[chave]);
    if (de !== para) resultado[rotulo] = { de, para };
  }
  return Object.keys(resultado).length ? resultado : null;
}

function registrar(req, { entidade, id = null, acao, resumo, detalhes = null }) {
  db.prepare(`
    INSERT INTO historico (usuario, entidade, entidade_id, acao, resumo, detalhes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.session?.usuarioNome || null,
    entidade,
    id === null ? null : Number(id),
    acao,
    resumo,
    detalhes ? JSON.stringify(detalhes) : null
  );
}

module.exports = { registrar, retrato, mudancas };
