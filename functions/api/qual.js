/**
 * Cloudflare Pages Function: /api/qual
 * Handles zero-cost 48-Hour Brand Qualification Audit submissions.
 */

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value || '').replace(/[&<>"']/g, (c) => map[c]);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const data = await request.json();
    const { name, email, brandUrl, revenueTier, bottleneck } = data;

    if (!name || !email || !brandUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'Name, email, and brand URL are required.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Dispatch Email via Resend if RESEND_API_KEY is configured
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
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
                <p style="color: #555;">Hi ${escapeHtml(name)}, our analytics team has received your audit submission for <strong>${escapeHtml(brandUrl)}</strong>.</p>
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
      } catch (e) {
        console.error('Email error:', e);
      }
    }

    // 2. Dispatch Webhook to Slack / Discord / CRM if WEBHOOK_URL is set
    if (env.WEBHOOK_URL) {
      try {
        await fetch(env.WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_brand_audit_request',
            name,
            email,
            brandUrl,
            revenueTier,
            bottleneck,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (webhookErr) {
        console.error('Webhook error:', webhookErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Audit request received successfully',
        brand: brandUrl,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
