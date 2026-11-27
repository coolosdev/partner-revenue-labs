/**
 * GET /api/leads — Admin-only lead viewer.
 *
 * Authentication: Bearer token or ?token= query param.
 * Set the secret as LEADS_TOKEN in Cloudflare Pages env vars.
 * Falls back to a default only if LEADS_TOKEN is not set (dev convenience).
 */

import { CORS_HEADERS } from '../_lib/leads.js';

const DEFAULT_TOKEN = 'changeme-prl-admin';

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...CORS_HEADERS, 'WWW-Authenticate': 'Bearer realm="PRL Admin"' },
  });
}

export async function onRequestGet({ request, env }) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const expected = env.LEADS_TOKEN || DEFAULT_TOKEN;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = bearerToken || queryToken;

  if (!provided || provided !== expected) {
    return unauthorized();
  }

  // ── Query ───────────────────────────────────────────────────────────────────
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding not available' }), {
      status: 503,
      headers: CORS_HEADERS,
    });
  }

  try {
    const kind = url.searchParams.get('kind') || null;    // filter: booking | audit
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let query = 'SELECT * FROM leads';
    const params = [];
    if (kind) {
      query += ' WHERE kind = ?';
      params.push(kind);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();
    const countResult = await env.DB.prepare(
      kind ? 'SELECT COUNT(*) as total FROM leads WHERE kind = ?' : 'SELECT COUNT(*) as total FROM leads'
    ).bind(...(kind ? [kind] : [])).first();

    return new Response(
      JSON.stringify({
        total: countResult?.total ?? 0,
        limit,
        offset,
        leads: result.results ?? [],
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('leads list error:', err);
    return new Response(JSON.stringify({ error: 'Database query failed' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

// Block all other methods
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
