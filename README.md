# LifeVU

Projeto integrado da LifeVU: a experiência visual estática fica em `public/`,
enquanto o Next.js protege a integração principal com o Gemini no servidor.

## Rotas

- `/` — landing imersiva atual da LifeVU, servida internamente por rewrite.
- `/dashboard.html` — painel da engine.
- `/admin.html` — painel administrativo.
- `/como-usar.html` — documentação para o usuário.
- `/api/gemini` — engine principal: recebe as referências do usuário autenticado
  e gera o prompt otimizado sem expor a chave do Gemini no navegador.
- `/api/nvidia` — módulo experimental de geração de imagem, preservado mas
  inativo no fluxo atual.

O `beforeFiles` rewrite de `next.config.ts` tem prioridade sobre o antigo
frontend React. O pequeno `app/page.tsx` existe apenas como fallback e não
contém mais a interface visual antiga.

## Desenvolvimento

Requisitos: Node.js 22 ou superior e npm.

```bash
npm clean-install
npm run dev
```

Acesse `http://localhost:3000/`.

## Gemini (obrigatório)

Crie localmente um arquivo `.env.local` — ele é ignorado pelo Git e não deve
ser enviado no ZIP — com:

```text
GEMINI_API_KEY=sua_chave_aqui
```

O modelo original permanece fixado como `gemini-flash-lite-latest`.

Limites opcionais da rota autenticada:

```text
GEMINI_RATE_LIMIT_MAX=10
GEMINI_RATE_LIMIT_WINDOW_SECONDS=600
LIFEVU_ALLOWED_ORIGINS=https://lifevu.example
```

O código de verificação de cadastro é enviado pelo SDK oficial do EmailJS. O
template configurado deve aceitar `to_name`, `to_email` e `message`.

Sem `GEMINI_API_KEY`, a interface continua abrindo, mas a geração de prompt
responde com erro de configuração. A rota valida o token de sessão do Supabase
antes de chamar o Gemini.

## Supabase e economia

A migration `supabase/migrations/20260811170000_secure_lifevu_economy.sql`
configura 10 moedas iniciais, renovação diária para 5 moedas gratuitas,
conversão confirmada de 1.000 créditos em 8 moedas avulsas, idempotência de
pagamentos e o protocolo atômico de geração/estorno.

Ela deve ser revisada e aplicada ao projeto Supabase antes de publicar esta
versão da API. Criar o arquivo localmente não altera o banco remoto. A função
`creditar_compra_confirmada` aceita apenas múltiplos inteiros de 1.000 e tem
execução concedida somente ao `service_role`; o identificador e o valor do
pagamento devem vir do confirmador confiável, nunca do navegador.

## NVIDIA (experimental e inativa)

A rota `/api/nvidia` não é chamada pelo dashboard. Se o experimento for
reativado no futuro, a variável correspondente será `NVIDIA_API_KEY`.

> Segurança: a chave do Gemini que existia no JavaScript público deve ser
> revogada e substituída no provedor, pois uma chave publicada no navegador não
> pode mais ser considerada secreta.

## Validação de produção

```bash
npm run lint
npm run build
npm run start
```

O build usa o App Router do Next.js e inclui todos os arquivos de `public/`.
