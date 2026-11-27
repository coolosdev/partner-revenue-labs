/**
 * Shared helpers for Partner Revenue Labs Pages Functions.
 * Stored under functions/_lib so Cloudflare Pages does not expose it as a route.
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value || '').replace(/[&<>"']/g, (c) => map[c]);
}

export function cleanText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Persist a booking or audit lead into the Cloudflare D1 `leads` table.
 * Returns { saved: boolean, id: number | null, error?: string }.
 */
export async function saveLead(env, lead) {
  if (!env || !env.DB) {
    return { saved: false, id: null, error: 'D1 binding DB is not configured' };
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO leads (
        kind, name, email, brand_url, revenue_tier, bottleneck,
        topic, slot_date, slot_time, start_utc, timezone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        cleanText(lead.kind, 20),
        cleanText(lead.name, 150),
        cleanText(lead.email, 200),
        cleanText(lead.brandUrl, 300),
        cleanText(lead.revenueTier, 150),
        cleanText(lead.bottleneck, 1500),
        cleanText(lead.topic, 150),
        cleanText(lead.slotDate, 80),
        cleanText(lead.slotTime, 40),
        cleanText(lead.startUtc, 60),
        cleanText(lead.timezone, 80)
      )
      .run();

    const id = result?.meta?.last_row_id ?? null;
    return { saved: true, id };
  } catch (err) {
    console.error('D1 saveLead error:', err);
    return { saved: false, id: null, error: err?.message || 'D1 insert failed' };
  }
}
