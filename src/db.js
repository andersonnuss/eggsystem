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
