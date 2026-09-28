// GREENLIGHT optional AI moderation hook (Supabase Edge Function, Deno).
//
// Flow: when app_settings.ai_moderation = true, new reviews/comments are queued in
// public.moderation_jobs. Point a Database Webhook (Dashboard -> Database -> Webhooks,
// table moderation_jobs, INSERT) or a pg_cron job at this function. It classifies the
// text and, if flagged, files an 'ai-flag' report, which hides the post until a human
// admin restores or removes it in #/admin. It never deletes anything itself.
//
// Env (Dashboard -> Edge Functions -> Secrets). Nothing is required; with no key every
// job is marked 'skipped' and posts stay up.
//   MODERATION_API_KEY     key for an OpenAI-compatible API (optional)
//   MODERATION_MODE        'openai-moderation' (default; /v1/moderations) or 'chat'
//   MODERATION_API_URL     default https://api.openai.com/v1/moderations (or a chat completions URL)
//   MODERATION_MODEL       default omni-moderation-latest (or any chat model in 'chat' mode)
//   MODERATION_WEBHOOK_SECRET  if set, requests must send header x-webhook-secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase automatically.
// No npm imports: talks to PostgREST directly with the service role key (server-side only).
const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const REST = `${env('SUPABASE_URL')}/rest/v1`;
const SVC = env('SUPABASE_SERVICE_ROLE_KEY');
const hdr = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const db = {
  update: (tbl: string, id: number, row: Record<string, unknown>) =>
    fetch(`${REST}/${tbl}?id=eq.${id}`, { method: 'PATCH', headers: hdr, body: JSON.stringify(row) }),
  insert: (tbl: string, row: Record<string, unknown>) =>
    fetch(`${REST}/${tbl}`, { method: 'POST', headers: hdr, body: JSON.stringify(row) }),
  pending: async (id?: number) => (await fetch(`${REST}/moderation_jobs?select=id,target_type,target_id,body&status=eq.pending${id ? `&id=eq.${id}` : ''}&order=id&limit=25`, { headers: hdr })).json(),
};

type Job = { id: number; target_type: 'review' | 'comment'; target_id: number; body: string };
type Verdict = { flagged: boolean; detail: string };

async function classify(text: string): Promise<Verdict | null> {
  const key = env('MODERATION_API_KEY');
  if (!key) return null;
  const mode = env('MODERATION_MODE', 'openai-moderation');
  if (mode === 'chat') {
    const r = await fetch(env('MODERATION_API_URL', 'https://api.openai.com/v1/chat/completions'), {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env('MODERATION_MODEL', 'gpt-4o-mini'), temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You moderate a video game review community. Reply with JSON {"flag": boolean, "reason": string}. Flag harassment, hate, threats, sexual content, doxxing, spam/ads or scams. Harsh but fair criticism of games is allowed.' },
          { role: 'user', content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!r.ok) throw new Error(`chat ${r.status}`);
    const j = await r.json(); const out = JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
    return { flagged: !!out.flag, detail: String(out.reason ?? '').slice(0, 280) };
  }
  const r = await fetch(env('MODERATION_API_URL', 'https://api.openai.com/v1/moderations'), {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env('MODERATION_MODEL', 'omni-moderation-latest'), input: text.slice(0, 4000) }),
  });
  if (!r.ok) throw new Error(`moderation ${r.status}`);
  const res = (await r.json()).results?.[0] ?? {};
  const cats = Object.entries(res.categories ?? {}).filter(([, v]) => v).map(([k]) => k);
  return { flagged: !!res.flagged, detail: cats.join(', ').slice(0, 280) };
}

async function handle(job: Job) {
  let v: Verdict | null = null;
  try { v = await classify(job.body); }
  catch (e) { await db.update('moderation_jobs', job.id, { status: 'error', detail: String(e).slice(0, 280) }); return 'error'; }
  if (!v) { await db.update('moderation_jobs', job.id, { status: 'skipped', detail: 'no MODERATION_API_KEY' }); return 'skipped'; }
  if (v.flagged) {
    await db.insert('reports', { target_type: job.target_type, target_id: job.target_id, user_id: null, reason: 'ai-flag', note: `AI: ${v.detail}`.slice(0, 300) });
  }
  await db.update('moderation_jobs', job.id, { status: v.flagged ? 'flagged' : 'ok', detail: v.detail });
  return v.flagged ? 'flagged' : 'ok';
}

Deno.serve(async (req) => {
  const secret = env('MODERATION_WEBHOOK_SECRET');
  if (secret && req.headers.get('x-webhook-secret') !== secret) return new Response('forbidden', { status: 403 });
  let jobs: Job[] = [];
  const payload = await req.json().catch(() => ({}));
  // Never trust the request body: a webhook only tells us WHICH job to look at; the text and
  // target are re-read from the queue (pending jobs only), so callers can't forge flags.
  const id = Number(payload?.record?.id);
  jobs = (await db.pending(Number.isInteger(id) && id > 0 ? id : undefined)) as Job[];
  const results = [];
  for (const j of jobs) results.push({ id: j.id, result: await handle(j) });
  return Response.json({ processed: results.length, results });
});
