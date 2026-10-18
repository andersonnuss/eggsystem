# Eggsystem

Sistema web simples para gerenciar o que o sítio produz e vende para conhecidos:

- **Produtos**: nome, unidade de venda (dúzia, kg, pote…) e preço padrão. Opcionalmente, uma unidade de produção diferente (ex.: produção por **ovo**, venda por **dúzia**, 12 ovos = 1 dúzia)
- **Produção**: lançamentos diários de produção e de perdas/consumo, na unidade de produção
- **Estoque**: calculado automaticamente (produção − perdas − vendas), mostrado nas duas unidades
- **Clientes**: CPF (para nota fiscal de produtor), contato, link direto pro WhatsApp e histórico de compras
- **Vendas**: vários itens por venda, controle de pago / a receber ("fiado")
- **Painel**: resumo do mês, estoque e quem está devendo
- **Histórico**: log de tudo que foi cadastrado, alterado ou excluído (produtos, clientes, produção, vendas) e dos acessos, com o que mudou e quem fez

Feito para usar no navegador do celular. Stack: Node.js 22.13+ (usa o SQLite embutido, `node:sqlite`), Express e EJS. Não precisa de servidor de banco de dados: tudo fica em um único arquivo `.db`.

## Rodando localmente

```bash
npm install
cp .env.example .env    # edite SESSION_SECRET
npm run dev
```

Acesse http://localhost:3000. No primeiro acesso o sistema pede para criar o usuário.

## Estrutura

```
src/
  server.js       # app Express, sessão e rotas
  db.js           # conexão SQLite e migrações (PRAGMA user_version)
  auth.js         # primeiro acesso, login e logout
  consultas.js    # consultas compartilhadas (estoque etc.)
  historico.js    # registro do log de alterações
  util.js         # formatação de dinheiro/datas
  routes/         # painel, produtos, clientes, producao, vendas
views/            # páginas EJS (partials/topo.ejs tem o menu)
public/style.css  # estilo mobile-first, com modo escuro
```

Para mudar o banco, acrescente uma nova entrada no array `migrations` em `src/db.js`. Nunca altere migrações já aplicadas.

## Instalando no servidor Linux

1. Instale o Node.js 22 ou mais novo (por exemplo, via [NodeSource](https://github.com/nodesource/distributions) ou `nvm`).
2. Copie o projeto para `/opt/eggsystem` (via `git clone` ou `rsync`) e rode:

   ```bash
   cd /opt/eggsystem
   npm ci --omit=dev
   cp .env.example .env
   ```

   No `.env`, defina `SESSION_SECRET` com o resultado de `openssl rand -hex 32`.

3. Crie um serviço systemd em `/etc/systemd/system/eggsystem.service`:

   ```ini
   [Unit]
   Description=Eggsystem
   After=network.target

   [Service]
   Type=simple
   User=eggsystem
   WorkingDirectory=/opt/eggsystem
   ExecStart=/usr/bin/node --env-file=.env src/server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo useradd --system --home /opt/eggsystem eggsystem
   sudo chown -R eggsystem: /opt/eggsystem
   sudo systemctl daemon-reload
   sudo systemctl enable --now eggsystem
   ```

4. **HTTPS**: para acessar pelo celular fora de casa, coloque um proxy reverso na frente. O mais simples é o [Caddy](https://caddyserver.com), que gera o certificado sozinho:

   ```
   seu-dominio.com.br {
       reverse_proxy localhost:3000
   }
   ```

   Com HTTPS ativo, defina `COOKIE_SECURE=true` no `.env`.

## Backup

Todos os dados ficam em `data/eggsystem.db`. Para fazer uma cópia segura com o sistema rodando:

```bash
sqlite3 /opt/eggsystem/data/eggsystem.db ".backup '/caminho/backup/eggsystem-$(date +%F).db'"
```

Vale agendar esse comando no `cron` para rodar todo dia.
