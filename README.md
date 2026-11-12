# portfolio-ask-api

Backend for the "Ask about Praharsh" bar on https://yourpraharsh.github.io/portfolio/.
One Netlify Function, `POST /api/ask`, sends the visitor's question plus the portfolio excerpts the page picked to Claude and returns a short answer.

Environment variables (Netlify → Project configuration → Environment variables):
- `ANTHROPIC_API_KEY` (required, secret)
- `ANTHROPIC_MODEL` (optional, default `claude-haiku-5-5`)
- `ALLOWED_ORIGINS` (optional, comma-separated, default `https://yourpraharsh.github.io`)
- `MAX_PER_HOUR` (optional, questions per visitor per hour, default 20)

No secrets live in this repo.
