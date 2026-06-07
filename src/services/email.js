import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Parses a sender address like "Name <email@domain.com>" or "email@domain.com"
 * into a structured { name, email } object suitable for Brevo.
 */
function parseSender(smtpFrom) {
  if (!smtpFrom) {
    return { name: 'Career Copilot', email: 'onboarding@brevo.com' };
  }
  
  const match = smtpFrom.match(/^(.*?)\s*<(.*?)>$/);
  if (match) {
    return {
      name: match[1].trim() || 'Career Copilot',
      email: match[2].trim()
    };
  }
  
  return {
    name: 'Career Copilot',
    email: smtpFrom.trim()
  };
}

/**
 * Sends a job alert email containing matched jobs.
 * @param {string} userEmail - User's email
 * @param {object} profile - Parsed resume profile
 * @param {Array} matches - Ranked job matches
 */
export async function sendJobMatchesEmail(userEmail, profile, matches) {
  const recipients = userEmail ? [userEmail] : [];

  console.log(`[Email Service] Preparing job match alert for: ${recipients.join(', ')}`);

  if (!recipients.length) {
    console.warn('[Email Service] No recipient email found. Skipping email.');
    return;
  }

  if (!matches || matches.length === 0) {
    console.warn('[Email Service] No job matches to email.');
    return;
  }

  // Build the email HTML body
  const skillsList = (profile?.skills || []).slice(0, 5).join(', ');

  let jobItemsHtml = '';
  for (const match of matches) {
    const applyLink = match.jobUrl || '#';
    const reasonsHtml = (match.reasons || []).map(r => `<li>${r}</li>`).join('');

    jobItemsHtml += `
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background-color: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <h3 style="margin: 0 0 8px 0; color: #1e293b; font-size: 18px;">${match.title}</h3>
        <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">
          <strong>Company:</strong> ${match.company} | <strong>Location:</strong> ${match.location || 'Remote'} | <strong>Match Score:</strong> <span style="color: #10b981; font-weight: bold;">${match.matchScore}%</span>
        </p>
        <ul style="margin: 0 0 12px 0; padding-left: 20px; color: #475569; font-size: 13px;">
          ${reasonsHtml}
        </ul>
        ${applyLink !== '#'
          ? `<a href="${applyLink}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;">Apply on LinkedIn</a>`
          : '<span style="color: #94a3b8; font-size: 12px; font-style: italic;">No direct link available</span>'
        }
      </div>
    `;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Your AI Job Recommendations</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 24px; margin: 0; color: #334155;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">Career Copilot</h1>
            <p style="margin: 0; font-size: 15px; opacity: 0.9;">Real-Time LinkedIn Job Matches &amp; Recommendations</p>
          </div>

          <!-- Body -->
          <div style="padding: 32px 24px;">
            <p style="margin-top: 0; font-size: 16px; line-height: 1.6; color: #334155;">Hi there,</p>
            <p style="font-size: 15px; line-height: 1.6; color: #475569;">
              We parsed your resume and ran a real-time LinkedIn job search for your target role and skills
              (<span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; font-family: monospace;">${skillsList}</span>).
            </p>

            <h2 style="font-size: 18px; color: #1e3a8a; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; margin-top: 24px; margin-bottom: 16px;">
              Top Job Matches For Your Profile
            </h2>

            ${jobItemsHtml}

            <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin-top: 24px;">
              Apply to these positions on LinkedIn directly or update your resume using our optimizer to increase your ATS score.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0 0 4px 0;">Generated by AI Career Copilot</p>
            <p style="margin: 0;">This email is related to your uploaded profile matching your skills.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  // ── 1. Try Brevo HTTP API (recommended for free tier as it has no domain restrictions for recipients) ──
  if (config.brevoApiKey) {
    console.log(`[Email Service] Attempting to send email via Brevo API to: ${recipients.join(', ')}`);
    try {
      const parsedSender = parseSender(config.smtpFrom || config.smtpUser);
      console.log(`[Email Service] Using sender for Brevo: ${parsedSender.name} <${parsedSender.email}>`);

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.brevoApiKey,
          'accept': 'application/json',
        },
        body: JSON.stringify({
          sender: parsedSender,
          to: recipients.map(email => ({ email })),
          subject: 'Career Copilot: Your Real-Time Job Recommendations',
          htmlContent: emailHtml,
        }),
      });

      if (response.ok) {
        const resData = await response.json();
        console.log(`[Email Service] ✅ Email successfully sent via Brevo API. Message ID: ${resData.messageId}`);
        return true;
      } else {
        const errText = await response.text();
        console.error(`[Email Service] ❌ Brevo API rejected the request (HTTP ${response.status}): ${errText}`);
        console.error('[Email Service] Common causes: invalid Brevo API key, or sender email is not registered/verified in Brevo.');
      }
    } catch (err) {
      console.error(`[Email Service] ❌ Network error calling Brevo API: ${err.message}`);
    }
  } else {
    console.log('[Email Service] BREVO_API_KEY is not configured. Skipping Brevo API.');
  }

  // ── 2. Try Resend HTTP API (bypasses Render SMTP port blocking on free tier) ──
  if (config.resendApiKey) {
    console.log(`[Email Service] Attempting to send email via Resend API to: ${recipients.join(', ')}`);
    try {
      // Resend does NOT allow free email provider domains (gmail.com, yahoo.com, etc.) as senders.
      // Only verified custom domains OR the default onboarding@resend.dev are allowed.
      // We detect free/unverified domains and always fall back to onboarding@resend.dev.
      const freeEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'career-copilot.com'];
      const smtpFromLower = (config.smtpFrom || '').toLowerCase();
      const isUnverifiedSender = !config.smtpFrom || freeEmailDomains.some(d => smtpFromLower.includes(d));
      const resendFrom = isUnverifiedSender
        ? 'Career Copilot <onboarding@resend.dev>'
        : config.smtpFrom;

      console.log(`[Email Service] Using sender: ${resendFrom}`);

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.resendApiKey}`,
        },
        body: JSON.stringify({
          from: resendFrom,
          to: recipients,
          subject: 'Career Copilot: Your Real-Time Job Recommendations',
          html: emailHtml,
        }),
      });

      if (response.ok) {
        const resData = await response.json();
        console.log(`[Email Service] ✅ Email successfully sent via Resend API. ID: ${resData.id}`);
        return true;
      } else {
        const errText = await response.text();
        console.error(`[Email Service] ❌ Resend API rejected the request (HTTP ${response.status}): ${errText}`);
        console.error('[Email Service] Common causes: invalid API key, unverified sender domain, or recipient not whitelisted on test mode.');
      }
    } catch (err) {
      console.error(`[Email Service] ❌ Network error calling Resend API: ${err.message}`);
    }
  } else {
    console.warn('[Email Service] ⚠️  RESEND_API_KEY is not configured. Skipping Resend API.');
  }

  // ── 2. Fallback: Gmail/SMTP (NOTE: Render Free Tier BLOCKS outbound SMTP on 465/587) ──
  if (config.smtpUser && config.smtpPass) {
    console.log(`[Email Service] Attempting to send via SMTP (${config.smtpHost}:${config.smtpPort})...`);
    try {
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: config.smtpFrom,
        to: recipients.join(', '),
        subject: 'Career Copilot: Your Real-Time Job Recommendations',
        html: emailHtml,
      });

      console.log(`[Email Service] ✅ Email successfully sent via SMTP. Message ID: ${info.messageId}`);
      return true;
    } catch (err) {
      console.error(`[Email Service] ❌ SMTP send failed: ${err.message}`);
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        console.error('[Email Service] ⚠️  Render Free Tier blocks outbound SMTP ports (465/587). Configure RESEND_API_KEY instead.');
      }
    }
  } else {
    console.warn('[Email Service] ⚠️  SMTP_USER / SMTP_PASS not configured. Skipping SMTP fallback.');
  }

  // ── 3. Last resort: write to debug file (useful in local dev only) ──
  console.warn('[Email Service] ⚠️  No email provider worked. Email was NOT sent to user.');
  console.warn('[Email Service] 👉 To fix: Set RESEND_API_KEY in your Render environment variables (https://resend.com/api-keys).');
  try {
    const dir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, `job-email-${Date.now()}.html`);
    fs.writeFileSync(filePath, emailHtml, 'utf8');
    console.log(`[Email Service] Debug email HTML saved locally to: ${filePath}`);
  } catch (err) {
    console.error(`[Email Service] Failed to write debug email file: ${err.message}`);
  }
}
