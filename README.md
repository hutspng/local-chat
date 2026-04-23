# local-chat

Chat LAN com WebSocket, suporte a mídia/arquivos e hostname preferido para acesso na rede.

## Como rodar

1. Instale dependências:

```bash
npm install
```

2. Inicie o servidor:

```bash
node server.js
```

3. Abra no navegador:

- Local: `http://localhost:3000`
- LAN (por IP): `http://IP_DO_SERVIDOR:3000`

## Hostname fixo na rede

O servidor agora expõe um hostname preferido configurável.

- Padrão: `local-chat.lan`
- Variável de ambiente: `CHAT_HOSTNAME`

Exemplo no PowerShell:

```powershell
$env:CHAT_HOSTNAME = "local-chat.lan"
node server.js
```

Com isso, a UI mostra `http://local-chat.lan:3000` como link sugerido.

### Importante

Para esse nome funcionar em outros dispositivos, a rede precisa resolver `local-chat.lan` para o IP atual do servidor. Você pode fazer isso de duas formas:

1. DNS local (roteador/servidor DNS da rede): criar registro `A` para `local-chat.lan`.
2. Arquivo hosts nos clientes: mapear `local-chat.lan` para o IP do servidor.

Sem DNS/hosts, continue usando o acesso por IP.
