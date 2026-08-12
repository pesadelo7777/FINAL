# Alteração mínima da Isis: `creditos_pagos`

O código-fonte da Isis não está neste workspace. Este documento não altera nem
reinicia o bot; ele especifica a mudança mínima a aplicar no repositório real.
`FinancialProcessor`, rádio, Mongo, Docker, listeners e detecção de pagamento
permanecem intocados.

Em `src/core/RoomInstance.ts`, mantenha cada concessão existente e acrescente
`creditos_pagos` ao **mesmo objeto do mesmo update de `profiles`**. Não faça um
segundo update.

Antes dos ramos financeiros, o registro de `profiles` já consultado precisa
incluir `creditos_pagos`. Normalize somente para o cálculo:

```ts
const creditosPagosAtuais = profile.creditos_pagos ?? 0;
```

## Moedas avulsas válidas

No update que já concede `moedas` calculadas, acrescente:

```ts
{
    moedas_avulsas: saldoAtual + moedas,
    creditos_pagos: creditosPagosAtuais + creditosRecebidos
}
```

Isso preserva o valor real recebido: 1.500 créditos concede 8 moedas e registra
1.500, não 1.000.

## VIP 15 Dias

No ramo existente de 5.000 créditos, preserve `plano` e `vip_vencimento` atuais
e acrescente ao mesmo update:

```ts
creditos_pagos: creditosPagosAtuais + 5000
```

## VIP 30 Dias

No ramo existente de 9.000 créditos, preserve `plano` e `vip_vencimento` atuais
e acrescente ao mesmo update:

```ts
creditos_pagos: creditosPagosAtuais + 9000
```

## Pagamentos inválidos

Não inclua `creditos_pagos` em nenhum caminho de rejeição. O update financeiro
deve continuar inexistente quando o pagamento for inválido.

## Revisão obrigatória no repositório real

Confirme no diff que cada concessão faz apenas um update atômico de `profiles` e
que nenhuma mudança atingiu `FinancialProcessor`, WebSocket, rádio, Mongo,
Docker, autenticação ou eventos IMVU. Execute `npx tsc --noEmit`, mas não reinicie
o bot nesta etapa.
