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
const LOGO_CID     = "randc-logo@randc.com";
const LOGO_IMG_TAG = `<img src="cid:${LOGO_CID}" alt="RandC" height="36"
  style="height:36px;width:auto;display:inline-block;" />`;

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

// ─────────────────────────────────────────────────────────────────────────────
//  TRANSPORT
// ─────────────────────────────────────────────────────────────────────────────
async function sendMail(mailOptions) {
  const { from, to, subject, html, attachments = [] } = mailOptions;

  const gmail          = google.gmail({ version: "v1", auth: oauth2Client });
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const boundary       = `randc_boundary_${Date.now()}`;
  const logoAttach     = getLogoAttachment();

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
    } catch { /* logo missing — skip silently */ }
  }

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
    } catch { /* attachment missing — skip silently */ }
  }

  mime += `\r\n--${boundary}--`;

  const raw = Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED DESIGN SYSTEM
//  Palette: #000000 · #ffffff · #22c55e  — no gradients, no radius, no shadows
// ─────────────────────────────────────────────────────────────────────────────

const FONT_LINK = `<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />`;

const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table  { border-collapse:collapse !important; }
  img    { border:0; display:block; height:auto; line-height:100%; outline:none; text-decoration:none; }
  a      { text-decoration:none; }
  body   { font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif;
           background:#f0f0f0; margin:0; padding:0; }
  h1,h2,h3,p,td,li,span {
    font-family:'Poppins','Segoe UI',Helvetica,Arial,sans-serif !important;
  }
  @media only screen and (max-width:620px) {
    .ow  { padding:16px 8px !important; }
    .ec  { width:100% !important; }
    .hc  { padding:28px 20px 24px !important; }
    .bc  { padding:28px 20px !important; }
    .fc  { padding:20px !important; }
    .pc  { padding:14px 16px !important; }
    .cta { display:block !important; width:100% !important;
           text-align:center !important; padding:16px 20px !important; }
    .fu  { font-size:11px !important; word-break:break-all !important; }
    .ir  { display:block !important; }
    .iv  { text-align:left !important; margin-top:2px; display:block !important; }
  }
`;

/** Thin horizontal rule */
function hr() {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0;">
      <tr><td style="height:1px;background:#000000;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>`;
}

/** Subtle separator used between table rows */
const ROW_BORDER = "border-bottom:1px solid #e5e5e5;";

/**
 * Full email wrapper
 * @param {string} headerHtml   — rendered <tr> content for the green header band
 * @param {string} bodyHtml     — rendered content inside white body cell
 */
function wrapEmail(headerHtml, bodyHtml) {
  const supportEmail = process.env.SUPPORT_EMAIL || "support@randc.com";
  const year         = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="telephone=no" />
  ${FONT_LINK}
  <style>${BASE_CSS}</style>
</head>
<body>
<div class="ow" style="background:#f0f0f0;padding:40px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td align="center">

  <table class="ec" width="600" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#ffffff;width:600px;max-width:100%;">

    <!-- GREEN HEADER -->
    <tr>
      <td class="hc" style="background:#22c55e;padding:36px 48px 28px;text-align:center;">
        ${headerHtml}
      </td>
    </tr>

    <!-- WHITE BODY -->
    <tr>
      <td class="bc" style="background:#ffffff;padding:40px 48px 36px;">
        ${bodyHtml}
        ${hr()}
        <p style="font-size:13px;color:#000000;line-height:1.75;margin:0;">
          Best regards,<br />
          <strong style="color:#000000;">The&nbsp;<span style="color:#22c55e;">RandC</span>&nbsp;Documentation Team</strong>
        </p>
      </td>
    </tr>

    <!-- BLACK FOOTER -->
    <tr>
      <td class="fc" style="background:#000000;padding:24px 48px;text-align:center;">
        <p style="font-size:12px;color:#ffffff;line-height:1.75;margin:0 0 6px;">
          Questions?&nbsp;
          <a href="mailto:${supportEmail}"
             style="color:#22c55e;font-weight:500;text-decoration:none;">${supportEmail}</a>
        </p>
        <p style="font-size:11px;color:rgba(255,255,255,0.50);line-height:1.65;margin:0 0 4px;">
          267 De Vega Compound, Silangan St. Caingin, Meycauayan, Bulacan 3020
        </p>
        <p style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.6;margin:0;">
          This is an automated message. Do not reply directly to this email.<br />
          &copy; ${year} RandC Documentation Services. All rights reserved.
        </p>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</div>
</body>
</html>`;
}

/**
 * Standard green header block (logo + title + subtitle)
 */
function buildHeader(title, subtitle) {
  return `
    ${LOGO_IMG_TAG}
    <h1 style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;
               line-height:1.25;margin:18px 0 8px;">
      ${title}
    </h1>
    <p style="color:rgba(255,255,255,0.88);font-size:13px;font-weight:400;
              line-height:1.5;margin:0;">
      ${subtitle}
    </p>`;
}

/**
 * Info table panel — black border, green label text
 * rows: [{ label, value, valueColor? }]
 */
function infoPanel(rows) {
  const rowsHtml = rows.map((r, i) => `
    <tr>
      <td class="ir" style="font-size:11px;font-weight:700;text-transform:uppercase;
                 letter-spacing:0.07em;color:#22c55e;width:130px;
                 padding:10px 0;${i < rows.length - 1 ? ROW_BORDER : ""}">
        ${r.label}
      </td>
      <td class="iv" style="font-size:13px;font-weight:600;
                 color:${r.valueColor || "#000000"};
                 text-align:right;padding:10px 0;
                 ${i < rows.length - 1 ? ROW_BORDER : ""}">
        ${r.value}
      </td>
    </tr>`).join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="border:1px solid #000000;margin-bottom:24px;">
      <tr>
        <td class="pc" style="padding:16px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * Labelled notice panel — black border, green label
 */
function noticePanel(label, contentHtml, marginBottom = "24px") {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="border:1px solid #000000;margin-bottom:${marginBottom};">
      <tr>
        <td class="pc" style="padding:16px 20px;">
          <p style="font-size:10px;font-weight:700;text-transform:uppercase;
                    letter-spacing:0.09em;color:#22c55e;margin:0 0 8px;">
            ${label}
          </p>
          ${contentHtml}
        </td>
      </tr>
    </table>`;
}

