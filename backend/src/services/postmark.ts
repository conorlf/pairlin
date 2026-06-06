import * as postmark from 'postmark';
import 'dotenv/config';

function getClient() {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN is not set — email sending is disabled');
  return new postmark.ServerClient(token);
}

const FROM = `LandedCost <noreply@${process.env.PLATFORM_DOMAIN ?? 'orders.landedcost.io'}>`;

export async function forwardEmail(params: {
  to: string;
  subject: string;
  originalFrom: string;
  htmlBody?: string;
  textBody?: string;
}) {
  const header = `<div style="background:#f5f5f5;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-family:sans-serif;font-size:13px;color:#555">
    📬 <strong>LandedCost</strong> forwarded this email from <strong>${params.originalFrom}</strong> on your behalf.
    <a href="${process.env.PLATFORM_CHECKOUT_URL?.replace('/checkout', '/dashboard') ?? '#'}">View in dashboard →</a>
  </div>`;

  await getClient().sendEmail({
    From: FROM,
    To: params.to,
    Subject: `[Forwarded] ${params.subject}`,
    HtmlBody: params.htmlBody ? header + params.htmlBody : undefined,
    TextBody: params.textBody ? `[Forwarded from ${params.originalFrom}]\n\n${params.textBody}` : undefined,
  });
}

export async function sendNotification(params: {
  to: string;
  subject: string;
  htmlBody: string;
}) {
  await getClient().sendEmail({
    From: FROM,
    To: params.to,
    Subject: params.subject,
    HtmlBody: params.htmlBody,
  });
}

export async function sendWithAttachment(params: {
  to: string;
  subject: string;
  htmlBody: string;
  attachmentName: string;
  attachmentContent: Buffer;
  attachmentContentType: string;
}) {
  await getClient().sendEmail({
    From: FROM,
    To: params.to,
    Subject: params.subject,
    HtmlBody: params.htmlBody,
    Attachments: [{
      Name: params.attachmentName,
      Content: params.attachmentContent.toString('base64'),
      ContentType: params.attachmentContentType,
      ContentID: '',
    }],
  });
}
