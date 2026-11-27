/**
 * Cloudflare Pages Function: /api/book
 * Handles zero-cost appointment bookings on Cloudflare Pages.
 *
 * Features:
 * - Resolves human date labels ("Tomorrow", "Friday") + 12h time strings into real timestamps.
 * - Generates standard RFC 5545 (.ics) calendar files compatible with Google Calendar,
 *   Outlook, and Apple Calendar.
 * - Sends email notifications + calendar invite using Resend free tier (3,000 emails/mo at $0 cost)
 *   or dispatches a Webhook to Slack/Discord/Zapier/Make.
 * - Returns .ics data URI for instant 1-click addition to calendar.
 */

import {
  CORS_HEADERS,
  cleanText,
  escapeHtml,
  isValidEmail,
  preflightResponse,
  saveLead,
} from '../_lib/leads.js';

const DEFAULT_TZ = 'America/Los_Angeles';

export async function onRequestOptions() {
  return preflightResponse();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseTime(str) {
  const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return { hour: 10, minute: 0 };
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function todayInTZ(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const s = fmt.format(new Date());
  const [y, mo, d] = s.split('-').map((v) => parseInt(v, 10));
  return { year: y, month: mo, day: d };
}

function resolveDate(label, timeZone) {
  const { year, month, day } = todayInTZ(timeZone);
  let base = Date.UTC(year, month - 1, day);
  const original = base;
  const l = String(label || '').trim().toLowerCase();

  if (!l || l === 'today') {
    // keep base
  } else if (l === 'tomorrow') {
    base += 86400000;
  } else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const idx = weekdays.indexOf(l);
    if (idx >= 0) {
      const currentDow = new Date(base).getUTCDay();
      let diff = (idx - currentDow + 7) % 7;
      if (diff === 0) diff = 7;
      base += diff * 86400000;
    } else {
      const parsed = Date.parse(label);
      if (!isNaN(parsed)) {
        const pd = new Date(parsed);
        return { year: pd.getUTCFullYear(), month: pd.getUTCMonth() + 1, day: pd.getUTCDate() };
      }
      base += 86400000;
    }
  }

  if (base === original && !l) {
    // no explicit label: default to tomorrow's date
    base += 86400000;
  }

  const d = new Date(base);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Convert a wall-clock date/time in an IANA timezone to a UTC Date.
 */
function zonedWallToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  function offsetAt(ts) {
    const parts = dtf.formatToParts(new Date(ts));
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const asUTC = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour, 10) % 24,
      parseInt(map.minute, 10),
      parseInt(map.second, 10)
    );
    return asUTC - ts;
  }

  const off1 = offsetAt(utcGuess);
  const candidate = utcGuess - off1;
  const off2 = offsetAt(candidate);
  return new Date(utcGuess - off2);
}

