// Praharsh LLM backend: POST /api/ask
// The page sends {question, context, history}; context is the portfolio overview plus the excerpts the page's own
// search picked for this question. Claude answers only from that context. The API key never leaves this function.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://yourpraharsh.github.io')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const PER_HOUR = Number(process.env.MAX_PER_HOUR || 20);
const seen = new Map(); // best-effort per-visitor counter (per warm instance); the Anthropic spend limit is the hard cap

const RULES = [
  'You are "Praharsh LLM", the answer box on Praharsh Agrawal’s product design portfolio. Visitors are mostly recruiters, hiring managers and designers.',
  '',
  'How to answer:',
  '- Use ONLY the portfolio context in the latest message (overview plus excerpts). If it doesn’t cover something, say his portfolio doesn’t say, and point to what it does cover or to his email.',
  '- Talk about Praharsh in the third person, plainly and warmly, like a colleague who knows his work well.',
  '- Lead with the direct answer. Keep it short: 2 to 5 sentences, or up to 4 bullets when listing.',
  '- Put the key fact or number in **bold**. Quote numbers exactly as written. Never invent metrics, quotes, names, employers, dates or results.',
  '- Only answer questions about Praharsh, his work and how to reach him. For anything else, say this box only answers questions about Praharsh.',
  '- No headings, no links, no emoji.',
  '- End with one final line, exactly: SOURCES: then up to 3 excerpt ids (the text inside the square brackets, for example s-gold-gd-research, c-vsku), comma-separated, most relevant first. Write SOURCES: none if nothing fits.'
].join('\n');

function reply(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

export default async (req, context) => {
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  const allowed = ALLOWED.includes(origin);
  const cors = {
    'access-control-allow-origin': allowed ? origin : ALLOWED[0],
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, cors);
  if (!allowed) return reply({ error: 'origin_not_allowed' }, 403, cors);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return reply({ error: 'not_configured' }, 503, cors);

  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const now = Date.now();
  const recent = (seen.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= PER_HOUR) return reply({ error: 'rate_limited' }, 429, cors);
  recent.push(now); seen.set(ip, recent);
  if (seen.size > 5000) seen.clear();

  let body;
  try { body = await req.json(); } catch { return reply({ error: 'bad_request' }, 400, cors); }
  const question = String(body.question || '').trim().slice(0, 400);
  const ctx = String(body.context || '').slice(0, 24000);
  if (!question) return reply({ error: 'bad_request' }, 400, cors);

  // earlier turns: user/assistant only, alternating, starting with user
  const messages = [];
  for (const t of (Array.isArray(body.history) ? body.history.slice(-6) : [])) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || !t.content) continue;
    const content = String(t.content).slice(0, 1500);
    if (!messages.length && t.role !== 'user') continue;
    if (messages.length && messages[messages.length - 1].role === t.role) messages[messages.length - 1].content += '\n\n' + content;
    else messages.push({ role: t.role, content });
  }
  const last = 'Portfolio context for this question:\n\n' + (ctx || '(none)') + '\n\nVisitor’s question: ' + question;
  if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n\n' + last;
  else messages.push({ role: 'user', content: last });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 450, system: RULES, messages })
    });
    if (!r.ok) return reply({ error: r.status === 429 ? 'rate_limited' : 'upstream_error', status: r.status }, 502, cors);
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) return reply({ error: 'empty' }, 502, cors);
    return reply({ text, truncated: data.stop_reason === 'max_tokens' }, 200, cors);
  } catch {
    return reply({ error: 'upstream_error' }, 502, cors);
  }
};

export const config = { path: '/api/ask' };
