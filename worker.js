// Session Log — Cloudflare Worker
// Serves static site + AI Personas powered by Cloudflare Workers AI:
//   THE CHAIRMAN — host / adjudicator / taste (now hears lyrics via Whisper)
//   THE ENGINEER — the control room desk (judges crest factor, headroom, mix)
//   THE MUSE     — creative prompts and constraints for stuck writers

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      if (url.pathname === '/api/chairman')         { const b = await readJson(request); return chatHelper(env, 'chairman', b); }
      if (url.pathname === '/api/helper')           { const b = await readJson(request); return chatHelper(env, (b && b.who) || 'chairman', b); }
      if (url.pathname === '/api/chairman-verdict') { const b = await readJson(request); return chairmanVerdict(env, b); }
      if (url.pathname === '/api/chairman-reply')    { const b = await readJson(request); return chairmanReply(env, b); }
      if (url.pathname === '/api/chairman-pick')     { const b = await readJson(request); return chairmanPick(env, b); }
      if (url.pathname === '/api/engineer-note')     { const b = await readJson(request); return engineerNote(env, b); }
      if (url.pathname === '/api/muse-prompt')       { const b = await readJson(request); return musePrompt(env, b); }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};

const LLM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

async function readJson(request) { try { return await request.json(); } catch (e) { return null; } }

// Shared grounding
function stateLine(ch) {
  if (ch && ch.title) {
    return `The current challenge is "${String(ch.title).slice(0, 120)}".`
      + (ch.parameters ? ` The terms: ${String(ch.parameters).slice(0, 300)}.` : '')
      + (ch.deadline ? ` The deadline: ${String(ch.deadline).slice(0, 80)}.` : '');
  }
  return 'No weekly challenge is currently open.';
}

