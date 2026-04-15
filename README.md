# LAN Chat Online (Render)

Chat em tempo real com WebSocket usando Node.js + Express.

## Rodar local

1. Instale dependências:
	- `npm install`
2. Suba o servidor:
	- `npm start`
3. Abra no navegador:
	- `http://localhost:3000`

## Deploy no Render (branch `online-chat`)

Este projeto já está pronto para Render com:
- `PORT` lido automaticamente via `process.env.PORT`
- endpoint de health check em `/health`
- arquivo `render.yaml` para configuração do serviço

### Passo a passo

1. Envie a branch para o GitHub:
	- `git push -u origin online-chat`
2. No Render, clique em `New +` -> `Blueprint`.
3. Selecione o repositório e a branch `online-chat`.
4. Confirme a criação do serviço.
5. Aguarde o deploy e abra a URL `https://seu-app.onrender.com`.

## Observações importantes

- O front e o WebSocket usam o mesmo domínio, então funciona automaticamente em HTTPS com `wss://`.
- No plano free, o serviço pode "hibernar" quando fica sem uso e demorar alguns segundos para acordar.
- Como é memória local em runtime, o histórico é perdido quando o processo reinicia.

## Scripts

- `npm start`: inicia o servidor (`server.js`)
