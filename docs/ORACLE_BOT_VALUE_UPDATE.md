# Atualização futura dos valores do bot SonhoBom na Oracle

Este procedimento é deliberadamente isolado. Ele não foi executado no repositório
do bot nem na VPS. O WebSocket do IMVU, os listeners, os eventos
`updateCreditBalances` e `messageReceived`, a assinatura
`inv:/wallet/wallet-${AVATAR_ID}`, o login, a identificação do remetente, a busca
por `profiles.imvu_account`, o cliente Supabase e os campos `moedas_avulsas`,
`plano` e `vip_vencimento` devem permanecer intocados.

Os blocos de VIP também não podem ser modificados:

```ts
if (creditosRecebidos === 20000) {
    // VIP 15 dias
} else if (creditosRecebidos === 35000) {
    // VIP 30 dias
}
```

## Alteração autorizada

No arquivo `src/core/RoomInstance.ts`, localizar somente:

```ts
let moedas = Math.floor(creditosRecebidos / 200);
```

Substituir apenas esse cálculo por:

```ts
const CREDITOS_POR_PACOTE = 1000;
const MOEDAS_POR_PACOTE = 8;

const pacotesInteiros = Math.floor(
    creditosRecebidos / CREDITOS_POR_PACOTE
);

const moedas = pacotesInteiros * MOEDAS_POR_PACOTE;
```

No mesmo bloco antifraude, substituir somente `Mínimo exigido: 200` por
`Mínimo exigido: 1000`. Não mover essa validação e não alterar qualquer outro
texto ou ramo.

Resultados esperados:

| Créditos recebidos | Moedas avulsas |
| ---: | ---: |
| 999 | 0 |
| 1.000 | 8 |
| 1.500 | 8 |
| 2.000 | 16 |
| 5.000 | 40 |

O patch de revisão está em `patches/sonhobom-oracle-economy-only.patch`. Ele não
deve ser aplicado antes de confirmar que o arquivo na VPS ainda contém exatamente
os dois textos antigos. Se `git apply --check` falhar, não force o patch: faça a
substituição manual dos dois trechos autorizados e revise o diff.

## Procedimento seguro na VPS

### 1. Acessar e localizar a instalação real

```bash
ssh <usuario>@<host-da-vps>
find "$HOME" /opt /srv -type f -path '*/src/core/RoomInstance.ts' 2>/dev/null
```

Não escolha um diretório por suposição. Após conferir o resultado, entre na raiz
real que contém `src/core/RoomInstance.ts` e confirme:

```bash
cd <diretorio-real-confirmado>
pwd
test -f src/core/RoomInstance.ts
grep -nF 'let moedas = Math.floor(creditosRecebidos / 200);' src/core/RoomInstance.ts
grep -nF 'Mínimo exigido: 200' src/core/RoomInstance.ts
```

### 2. Identificar como o processo está hospedado, sem reiniciar nada

Execute apenas comandos de descoberta:

```bash
pm2 list 2>/dev/null || true
systemctl --type=service --state=running 2>/dev/null | grep -Ei 'sonhobom|imvu|node' || true
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true
pgrep -af 'node|tsx|ts-node' || true
```

Registre o nome ou ID real encontrado e não reinicie processos semelhantes por
tentativa.

### 3. Criar backup e revisar o patch

```bash
BOT_FILE='src/core/RoomInstance.ts'
BACKUP_FILE="${BOT_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
cp --preserve=mode,timestamps -- "$BOT_FILE" "$BACKUP_FILE"
printf 'Backup: %s\n' "$BACKUP_FILE"
```

Depois de transferir o patch para um caminho conhecido na VPS, valide-o sem
alterar o arquivo:

```bash
git apply --check <caminho-confirmado>/sonhobom-oracle-economy-only.patch
```

Somente se a verificação passar e o diff contiver exclusivamente as duas
substituições autorizadas:

```bash
git apply <caminho-confirmado>/sonhobom-oracle-economy-only.patch
git diff -- src/core/RoomInstance.ts
```

Se o projeto não usar Git ou o check falhar, edite manualmente apenas os dois
trechos descritos acima. Em seguida, use `diff -u` contra o backup:

```bash
diff -u -- "$BACKUP_FILE" "$BOT_FILE"
```

O diff deve conter somente as constantes, o cálculo por pacotes inteiros e a
mudança de `200` para `1000` na mensagem.

### 4. Verificar e compilar

```bash
npx tsc --noEmit
```

Continue apenas com saída zero. Descubra os scripts existentes sem executar um
build arbitrário:

```bash
npm pkg get scripts
```

Se houver um script de build já utilizado pelo processo atual, execute exatamente
esse script. Não reinicie nada se TypeScript ou build falhar.

### 5. Reiniciar somente o processo identificado

Use apenas a alternativa correspondente ao gerenciador confirmado na etapa 2,
substituindo o marcador pelo nome ou ID real:

```bash
pm2 restart <nome-ou-id-pm2-confirmado>
pm2 logs <nome-ou-id-pm2-confirmado> --lines 100
```

```bash
sudo systemctl restart <servico-systemd-confirmado>
sudo journalctl -u <servico-systemd-confirmado> -n 100 -f
```

```bash
docker restart <container-confirmado>
docker logs --tail 100 -f <container-confirmado>
```

Para Node direto, registre PID, comando completo e diretório de trabalho antes de
qualquer ação. Reinicie somente pelo mecanismo de inicialização já documentado na
VPS; não improvise um novo comando nem encerre processos por nome genérico.

### 6. Checklist após o reinício

- O bot conecta ao IMVU.
- O bot entra na sala correta.
- A assinatura `inv:/wallet/wallet-${AVATAR_ID}` ocorre.
- `updateCreditBalances` continua sendo recebido.
- `messageReceived` continua sendo recebido.
- O pagador continua sendo identificado por `profiles.imvu_account`.
- Um pagamento controlado de 1.000 créditos credita exatamente 8 moedas avulsas.
- Os pagamentos de 20.000 e 35.000 continuam ativando, respectivamente, VIP de
  15 e 30 dias, sem passar pelo cálculo de moedas avulsas.

Se qualquer item falhar, não faça outras alterações. Pare o teste, restaure o
backup pelo procedimento operacional aprovado e investigue o diff e os logs.