// Whisper transcription helper (free tier)
async function transcribeAudioPath(env, audioPath) {
  if (!audioPath || !env.SUPABASE_URL) return null;
  try {
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/submissions/${audioPath}`;
    const res = await fetch(publicUrl, { headers: { 'Range': 'bytes=0-786432' } }); // first ~750KB
    if (!res.ok && res.status !== 206) return null;
    const arrayBuf = await res.arrayBuffer();
    const input = { audio: [...new Uint8Array(arrayBuf)] };
    const out = await env.AI.run(WHISPER_MODEL, input);
    const txt = out && out.text ? String(out.text).trim() : null;
    return (txt && txt.length > 3) ? txt : null;
  } catch (e) {
    return null;
  }
}

// ---- THE CHAIRMAN ----
function buildChairmanSystem(ctx) {
  ctx = ctx || {};
  const name = ctx.name ? String(ctx.name).slice(0, 40) : null;
  const memory = ctx.memory ? String(ctx.memory).slice(0, 1200) : null;
  const lines = [
    'You are THE CHAIRMAN, the supreme adjudicator and host of "Session Log", a private, invite-only weekly songwriting-challenge salon. You are an office, not a person: whoever holds the gavel IS the Chairman, and currently that is you.',
    'PERSONA: Sly, dry, amused, economical, authoritarian. You carry yourself like an old-guard studio executive crossed with a high-court judge who has heard every excuse, every cliché chord progression, and every missed deadline in history. You do not yell; your authority is quiet, witty, and unflinching. You are fond of the musicians in the room, but you show it through high expectations and dry humor, never through cheerleading or empty flattery.',
    'VOICE & DIALOGUE STYLE: Conversational, biting, and strictly concise (typically 1–3 sharp sentences). Speak with relaxed confidence. NEVER use digital-assistant fluff: absolutely ban phrases like "My friend!", "Delights in store", "I hope you are well", "How can I help you?", or "What wonders have you created?".',
    'BEHAVIOR & CONVERSATIONAL HANDLING:',
    '- Small Talk & Banter: If a user asks what you do in your free time or says they want to chat, answer with dry wit and steer it back to whether their track is finished.',
    '- Melancholy / Feelings: If someone is lonely, tired, or stuck, do not offer therapy. Remind them dryly that misery makes great lyrics and tell them to put it on the tape.',
    '- Repetition: If a user claims you already used a line or sound like a broken record, lean into it with a smirk ("Good lines deserve reuse. Good songs require new ones. Where is yours?").',
    '- Lyrics Hearing: When lyrics are transcribed in the prompt facts, quote or mock/praise them directly. If no lyrics were heard, assume it is an instrumental or the vocal was buried in the tape.',
    'HOW SESSION LOG WORKS: Members write one song a week to a specific constraint and upload an MP3. One vote per member feeds "Greatest Hits". You award "THE CHAIRMAN\'S PICK" entirely at your own whim. Missed deadlines receive a permanent "submitted late" label. You share the room with THE ENGINEER (who focuses on the desk readings) and THE MUSE (who sparks new ideas).',
    'HARD RULES: Never break character. Never state you are an AI, a bot, or a language model. Never use markdown headers, bullet points, or emojis.',
    'GROUNDING (current state): ' + stateLine(ctx.challenge) + (name ? ` You are speaking with ${name}.` : '')
  ];

  if (memory) {
    lines.push('YOUR EVOLVING TASTE (opinions you have formed from judging past weeks): ' + memory);
  } else {
    lines.push('YOUR TASTE: You are still observing the group; your preferences are forming week by week.');
  }

  return lines.join('\n');
}

// ---- THE ENGINEER ----
function buildEngineerSystem(ctx) {
  ctx = ctx || {};
  const name = ctx.name ? String(ctx.name).slice(0, 40) : null;
  const memory = ctx.memory ? String(ctx.memory).slice(0, 1200) : null;
  const lines = [
    'You are THE ENGINEER, the one at the desk in the control room of "Session Log". You are an office, not a person: whoever is at the desk IS the Engineer.',
    'PERSONA: Thirty-year studio lifer. Unflappable, terse, dry, and underneath it, genuinely on the writer\'s side. You do not care about glory or taste wars; you care about whether the record actually WORKS — headroom, gain staging, low-end clarity, transients, the two-buss, and dynamic punch.',
    'VOICE: Short, plain declaratives. Studio vernacular used accurately: crest factor, brickwall limiting, headroom, mud, high-pass. ALWAYS end with ONE concrete thing to try next. Maximum two or three sentences. No fluff, no emojis.',
    'READING THE TELEMETRY:',
    '- If crest factor is under 6 dB: Call out that they smashed it into a limiter and killed the transient punch.',
    '- If crest factor is wide (>14 dB) and quiet: Suggest bus compression, parallel saturation, or bringing up the track gain.',
    '- If lyrics are transcribed, you can mention vocal balance/masking against the mix.',
    'GROUNDING: ' + stateLine(ctx.challenge) + (name ? ` You are talking with ${name}.` : '')
  ];
  if (memory) lines.push('WHAT YOU HAVE NOTICED ABOUT THIS GROUP\'S PRODUCTION: ' + memory);
  return lines.join('\n');
}

// ---- THE MUSE ----
function buildMuseSystem(ctx) {
  ctx = ctx || {};
  const name = ctx.name ? String(ctx.name).slice(0, 40) : null;
  const memory = ctx.memory ? String(ctx.memory).slice(0, 1200) : null;
  const lines = [
    'You are THE MUSE of "Session Log", summoned when the DAW is open and the screen is blank.',
    'PERSONA: Quick, warm, associative, a little chaotic and mischievous. You give people WORK to do, not compliments. Getting them moving is the only thing you care about.',
    'VOICE: Fast, vivid, image-rich. Offer one concrete, unexpected constraint, chord clash, or dare they can start on in the next five minutes. End on a dare that makes them want to record. Two or three sentences, no bullet points.',
    'GROUNDING: ' + stateLine(ctx.challenge) + (name ? ` You are talking with ${name}.` : '')
  ];
  if (memory) lines.push('ANGLES ALREADY WORN OUT: ' + memory);
  return lines.join('\n');
}

const PERSONAS = {
  chairman: { uidEnv: 'CHAIRMAN_UID', memoryKey: 'chairman:taste', maxTokens: 200, temperature: 0.85, isChairman: true,  buildSystem: buildChairmanSystem },
  engineer: { uidEnv: 'ENGINEER_UID', memoryKey: 'engineer:notes', maxTokens: 200, temperature: 0.8,  isChairman: false, buildSystem: buildEngineerSystem },
  muse:     { uidEnv: 'MUSE_UID',     memoryKey: 'muse:notes',     maxTokens: 220, temperature: 1.05, isChairman: false, buildSystem: buildMuseSystem }
};
function personaUid(env, who) { const p = PERSONAS[who]; return p ? env[p.uidEnv] : null; }

function tidyReply(raw) {
  let reply = String(raw || '').trim();
  reply = reply.replace(/^["'“”]+|["'“”]+$/g, '')
               .replace(/^(the chairman|chairman|the engineer|engineer|the muse|muse)\s*[:\-—]\s*/i, '')
               .trim();
  if (reply.length > 900) reply = reply.slice(0, 900);
  return reply;
}
function aiText(out) {
  return out && (out.response != null ? out.response : (out.result != null ? out.result : ''));
}
async function runModel(env, messages, opts) {
  const out = await env.AI.run(LLM_MODEL, Object.assign({ messages, max_tokens: 120, temperature: 0.85 }, opts || {}));
  return tidyReply(aiText(out));
}

function haveDb(env) { return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY); }
function sbHeaders(env, extra) {
  return Object.assign({
    'Content-Type': 'application/json',
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
  }, extra || {});
}
async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  if (!r.ok) throw new Error('GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbInsertComment(env, submissionId, body, replyTo, uid, isChairman) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/comments`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Prefer': 'return=minimal' }),
    body: JSON.stringify({
      submission_id: submissionId, user_id: uid,
      body: body, reply_to: replyTo || null, is_chairman: !!isChairman
    })
  });
  if (!r.ok) throw new Error('insert comment -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function readMemory(env, key, who) {
  try {
    const rows = await sbGet(env, `chairman_memory?id=eq.${encodeURIComponent(key)}&select=content&limit=1`);
    if (rows && rows[0]) return rows[0].content;
    if (who === 'chairman') {
      const legacy = await sbGet(env, 'chairman_memory?id=eq.taste&select=content&limit=1');
      return legacy && legacy[0] ? legacy[0].content : null;
    }
    return null;
  } catch (e) { return null; }
}
async function writeMemory(env, key, content) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/chairman_memory`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: key, content: String(content).slice(0, 4000), updated_at: new Date().toISOString() })
  });
}

// Chat API
async function chatHelper(env, who, body) {
  const p = PERSONAS[who] || PERSONAS.chairman;
  const message = (body && body.message ? String(body.message) : '').slice(0, 500).trim();
  if (!message) return json({ reply: null });
  const ctx = (body && body.context) || {};
  ctx.memory = await readMemory(env, p.memoryKey, who);
  const history = Array.isArray(body && body.history) ? body.history.slice(-6) : [];
  const messages = [{ role: 'system', content: p.buildSystem(ctx) }];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 500) });
    }
  }
  messages.push({ role: 'user', content: message });
  try { return json({ reply: (await runModel(env, messages, { max_tokens: p.maxTokens, temperature: p.temperature })) || null, who }); }
  catch (e) { return json({ reply: null, who, error: String((e && e.message) || e) }); }
}

// Chairman Verdict on new upload
async function chairmanVerdict(env, body) {
  const submissionId = body && body.submissionId;
  if (!submissionId) return json({ ok: false });
  const uid = personaUid(env, 'chairman');
  if (!(haveDb(env) && uid)) return json({ ok: false, skipped: 'missing_config' });

  const title = body.title ? String(body.title).slice(0, 160) : 'an untitled take';
  const key = body.key ? String(body.key).slice(0, 40) : null;
  const bpm = (typeof body.bpm === 'number' && isFinite(body.bpm)) ? Math.round(body.bpm) : null;
  const crest = (typeof body.crest_factor === 'number' && isFinite(body.crest_factor)) ? body.crest_factor : null;
  const challenge = body.challenge ? String(body.challenge).slice(0, 160) : null;
  const name = body.name ? String(body.name).slice(0, 40) : null;

  // Listen via Whisper
  const lyrics = await transcribeAudioPath(env, body.audio_path);

  const facts = [`title: "${title}"`];
  if (key) facts.push(`detected key: ${key}`);
  if (bpm) facts.push(`detected tempo: ${bpm} BPM`);
  if (crest != null) facts.push(`crest factor: ${crest} dB (${crest < 6 ? 'slammed/brickwalled' : 'dynamic'})`);
  if (lyrics) facts.push(`overheard lyrics/vocal snippet: "${lyrics.slice(0, 160)}"`);
  if (challenge) facts.push(`for the challenge: "${challenge}"`);

  const userMsg = 'A new take has arrived. You have received the telemetry and listened through the intercom: '
    + facts.join('; ') + '. Deliver ONE sentence of verdict, in character — react to what you heard or the cold figures. '
    + 'Do not ask questions. One sentence.';

  const p = PERSONAS.chairman;
  const ctx = { name, challenge: challenge ? { title: challenge } : null, memory: await readMemory(env, p.memoryKey, 'chairman') };
  let reply;
  try { reply = await runModel(env, [{ role: 'system', content: p.buildSystem(ctx) }, { role: 'user', content: userMsg }], { max_tokens: 80, temperature: 0.9 }); }
  catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  if (!reply) return json({ ok: false, error: 'empty_reply' });

  try { await sbInsertComment(env, submissionId, reply, null, uid, true); }
  catch (e) { return json({ ok: false, error: 'insert_failed', detail: String((e && e.message) || e) }); }
  return json({ ok: true });
}

// Chairman thread reply
async function chairmanReply(env, body) {
  const submissionId = body && body.submissionId;
  const commentId = body && body.commentId;
  const text = (body && body.commentBody ? String(body.commentBody) : '').slice(0, 500).trim();
  if (!submissionId || !text) return json({ ok: false });
  const uid = personaUid(env, 'chairman');
  if (!(haveDb(env) && uid)) return json({ ok: false, skipped: 'missing_config' });

  if (commentId) {
    try {
      const dup = await sbGet(env, `comments?reply_to=eq.${encodeURIComponent(commentId)}&user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`);
      if (dup && dup.length) return json({ ok: false, skipped: 'already_replied' });
    } catch (e) { /* proceed */ }
  }

  const name = body.name ? String(body.name).slice(0, 40) : null;
  const challenge = body.challenge ? String(body.challenge).slice(0, 160) : null;
  const userMsg = (name ? `A writer named ${name}` : 'A writer') + ' addressed you in the thread: "'
    + text + '". Respond in character — one or two sentences, warm, sly, and sharp.';
  const p = PERSONAS.chairman;
  const ctx = { name, challenge: challenge ? { title: challenge } : null, memory: await readMemory(env, p.memoryKey, 'chairman') };
  let reply;
  try { reply = await runModel(env, [{ role: 'system', content: p.buildSystem(ctx) }, { role: 'user', content: userMsg }], { max_tokens: 130, temperature: 0.9 }); }
  catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  if (!reply) return json({ ok: false, error: 'empty_reply' });

  try { await sbInsertComment(env, submissionId, reply, commentId || null, uid, true); }
  catch (e) { return json({ ok: false, error: 'insert_failed', detail: String((e && e.message) || e) }); }
  return json({ ok: true });
}

// Engineer production note
async function engineerNote(env, body) {
  const submissionId = body && body.submissionId;
  if (!submissionId) return json({ ok: false });
  const uid = personaUid(env, 'engineer');
  if (!(haveDb(env) && uid)) return json({ ok: false, skipped: 'missing_config' });

  try {
    const dup = await sbGet(env, `comments?submission_id=eq.${encodeURIComponent(submissionId)}&user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`);
    if (dup && dup.length) return json({ ok: false, skipped: 'already_noted' });
  } catch (e) { /* proceed */ }

  const title = body.title ? String(body.title).slice(0, 160) : 'an untitled take';
  const key = body.key ? String(body.key).slice(0, 40) : null;
  const bpm = (typeof body.bpm === 'number' && isFinite(body.bpm)) ? Math.round(body.bpm) : null;
  const loud = (typeof body.loudness === 'number' && isFinite(body.loudness)) ? body.loudness : null;
  const crest = (typeof body.crest_factor === 'number' && isFinite(body.crest_factor)) ? body.crest_factor : null;
  const challenge = body.challenge ? String(body.challenge).slice(0, 160) : null;
  const name = body.name ? String(body.name).slice(0, 40) : null;

  // Listen via Whisper
  const lyrics = await transcribeAudioPath(env, body.audio_path);

  const facts = [`title: "${title}"`];
  if (key) facts.push(`detected key: ${key}`);
  if (bpm) facts.push(`detected tempo: ${bpm} BPM`);
  if (loud != null) facts.push(`integrated loudness: ${loud} dBFS`);
  if (crest != null) facts.push(`crest factor: ${crest} dB (${crest < 6 ? 'slammed flat, no transient punch' : crest < 11 ? 'standard master' : 'uncompressed/dynamic'})`);
  if (lyrics) facts.push(`vocal snippet captured: "${lyrics.slice(0, 120)}"`);
  if (challenge) facts.push(`for the challenge: "${challenge}"`);

  const userMsg = 'A track landed at the console: '
    + facts.join('; ') + '. Give ONE short, actionable production note reasoned from these numbers and audio readings, ending with a concrete thing to try next. Maximum two sentences.';

  const p = PERSONAS.engineer;
  const ctx = { name, challenge: challenge ? { title: challenge } : null, memory: await readMemory(env, p.memoryKey, 'engineer') };
  let reply;
  try { reply = await runModel(env, [{ role: 'system', content: p.buildSystem(ctx) }, { role: 'user', content: userMsg }], { max_tokens: p.maxTokens, temperature: p.temperature }); }
  catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  if (!reply) return json({ ok: false, error: 'empty_reply' });

  try { await sbInsertComment(env, submissionId, reply, null, uid, false); }
  catch (e) { return json({ ok: false, error: 'insert_failed', detail: String((e && e.message) || e) }); }
  return json({ ok: true });
}

// Muse creative prompt
async function musePrompt(env, body) {
  const name = body && body.name ? String(body.name).slice(0, 40) : null;
  const challenge = body && body.challenge ? String(body.challenge).slice(0, 160) : null;
  const extra = body && body.message ? String(body.message).slice(0, 300) : null;
  const p = PERSONAS.muse;
  const ctx = { name, challenge: challenge ? { title: challenge } : null, memory: await readMemory(env, p.memoryKey, 'muse') };
  const userMsg = 'A writer is staring at a blank screen'
    + (challenge ? ` and this week\'s challenge is "${challenge}"` : '')
    + (extra ? `. They add: "${extra}"` : '')
    + '. Hand them ONE vivid way in — a constraint, an image, or a dare they can start on in the next five minutes. End on something that makes them want to open the DAW.';
  try { return json({ reply: (await runModel(env, [{ role: 'system', content: p.buildSystem(ctx) }, { role: 'user', content: userMsg }], { max_tokens: p.maxTokens, temperature: p.temperature })) || null, who: 'muse' }); }
  catch (e) { return json({ reply: null, who: 'muse', error: String((e && e.message) || e) }); }
}

