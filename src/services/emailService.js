import "dotenv/config";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOGO
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_CID = "randc-logo@randc.com";

function getLogoAttachment() {
  const logoPath = path.join(__dirname, "..", "..", "public", "images", "randclogo.png");
  if (!fs.existsSync(logoPath)) {
    console.warn(`[emailService] Logo not found at: ${logoPath}. Emails will send without logo.`);
    return null;
  }
  return {
    filename:           "randclogo.png",
    path:               logoPath,
    cid:                LOGO_CID,
    contentDisposition: "inline",
  };
}

const LOGO_IMG_TAG = `<img src="cid:${LOGO_CID}" alt="RandC Documentation" style="height:44px;width:auto;display:inline-block;" />`;

// ─────────────────────────────────────────────────────────────────────────────
//  CORE SEND — Gmail API over HTTPS (port 443)
//  Railway blocks SMTP ports 465 & 587 on the free plan.
//  This function builds a raw RFC-2822 MIME message and sends it via the
//  Gmail REST API so no SMTP socket is ever opened.
// ─────────────────────────────────────────────────────────────────────────────
async function sendMail(mailOptions) {
  const { from, to, subject, html, attachments = [] } = mailOptions;

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // UTF-8 encoded subject (handles ₱, accents, emoji in subject lines)
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  const boundary    = `randc_boundary_${Date.now()}`;
  const logoAttach  = getLogoAttachment();

  // ── HTML part ──────────────────────────────────────────────────────────────
  let mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html, "utf8").toString("base64"),
  ].join("\r\n");

  // ── Inline logo ────────────────────────────────────────────────────────────
  if (logoAttach) {
    try {
      const logoData = fs.readFileSync(logoAttach.path);
      mime += "\r\n" + [
        `--${boundary}`,
        `Content-Type: image/png; name="randclogo.png"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: inline`,
        `Content-ID: <${LOGO_CID}>`,
        ``,
        logoData.toString("base64"),
      ].join("\r\n");
    } catch {
      // Logo file missing — email sends without it, no crash
    }
  }

  // ── Any extra attachments (skip logo — already handled) ───────────────────
  for (const att of attachments) {
    if (att.cid === LOGO_CID) continue;
    try {
      const data = fs.readFileSync(att.path);
      mime += "\r\n" + [
        `--${boundary}`,
        `Content-Type: application/octet-stream; name="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        ``,
        data.toString("base64"),
      ].join("\r\n");
    } catch { /* skip missing attachment */ }
  }

  mime += `\r\n--${boundary}--`;

  // Gmail API requires URL-safe base64 (no +, /, or trailing =)
  const raw = Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId:      "me",
    requestBody: { raw },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function capitalizeStatus(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

const FONT_IMPORT = `<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />`;

const BASE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse !important; }
  img   { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
  a     { text-decoration:none; }
  body  { font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif; background:#f1f3fa; margin:0; padding:0; }
  @media only screen and (max-width:620px){
    .email-card   { border-radius:0!important; }
    .email-header { padding:24px 20px 20px!important; }
    .email-body   { padding:24px 20px!important; }
    .email-footer { padding:18px 20px!important; }
    .info-row     { display:block!important; }
    .info-value   { text-align:left!important; margin-top:2px; }
    .cta-btn      { padding:13px 20px!important; font-size:13px!important; }
  }
`;

function buildFooter() {
  return `
    <div style="background:#f1f3fa;border-top:1px solid #dde1ef;padding:22px 40px;text-align:center;">
      <p style="font-size:12px;color:#374151;margin-bottom:8px;">
        Questions? Contact us at
        <a href="mailto:${process.env.SUPPORT_EMAIL || "support@randc.com"}" style="color:#16a34a;font-weight:500;">${process.env.SUPPORT_EMAIL || "support@randc.com"}</a>
        &nbsp;·&nbsp;
        267 De Vega Compound, Silangan St. Caingin, Meycauayan, Bulacan 3020
      </p>
      <p style="font-size:11px;color:#9ca3af;line-height:1.6;">
        This is an automated message. Please do not reply directly to this email.<br/>
        &copy; ${new Date().getFullYear()} RandC Documentation Services. All rights reserved.
      </p>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TRANSACTION STATUS UPDATE EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendClientDocumentProcessUpdate(data, clientEmail) {
  try {
    const statusLabel     = capitalizeStatus(data.statusName).replace(/_/g, " ");
    const isToClaimStatus = data.statusName?.toLowerCase() === "to_claim" ||
                            data.statusName?.toLowerCase() === "to claim";

    const remarksBlock = data.remarks
      ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;
                    border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                      color:#b45309;margin-bottom:6px;">📝 &nbsp;Remarks</div>
          <p style="font-size:13.5px;color:#374151;line-height:1.65;margin:0;">${data.remarks}</p>
        </div>`
      : "";

    const deadlineBlock = isToClaimStatus && data.claimDeadline
      ? `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;
                    border-radius:10px;padding:14px 20px;margin-bottom:24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="32" valign="middle" style="font-size:22px;padding-right:12px;">⏰</td>
              <td valign="middle">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                            letter-spacing:0.06em;color:#c2410c;margin-bottom:2px;">Claim Deadline</div>
                <div style="font-size:14px;font-weight:700;color:#ea580c;">${data.claimDeadline}</div>
              </td>
            </tr>
          </table>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;
                    border-radius:10px;padding:14px 20px;margin-bottom:24px;">
          <div style="font-size:12px;font-weight:700;color:#b91c1c;margin-bottom:4px;">⚠️ &nbsp;Penalty Notice</div>
          <p style="font-size:13px;color:#7f1d1d;line-height:1.6;margin:0;">
            Documents not claimed within <strong>7 days</strong> from the ready date will incur
            a <strong>₱200.00 penalty fee</strong>. Please claim before the deadline to avoid this charge.
          </p>
        </div>`
      : "";

    const ctaBlock = isToClaimStatus
      ? `
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${process.env.APP_URL || "http://localhost:3000"}/pages/client.html"
             style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);
                    color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.02em;
                    padding:14px 36px;border-radius:10px;text-decoration:none;
                    box-shadow:0 4px 14px rgba(22,163,74,0.30);">
            View Your Document Status
          </a>
        </div>`
      : `
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${process.env.APP_URL || "http://localhost:3000"}/pages/client.html"
             style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);
                    color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.02em;
                    padding:14px 36px;border-radius:10px;text-decoration:none;
                    box-shadow:0 4px 14px rgba(22,163,74,0.30);">
            View My Transactions
          </a>
        </div>`;

    const attachmentsRow = data.hasImages
      ? `<tr class="info-row" style="border-bottom:1px solid #dcfce7;">
           <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                      letter-spacing:0.05em;width:115px;padding:8px 0;">Attachments/Files</td>
           <td class="info-value" style="font-size:13.5px;color:#0f172a;font-weight:500;
                      text-align:right;padding:8px 0;">📎 Update includes attached documentation</td>
         </tr>`
      : "";

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <title>Transaction Update — RandC Documentation</title>
        ${FONT_IMPORT}
        <style>${BASE_STYLES}</style>
      </head>
      <body>
        <div style="background:#f1f3fa;padding:32px 16px;">
          <div class="email-card" style="max-width:600px;margin:0 auto;background:#ffffff;
               border-radius:16px;overflow:hidden;
               box-shadow:0 4px 24px rgba(15,23,42,0.10),0 1px 4px rgba(15,23,42,0.06);
               border:1px solid #dde1ef;">
            <div class="email-header"
                 style="background:linear-gradient(135deg,#16a34a 0%,#22c55e 60%,#15803d 100%);
                        padding:36px 40px 28px;text-align:center;">
              <div style="display:none;">${LOGO_IMG_TAG}</div>
              <div style="font-size:34px;margin-bottom:10px;">📋</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;
                         margin:0;line-height:1.3;font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                Transaction Status Update
              </h1>
              <p style="color:rgba(255,255,255,0.82);font-size:13px;font-weight:400;margin-top:6px;">
                Your document processing status has changed
              </p>
            </div>
            <div style="text-align:center;padding:18px 40px 0;">
              <span style="display:inline-block;background:#ffffff;color:#16a34a;
                           font-size:12px;font-weight:700;letter-spacing:0.08em;
                           text-transform:uppercase;padding:6px 22px;border-radius:999px;
                           border:2px solid #16a34a;box-shadow:0 2px 10px rgba(22,163,74,0.18);">
                ${statusLabel}
              </span>
            </div>
            <div class="email-body" style="padding:30px 40px 28px;">
              <p style="font-size:15px;color:#0f172a;font-weight:400;margin-bottom:6px;">
                Dear <strong>${data.clientName}</strong>,
              </p>
              <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
                We'd like to inform you that the status of your document transaction has been updated.
                Please review the details below and take any necessary action.
              </p>
              <div style="background:#f8fffe;border:1px solid #bbf7d0;border-left:4px solid #22c55e;
                          border-radius:10px;padding:20px 24px;margin-bottom:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr class="info-row" style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;width:115px;padding:8px 0;">Transaction ID</td>
                    <td class="info-value" style="font-size:13.5px;color:#0f172a;font-weight:500;
                               text-align:right;padding:8px 0;">#${data.transactionId}</td>
                  </tr>
                  <tr class="info-row" style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;width:115px;padding:8px 0;">Service</td>
                    <td class="info-value" style="font-size:13.5px;color:#0f172a;font-weight:500;
                               text-align:right;padding:8px 0;">${data.serviceName}</td>
                  </tr>
                  <tr class="info-row" style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;width:115px;padding:8px 0;">New Status</td>
                    <td class="info-value" style="font-size:13.5px;color:#16a34a;font-weight:700;
                               text-align:right;padding:8px 0;">${statusLabel}</td>
                  </tr>
                  ${attachmentsRow}
                </table>
              </div>
              ${remarksBlock}
              ${deadlineBlock}
              ${ctaBlock}
              <div style="height:1px;background:#dde1ef;margin:24px 0;"></div>
              <div style="font-size:13.5px;color:#374151;line-height:1.7;">
                <p>If you have questions or need assistance, please don't hesitate to
                  <a href="mailto:${process.env.SUPPORT_EMAIL || "support@randc.com"}"
                     style="color:#16a34a;font-weight:500;">contact our support team</a>.
                </p>
                <br/>
                <p>Best regards,<br/>
                  <strong style="color:#0f172a;">The
                    <span style="color:#16a34a;font-weight:700;">RandC</span>
                    Documentation Team
                  </strong>
                </p>
              </div>
            </div>
            ${buildFooter()}
          </div>
        </div>
      </body>
      </html>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      clientEmail,
      subject: `Transaction #${data.transactionId} — Status Updated to ${statusLabel}`,
      html:    htmlContent,
    });

    console.log(`Status update email sent to ${clientEmail} [${statusLabel}]`);
    return { success: true };
  } catch (error) {
    console.error("Error sending document process update email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  OTP EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendUserOTP(OTP, email) {
  try {
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${FONT_IMPORT}
        <style>${BASE_STYLES}</style>
      </head>
      <body>
        <div style="background:#f1f3fa;padding:32px 16px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;
               box-shadow:0 4px 24px rgba(15,23,42,0.10);border:1px solid #dde1ef;">
            <div style="background:linear-gradient(135deg,#16a34a 0%,#22c55e 60%,#15803d 100%);
                        padding:36px 40px 28px;text-align:center;">
              <div style="display:none;">${LOGO_IMG_TAG}</div>
              <div style="font-size:34px;margin-bottom:10px;">🔐</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;line-height:1.3;
                         font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                One-Time Password
              </h1>
              <p style="color:rgba(255,255,255,0.82);font-size:13px;margin-top:6px;">
                Verify your email address
              </p>
            </div>
            <div style="padding:32px 40px 28px;">
              <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
                We received a request to verify your email address. Use the OTP below to continue.
              </p>
              <div style="background:#f8fffe;border:1px solid #bbf7d0;border-left:4px solid #22c55e;
                          border-radius:10px;padding:28px 24px;margin-bottom:24px;text-align:center;">
                <p style="font-size:12px;color:#16a34a;font-weight:600;text-transform:uppercase;
                           letter-spacing:0.07em;margin-bottom:10px;">Your One-Time Password</p>
                <p style="font-size:40px;font-weight:700;color:#16a34a;letter-spacing:10px;
                           margin:0;font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                  ${OTP}
                </p>
              </div>
              <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;
                          border-radius:10px;padding:16px 20px;margin-bottom:24px;">
                <div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:6px;">
                  ⚠️ &nbsp;Security Notice
                </div>
                <ul style="font-size:13px;color:#374151;line-height:1.8;padding-left:16px;margin:0;">
                  <li>This OTP is valid for <strong>5 minutes only</strong></li>
                  <li>Do not share this code with anyone</li>
                  <li>If you didn't request this, please ignore this email</li>
                </ul>
              </div>
              <p style="font-size:13.5px;color:#374151;">
                Best regards,<br/>
                <strong style="color:#0f172a;">
                  The <span style="color:#16a34a;font-weight:700;">RandC</span> Support Team
                </strong>
              </p>
            </div>
            ${buildFooter()}
          </div>
        </div>
      </body>
      </html>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: "Your One-Time Password (OTP) — Do Not Share",
      html:    htmlContent,
    });

    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  APPOINTMENT EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
function getAppointmentEmailTemplate(type, data) {
  const infoCard = (accentColor, borderColor, labelColor) => `
    <div style="background:#f8fffe;border:1px solid ${borderColor};border-left:4px solid ${accentColor};
                border-radius:10px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr style="border-bottom:1px solid ${borderColor};">
          <td style="font-size:12px;font-weight:600;color:${labelColor};text-transform:uppercase;
                     letter-spacing:0.05em;width:90px;padding:8px 0;">Date</td>
          <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
            ${data.date}
          </td>
        </tr>
        <tr style="border-bottom:1px solid ${borderColor};">
          <td style="font-size:12px;font-weight:600;color:${labelColor};text-transform:uppercase;
                     letter-spacing:0.05em;padding:8px 0;">Time</td>
          <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
            ${data.time}
          </td>
        </tr>
        <tr>
          <td style="font-size:12px;font-weight:600;color:${labelColor};text-transform:uppercase;
                     letter-spacing:0.05em;padding:8px 0;">Services</td>
          <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
            ${data.services || "—"}
          </td>
        </tr>
      </table>
    </div>`;

  const buildHeader = (gradient, icon, title) => `
    <div style="background:${gradient};padding:36px 40px 28px;text-align:center;">
      <div style="display:none;">${LOGO_IMG_TAG}</div>
      <div style="font-size:34px;margin-bottom:10px;">${icon}</div>
      <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;line-height:1.3;
                font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">${title}</h1>
      <p style="color:rgba(255,255,255,0.82);font-size:13px;margin-top:6px;">
        RandC Documentation Services
      </p>
    </div>`;

  const remarksBlock = (bg, border, labelColor, bodyColor, title) =>
    data.remarks
      ? `<div style="background:${bg};border:1px solid ${border};border-left:4px solid ${border};
                    border-radius:10px;padding:16px 20px;margin-bottom:24px;">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                       color:${labelColor};margin-bottom:6px;">${title}</div>
           <p style="font-size:13.5px;color:${bodyColor};line-height:1.65;margin:0;">${data.remarks}</p>
         </div>`
      : "";

  const wrapHtml = (header, body) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      ${FONT_IMPORT}
      <style>${BASE_STYLES}</style>
    </head>
    <body>
      <div style="background:#f1f3fa;padding:32px 16px;">
        <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;
             box-shadow:0 4px 24px rgba(15,23,42,0.10);border:1px solid #dde1ef;">
          ${header}
          <div style="padding:32px 40px 28px;">
            ${body}
            <div style="height:1px;background:#dde1ef;margin:24px 0;"></div>
            <p style="font-size:13.5px;color:#374151;">
              Best regards,<br/>
              <strong style="color:#0f172a;">
                The <span style="color:#16a34a;font-weight:700;">RandC</span> Documentation Team
              </strong>
            </p>
          </div>
          ${buildFooter()}
        </div>
      </div>
    </body>
    </html>`;

  const templates = {
    approved: {
      subject: "✓ Appointment Approved — RandC Documentation",
      html: wrapHtml(
        buildHeader("linear-gradient(135deg,#16a34a 0%,#22c55e 60%,#15803d 100%)", "✅", "Appointment Approved"),
        `<p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
           Dear <strong>${data.firstName}</strong>,
         </p>
         <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
           Great news! Your appointment has been <strong style="color:#16a34a;">approved</strong>.
           Please see the details below and make sure to be prepared on your scheduled date.
         </p>
         ${infoCard("#22c55e", "#bbf7d0", "#16a34a")}
         <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;
                     border-radius:10px;padding:16px 20px;margin-bottom:24px;">
           <div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:8px;">
             ⚠️ &nbsp;Important Reminders
           </div>
           <ul style="font-size:13px;color:#374151;line-height:1.8;padding-left:16px;margin:0;">
             <li>Arrive 10–15 minutes before your scheduled time</li>
             <li>Bring all required documents</li>
             <li>Bring a valid government-issued ID</li>
             <li>Contact us at least 24 hours in advance to reschedule</li>
           </ul>
         </div>
         ${remarksBlock("#dbeafe", "#93c5fd", "#1d4ed8", "#1e3a5f", "📝 &nbsp;Additional Notes")}`
      ),
    },
    cancelled: {
      subject: "Appointment Cancelled — RandC Documentation",
      html: wrapHtml(
        buildHeader("linear-gradient(135deg,#dc2626 0%,#ef4444 60%,#b91c1c 100%)", "❌", "Appointment Cancelled"),
        `<p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
           Dear <strong>${data.firstName}</strong>,
         </p>
         <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
           We regret to inform you that your appointment has been <strong style="color:#dc2626;">cancelled</strong>.
         </p>
         <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;
                     border-radius:10px;padding:20px 24px;margin-bottom:24px;">
           <table width="100%" cellpadding="0" cellspacing="0">
             <tr style="border-bottom:1px solid #fecaca;">
               <td style="font-size:12px;font-weight:600;color:#dc2626;text-transform:uppercase;
                          letter-spacing:0.05em;width:90px;padding:8px 0;">Date</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.date}
               </td>
             </tr>
             <tr style="border-bottom:1px solid #fecaca;">
               <td style="font-size:12px;font-weight:600;color:#dc2626;text-transform:uppercase;
                          letter-spacing:0.05em;padding:8px 0;">Time</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.time}
               </td>
             </tr>
             <tr>
               <td style="font-size:12px;font-weight:600;color:#dc2626;text-transform:uppercase;
                          letter-spacing:0.05em;padding:8px 0;">Services</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.services || "—"}
               </td>
             </tr>
           </table>
         </div>
         ${remarksBlock("#fef2f2", "#ef4444", "#b91c1c", "#7f1d1d", "📋 &nbsp;Reason for Cancellation")}
         <p style="font-size:13.5px;color:#374151;line-height:1.7;margin-bottom:8px;">
           If you would like to reschedule, please book a new appointment through your dashboard.
           We apologize for any inconvenience caused.
         </p>`
      ),
    },
    completed: {
      subject: "Appointment Completed — RandC Documentation",
      html: wrapHtml(
        buildHeader("linear-gradient(135deg,#16a34a 0%,#22c55e 60%,#15803d 100%)", "🎉", "Appointment Completed"),
        `<p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
           Dear <strong>${data.firstName}</strong>,
         </p>
         <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
           Thank you for visiting us! Your appointment has been successfully completed.
         </p>
         ${infoCard("#22c55e", "#bbf7d0", "#16a34a")}
         ${remarksBlock("#d1fae5", "#22c55e", "#15803d", "#374151", "📝 &nbsp;Notes")}`
      ),
    },
    pending: {
      subject: "Appointment Request Received — RandC Documentation",
      html: wrapHtml(
        buildHeader("linear-gradient(135deg,#1d4ed8 0%,#3b82f6 60%,#1e40af 100%)", "📋", "Appointment Request Received"),
        `<p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
           Dear <strong>${data.firstName}</strong>,
         </p>
         <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
           Thank you for booking an appointment. We have received your request and it is currently
           <strong style="color:#2563eb;">under review</strong>.
         </p>
         <div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;
                     border-radius:10px;padding:20px 24px;margin-bottom:24px;">
           <table width="100%" cellpadding="0" cellspacing="0">
             <tr style="border-bottom:1px solid #bfdbfe;">
               <td style="font-size:12px;font-weight:600;color:#2563eb;text-transform:uppercase;
                          letter-spacing:0.05em;width:90px;padding:8px 0;">Date</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.date}
               </td>
             </tr>
             <tr style="border-bottom:1px solid #bfdbfe;">
               <td style="font-size:12px;font-weight:600;color:#2563eb;text-transform:uppercase;
                          letter-spacing:0.05em;padding:8px 0;">Time</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.time}
               </td>
             </tr>
             <tr>
               <td style="font-size:12px;font-weight:600;color:#2563eb;text-transform:uppercase;
                          letter-spacing:0.05em;padding:8px 0;">Services</td>
               <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                 ${data.services || "—"}
               </td>
             </tr>
           </table>
         </div>
         <div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;
                     border-radius:10px;padding:16px 20px;margin-bottom:24px;">
           <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px;">
             🔔 &nbsp;What's Next?
           </div>
           <ul style="font-size:13px;color:#374151;line-height:1.8;padding-left:16px;margin:0;">
             <li>We will review your request within 24 hours</li>
             <li>You'll receive a confirmation email once approved</li>
             <li>Track your appointment status in your dashboard</li>
           </ul>
         </div>`
      ),
    },
  };

  return templates[type] || templates.pending;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEND APPOINTMENT EMAIL SERVICE
// ─────────────────────────────────────────────────────────────────────────────
export async function sendAppointmentEmailService(type, recipientEmail, data) {
  try {
    const template = getAppointmentEmailTemplate(type, data);

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      recipientEmail,
      subject: template.subject,
      html:    template.html,
    });

    console.log(`${type} appointment email sent to: ${recipientEmail}`);
  } catch (error) {
    console.error(`Error sending ${type} appointment email:`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  APPOINTMENT COMPLETION EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendAppointmentCompletionEmail(data, clientEmail) {
  try {
    const serviceListHtml = Array.isArray(data.services) && data.services.length
      ? data.services.map((s) => `
          <tr>
            <td style="padding:8px 12px;background:#f0fdf4;border-radius:6px;
                       font-size:13.5px;color:#0f172a;margin-bottom:6px;">
              <span style="color:#22c55e;font-weight:700;margin-right:8px;">✓</span>${s}
            </td>
          </tr>
          <tr><td style="height:6px;"></td></tr>`).join("")
      : `<tr><td style="font-size:13px;color:#374151;padding:8px 0;">No services listed.</td></tr>`;

    const remarksBlock = data.remarks
      ? `<div style="background:#dbeafe;border:1px solid #93c5fd;border-left:4px solid #3b82f6;
                    border-radius:10px;padding:16px 20px;margin-bottom:24px;">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#1d4ed8;margin-bottom:6px;">
             📝 &nbsp;Additional Notes
           </div>
           <p style="font-size:13.5px;color:#374151;line-height:1.65;margin:0;">${data.remarks}</p>
         </div>`
      : "";

    let formattedDate = data.appointmentDate;
    if (data.appointmentDate) {
      const d = new Date(data.appointmentDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        });
      }
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        ${FONT_IMPORT}
        <style>${BASE_STYLES}</style>
      </head>
      <body>
        <div style="background:#f1f3fa;padding:32px 16px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;
               box-shadow:0 4px 24px rgba(15,23,42,0.10);border:1px solid #dde1ef;">
            <div style="background:linear-gradient(135deg,#16a34a 0%,#22c55e 60%,#15803d 100%);
                        padding:36px 40px 28px;text-align:center;">
              <div style="display:none;">${LOGO_IMG_TAG}</div>
              <div style="font-size:34px;margin-bottom:10px;">🎉</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;line-height:1.3;
                         font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                Appointment Completed
              </h1>
              <p style="color:rgba(255,255,255,0.82);font-size:13px;margin-top:6px;">
                Document processing has been initiated
              </p>
            </div>
            <div style="padding:32px 40px 28px;">
              <p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
                Dear <strong>${data.clientName}</strong>,
              </p>
              <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
                Thank you for visiting us! Your appointment has been successfully completed and
                document processing has started.
              </p>
              <div style="background:#f8fffe;border:1px solid #bbf7d0;border-left:4px solid #22c55e;
                          border-radius:10px;padding:20px 24px;margin-bottom:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;width:130px;padding:8px 0;">Appointment ID</td>
                    <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                      #${data.appointmentId}
                    </td>
                  </tr>
                  <tr style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;padding:8px 0;">Date</td>
                    <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                      ${formattedDate}
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;padding:8px 0;">Time</td>
                    <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                      ${data.appointmentTime}
                    </td>
                  </tr>
                </table>
              </div>
              <div style="background:#d1fae5;border:1px solid #22c55e;border-left:4px solid #16a34a;
                          border-radius:10px;padding:14px 20px;margin-bottom:20px;">
                <div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:4px;">
                  📄 &nbsp;Document Processing Initiated
                </div>
                <p style="font-size:13px;color:#166534;line-height:1.6;margin:0;">
                  We have created <strong>${data.transactionCount}</strong> document processing
                  transaction(s) for your selected services.
                </p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                ${serviceListHtml}
              </table>
              ${remarksBlock}
              <div style="text-align:center;margin:28px 0 8px;">
                <a href="${process.env.APP_URL || "http://localhost:3000"}/pages/client.html"
                   style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);
                          color:#ffffff;font-size:14px;font-weight:700;padding:14px 36px;
                          border-radius:10px;text-decoration:none;
                          box-shadow:0 4px 14px rgba(22,163,74,0.30);">
                  View My Transactions
                </a>
              </div>
              <div style="height:1px;background:#dde1ef;margin:24px 0;"></div>
              <p style="font-size:13.5px;color:#374151;">
                Best regards,<br/>
                <strong style="color:#0f172a;">
                  The <span style="color:#16a34a;font-weight:700;">RandC</span> Documentation Team
                </strong>
              </p>
            </div>
            ${buildFooter()}
          </div>
        </div>
      </body>
      </html>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      clientEmail,
      subject: "Appointment Completed — Document Processing Started",
      html:    htmlContent,
    });

    console.log(`Appointment completion email sent to ${clientEmail}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending appointment completion email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  READY TO CLAIM EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendReadyToClaimEmail(clientInfo, transactionId, claimDeadline, serviceName) {
  try {
    const { email, first_name, last_name } = clientInfo;

    let deadlineStr  = "Please check your dashboard for the deadline.";
    let deadlineTime = "";
    if (claimDeadline) {
      const d = new Date(claimDeadline);
      if (!isNaN(d.getTime())) {
        deadlineStr  = d.toLocaleDateString("en-PH", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        });
        deadlineTime = d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
      }
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        ${FONT_IMPORT}
        <style>${BASE_STYLES}</style>
      </head>
      <body>
        <div style="background:#f1f3fa;padding:32px 16px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;
               box-shadow:0 4px 24px rgba(15,23,42,0.10);border:1px solid #dde1ef;">
            <div style="background:linear-gradient(135deg,#4f46e5 0%,#0891b2 100%);
                        padding:36px 40px 28px;text-align:center;">
              <div style="display:none;">${LOGO_IMG_TAG}</div>
              <div style="font-size:34px;margin-bottom:10px;">📄</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;line-height:1.3;
                         font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                Document Ready to Claim
              </h1>
              <p style="color:rgba(255,255,255,0.82);font-size:13px;margin-top:6px;">
                RandC Documentation Services
              </p>
            </div>
            <div style="text-align:center;padding:18px 40px 0;">
              <span style="display:inline-block;background:#ffffff;color:#16a34a;font-size:12px;
                           font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                           padding:6px 22px;border-radius:999px;border:2px solid #16a34a;
                           box-shadow:0 2px 10px rgba(22,163,74,0.18);">
                Ready to Claim
              </span>
            </div>
            <div style="padding:30px 40px 28px;">
              <p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
                Dear <strong>${first_name} ${last_name}</strong>,
              </p>
              <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px;">
                Great news! Your document has been processed and is now ready for pickup at our office.
              </p>
              <div style="background:#f8fffe;border:1px solid #bbf7d0;border-left:4px solid #22c55e;
                          border-radius:10px;padding:20px 24px;margin-bottom:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;width:130px;padding:8px 0;">Service</td>
                    <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                      ${serviceName || "Document Processing Service"}
                    </td>
                  </tr>
                  <tr style="border-bottom:1px solid #dcfce7;">
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;padding:8px 0;">Transaction ID</td>
                    <td style="font-size:13.5px;color:#0f172a;font-weight:500;text-align:right;padding:8px 0;">
                      #${transactionId}
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;font-weight:600;color:#16a34a;text-transform:uppercase;
                               letter-spacing:0.05em;padding:8px 0;">Status</td>
                    <td style="font-size:13.5px;color:#16a34a;font-weight:700;text-align:right;padding:8px 0;">
                      Ready to Claim
                    </td>
                  </tr>
                </table>
              </div>
              <div style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;
                          border-radius:10px;padding:14px 20px;margin-bottom:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32" valign="middle" style="font-size:22px;padding-right:12px;">⏰</td>
                    <td valign="middle">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                                  letter-spacing:0.06em;color:#c2410c;margin-bottom:2px;">Claim Deadline</div>
                      <div style="font-size:14px;font-weight:700;color:#ea580c;">
                        ${deadlineStr}${deadlineTime ? " · " + deadlineTime : ""}
                      </div>
                    </td>
                  </tr>
                </table>
              </div>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;
                          border-radius:10px;padding:16px 20px;margin-bottom:24px;">
                <div style="font-size:12px;font-weight:700;color:#b91c1c;margin-bottom:6px;">
                  ⚠️ &nbsp;Penalty Notice
                </div>
                <p style="font-size:13px;color:#7f1d1d;line-height:1.6;margin:0;">
                  Documents not claimed within <strong>7 days</strong> from the ready date will incur
                  a <strong>₱200.00 penalty fee</strong>. Please claim before the deadline to avoid this charge.
                </p>
              </div>
              <div style="background:#f8fafc;border:1px solid #dde1ef;border-radius:10px;
                          padding:18px 20px;margin-bottom:24px;">
                <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:12px;">
                  📍 &nbsp;Office Information
                </div>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="22" valign="top" style="font-size:14px;padding-right:10px;">📌</td>
                    <td style="font-size:13px;color:#374151;line-height:1.6;padding-bottom:8px;">
                      <strong>Address:</strong><br/>
                      267 De Vega Compound, Silangan St. Caingin,<br/>
                      Meycauayan, Bulacan 3020
                    </td>
                  </tr>
                  <tr>
                    <td valign="top" style="font-size:14px;padding-right:10px;">🕐</td>
                    <td style="font-size:13px;color:#374151;line-height:1.6;padding-bottom:8px;">
                      <strong>Office Hours:</strong><br/>
                      Mon – Sat: 8:00 AM – 5:00 PM<br/>
                      Sunday: Closed
                    </td>
                  </tr>
                  <tr>
                    <td valign="top" style="font-size:14px;padding-right:10px;">📞</td>
                    <td style="font-size:13px;color:#374151;line-height:1.6;">
                      <strong>Contact:</strong> +63 917 123 4567
                    </td>
                  </tr>
                </table>
              </div>
              <div style="text-align:center;margin:28px 0 8px;">
                <a href="${process.env.APP_URL || "http://localhost:3000"}/pages/client.html"
                   style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);
                          color:#ffffff;font-size:14px;font-weight:700;padding:14px 36px;
                          border-radius:10px;text-decoration:none;
                          box-shadow:0 4px 14px rgba(22,163,74,0.30);">
                  View Your Document
                </a>
              </div>
              <p style="font-size:13px;color:#374151;line-height:1.65;margin-top:20px;">
                Please bring a valid government-issued ID when claiming your document.
              </p>
              <div style="height:1px;background:#dde1ef;margin:24px 0;"></div>
              <p style="font-size:13.5px;color:#374151;">
                Best regards,<br/>
                <strong style="color:#0f172a;">
                  The <span style="color:#16a34a;font-weight:700;">RandC</span> Documentation Team
                </strong>
              </p>
            </div>
            ${buildFooter()}
          </div>
        </div>
      </body>
      </html>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `📄 Your Document is Ready to Claim — Transaction #${transactionId}`,
      html:    htmlContent,
    });

    console.log(`Ready-to-claim email sent to ${email} [Tx #${transactionId}]`);
    return { success: true };
  } catch (error) {
    console.error("Error sending ready-to-claim email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VERIFY EMAIL CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyEmailConfigService() {
  try {
    // Verify OAuth2 credentials are working by getting a fresh access token
    const { token } = await oauth2Client.getAccessToken();
    if (!token) throw new Error("Could not obtain access token");
    console.log("Email (Gmail API) is ready to send messages");
    return true;
  } catch (error) {
    console.error("Email configuration error:", error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAGIC LINK EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendMagicLinkEmail({ email, name, magicUrl, expiresAt }) {
  try {
    const displayName = name || "there";

    const expiresStr = expiresAt.toLocaleString("en-PH", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: "Asia/Manila",
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <title>Your Magic Login Link — RandC Documentation</title>
        ${FONT_IMPORT}
        <style>${BASE_STYLES}</style>
      </head>
      <body>
        <div style="background:#f1f3fa;padding:32px 16px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;
               box-shadow:0 4px 24px rgba(15,23,42,0.10),0 1px 4px rgba(15,23,42,0.06);
               border:1px solid #dde1ef;">
            <div style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 60%,#1e40af 100%);
                        padding:36px 40px 28px;text-align:center;">
              <div style="display:none;">${LOGO_IMG_TAG}</div>
              <div style="font-size:38px;margin-bottom:10px;">🔗</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;
                         margin:0;line-height:1.3;font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;">
                Your Magic Login Link
              </h1>
              <p style="color:rgba(255,255,255,0.82);font-size:13px;font-weight:400;margin-top:6px;">
                One click to sign in — no password needed
              </p>
            </div>
            <div style="padding:30px 40px 28px;">
              <p style="font-size:15px;color:#0f172a;margin-bottom:6px;">
                Hi <strong>${displayName}</strong>,
              </p>
              <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:28px;">
                We received a request to sign in to your <strong>RandC Documentation Services</strong>
                account using your Gmail address. Click the button below to log in instantly.
              </p>
              <div style="text-align:center;margin:0 0 28px;">
                <a href="${magicUrl}"
                   style="display:inline-block;background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);
                          color:#ffffff;font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;
                          font-size:15px;font-weight:700;letter-spacing:0.02em;
                          padding:16px 48px;border-radius:12px;text-decoration:none;
                          box-shadow:0 4px 16px rgba(37,99,235,0.35);">
                  ✉️&nbsp;&nbsp;Sign In to My Account
                </a>
              </div>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;
                          border-radius:10px;padding:14px 20px;margin-bottom:22px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="28" valign="middle" style="font-size:20px;padding-right:10px;">⏰</td>
                    <td valign="middle">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                                  letter-spacing:0.06em;color:#1d4ed8;margin-bottom:2px;">Link Expires</div>
                      <div style="font-size:13.5px;font-weight:600;color:#1e3a8a;">
                        ${expiresStr}&nbsp;·&nbsp;valid for 15 minutes
                      </div>
                    </td>
                  </tr>
                </table>
              </div>
              <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;
                          border-radius:10px;padding:14px 20px;margin-bottom:24px;">
                <div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:5px;">
                  🔒&nbsp;&nbsp;Security Notice
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#78350f;line-height:1.8;">
                  <li>This link can only be used <strong>once</strong>.</li>
                  <li>It expires in <strong>15 minutes</strong>.</li>
                  <li>If you did not request this, you can safely ignore this email — your account remains secure.</li>
                </ul>
              </div>
              <p style="font-size:12px;color:#64748b;line-height:1.7;word-break:break-all;">
                If the button above doesn't work, copy and paste this URL into your browser:<br/>
                <span style="color:#2563eb;">${magicUrl}</span>
              </p>
              <div style="height:1px;background:#dde1ef;margin:24px 0;"></div>
              <p style="font-size:13.5px;color:#374151;line-height:1.7;">
                Best regards,<br/>
                <strong style="color:#0f172a;">
                  The&nbsp;<span style="color:#16a34a;font-weight:700;">RandC</span> Documentation Team
                </strong>
              </p>
            </div>
            ${buildFooter()}
          </div>
        </div>
      </body>
      </html>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: "🔗 Your Magic Login Link — RandC Documentation",
      html:    htmlContent,
    });

    console.log(`Magic link email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending magic link email:", error);
    throw error;
  }
}
