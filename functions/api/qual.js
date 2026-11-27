/**
 * Cloudflare Pages Function: /api/qual
 * Handles 48-Hour Diagnostic Audit & Contact Form submissions with D1 persistence.
 */

import {
  CORS_HEADERS,
  cleanText,
  escapeHtml,
  isValidEmail,
  preflightResponse,
  saveLead,
} from '../_lib/leads.js';

export async function onRequestOptions() {
  return preflightResponse();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const name = cleanText(data.name, 150);
    const email = cleanText(data.email, 200);
    const brandUrl = cleanText(data.brandUrl, 300);
    const revenueTier = cleanText(data.revenueTier, 150);
    const bottleneck = cleanText(data.bottleneck, 1500);

    if (!name || !email || !brandUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'Name, email, and brand URL are required.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid email address.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // 1. Persist lead in Cloudflare D1 so submissions are never dropped
    const dbResult = await saveLead(env, {
      kind: 'audit',
      name,
      email,
      brandUrl,
      revenueTier,
      bottleneck,
    });

    // 2. Dispatch Email via Resend if RESEND_API_KEY is configured
    let emailSent = false;
    if (env.RESEND_API_KEY) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM || 'Partner Revenue Labs <audits@partnerrevenuelabs.com>',
            to: [email, env.ADMIN_EMAIL || 'team@partnerrevenuelabs.com'],
            subject: `Growth Audit Request Received: ${brandUrl}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #FAF9F5; border-radius: 16px; border: 1px solid #E8E6DF;">
                <div style="background: #D92D20; color: white; width: 32px; height: 32px; border-radius: 6px; text-align: center; line-height: 32px; font-weight: bold; font-size: 13px;">PRL</div>
                <h2 style="color: #121316; margin-top: 16px;">48-Hour Growth Audit Dossier Initialized</h2>
                <p style="color: #555;">Hi ${escapeHtml(name)}, we have received your diagnostic audit request for <strong>${escapeHtml(brandUrl)}</strong>.</p>
                <div style="background: white; padding: 16px; border-radius: 12px; margin: 20px 0; border: 1px solid #EEE;">
                  <p style="margin: 0 0 6px 0;"><strong>Revenue Tier:</strong> ${escapeHtml(revenueTier || 'N/A')}</p>
                  <p style="margin: 0 0 6px 0;"><strong>Bottleneck:</strong> ${escapeHtml(bottleneck || 'N/A')}</p>
                  <p style="margin: 0; color: #8CA388; font-weight: bold;">Status: Pending 48-Hour Manual Review</p>
                </div>
                <p style="color: #888; font-size: 12px;">We will send your channel &amp; bottleneck breakdown within 48 hours.</p>
              </div>
            `,
          }),
        });
        emailSent = emailRes.ok;
      } catch (e) {
        console.error('Email error:', e);
      }
    }

    // 3. Dispatch Webhook to Slack / Discord / CRM if WEBHOOK_URL is set
    let webhookSent = false;
    if (env.WEBHOOK_URL) {
      try {
        const whRes = await fetch(env.WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_brand_audit_request',
            leadId: dbResult.id,
            name,
            email,
            brandUrl,
            revenueTier,
            bottleneck,
            timestamp: new Date().toISOString(),
          }),
        });
        webhookSent = whRes.ok;
      } catch (webhookErr) {
        console.error('Webhook error:', webhookErr);
      }
    }

    if (!dbResult.saved && !emailSent && !webhookSent) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unable to persist audit request right now.' }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Audit request received successfully',
        leadId: dbResult.id,
        savedToDb: dbResult.saved,
        brand: brandUrl,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