function icsStamp(date) {
  return (
    date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  );
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const name = cleanText(data.name, 150);
    const email = cleanText(data.email, 200);
    const dateStr = cleanText(data.dateStr, 80);
    const timeStr = cleanText(data.timeStr, 40);
    const topic = cleanText(data.topic, 150);
    const brandUrl = cleanText(data.brandUrl, 300);

    if (!name || !email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Name and email are required.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid email address.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const timeZone = cleanText(data.timezone, 80) || DEFAULT_TZ;
    const resolved = resolveDate(dateStr, DEFAULT_TZ);
    const { hour, minute } = parseTime(timeStr);

    const startUtc = zonedWallToUtc(
      resolved.year,
      resolved.month,
      resolved.day,
      hour,
      minute,
      DEFAULT_TZ
    );
    const endUtc = new Date(startUtc.getTime() + 15 * 60 * 1000);

    const now = new Date();
    const dtStamp = icsStamp(now);
    const dtStart = icsStamp(startUtc);
    const dtEnd = icsStamp(endUtc);

    const displayDate = startUtc.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: DEFAULT_TZ,
    });
    const displayTime = startUtc.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: DEFAULT_TZ,
    });

    const safeName = escapeIcsText(name);
    const safeEmail = String(email).replace(/[\r\n]+/g, ' ');
    const meetingTitle = `PRL Growth Discovery: ${safeName} & Partner Revenue Labs`;
    const meetingDesc = [
      '15-Minute Strategy Session with Partner Revenue Labs.',
      '',
      `Attendee: ${safeName} (${safeEmail})`,
      `Brand: ${escapeIcsText(brandUrl || 'N/A')}`,
      `Topic Focus: ${escapeIcsText(topic || 'Affiliate & Media Scaling')}`,
      `Scheduled: ${displayDate} at ${displayTime} (Pacific Time)`,
      'Meeting Link: https://meet.google.com/prl-discovery',
    ].join('\\n');

    const uid = `prl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}@partner-revenue-labs.pages.dev`;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Partner Revenue Labs//Scheduler v1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${meetingTitle}`,
      `DESCRIPTION:${meetingDesc}`,
      'LOCATION:Google Meet (https://meet.google.com/prl-discovery)',
      'ORGANIZER;CN=Partner Revenue Labs:mailto:partners@partnerrevenuelabs.com',
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=${safeName}:mailto:${safeEmail}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder: Partner Revenue Labs Discovery Call in 15 minutes',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const icsBase64 = toBase64(icsContent);
    const icsDataUri = `data:text/calendar;charset=utf-8;base64,${icsBase64}`;

    // Persist booking lead in Cloudflare D1 so submissions are never dropped
    const dbResult = await saveLead(env, {
      kind: 'booking',
      name,
      email,
      brandUrl,
      topic,
      slotDate: dateStr || displayDate,
      slotTime: timeStr || displayTime,
      startUtc: startUtc.toISOString(),
      timezone: timeZone,
    });

    // Optional: Send email via Resend API if RESEND_API_KEY is configured
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
            from: env.EMAIL_FROM || 'Partner Revenue Labs <discovery@partnerrevenuelabs.com>',
            to: [email, env.ADMIN_EMAIL || 'team@partnerrevenuelabs.com'],
            subject: 'Confirmed: 15-Min Strategy Session with Partner Revenue Labs',
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #FAF9F5; border-radius: 16px; border: 1px solid #E8E6DF;">
                <div style="background: #D92D20; color: white; width: 32px; height: 32px; border-radius: 6px; text-align: center; line-height: 32px; font-weight: bold; font-size: 13px;">PRL</div>
                <h2 style="color: #121316; margin-top: 16px;">Strategy Session Confirmed</h2>
                <p style="color: #555; line-height: 1.5;">Hi ${escapeHtml(name)}, your 15-minute discovery session with Partner Revenue Labs has been scheduled.</p>
                <div style="background: white; padding: 16px; border-radius: 12px; margin: 20px 0; border: 1px solid #EEE;">
                  <p style="margin: 0 0 8px 0; font-weight: bold; color: #121316;">Date &amp; Time: ${displayDate} at ${displayTime} PT</p>
                  <p style="margin: 0 0 8px 0; color: #555;">Topic: ${escapeHtml(topic || 'Affiliate & Media Scaling')}</p>
                  <p style="margin: 0; color: #8CA388; font-weight: bold;">Meeting: <a href="https://meet.google.com/prl-discovery" style="color: #8CA388;">Google Meet Link</a></p>
                </div>
                <p style="color: #888; font-size: 12px;">A calendar invitation is attached. You can also add it from the confirmation screen.</p>
              </div>
            `,
            attachments: [
              {
                filename: 'invite.ics',
                content: icsBase64,
              },
            ],
          }),
        });
        emailSent = emailRes.ok;
      } catch (emailErr) {
        console.error('Email dispatch error (non-fatal):', emailErr);
      }
    }

    // Optional: Dispatch Webhook to Slack / Discord / Zapier if WEBHOOK_URL is set
    let webhookSent = false;
    if (env.WEBHOOK_URL) {
      try {
        const whRes = await fetch(env.WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_booking',
            leadId: dbResult.id,
            name,
            email,
            brandUrl,
            topic,
            dateStr,
            timeStr,
            resolvedStartUtc: startUtc.toISOString(),
            timestamp: now.toISOString(),
          }),
        });
        webhookSent = whRes.ok;
      } catch (webhookErr) {
        console.error('Webhook notification error:', webhookErr);
      }
    }

    if (!dbResult.saved && !emailSent && !webhookSent) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unable to persist booking right now.' }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const gcalUrl =
      'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      `&text=${encodeURIComponent(meetingTitle)}` +
      `&dates=${dtStart}/${dtEnd}` +
      `&details=${encodeURIComponent(meetingDesc)}` +
      `&location=${encodeURIComponent('https://meet.google.com/prl-discovery')}`;

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Booking confirmed successfully',
        leadId: dbResult.id,
        savedToDb: dbResult.saved,
        booking: {
          name,
          email,
          dateStr,
          timeStr,
          displayDate,
          displayTime,
          startUtc: startUtc.toISOString(),
          gcalUrl,
          icsDataUri,
        },
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
