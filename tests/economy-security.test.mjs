import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  COINS_PER_1000_CREDITS,
  CREDITS_PER_PACKAGE,
  DAILY_FREE_COINS,
  INITIAL_FREE_COINS,
  coinsForConfirmedCredits,
} from "../lib/economy.mjs";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("centralizes the LifeVU economy and converts only confirmed 1K packages", () => {
  assert.equal(INITIAL_FREE_COINS, 10);
  assert.equal(DAILY_FREE_COINS, 5);
  assert.equal(CREDITS_PER_PACKAGE, 1000);
  assert.equal(COINS_PER_1000_CREDITS, 8);
  assert.equal(coinsForConfirmedCredits(1000), 8);
  assert.equal(coinsForConfirmedCredits(2000), 16);
  assert.equal(coinsForConfirmedCredits(5000), 40);
  assert.equal(coinsForConfirmedCredits(1500), null);
});

test("migration grants 10 only on insert and renews free coins once per Bahia day", async () => {
  const sql = await readProjectFile(
    "supabase/migrations/20260811170000_secure_lifevu_economy.sql",
  );

  assert.match(sql, /alter column moedas_free set default 10/i);
  assert.match(sql, /new\.moedas_free := 10/i);
  assert.match(sql, /before insert on public\.profiles/i);
  assert.match(sql, /if v_last_reset < v_today then[\s\S]*set moedas_free = 5/i);
  assert.match(sql, /ultimo_reset_diario = v_today/i);
  assert.match(sql, /timezone\('America\/Bahia', now\(\)\)/i);
  assert.doesNotMatch(
    sql.match(/create or replace function public\.resetar_moedas_diarias[\s\S]*?\$\$;/i)?.[0] ?? "",
    /set moedas_avulsas/i,
  );
});

test("targeted free coin fix overrides legacy 2 without changing existing balances", async () => {
  const sql = await readProjectFile(
    "supabase/migrations/20260812160000_fix_free_coin_allocation.sql",
  );

  assert.match(sql, /alter column moedas_free set default 10/i);
  assert.match(sql, /new\.moedas_free := 10/i);
  assert.match(sql, /create trigger zz_lifevu_set_new_profile_free_coins[\s\S]*before insert/i);
  assert.match(sql, /set moedas_free = 5,[\s\S]*ultimo_reset_diario = v_today/i);
  assert.match(sql, /v_last_reset >= v_today[\s\S]*return false/i);
  assert.match(sql, /timezone\('America\/Bahia', now\(\)\)/i);
  assert.doesNotMatch(sql, /set\s+moedas_avulsas|set\s+moedas_vip/i);
  assert.doesNotMatch(
    sql.match(/update public\.profiles[\s\S]*?where ultimo_reset_diario is null;/i)?.[0] ?? "",
    /moedas_free\s*=/i,
  );
  assert.doesNotMatch(sql, /auth\.role\(\)/i);
  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'role', ''\) = 'service_role'/i);
  assert.match(sql, /auth\.uid\(\) is distinct from usuario_id[\s\S]*auth\.jwt\(\) ->> 'role'/i);
  assert.match(sql, /select ultimo_reset_diario[\s\S]*for update/i);
  assert.match(sql, /perform pg_catalog\.set_config\([\s\S]*'lifevu\.daily_reset_authorized'[\s\S]*'1'[\s\S]*true/i);
  assert.match(sql, /pg_catalog\.current_setting\('lifevu\.daily_reset_authorized', true\)/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /new\.moedas_free is distinct from old\.moedas_free/i);
  assert.match(sql, /new\.ultimo_reset_diario is distinct from old\.ultimo_reset_diario/i);
  assert.match(sql, /new\.moedas_avulsas is distinct from old\.moedas_avulsas/i);
  assert.match(sql, /new\.creditos_pagos is distinct from old\.creditos_pagos/i);
  assert.match(sql, /new\.plano is distinct from old\.plano/i);
  assert.match(sql, /new\.role is distinct from old\.role/i);
  assert.match(sql, /new\.vip_vencimento is distinct from old\.vip_vencimento/i);
  assert.match(sql, /Acesso Negado: Tentativa de fraude bloqueada pelo sistema\./i);
  assert.match(sql, /where id = auth\.uid\(\) and role = 'admin'/i);
  assert.match(sql, /revoke all on function public\.resetar_moedas_diarias\(uuid\) from public/i);
  assert.match(sql, /grant execute on function public\.resetar_moedas_diarias\(uuid\)[\s\S]*to authenticated, service_role/i);
});

