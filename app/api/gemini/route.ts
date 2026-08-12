import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const MAX_REQUEST_BYTES = 19 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024;
const GEMINI_TIMEOUT_MS = 45_000;
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 600;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://hrldelnvaukkroupanvg.supabase.co";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_s4MEjHRwsFnDfUKBLheacg_wjuDzguc";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";
type LifeVUInput =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: AllowedImageMimeType; data: string };

type BeginGenerationResult = {
  ok: boolean;
  code?: string;
  request_id?: string;
  retry_after?: number;
};

function jsonResponse(payload: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return NextResponse.json(payload, {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  });
}

function safePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function decodeCanonicalBase64(data: string) {
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return null;
  }

  const decoded = Buffer.from(data, "base64");
  const canonicalInput = data.replace(/=+$/, "");
  const canonicalDecoded = decoded.toString("base64").replace(/=+$/, "");
  return canonicalInput === canonicalDecoded ? decoded : null;
}

function matchesDeclaredMimeType(data: Buffer, mimeType: AllowedImageMimeType) {
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  return data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP";
}

export function validatePayload(value: unknown): LifeVUInput[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasExactKeys(body, ["input"]) || !Array.isArray(body.input)) return null;
  if (body.input.length < 2 || body.input.length > 4) return null;

  const [textItem, ...imageItems] = body.input;
  if (!textItem || typeof textItem !== "object" || Array.isArray(textItem)) return null;
  const textRecord = textItem as Record<string, unknown>;
  if (
    !hasExactKeys(textRecord, ["type", "text"]) ||
    textRecord.type !== "text" ||
    typeof textRecord.text !== "string" ||
    textRecord.text.length === 0 ||
    textRecord.text.length > MAX_TEXT_LENGTH
  ) {
    return null;
  }

  let totalImageBytes = 0;
  const validated: LifeVUInput[] = [{ type: "text", text: textRecord.text }];
  for (const item of imageItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const imageRecord = item as Record<string, unknown>;
    if (
      !hasExactKeys(imageRecord, ["type", "mime_type", "data"]) ||
      imageRecord.type !== "image" ||
      typeof imageRecord.mime_type !== "string" ||
      !ALLOWED_IMAGE_MIME_TYPES.has(imageRecord.mime_type) ||
      typeof imageRecord.data !== "string"
    ) {
      return null;
    }

    const decoded = decodeCanonicalBase64(imageRecord.data);
    const mimeType = imageRecord.mime_type as AllowedImageMimeType;
    if (!decoded || decoded.length === 0 || decoded.length > MAX_IMAGE_BYTES) return null;
    if (!matchesDeclaredMimeType(decoded, mimeType)) return null;

    totalImageBytes += decoded.length;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) return null;
    validated.push({ type: "image", mime_type: mimeType, data: imageRecord.data });
  }

  return validated;
}

export function isAllowedOrigin(req: Request) {
  const originHeader = req.headers.get("origin");
  if (!originHeader) return false;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  if (origin.origin === new URL(req.url).origin) return true;

  const configuredOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    ...(process.env.LIFEVU_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });

  if (configuredOrigins.includes(origin.origin)) return true;
  return process.env.NODE_ENV !== "production" &&
    (origin.hostname === "localhost" || origin.hostname === "127.0.0.1");
}

async function authenticate(req: Request): Promise<{
  user: User;
  supabase: SupabaseClient;
} | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) return null;

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  return error || !user ? null : { user, supabase };
}

async function finishGeneration(
  supabase: SupabaseClient,
  requestId: string,
  succeeded: boolean,
  userId: string,
) {
  const { data, error } = await supabase.rpc("lifevu_finish_generation", {
    p_request_id: requestId,
    p_succeeded: succeeded,
  });
  if (error || data !== true) {
    console.error("lifevu_generation_finalize_failed", {
      code: error?.code ?? "rpc_false",
      userId,
      requestId,
    });
  }
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ error: "Tipo de conteúdo inválido." }, 415);
  }

  if (!isAllowedOrigin(req)) {
    return jsonResponse({ error: "Origem não autorizada." }, 403);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "A requisição ultrapassa o limite permitido." }, 413);
  }

  const authenticated = await authenticate(req);
  if (!authenticated) {
    return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
  }
  const { user, supabase } = authenticated;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Serviço temporariamente indisponível." }, 503);
  }

  let rawBody: ArrayBuffer;
  try {
    rawBody = await req.arrayBuffer();
  } catch {
    return jsonResponse({ error: "Não foi possível ler a requisição." }, 400);
  }
  if (rawBody.byteLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "A requisição ultrapassa o limite permitido." }, 413);
  }

  let parsedBody: unknown;
  try {
    const bodyText = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    parsedBody = JSON.parse(bodyText) as unknown;
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  const input = validatePayload(parsedBody);
  if (!input) {
    return jsonResponse({ error: "Conteúdo multimodal inválido." }, 400);
  }

  const rateLimitMax = safePositiveInteger(
    process.env.GEMINI_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX,
  );
  const rateLimitWindow = safePositiveInteger(
    process.env.GEMINI_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  );
  const { data: beginData, error: beginError } = await supabase.rpc(
    "lifevu_begin_generation",
    {
      p_rate_limit_max: rateLimitMax,
      p_window_seconds: rateLimitWindow,
    },
  );

  if (beginError) {
    console.error("lifevu_generation_begin_failed", {
      code: beginError.code,
      userId: user.id,
    });
    return jsonResponse({ error: "Não foi possível validar o saldo." }, 503);
  }

  const begin = beginData as BeginGenerationResult | null;
  if (!begin?.ok || !begin.request_id) {
    if (begin?.code === "rate_limited" || begin?.code === "generation_in_progress") {
      const retryAfter = Math.max(1, Number(begin.retry_after) || 5);
      return jsonResponse(
        { error: "Limite temporário de gerações atingido." },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }
    if (begin?.code === "insufficient_coins") {
      return jsonResponse({ error: "Moedas insuficientes." }, 402);
    }
    if (begin?.code === "unauthorized") {
      return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
    }
    return jsonResponse({ error: "Não foi possível autorizar a geração." }, 403);
  }

  const requestId = begin.request_id;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
    const parts: Array<string | Part> = input.map((item) =>
      item.type === "text"
        ? item.text
        : { inlineData: { mimeType: item.mime_type, data: item.data } },
    );
    const result = await model.generateContent(parts, {
      timeout: GEMINI_TIMEOUT_MS,
      signal: controller.signal,
    });
    const text = result.response.text().trim();

    if (!text) throw new Error("empty_response");

    await finishGeneration(supabase, requestId, true, user.id);
    return jsonResponse({ text });
  } catch (error: unknown) {
    await finishGeneration(supabase, requestId, false, user.id);
    const code = error instanceof Error ? error.name : "unknown_error";
    console.error("gemini_request_failed", { code, userId: user.id, requestId });
    return jsonResponse(
      { error: "Falha temporária ao processar a geração." },
      controller.signal.aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
