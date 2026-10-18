# Eggsystem

Sistema web simples para gerenciar o que o sítio produz e vende para conhecidos:

- **Produtos**: nome, unidade de venda (dúzia, kg, pote…) e preço padrão. Opcionalmente, uma unidade de produção diferente (ex.: produção por **ovo**, venda por **dúzia**, 12 ovos = 1 dúzia)
- **Produção**: lançamentos diários de produção e de perdas/consumo, na unidade de produção
- **Estoque**: calculado automaticamente (produção − perdas − vendas), mostrado nas duas unidades
- **Clientes**: CPF (para nota fiscal de produtor), contato, link direto pro WhatsApp e histórico de compras
- **Vendas**: vários itens por venda, controle de pago / a receber ("fiado")
- **Painel**: resumo do mês, estoque e quem está devendo
- **Alexa**: lançamento de produção e perdas por voz ("Alexa, diga ao meu sítio que hoje a produção foi de 30 ovos")
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
  producao.js     # lançar/excluir produção (usado pela tela e pela Alexa)
  alexa/          # endpoint da skill, verificação de assinatura, interpretação e modelo de voz
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

## Alexa (registro por voz)

O sistema tem um endpoint `/alexa` para uma skill própria (não publicada, roda só nas Echos da sua conta). Exemplos:

- "Alexa, diga ao meu sítio que hoje a produção foi de 30 ovos"
- "Alexa, diga ao meu sítio que tive 10 quilos de aipim"
- "Alexa, diga ao meu sítio que perdi 3 ovos"
- "Alexa, diga ao meu sítio para desfazer" (remove o último lançamento por voz feito nos últimos 30 minutos)

Sem unidade, vale a unidade de produção do produto. Falando a unidade de venda ("2 dúzias de ovos"), o sistema converte. Tudo fica no Histórico com o usuário "Alexa".

### Requisito: endereço HTTPS público

A Alexa roda na nuvem da Amazon, então ela precisa alcançar o servidor por **HTTPS com certificado válido**. Duas formas:

- **Cloudflare Tunnel** (não precisa abrir porta no roteador; precisa de um domínio na Cloudflare): instale o `cloudflared`, crie um túnel apontando para `http://localhost:3000` e use a URL do túnel.
- **Caddy + domínio + redirecionamento das portas 80/443** no roteador (veja "HTTPS" acima). Se o IP da sua internet muda, use um DNS dinâmico.

O endpoint só aceita requisições assinadas pela Amazon para o seu Skill ID (assinatura conferida com o `crypto` do Node, sem bibliotecas extras).

### Criando a skill

O passo a passo também aparece no sistema em **Painel → Registrar produção por voz**, com o modelo pronto para copiar.

1. Em https://developer.amazon.com/alexa/console/ask (mesma conta Amazon da Echo): *Create Skill* → nome à sua escolha → idioma **Portuguese (BR)** → modelo **Custom** → hospedagem **Provision your own**.
2. *Interaction Model → JSON Editor*: cole o JSON de `/integracoes/alexa/modelo.json` → *Save* → *Build*.
3. *Endpoint*: **HTTPS**, URL `https://seu-dominio/alexa`, certificado "from a trusted certificate authority".
4. Copie o **Skill ID** para o `.env` (`ALEXA_SKILL_ID=amzn1.ask.skill...`) e reinicie o serviço.
5. Aba *Test*: mude para **Development** e teste digitando "diga ao meu sítio que tive 30 ovos".

Ao cadastrar produtos novos, baixe o JSON de novo e faça o *Build*, para a Alexa reconhecer os nomes. O nome de invocação ("meu sítio") pode ser mudado em `ALEXA_INVOCACAO`, mas tem que ser igual ao da skill.

## Backup

Todos os dados ficam em `data/eggsystem.db`. Para fazer uma cópia segura com o sistema rodando:

```bash
sqlite3 /opt/eggsystem/data/eggsystem.db ".backup '/caminho/backup/eggsystem-$(date +%F).db'"
```

Vale agendar esse comando no `cron` para rodar todo dia.