/**
 * CTA button row
 */
function ctaButton(href, label) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="margin-bottom:32px;">
      <tr>
        <td align="center">
          <a href="${href}" class="cta"
             style="display:inline-block;background:#22c55e;color:#ffffff;
                    font-size:15px;font-weight:700;letter-spacing:0.02em;
                    line-height:1;padding:18px 52px;text-decoration:none;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

/**
 * Bullet list helper (em-dash style, no colored backgrounds)
 */
function bulletList(items) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      ${items.map((item) => `
        <tr>
          <td width="16" valign="top"
              style="font-size:13px;color:#000000;padding-top:1px;padding-right:8px;
                     line-height:1.65;">
            &mdash;
          </td>
          <td style="font-size:13px;color:#000000;line-height:1.65;padding-bottom:6px;">
            ${item}
          </td>
        </tr>`).join("")}
    </table>`;
}

/** Utility */
function capitalizeStatus(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
//  1.  OTP EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendUserOTP(OTP, email) {
  try {
    const header = buildHeader(
      "One-Time Password",
      "Verify your email address to continue"
    );

    const body = `
      <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
        Hello,
      </p>
      <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 32px;">
        We received a request to verify your email address.
        Use the code below to continue. Do not share it with anyone.
      </p>

      <!-- OTP display -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="border:1px solid #000000;margin-bottom:24px;">
        <tr>
          <td style="padding:28px 20px;text-align:center;">
            <p style="font-size:10px;font-weight:700;text-transform:uppercase;
                      letter-spacing:0.09em;color:#22c55e;margin:0 0 12px;">
              Your One-Time Password
            </p>
            <p style="font-size:44px;font-weight:700;color:#000000;
                      letter-spacing:12px;margin:0;line-height:1;">
              ${OTP}
            </p>
          </td>
        </tr>
      </table>

      ${noticePanel("Security Notice", bulletList([
        "This OTP is valid for <strong>5 minutes only</strong>.",
        "Do not share this code with anyone.",
        "If you did not request this, ignore this email — your account is safe.",
      ]))}`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: "Your One-Time Password (OTP) — Do Not Share",
      html:    wrapEmail(header, body),
    });

    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  2.  MAGIC LINK EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendMagicLinkEmail({ email, name, magicUrl, expiresAt, deleted_at }) {
  try {
    const displayName  = name || "there";
    const isRestoring  = Boolean(deleted_at);
    const ctaLabel     = isRestoring ? "Restore Account Access" : "Sign In to My Account";
    const headerTitle  = isRestoring ? "Restore Your Account"   : "Magic Login Link";
    const headerSub    = isRestoring
      ? "One click to restore access — no password required"
      : "One click to sign in — no password required";
    const bodyIntro    = isRestoring
      ? `Your account was previously anonymized. Clicking the button below will restore your access to <strong>RandC Documentation Services</strong> and reactivate your account.`
      : `We received a sign-in request for your <strong>RandC Documentation Services</strong> account. Click the button below to log in securely — no password needed.`;

    const expiresStr = expiresAt.toLocaleString("en-PH", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: "Asia/Manila",
    });

    const header = buildHeader(headerTitle, headerSub);

    const body = `
      <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
        Hi ${displayName},
      </p>
      <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 32px;">
        ${bodyIntro}
      </p>

      ${ctaButton(magicUrl, ctaLabel)}
      ${hr()}

      ${noticePanel("Link Expiry", `
        <p style="font-size:13px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 3px;">
          ${expiresStr}
        </p>
        <p style="font-size:12px;color:#000000;line-height:1.5;margin:0;">
          Valid for <strong>15 minutes</strong> from the time it was sent.
        </p>`, "16px")}

      ${noticePanel("Security Notice", bulletList([
        "This link works <strong>once only</strong> and expires in 15 minutes.",
        "Never share this link with anyone.",
        "Didn't request this? Ignore this email — your account is safe.",
      ]))}
      `;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: isRestoring
        ? "Restore Your Account — RandC Documentation"
        : "Your Magic Login Link — RandC Documentation",
      html:    wrapEmail(header, body),
    });

    console.log(`Magic link email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending magic link email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  3.  TRANSACTION STATUS UPDATE EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendClientDocumentProcessUpdate(data, clientEmail) {
  try {
    const statusLabel     = capitalizeStatus(data.statusName).replace(/_/g, " ");
    const isToClaimStatus = ["to_claim", "to claim"].includes(data.statusName?.toLowerCase());
    const appUrl          = `${process.env.APP_URL}/pages/client.html`;

    const header = buildHeader(
      "Transaction Status Update",
      "Your document processing status has changed"
    );

    // status badge row
    const statusBadge = `
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="margin-bottom:28px;">
        <tr>
          <td align="center">
            <span style="display:inline-block;background:#000000;color:#22c55e;
                         font-size:11px;font-weight:700;letter-spacing:0.09em;
                         text-transform:uppercase;padding:7px 24px;">
              ${statusLabel}
            </span>
          </td>
        </tr>
      </table>`;

    const txRows = [
      { label: "Transaction ID", value: `#${data.transactionId}` },
      { label: "Service",        value: data.serviceName },
      { label: "New Status",     value: statusLabel, valueColor: "#22c55e" },
      ...(data.hasImages
        ? [{ label: "Attachments", value: "Update includes attached documentation" }]
        : []),
    ];

    const remarksBlock = data.remarks
      ? noticePanel("Remarks", `
          <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">${data.remarks}</p>`)
      : "";

    const deadlineBlock = isToClaimStatus && data.claimDeadline
      ? noticePanel("Claim Deadline", `
          <p style="font-size:14px;font-weight:700;color:#000000;margin:0 0 4px;">${data.claimDeadline}</p>
          <p style="font-size:12px;color:#000000;line-height:1.6;margin:0;">
            Documents not claimed within <strong>7 days</strong> will incur
            a <strong>&#8369;200.00 penalty fee</strong>.
          </p>`)
      : "";

    const ctaLabel = isToClaimStatus ? "View Your Document Status" : "View My Transactions";

    const body = `
      <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
        Dear ${data.clientName},
      </p>
      <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
        The status of your document transaction has been updated.
        Please review the details below and take any necessary action.
      </p>
      ${statusBadge}
      ${infoPanel(txRows)}
      ${remarksBlock}
      ${deadlineBlock}
      ${ctaButton(appUrl, ctaLabel)}
      <p style="font-size:13px;color:#000000;line-height:1.75;margin:0;">
        If you have questions, please
        <a href="mailto:${process.env.SUPPORT_EMAIL}"
           style="color:#22c55e;font-weight:500;">contact our support team</a>.
      </p>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      clientEmail,
      subject: `Transaction #${data.transactionId} — Status Updated to ${statusLabel}`,
      html:    wrapEmail(header, body),
    });

    console.log(`Status update email sent to ${clientEmail} [${statusLabel}]`);
    return { success: true };
  } catch (error) {
    console.error("Error sending document process update email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4.  APPOINTMENT EMAILS  (approved / cancelled / completed / pending)
// ─────────────────────────────────────────────────────────────────────────────
function buildAppointmentInfoPanel(data, accentColor = "#22c55e") {
  return infoPanel([
    { label: "Date",     value: data.date },
    { label: "Time",     value: data.time },
    { label: "Services", value: data.services || "—" },
  ]);
}

function getAppointmentEmailTemplate(type, data) {
  const appUrl = `${process.env.APP_URL}/pages/client.html`;

  const configs = {
    approved: {
      subject:  "Appointment Approved — RandC Documentation",
      title:    "Appointment Approved",
      subtitle: "Your appointment has been confirmed",
      body: () => `
        <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
          Dear ${data.firstName},
        </p>
        <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
          Your appointment has been <strong style="color:#22c55e;">approved</strong>.
          Please review the details below and be prepared on your scheduled date.
        </p>
        ${buildAppointmentInfoPanel(data)}
        ${noticePanel("Important Reminders", bulletList([
          "Arrive 10–15 minutes before your scheduled time.",
          "Bring all required documents.",
          "Bring a valid government-issued ID.",
          "Notify us at least 24 hours in advance to reschedule.",
        ]))}
        ${data.remarks ? noticePanel("Additional Notes", `
          <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">${data.remarks}</p>`) : ""}
        ${ctaButton(appUrl, "View My Appointment")}`,
    },

    cancelled: {
      subject:  "Appointment Cancelled — RandC Documentation",
      title:    "Appointment Cancelled",
      subtitle: "Your appointment has been cancelled",
      body: () => `
        <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
          Dear ${data.firstName},
        </p>
        <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
          We regret to inform you that your appointment has been <strong>cancelled</strong>.
        </p>
        ${buildAppointmentInfoPanel(data)}
        ${data.remarks ? noticePanel("Reason for Cancellation", `
          <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">${data.remarks}</p>`) : ""}
        <p style="font-size:13px;color:#000000;line-height:1.75;margin:0;">
          To reschedule, please book a new appointment through your dashboard.
          We apologize for the inconvenience.
        </p>`,
    },

    completed: {
      subject:  "Appointment Completed — RandC Documentation",
      title:    "Appointment Completed",
      subtitle: "Thank you for visiting RandC Documentation",
      body: () => `
        <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
          Dear ${data.firstName},
        </p>
        <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
          Thank you for visiting us. Your appointment has been successfully completed.
        </p>
        ${buildAppointmentInfoPanel(data)}
        ${data.remarks ? noticePanel("Notes", `
          <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">${data.remarks}</p>`) : ""}
        ${ctaButton(appUrl, "View My Transactions")}`,
    },

    pending: {
      subject:  "Appointment Request Received — RandC Documentation",
      title:    "Appointment Request Received",
      subtitle: "We have received your booking request",
      body: () => `
        <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
          Dear ${data.firstName},
        </p>
        <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
          Thank you for booking an appointment. Your request is currently
          <strong>under review</strong>.
        </p>
        ${buildAppointmentInfoPanel(data)}
        ${noticePanel("What's Next?", bulletList([
          "We will review your request within 24 hours.",
          "You will receive a confirmation email once approved.",
          "Track your appointment status through your dashboard.",
        ]))}`,
    },
  };

  const cfg = configs[type] || configs.pending;
  const header = buildHeader(cfg.title, cfg.subtitle);

  return {
    subject: cfg.subject,
    html:    wrapEmail(header, cfg.body()),
  };
}

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
//  5.  APPOINTMENT COMPLETION EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export async function sendAppointmentCompletionEmail(data, clientEmail) {
  try {
    let formattedDate = data.appointmentDate;
    if (data.appointmentDate) {
      const d = new Date(data.appointmentDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        });
      }
    }

    const serviceListHtml = Array.isArray(data.services) && data.services.length
      ? data.services.map((s) => `
          <tr>
            <td style="font-size:13px;color:#000000;line-height:1.65;
                       padding:7px 0;${ROW_BORDER}">
              <span style="color:#22c55e;font-weight:700;margin-right:8px;">&#10003;</span>${s}
            </td>
          </tr>`).join("")
      : `<tr><td style="font-size:13px;color:#000000;padding:7px 0;">No services listed.</td></tr>`;

    const remarksBlock = data.remarks
      ? noticePanel("Additional Notes", `
          <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">${data.remarks}</p>`)
      : "";

    const header = buildHeader(
      "Appointment Completed",
      "Document processing has been initiated"
    );

    const body = `
      <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
        Dear ${data.clientName},
      </p>
      <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
        Your appointment has been successfully completed and document processing has started.
      </p>

      ${infoPanel([
        { label: "Appointment ID", value: `#${data.appointmentId}` },
        { label: "Date",           value: formattedDate },
        { label: "Time",           value: data.appointmentTime },
      ])}

      ${noticePanel("Processing Initiated", `
        <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">
          We have created <strong>${data.transactionCount}</strong> document processing
          transaction(s) for your selected services.
        </p>`)}

      <!-- Service list -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="border:1px solid #000000;margin-bottom:24px;">
        <tr>
          <td class="pc" style="padding:16px 20px;">
            <p style="font-size:10px;font-weight:700;text-transform:uppercase;
                      letter-spacing:0.09em;color:#22c55e;margin:0 0 10px;">
              Services
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              ${serviceListHtml}
            </table>
          </td>
        </tr>
      </table>

      ${remarksBlock}
      ${ctaButton(`${process.env.APP_URL}/pages/client.html`, "View My Transactions")}`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      clientEmail,
      subject: "Appointment Completed — Document Processing Started",
      html:    wrapEmail(header, body),
    });

    console.log(`Appointment completion email sent to ${clientEmail}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending appointment completion email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  6.  READY TO CLAIM EMAIL
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

    const header = buildHeader(
      "Document Ready to Claim",
      "Your processed document is available for pickup"
    );

    const body = `
      <p style="font-size:15px;font-weight:600;color:#000000;line-height:1.5;margin:0 0 8px;">
        Dear ${first_name} ${last_name},
      </p>
      <p style="font-size:14px;color:#000000;line-height:1.75;margin:0 0 24px;">
        Your document has been processed and is now ready for pickup at our office.
      </p>

      ${infoPanel([
        { label: "Service",        value: serviceName || "Document Processing Service" },
        { label: "Transaction ID", value: `#${transactionId}` },
        { label: "Status",         value: "Ready to Claim", valueColor: "#22c55e" },
      ])}

      ${noticePanel("Claim Deadline", `
        <p style="font-size:14px;font-weight:700;color:#000000;margin:0 0 3px;">
          ${deadlineStr}${deadlineTime ? " &middot; " + deadlineTime : ""}
        </p>
        <p style="font-size:12px;color:#000000;line-height:1.6;margin:0;">
          Documents not claimed within <strong>7 days</strong> will incur
          a <strong>&#8369;200.00 penalty fee</strong>.
        </p>`, "16px")}

      ${noticePanel("Penalty Notice", `
        <p style="font-size:13px;color:#000000;line-height:1.65;margin:0;">
          To avoid the penalty, please claim your document before the deadline shown above.
        </p>`)}

      ${noticePanel("Office Information", `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="font-size:13px;color:#000000;line-height:1.65;
                       padding:6px 0;${ROW_BORDER}">
              <strong>Address:</strong><br />
              267 De Vega Compound, Silangan St. Caingin,<br />
              Meycauayan, Bulacan 3020
            </td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#000000;line-height:1.65;
                       padding:6px 0;${ROW_BORDER}">
              <strong>Office Hours:</strong><br />
              Mon – Sat: 8:00 AM – 5:00 PM &nbsp;|&nbsp; Sunday: Closed
            </td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#000000;line-height:1.65;padding:6px 0;">
              <strong>Contact:</strong> +63 917 123 4567
            </td>
          </tr>
        </table>`)}

      ${ctaButton(`${process.env.APP_URL}/pages/client.html`, "View Your Document")}

      <p style="font-size:12px;color:#000000;line-height:1.65;margin:0;">
        Please bring a valid government-issued ID when claiming your document.
      </p>`;

    await sendMail({
      from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `Your Document is Ready to Claim — Transaction #${transactionId}`,
      html:    wrapEmail(header, body),
    });

    console.log(`Ready-to-claim email sent to ${email} [Tx #${transactionId}]`);
    return { success: true };
  } catch (error) {
    console.error("Error sending ready-to-claim email:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  7.  VERIFY EMAIL CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyEmailConfigService() {
  try {
    const { token } = await oauth2Client.getAccessToken();
    if (!token) throw new Error("Could not obtain access token");
    console.log("Gmail API is ready to send messages");
    return true;
  } catch (error) {
    console.error("Email configuration error:", error);
    return false;
  }
}
