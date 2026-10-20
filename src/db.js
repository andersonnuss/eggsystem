const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.env.DB_PATH || './data/eggsystem.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Cada posição do array é uma migração; nunca altere as já aplicadas, só acrescente novas.
const migrations = [
  `
  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL
  );

  CREATE TABLE produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    unidade TEXT NOT NULL DEFAULT 'un',
    preco_centavos INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE clientes (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    telefone TEXT,
    endereco TEXT,
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Entradas (produção/colheita) e saídas que não são vendas (perda, consumo próprio)
  CREATE TABLE producao (
    id INTEGER PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    data TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'producao' CHECK (tipo IN ('producao', 'perda')),
    quantidade REAL NOT NULL CHECK (quantidade > 0),
    observacao TEXT
  );
  CREATE INDEX idx_producao_produto ON producao(produto_id);

  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    data TEXT NOT NULL,
    total_centavos INTEGER NOT NULL DEFAULT 0,
    pago INTEGER NOT NULL DEFAULT 0,
    data_pagamento TEXT,
    observacao TEXT
  );
  CREATE INDEX idx_vendas_cliente ON vendas(cliente_id);
  CREATE INDEX idx_vendas_data ON vendas(data);

  CREATE TABLE venda_itens (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade REAL NOT NULL CHECK (quantidade > 0),
    preco_unit_centavos INTEGER NOT NULL
  );
  CREATE INDEX idx_venda_itens_venda ON venda_itens(venda_id);
  CREATE INDEX idx_venda_itens_produto ON venda_itens(produto_id);
  `,
  `
  -- CPF só com dígitos; opcional, mas não pode repetir
  ALTER TABLE clientes ADD COLUMN cpf TEXT;
  CREATE UNIQUE INDEX idx_clientes_cpf ON clientes(cpf) WHERE cpf IS NOT NULL;
  `,
  `
  -- Produção pode ser lançada numa unidade menor que a de venda (ex.: ovo x dúzia).
  -- fator = quantas unidades de produção formam 1 unidade de venda (ex.: 12).
  -- producao.quantidade fica na unidade de produção; venda_itens.quantidade na de venda.
  ALTER TABLE produtos ADD COLUMN unidade_producao TEXT;
  ALTER TABLE produtos ADD COLUMN fator REAL NOT NULL DEFAULT 1;

  -- Log de tudo que foi cadastrado, alterado ou excluído
  CREATE TABLE historico (
    id INTEGER PRIMARY KEY,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    usuario TEXT,
    entidade TEXT NOT NULL,
    entidade_id INTEGER,
    acao TEXT NOT NULL,
    resumo TEXT NOT NULL,
    detalhes TEXT
  );
  CREATE INDEX idx_historico_entidade ON historico(entidade, entidade_id);
  CREATE INDEX idx_historico_data ON historico(criado_em);
  `,
  `
  -- Vários usuários, todos com os mesmos acessos; inativo não consegue entrar
  ALTER TABLE usuarios ADD COLUMN nome TEXT;
  ALTER TABLE usuarios ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE usuarios ADD COLUMN criado_em TEXT;
  UPDATE usuarios SET criado_em = datetime('now');
  `,
  `
  -- E-mail (minúsculo, opcional, único); usado também para entrar com a conta Google
  ALTER TABLE usuarios ADD COLUMN email TEXT;
  CREATE UNIQUE INDEX idx_usuarios_email ON usuarios(email) WHERE email IS NOT NULL;
  `,
  `
  -- Novo tipo "ajuste" (contagem de estoque): quantidade com sinal, + entra e - sai.
  -- O SQLite não altera CHECK de uma tabela existente, então ela é recriada.
  CREATE TABLE producao_nova (
    id INTEGER PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    data TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'producao' CHECK (tipo IN ('producao', 'perda', 'ajuste')),
    quantidade REAL NOT NULL CHECK (quantidade <> 0 AND (tipo = 'ajuste' OR quantidade > 0)),
    observacao TEXT
  );
  INSERT INTO producao_nova (id, produto_id, data, tipo, quantidade, observacao)
    SELECT id, produto_id, data, tipo, quantidade, observacao FROM producao;
  DROP TABLE producao;
  ALTER TABLE producao_nova RENAME TO producao;
  CREATE INDEX idx_producao_produto ON producao(produto_id);
  `,
];

function migrate() {
  const { user_version: atual } = db.prepare('PRAGMA user_version').get();
  for (let v = atual; v < migrations.length; v++) {
    transaction(() => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrate();

module.exports = { db, transaction };