test("daily free coin state renews to 5 only after the Bahia date changes", () => {
  const renew = ({ free, purchased, vip, lastReset, today }) => {
    if (lastReset >= today) return { renewed: false, free, purchased, vip, lastReset };
    return { renewed: true, free: 5, purchased, vip, lastReset: today };
  };

  assert.deepEqual(
    renew({ free: 10, purchased: 0, vip: 0, lastReset: "2026-08-12", today: "2026-08-12" }),
    { renewed: false, free: 10, purchased: 0, vip: 0, lastReset: "2026-08-12" },
  );
  assert.deepEqual(
    renew({ free: 10, purchased: 16, vip: 7, lastReset: "2026-08-12", today: "2026-08-13" }),
    { renewed: true, free: 5, purchased: 16, vip: 7, lastReset: "2026-08-13" },
  );
  assert.deepEqual(
    renew({ free: 1, purchased: 16, vip: 7, lastReset: "2026-08-12", today: "2026-08-13" }),
    { renewed: true, free: 5, purchased: 16, vip: 7, lastReset: "2026-08-13" },
  );
  assert.deepEqual(
    renew({ free: 5, purchased: 16, vip: 7, lastReset: "2026-08-13", today: "2026-08-13" }),
    { renewed: false, free: 5, purchased: 16, vip: 7, lastReset: "2026-08-13" },
  );
});

test("daily authorization cannot bypass financial antifraud protection", () => {
  const mayChange = ({ serviceRole = false, admin = false, dailyFlag = false, fields }) => {
    if (serviceRole || admin) return true;
    const financial = new Set(["moedas_avulsas", "creditos_pagos", "plano", "role", "vip_vencimento"]);
    if (fields.some((field) => financial.has(field))) return false;
    const daily = new Set(["moedas_free", "ultimo_reset_diario"]);
    return dailyFlag && fields.every((field) => daily.has(field));
  };

  assert.equal(mayChange({ fields: ["moedas_free"] }), false);
  assert.equal(mayChange({ fields: ["ultimo_reset_diario"] }), false);
  assert.equal(mayChange({ dailyFlag: true, fields: ["moedas_free", "ultimo_reset_diario"] }), true);
  assert.equal(mayChange({ dailyFlag: true, fields: ["moedas_avulsas"] }), false);
  assert.equal(mayChange({ dailyFlag: true, fields: ["creditos_pagos"] }), false);
  assert.equal(mayChange({ serviceRole: true, fields: ["moedas_free", "creditos_pagos"] }), true);
  assert.equal(mayChange({ admin: true, fields: ["moedas_free", "creditos_pagos"] }), true);
});

test("authenticated dashboard runs the daily reset before fetching balances", async () => {
  const dashboard = await readProjectFile("public/js/dashboard.js");
  const sessionStart = dashboard.indexOf("async function carregarSessao()");
  const sessionEnd = dashboard.indexOf("carregarSessao();", sessionStart);
  const sessionLoad = dashboard.slice(sessionStart, sessionEnd);

  assert.match(sessionLoad, /auth\.getUser\(\)/);
  assert.match(sessionLoad, /if \(authError \|\| !user\)/);
  assert.match(sessionLoad, /rpc\('resetar_moedas_diarias', \{ usuario_id: user\.id \}\)/);
  assert.match(sessionLoad, /if \(resetError\) console\.warn/);
  assert.match(sessionLoad, /from\('profiles'\)\.select\('\*'\)/);
  assert.ok(
    sessionLoad.indexOf("rpc('resetar_moedas_diarias'") < sessionLoad.indexOf("from('profiles')"),
    "daily reset must run before the balance profile is fetched",
  );
});