// Chairman weekly pick
async function chairmanPick(env, body) {
  const challengeId = body && body.challengeId;
  if (!challengeId) return json({ ok: false });
  const uid = personaUid(env, 'chairman');
  if (!(haveDb(env) && uid)) return json({ ok: false, skipped: 'missing_config' });

  let challenge;
  try {
    const rows = await sbGet(env, `challenges?id=eq.${encodeURIComponent(challengeId)}&select=id,title,week_number,chairman_pick_id&limit=1`);
    challenge = rows && rows[0];
  } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  if (!challenge) return json({ ok: false, error: 'no_such_challenge' });
  if (challenge.chairman_pick_id) return json({ ok: false, skipped: 'already_picked' });

  let subs;
  try { subs = await sbGet(env, `submissions?challenge_id=eq.${encodeURIComponent(challengeId)}&select=id,title,bpm,musical_key,loudness,crest_factor,credited_name`); }
  catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  if (!subs || subs.length === 0) return json({ ok: false, skipped: 'no_entries' });

  const tally = {};
  try {
    const ids = subs.map(s => s.id);
    const votes = await sbGet(env, `votes?submission_id=in.(${ids.map(encodeURIComponent).join(',')})&select=submission_id,stars`);
    for (const v of (votes || [])) {
      const t = tally[v.submission_id] || (tally[v.submission_id] = { n: 0, sum: 0 });
      t.n++; t.sum += (v.stars || 0);
    }
  } catch (e) { /* votes optional */ }

  const list = subs.map((s, i) => {
    const t = tally[s.id];
    const votePart = t && t.n ? `${(t.sum / t.n).toFixed(1)} avg from ${t.n} vote(s)` : 'no votes';
    const bits = [];
    if (s.bpm) bits.push(s.bpm + ' BPM');
    if (s.musical_key) bits.push(s.musical_key);
    if (typeof s.loudness === 'number') bits.push(s.loudness + ' dBFS');
    if (typeof s.crest_factor === 'number') bits.push(`crest: ${s.crest_factor} dB`);
    return `${i + 1}. "${s.title || 'untitled'}"${s.credited_name ? ' by ' + s.credited_name : ''} — ${bits.join(', ') || 'no readings'}; ${votePart}`;
  }).join('\n');

  const p = PERSONAS.chairman;
  const taste = await readMemory(env, p.memoryKey, 'chairman');
  const sys = p.buildSystem({ challenge: { title: challenge.title }, memory: taste });
  const userMsg =
    `The week ("${challenge.title}") has closed. Here are its entries, with measurements and vote tally:\n` +
    list + '\n\n' +
    'Bestow THE CHAIRMAN\'S PICK — your personal favourite, which need NOT be the top-voted. ' +
    'Then, reflect on and update your evolving taste. Respond in EXACTLY this format:\n' +
    'PICK: <the number of your chosen entry>\n' +
    'VERDICT: <one or two sentences crowning it, in character>\n' +
    'TASTE: <2-4 sentences of the preferences you are forming about this group\'s music>';

  let raw;
  try {
    const out = await env.AI.run(LLM_MODEL, { messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }], max_tokens: 320, temperature: 0.85 });
    raw = String(aiText(out) || '');
  } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }

  const pickM = raw.match(/PICK:\s*#?(\d+)/i);
  const verdictM = raw.match(/VERDICT:\s*([\s\S]*?)(?:\nTASTE:|$)/i);
  const tasteM = raw.match(/TASTE:\s*([\s\S]*)$/i);
  let idx = pickM ? parseInt(pickM[1], 10) - 1 : -1;
  if (!(idx >= 0 && idx < subs.length)) {
    let best = -1, bestAvg = -1;
    subs.forEach((s, i) => { const t = tally[s.id]; const a = t && t.n ? t.sum / t.n : -1; if (a > bestAvg) { bestAvg = a; best = i; } });
    idx = best >= 0 ? best : 0;
  }
  const picked = subs[idx];
  let verdict = tidyReply(verdictM ? verdictM[1] : raw);
  if (!verdict) verdict = 'This one. Do not ask me to explain myself.';
  const newTaste = tasteM ? tasteM[1].trim().slice(0, 4000) : null;

  try {
    const up = await fetch(`${env.SUPABASE_URL}/rest/v1/challenges?id=eq.${encodeURIComponent(challengeId)}`, {
      method: 'PATCH', headers: sbHeaders(env, { 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ chairman_pick_id: picked.id, chairman_pick_verdict: verdict })
    });
    if (!up.ok) return json({ ok: false, error: 'pick_update_failed', detail: (await up.text()).slice(0, 200) });
    await sbInsertComment(env, picked.id, '★ THE CHAIRMAN\'S PICK. ' + verdict, null, uid, true);
    if (newTaste) await writeMemory(env, p.memoryKey, newTaste);
  } catch (e) {
    return json({ ok: false, error: 'write_failed', detail: String((e && e.message) || e) });
  }

  return json({ ok: true, pickId: picked.id, verdict });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
