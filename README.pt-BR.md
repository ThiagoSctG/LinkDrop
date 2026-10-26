<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="">

# LinkDrop

**Passe links e notas entre o computador e o celular. Escaneie um QR Code e compartilhe uma lista ao vivo. Sem login, nada guardado.**

[![CI](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml/badge.svg)](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ThiagoSctG/LinkDrop?sort=semver)](https://github.com/ThiagoSctG/LinkDrop/releases/latest)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · **Português**

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" alt="LinkDrop em um computador e em um celular exibindo a mesma lista de links e notas">
</picture>

## Por que o LinkDrop?

Levar um link do celular para a tela da sala de reunião, ou uma nota do notebook para o celular, normalmente significa mandar um e-mail para si mesmo ou entrar em um aplicativo de mensagens num computador que não é seu. O LinkDrop elimina esse passo: abra no computador, escaneie o QR Code, e os dois dispositivos compartilham uma lista até você encerrar a sessão.

## Recursos

- **Pareamento por QR Code** temporário. Sem contas e sem instalar aplicativo.
- **Lista ao vivo nos dois sentidos**, com links e notas e título opcional.
- **Itens criptografados de ponta a ponta**: títulos e conteúdos são cifrados nos dispositivos antes de chegar ao servidor.
- **Feito para telas compartilhadas**: exiba um link como QR Code grande ou uma nota em tela cheia.
- **Efêmero**: tudo fica em memória e é apagado quando a sessão termina ou após 30 minutos sem atividade.
- **Auto-hospedado e leve**: um binário de ~7 MB ou uma imagem de contêiner multiarquitetura, temas claro e escuro, português e inglês.

## Começar

```bash
docker run -d --name linkdrop -p 47821:47821 ghcr.io/thiagosctg/linkdrop:v0.1.1
```

Em uma rede local de confiança, abra `http://<IP-do-computador-na-rede>:47821` no computador e escaneie o QR Code com o celular. Os dois dispositivos precisam alcançar esse endereço; `localhost` no celular aponta para o próprio celular. Os itens continuam criptografados em HTTP, mas alguém na rede pode alterar o aplicativo e capturar chaves ou conteúdos. A interface informa essa limitação. Use HTTPS para instâncias públicas e redes em que você não confia.

**Outras opções:**

- **Docker Compose**: clone o repositório, copie `.env.example` para `.env` e rode `docker compose up -d`.
- **Binários** para Linux, macOS e Windows na página de [Releases](https://github.com/ThiagoSctG/LinkDrop/releases/latest), com checksums SHA-256. Eles não são assinados digitalmente.

## Configuração

Use variáveis de ambiente; valores inválidos impedem a inicialização com uma mensagem de erro.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `47821` | Porta de escuta (porta do host no Compose fornecido) |
| `PUBLIC_URL` | _vazio_ | URL-base nas respostas de pareamento da API; os QRs do navegador usam a origem da página |
| `TRUST_PROXY` | `false` | Confia em `X-Forwarded-For` e `X-Forwarded-Proto`; só atrás de um proxy |
| `SESSION_TTL` | `30m` | Tempo sem atividade até a sessão terminar |
| `PAIRING_TTL` | `2m` | Validade de um QR Code não escaneado |
| `MAX_ITEMS_PER_SESSION` | `100` | Máximo de itens por sessão (cada sessão também guarda no máximo 2 MiB cifrados) |
| `MAX_SESSIONS` | `1000` | Sessões simultâneas; QR Codes não escaneados ficam limitados ao dobro disso |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | `60` / `1m` | Requisições de API por IP (IPv6 por /64) a cada janela |
| `RATE_LIMIT_MAX_KEYS` | `10000` | IPs acompanhados simultaneamente; quando cheio, o mais antigo é descartado |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` (JSON no stderr) |

Para instâncias públicas, use um proxy HTTPS que encaminhe WebSockets. Se ativar `TRUST_PROXY`, restrinja o acesso ao backend a esse proxy: os cabeçalhos encaminhados são confiados, então a porta do backend não deve continuar acessível diretamente aos clientes. Abra o mesmo endereço acessível também no computador; os QRs usam essa origem para não anexar chaves de criptografia a uma URL fornecida pelo servidor. `PUBLIC_URL` continua controlando a URL sem chave retornada pela API.

## Segurança e privacidade

- Títulos e conteúdos são criptografados com AES-256-GCM no navegador. A chave da sessão é compartilhada no fragmento do link do QR (`#key=…`), que não é enviado nas requisições HTTP. O servidor guarda e retransmite dados cifrados, sem receber a chave de criptografia.
- HTTP pelo IP da rede funciona com os itens criptografados e um aviso sobre o transporte. Ele não autentica o aplicativo entregue ao navegador nem protege as credenciais de acesso em trânsito. Prefira HTTPS; não exponha uma instância HTTP publicamente. O servidor ainda vê metadados como IPs, quantidade de itens, tamanho dos dados cifrados e horários de atividade.
- O host entrega a aplicação web: se for malicioso ou comprometido, pode servir JavaScript alterado para capturar chaves ou conteúdo. A E2EE protege o conteúdo processado pela aplicação sem modificações; ela não elimina a confiança no aplicativo entregue ao navegador. Esta implementação ainda não passou por auditoria criptográfica independente.
- A aplicação mantém os dados cifrados na memória do servidor e não grava intencionalmente os itens em disco ou logs. Logs da infraestrutura, swap, dumps, clipboard e cópias nos dispositivos têm retenção própria. Reiniciar o servidor encerra todas as sessões.
- Links de pareamento e credenciais salvas (incluindo a chave de criptografia no armazenamento do navegador) são segredos. Fechar a aba não encerra a sessão; use **Encerrar sessão** em computadores compartilhados. Substituir o celular revoga seu acesso ao servidor, mas mantém a chave de criptografia para preservar a lista. Não há sigilo futuro nem proteção contra repetição ou omissão de itens anteriormente válidos; encerre a sessão e crie outra para obter uma chave nova.
- Execute uma única instância; as sessões não são compartilhadas entre réplicas.

Veja [o desenho da criptografia](docs/encryption.md) (em inglês) para protocolo, modelo de ameaça e limites.

Relate vulnerabilidades de forma privada, como descrito no [SECURITY.md](SECURITY.md).

## Desenvolvimento

Requer Go 1.27.3+ e Node.js 22+.

```bash
npm ci && npm run build
go run ./cmd/linkdrop      # http://localhost:47821
npm run dev                # opcional: hot reload em http://localhost:5173
```

Veja o [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês) para arquitetura, testes e processo de release. Issues e pull requests são bem-vindos em português ou inglês.

## Licença

[MIT](LICENSE) · [Changelog](CHANGELOG.md)