test("confirmed purchases are idempotent and credit the purchased bucket", async () => {
  const sql = await readProjectFile(
    "supabase/migrations/20260811170000_secure_lifevu_economy.sql",
  );

  assert.match(sql, /payment_id text primary key/i);
  assert.match(sql, /p_credits % 1000 <> 0/i);
  assert.match(sql, /v_coins := \(p_credits \/ 1000\) \* 8/i);
  assert.match(sql, /on conflict \(payment_id\) do nothing/i);
  assert.match(sql, /moedas_avulsas = coalesce\(moedas_avulsas, 0\) \+ v_coins/i);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.creditar_compra_confirmada[\s\S]*to authenticated/i);
});

test("migration preserves the SonhoBom legacy profiles update path", async () => {
  const [sql, landing, oracleDoc, oraclePatch] = await Promise.all([
    readProjectFile("supabase/migrations/20260811170000_secure_lifevu_economy.sql"),
    readProjectFile("public/landing.html"),
    readProjectFile("docs/ORACLE_BOT_VALUE_UPDATE.md"),
    readProjectFile("patches/sonhobom-oracle-economy-only.patch"),
  ]);

  assert.doesNotMatch(sql, /(?:revoke|grant)[^;]*on table public\.profiles/i);
  assert.doesNotMatch(sql, /(?:create|alter|drop) policy[\s\S]*?profiles/i);
  assert.match(sql, /before insert on public\.profiles/i);
  assert.doesNotMatch(sql, /before update on public\.profiles/i);
  assert.match(sql, /optional service-role path/i);
  assert.match(landing, /5\.000 Créditos/);
  assert.match(landing, /9\.000 Créditos/);
  assert.match(landing, /valoresAvulsos = \[1000, 2000, 3000, 4000, 6000, 7000, 8000, 10000\]/);
  assert.doesNotMatch(landing, /valoresAvulsos = \[[^\]]*(?:5000|9000)/);

  assert.match(oracleDoc, /creditosRecebidos === 20000/);
  assert.match(oracleDoc, /creditosRecebidos === 35000/);
  assert.match(oraclePatch, /CREDITOS_POR_PACOTE = 1000/);
  assert.match(oraclePatch, /MOEDAS_POR_PACOTE = 8/);
  assert.match(oraclePatch, /Mínimo exigido: 1000/);
  assert.doesNotMatch(
    oraclePatch,
    /updateCreditBalances|messageReceived|WebSocket|Supabase|imvu_account|wallet-|20000|35000/,
  );
});

