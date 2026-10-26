# LinkDrop

[English](README.md) · **Português**

Compartilhe links e textos entre uma tela e um celular sem login, mensageiros ou histórico permanente.

A tela exibe um QR Code temporário. Ao escaneá-lo, o celular entra na mesma sessão e os dois dispositivos passam a compartilhar uma lista em tempo real. A sessão expira após 30 minutos sem atividade e tudo é apagado quando ela termina.

## Recursos

- Pareamento por QR Code ou link copiável
- Links e notas com título opcional, atualizados ao vivo nos dois dispositivos
- Só links `http(s)` são clicáveis; todo o resto é texto
- Sem conta e sem banco de dados: o estado fica em memória e some com a sessão
- Um único binário de cerca de 10 MB, ou uma imagem de contêiner de cerca de 16 MB (amd64 e arm64)
- Temas claro e escuro, interface em português e inglês
- Limite de requisições, Content Security Policy estrita e nenhum conteúdo nos logs

## Executar

### Docker

```bash
docker run -d -p 3000:3000 --name linkdrop ghcr.io/thiagosctg/linkdrop-web:latest
```

Abra `http://localhost:3000` na tela e escaneie o QR Code com o celular. Os dois dispositivos precisam acessar o mesmo endereço, então use o IP da máquina na rede local ou um domínio público em vez de `localhost`.

### Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

No PowerShell, use `Copy-Item .env.example .env`.

### Binário

Baixe o binário da sua plataforma na página de [releases](https://github.com/ThiagoSctG/LinkDrop/releases) e execute:

```bash
PORT=3000 ./linkdrop
```

## Configuração

Todas as opções são variáveis de ambiente; a tabela completa está no [README em inglês](README.md#configuration). As principais:

- `PORT` (padrão `3000`)
- `TRUST_PROXY` (padrão `false`): ative apenas atrás de um proxy reverso.
- `PUBLIC_URL`: origem pública usada nos links de pareamento.
- `SESSION_TTL` (padrão `30m`) e `PAIRING_TTL` (padrão `2m`)
- `MAX_ITEMS_PER_SESSION` (padrão `100`)

**Reiniciar o servidor encerra as sessões.** O estado fica em memória de propósito. Ao desligar, os dispositivos conectados são avisados e voltam ao início.

Use HTTPS em produção; navegadores só permitem copiar para a área de transferência em origens seguras.

## Desenvolvimento

Requisitos: Go 1.26+ e Node.js 22+.

```bash
npm ci
npm run build          # gera web/dist, que o binário Go embute
go run ./cmd/linkdrop  # http://localhost:3000
npm run dev            # Vite com hot reload em http://localhost:5173, com proxy de /api para a porta 3000
```

`npm run build:all` gera o frontend e o binário `linkdrop` em um único passo.

Veja o [CONTRIBUTING.md](CONTRIBUTING.md) para estrutura e convenções.

## Licença

[MIT](LICENSE)
