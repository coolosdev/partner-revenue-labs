# Partner Revenue Labs

**Performance media, attribution, and creator seeding for emerging DTC brands.**

Live site: [partner-revenue-labs.pages.dev](https://partner-revenue-labs.pages.dev)

---

## What We Do

Partner Revenue Labs (PRL) is a margin-first media agency for DTC operators running $50K–$2M/month in revenue. We build full-funnel attribution stacks, run paid media on Meta, Google, and TikTok, and seed product through creator networks — all with a focus on measurable efficiency metrics: MER, blended CPA, and channel-level ROAS.

We don't manage ad spend like a commission-based agency. We charge a management retainer and optimize for your margins, not our cut.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Site framework | [Astro](https://astro.build) (static output) |
| Hosting & CDN | [Cloudflare Pages](https://pages.cloudflare.com) (free tier) |
| Edge functions | Cloudflare Pages Functions (Node-compatible JS) |
| Lead database | Cloudflare D1 (SQLite at the edge) |
| Email (optional) | [Resend](https://resend.com) |
| Deployment | `wrangler pages deploy` via npm script |

---

## Local Development

```bash
# Install dependencies
npm install

# Start local dev server (Vite + Astro)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Deploy to Cloudflare Pages
npm run deploy

# Inspect D1 leads (remote)
npm run leads
```

Requires Node 18+ and [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`).

---

## Project Structure

```
src/
  pages/           — 14 Astro pages (index, services, about, contact, blog, media-kit, privacy, terms, admin/leads)
  content/blog/    — MDX/MD blog posts (Playbooks)
  components/      — Shared Astro components (SEO, Nav, Footer)
  layouts/         — Page layout templates

functions/
  api/
    qual.js        — POST /api/qual — audit inquiry → D1
    book.js        — POST /api/book — booking → D1 + .ics
    leads.js       — GET /api/leads — admin-only D1 lead viewer
  _lib/
    leads.js       — Shared helpers (saveLead, escapeHtml, CORS_HEADERS)

migrations/
  0001_create_leads.sql   — D1 schema

public/
  og-image.png     — Branded 1200×630 OG card
```

---

## Lead Database

All form submissions (audit inquiries and booking requests) are persisted to Cloudflare D1 (`partner-revenue-labs-leads` database, `leads` table).

**View leads in the browser:** `/admin/leads` — requires a `LEADS_TOKEN` (set in Cloudflare Pages env vars).

**View leads from CLI:**
```bash
npm run leads
```

**Admin API:**
```
GET /api/leads?token=YOUR_TOKEN&kind=audit&limit=50&offset=0
```

---

## Environment Variables

Set these in Cloudflare Pages dashboard → Settings → Environment Variables:

| Variable | Purpose | Required |
|---|---|---|
| `LEADS_TOKEN` | Admin auth for `/api/leads` and `/admin/leads` | Recommended |
| `RESEND_API_KEY` | Email notifications on new lead | Optional |
| `ADMIN_EMAIL` | Recipient for lead notification emails | Optional |
| `EMAIL_FROM` | From address for Resend emails | Optional |
| `WEBHOOK_URL` | Slack/Discord/Zapier webhook on new lead | Optional |

Without `RESEND_API_KEY` and `WEBHOOK_URL`, leads are still saved to D1 — no data is lost.

---

## D1 Schema

```sql
CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,          -- 'audit' | 'booking'
  name         TEXT,
  email        TEXT,
  brand_url    TEXT,
  revenue_tier TEXT,
  bottleneck   TEXT,
  topic        TEXT,
  slot_date    TEXT,
  slot_time    TEXT,
  start_utc    TEXT,
  timezone     TEXT,
  status       TEXT DEFAULT 'new',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Disclaimer

All performance figures, telemetry data, and case metrics shown on this site are **illustrative models**, not historical agency results. Partner Revenue Labs does not guarantee specific outcomes. Media management fees are retainer-based and separate from advertising spend.

---

## License

Site code: MIT. Content (copy, playbooks, blog posts): © Partner Revenue Labs. All rights reserved.
