import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("serves the immersive landing at the clean root URL", async () => {
  const [nextConfig, fallbackPage, landing] = await Promise.all([
    readProjectFile("next.config.ts"),
    readProjectFile("app/page.tsx"),
    readProjectFile("public/landing.html"),
  ]);

  assert.match(nextConfig, /beforeFiles/);
  assert.match(nextConfig, /source:\s*"\/"/);
  assert.match(nextConfig, /destination:\s*"\/landing\.html"/);
  assert.match(fallbackPage, /redirect\("\/landing\.html"\)/);
  assert.match(landing, /css\/immersive\.css\?v=7/);
  assert.match(landing, /js\/landing-experience\.js\?v=7/);
  assert.match(landing, /Deslize para explorar/);
});

test("keeps mobile motion and routes the primary engine through secure Gemini", async () => {
  const [motion, compiler, dashboard, dashboardHtml, geminiRoute, nvidiaRoute] = await Promise.all([
    readProjectFile("public/js/landing-experience.js"),
    readProjectFile("public/js/compiler.js"),
    readProjectFile("public/js/dashboard.js"),
    readProjectFile("public/dashboard.html"),
    readProjectFile("app/api/gemini/route.ts"),
    readProjectFile("app/api/nvidia/route.ts"),
  ]);

  assert.match(motion, /requestAnimationFrame/);
  assert.match(motion, /touchmove/);
  assert.match(motion, /visualViewport/);
  assert.match(motion, /--scroll-cue-opacity/);
  assert.match(compiler, /fetch\("\/api\/gemini"/);
  assert.match(compiler, /Authorization.*Bearer/);
  assert.doesNotMatch(compiler, /@google\/generative-ai|esm\.run/);
  assert.match(dashboard, /session\.access_token/);
  assert.doesNotMatch(dashboard, /AQ\.[A-Za-z0-9_-]+/);
  assert.doesNotMatch(dashboardHtml, /@google\/generative-ai/);
  assert.match(geminiRoute, /process\.env\.GEMINI_API_KEY/);
  assert.match(geminiRoute, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(geminiRoute, /gemini-flash-lite-latest/);
  assert.match(geminiRoute, /model\.generateContent\(parts,/);
  assert.match(nvidiaRoute, /process\.env\.NVIDIA_API_KEY/);
});

test("sends registration verification through the configured EmailJS browser SDK", async () => {
  const landing = await readProjectFile("public/landing.html");

  assert.match(landing, /@emailjs\/browser@4\/dist\/email\.min\.js/);
  assert.match(landing, /emailjs\.init\(\{ publicKey:/);
  assert.match(landing, /emailjs\.send\('service_uy9yhhg', 'template_rrzfoyi'/);
  assert.match(landing, /to_name:[\s\S]*to_email:[\s\S]*message:/);
  assert.doesNotMatch(landing, /SUA_PUBLIC_KEY_EMAILJS|SEU_TEMPLATE_ID_EMAILJS|\/api\/email\/verification/);
});
