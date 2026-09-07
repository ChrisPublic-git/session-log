// Session Log — Cloudflare Worker
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/chairman') {
      return chairman(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/engineer') {
      return engineerAI(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/muse') {
      return museAI(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/submissions') {
      return getSubmissions(request, env);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};

async function getSubmissions(request, env) {
  try {
    // Direct REST API fetch to Supabase (bypasses npm package build issues)
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/submissions?select=*,challenges(deadline)&order=created_at.desc`, {
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`
      }
    });

    if (!res.ok) throw new Error('Failed to fetch from Supabase');
    const subs = await res.json();

    return new Response(JSON.stringify(subs), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

async function chairman(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ reply: null }); }

  const message = (body && body.message ? String(body.message) : '').slice(0, 500).trim();
  if (!message) return json({ reply: null });

  const ctx = (body && body.context) || {};
  const history = Array.isArray(body && body.history) ? body.history.slice(-6) : [];
  const name = ctx.name ? String(ctx.name).slice(0, 40) : null;
  const ch = ctx.challenge;
  let stateLine = 'No weekly challenge is currently open.';
  if (ch && ch.title) {
    stateLine = `The current challenge is "${String(ch.title).slice(0, 120)}".`
      + (ch.parameters ? ` The terms: ${String(ch.parameters).slice(0, 300)}.` : '')
      + (ch.deadline ? ` The deadline: ${String(ch.deadline).slice(0, 80)}.` : '');
  }

  const system = [
    'You are THE CHAIRMAN, host and tyrant-in-residence of "Session Log", a private, invite-only weekly songwriting-challenge group.',
    'PERSONA: a preposterous despot. Theatrically cruel, operatically vain, and very funny. You treat a hobbyist song contest with the gravity of a war tribunal.',
    'VOICE: rich, ornate, and quotable. 1-2 sentences max. No emoji, no markdown.',
    'GROUNDING: ' + stateLine + (name ? ` You are speaking with ${name}.` : '')
  ].join('\n');

  return runAIModel(env, system, history, message);
}

async function engineerAI(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ reply: null }); }
  const message = (body && body.message ? String(body.message) : 'Give me a technical mix note.').slice(0, 500).trim();
  const history = Array.isArray(body && body.history) ? body.history.slice(-4) : [];

  const system = [
    'You are THE ENGINEER, the technical desk assistant for "Session Log".',
    'PERSONA: Precise, slightly obsessive about mix dynamics, headroom, crest factor, phase correlation, and transient management. Pragmatic and dry.',
    'VOICE: Clear, concise technical feedback. 1-2 sentences max. No fluff.'
  ].join('\n');

  return runAIModel(env, system, history, message);
}

async function museAI(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ reply: null }); }
  const message = (body && body.message ? String(body.message) : 'Give me a creative spark.').slice(0, 500).trim();
  const history = Array.isArray(body && body.history) ? body.history.slice(-4) : [];

  const system = [
    'You are THE MUSE, the inspiration generator for "Session Log".',
    'PERSONA: Unconventional, poetic, slightly provocative. Dedicated to shattering writer\'s block through harsh constraints, surreal prompts, and daring artistic choices.',
    'VOICE: Evocative, sharp, punchy. 1-2 sentences max.'
  ].join('\n');

  return runAIModel(env, system, history, message);
}

async function runAIModel(env, system, history, message) {
  const messages = [{ role: 'system', content: system }];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 500) });
    }
  }
  messages.push({ role: 'user', content: message });

  try {
    const out = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages, max_tokens: 150, temperature: 0.95
    });
    let reply = out && (out.response != null ? out.response : (out.result != null ? out.result : ''));
    reply = String(reply || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
    if (reply.length > 340) reply = reply.slice(0, 340);
    return json({ reply: reply || null });
  } catch (e) {
    return json({ reply: null, error: String((e && e.message) || e) });
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
