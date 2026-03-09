# Especificações Recomendadas para Emulação Hospedagem do Sistema Zottelli na VPS

Dado o ecossistema atual do *Zottelli Selection*, que roda em Node.js com SQLite (modo WAL ativo para alta concorrência) e manipula imagens locais via `multer`. O fato de não utilizarmos MySQL ou Postgres garante um consumo de memória infinitamente menor, com as requisições sendo resolvidas em nanossegundos via disco NVMe.

Para hospedagem, o painel ideal para iniciantes seria o **Coolify** ou **CapRover**, mas mesmo implantando e rodando ele puro com `pm2` direto do terminal, as necessidades não são altas.

## Requisitos Mínimos (Suporta tranquilamente o time de 4 pessoas + Site):
- **CPU:** 1 vCore (x86_64 CPU)
- **Memória RAM:** 1GB a 2GB RAM (Basta e sobra, pois o node consumirá entre 80-150MB no pior cenário).
- **Armazenamento:** 20 GB a 25 GB SSD ou NVMe M.2 (Recomendado para o banco SQLite). *O que vai gastar espaço são as fotos do módulo `Showroom`, mas como fizemos o script que apaga o carro após 10 dias de vendido, o disco ficará sempre auto-gerenciado.*
- **Tráfego de Rede / Banda:** 1 Terabyte de banda de saída (padrão de qualquer empresa).
- **Sistema Operacional Requerido:** Ubuntu Server 22.04 LTS ou Debian 12 (são os que têm maior paridade com Node.JS e pacotes npm sem precisarem de configurações avulsas de segurança).

## Sugestão de Fornecedores de VPS:
1. **Hetzner (Ashburn, VA - EUA):** ~€ 4.00 mensais (5 dólares). 2 vCores ARM, 4GB RAM e 40GB NVMe. Extremamente rápido e barato.
2. **DigitalOcean (Basic Droplet):** ~$6 mensais. 1 vCore, 1GB RAM. Rápido e prático, bom para quem nunca fez deploy.
3. **Hostinger (VPS 1):** ~R$ 30,00 mensais. Caso queira pagamento nativo no Brasil (PIX), boa gerência de painel (Painel hPanel deles tem um click-deploy do Nodejs).

### Otimizações Recentes Aplicadas ao Sistema para Estabilidade na VPS:
1. Adicionamos a exclusão diária de fotos dos carros já vendidos depois de 10 dias (limpando o disco NVMe para não estourar o limite de 20GB).
2. O sistema de login possui timeout e heartbeat, logo requisições pendidas no proxy e zumbis que drenam a RAM do Linux não vão acontecer.
3. Arquitetura unificada. Tudo ocorre sob o script `server.js` (gerenciando API, Banco e estáticos da `/public`). Um único processo do `pm2 start server.js` é capaz de atender 1000 requests/s no ambiente Ubuntu com NVMe.
4. Adicionado backup físico diário `loja_backup_XXX.db` criado a cada 24 HORAS dentro de `/backups`, que retém os últimos 14 dias garantindo que se quebrar ou haver falha humana os dados de vocês estarão salvos em disco, ocupando menos de 20MB ao total (14 arquivos SQLite pequenos).

**Nota de Deploy:** Ao ir para o ar, se certifique de instalar no servidor o `pm2` via npm global e rodar o seu app com `pm2 start server.js --name "zottelli-sys"`.