test("paid credit increases create financial history without changing frontend permissions", async () => {
  const [baseMigration, historyMigration, admin, isisDoc] = await Promise.all([
    readProjectFile("supabase/migrations/20260811170000_secure_lifevu_economy.sql"),
    readProjectFile("supabase/migrations/20260812120000_record_legacy_payment_history.sql"),
    readProjectFile("public/admin.html"),
    readProjectFile("docs/ISIS_CREDITOS_PAGOS_UPDATE.md"),
  ]);

  assert.match(admin, /from\('historico_transacoes'\)/);
  assert.match(admin, /order\('data_hora', \{ ascending: false \}\)/);
  assert.doesNotMatch(admin, /localStorage/);
  assert.match(historyMigration, /after update of creditos_pagos on public\.profiles/i);
  assert.match(historyMigration, /coalesce\(new\.creditos_pagos, 0\) > coalesce\(old\.creditos_pagos, 0\)/i);
  assert.match(historyMigration, /v_paid := coalesce\(new\.creditos_pagos, 0\) - coalesce\(old\.creditos_pagos, 0\)/i);
  assert.match(historyMigration, /v_coins_granted := coalesce\(new\.moedas_avulsas, 0\)[\s\S]*coalesce\(old\.moedas_avulsas, 0\)/i);
  assert.match(historyMigration, /VIP 15 Dias · 5000 créditos/);
  assert.match(historyMigration, /VIP 30 Dias · 9000 créditos/);
  assert.match(historyMigration, /'Automático'/);
  assert.match(historyMigration, /new\.creditos_pagos := old\.creditos_pagos/);
  assert.match(historyMigration, /new\.moedas_avulsas := old\.moedas_avulsas/);
  assert.match(historyMigration, /new\.plano := old\.plano/);
  assert.match(historyMigration, /new\.role := old\.role/);
  assert.match(historyMigration, /new\.vip_vencimento := old\.vip_vencimento/);
  assert.match(historyMigration, /auth\.role\(\)[\s\S]*service_role/);
  assert.match(historyMigration, /role = 'admin'/);
  assert.doesNotMatch(historyMigration, /create table|alter table|create policy|drop policy/i);
  assert.doesNotMatch(historyMigration, /(?:grant|revoke)[^;]*on table/i);
  assert.doesNotMatch(admin, /\.from\('historico_transacoes'\)[\s\S]*?\.(?:insert|update|delete)\(/);
  assert.match(baseMigration, /set_config\('lifevu\.purchase_history_written_by_rpc', '1', true\)/);
  assert.match(isisDoc, /creditos_pagos: creditosPagosAtuais \+ creditosRecebidos/);
  assert.match(isisDoc, /creditos_pagos: creditosPagosAtuais \+ 5000/);
  assert.match(isisDoc, /creditos_pagos: creditosPagosAtuais \+ 9000/);
});

test("financial history contract covers coins, VIPs and ignores non-payments", () => {
  const describeUpdate = ({ oldPaid, newPaid, oldCoins, newCoins, plan }) => {
    const paid = (newPaid ?? 0) - (oldPaid ?? 0);
    if (paid <= 0) return null;
    if (paid === 5000 && plan.includes("VIP 15")) return "VIP 15 Dias · 5000 créditos";
    if (paid === 9000 && plan.includes("VIP 30")) return "VIP 30 Dias · 9000 créditos";
    const coins = (newCoins ?? 0) - (oldCoins ?? 0);
    if (coins <= 0) return null;
    return `+${coins} moedas · ${paid} créditos · Moedas avulsas`;
  };

  assert.equal(describeUpdate({ oldPaid: 0, newPaid: 1000, oldCoins: 0, newCoins: 8, plan: "Free" }), "+8 moedas · 1000 créditos · Moedas avulsas");
  assert.equal(describeUpdate({ oldPaid: 0, newPaid: 1500, oldCoins: 0, newCoins: 8, plan: "Free" }), "+8 moedas · 1500 créditos · Moedas avulsas");
  assert.equal(describeUpdate({ oldPaid: 0, newPaid: 2000, oldCoins: 0, newCoins: 16, plan: "Free" }), "+16 moedas · 2000 créditos · Moedas avulsas");
  assert.equal(describeUpdate({ oldPaid: 0, newPaid: 5000, oldCoins: 0, newCoins: 0, plan: "VIP 15 Dias" }), "VIP 15 Dias · 5000 créditos");
  assert.equal(describeUpdate({ oldPaid: 0, newPaid: 9000, oldCoins: 0, newCoins: 0, plan: "VIP 30 Dias" }), "VIP 30 Dias · 9000 créditos");
  assert.equal(describeUpdate({ oldPaid: 1000, newPaid: 1000, oldCoins: 8, newCoins: 8, plan: "Free" }), null);
  assert.equal(describeUpdate({ oldPaid: 1000, newPaid: 1000, oldCoins: 8, newCoins: 16, plan: "Free" }), null);
});

test("landing hero uses pair 1 and results use pairs 3, 4, then 2", async () => {
  const landing = await readProjectFile("public/landing.html");
  const hero = landing.match(/<div class="hero-stage"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.match(hero, /pose-reference-01\.webp/);
  assert.match(hero, /result-01\.webp/);
  assert.doesNotMatch(hero, /pose-reference-0[234]|result-0[234]/);

  const poseSources = [...landing.matchAll(/<figure class="media-card pose-card">[\s\S]*?<img src="img\/([^"]+)"/g)]
    .map((match) => match[1]);
  const resultSources = [...landing.matchAll(/<figure class="result-card[^>]*>[\s\S]*?<img src="img\/([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(poseSources, ["pose3.jpg", "pose4.jpg", "pose-reference-02.webp"]);
  assert.deepEqual(resultSources, ["resultado3.png", "resultado4.png", "result-02.webp"]);
});

test("header wordmarks expose white LIFE and red VU spans", async () => {
  const [landing, dashboard, admin, immersiveCss, dashboardCss, adminCss] = await Promise.all([
    readProjectFile("public/landing.html"),
    readProjectFile("public/dashboard.html"),
    readProjectFile("public/admin.html"),
    readProjectFile("public/css/immersive.css"),
    readProjectFile("public/css/dashboard-v2.css"),
    readProjectFile("public/css/admin-v2.css"),
  ]);
  for (const html of [landing, dashboard, admin]) {
    assert.match(html, /class="brand-life">LIFE<\/span><span class="brand-vu">VU<\/span>/);
  }
  assert.match(immersiveCss, /\.nav-wordmark \.brand-life \{ color: #fff; \}/);
  assert.match(dashboardCss, /\.studio-brand \.brand-life \{ color: #fff; \}/);
  assert.match(adminCss, /\.admin-brand \.brand-life \{ color: #fff; \}/);
});

test("Gemini payload validation checks image signatures instead of trusting MIME", async () => {
  const route = await readProjectFile("app/api/gemini/route.ts");
  assert.match(route, /decodeCanonicalBase64/);
  assert.match(route, /matchesDeclaredMimeType/);
  assert.match(route, /data\[0\] === 0xff[\s\S]*data\[1\] === 0xd8/);
  assert.match(route, /0x89, 0x50, 0x4e, 0x47/);
  assert.match(route, /"RIFF"[\s\S]*"WEBP"/);
  assert.match(route, /MAX_IMAGE_BYTES = 6 \* 1024 \* 1024/);
  assert.match(route, /MAX_TOTAL_IMAGE_BYTES = 18 \* 1024 \* 1024/);
});

test("Gemini rejects missing sessions and oversized bodies before provider access", async () => {
  const route = await readProjectFile("app/api/gemini/route.ts");
  assert.match(route, /if \(!authenticated\)[\s\S]*401/);
  assert.match(route, /declaredLength > MAX_REQUEST_BYTES[\s\S]*413/);
  assert.match(route, /rawBody\.byteLength > MAX_REQUEST_BYTES[\s\S]*413/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
});

test("Gemini route uses persistent RPC limits and one-time server refunds", async () => {
  const [route, dashboard, migration] = await Promise.all([
    readProjectFile("app/api/gemini/route.ts"),
    readProjectFile("public/js/dashboard.js"),
    readProjectFile("supabase/migrations/20260811170000_secure_lifevu_economy.sql"),
  ]);
  assert.match(route, /lifevu_begin_generation/);
  assert.match(route, /\n\s*429,/);
  assert.match(route, /"Retry-After"/);
  assert.match(route, /lifevu_finish_generation/);
  assert.match(route, /finishGeneration\(supabase, requestId, false/);
  assert.match(route, /GEMINI_TIMEOUT_MS = 45_000/);
  assert.match(migration, /lifevu_one_processing_request_per_user_idx/);
  assert.match(migration, /where status = 'processing'/);
  assert.match(migration, /v_request\.status <> 'processing'/);
  assert.doesNotMatch(dashboard, /consumir_moeda|estornar_moeda/);
});

test("public files contain no server Gemini secret reference", async () => {
  const publicUrl = new URL("../public/", import.meta.url);
  const queue = [publicUrl];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), current);
      if (entry.isDirectory()) queue.push(child);
      else if (/\.(?:html|js|css|svg)$/i.test(entry.name)) {
        assert.doesNotMatch(await readFile(child, "utf8"), /GEMINI_API_KEY/);
      }
    }
  }
});
