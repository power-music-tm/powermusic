/**
 * Supabase Auth "Send Email" hook — sends magic-link auth emails via Brevo.
 *
 * Deploy: supabase functions deploy send-email --no-verify-jwt
 * Secrets: BREVO_API_KEY, SEND_EMAIL_HOOK_SECRET, AUTH_EMAIL_FROM
 */

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type EmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email"
  | "reauthentication";

type HookUser = {
  email: string;
  new_email?: string;
};

type HookEmailData = {
  token: string;
  token_hash: string;
  token_new: string;
  token_hash_new: string;
  redirect_to: string;
  email_action_type: EmailActionType;
  site_url: string;
};

type HookPayload = {
  user: HookUser;
  email_data: HookEmailData;
};

const SUBJECTS: Record<string, string> = {
  signup: "Confirm your Power Music Ops account",
  magiclink: "Your Power Music Ops sign-in link",
  email: "Your Power Music Ops sign-in link",
  recovery: "Reset your Power Music Ops password",
  invite: "You are invited to Power Music Ops",
  email_change: "Confirm your new email address",
  reauthentication: "Your Power Music Ops verification code",
};

function buildVerifyUrl(
  supabaseUrl: string,
  tokenHash: string,
  actionType: string,
  redirectTo: string,
): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type: actionType,
    redirect_to: redirectTo,
  });
  return `${supabaseUrl.replace(/\/$/, "")}/auth/v1/verify?${params.toString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseFromAddress(from: string, fallbackName: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: fallbackName, email: from.trim() };
}

function renderMagicLinkEmail(options: {
  appName: string;
  actionType: string;
  confirmationUrl: string;
}): string {
  const { appName, actionType, confirmationUrl } = options;
  const isSignup = actionType === "signup";
  const isRecovery = actionType === "recovery";
  const heading = isSignup
    ? "Confirm your account"
    : isRecovery
      ? "Reset your password"
      : "Sign in to your account";
  const lead = isSignup
    ? "Thanks for registering. Click the button below to verify your email and continue."
    : isRecovery
      ? "Click the button below to choose a new password. This link expires shortly and works once."
      : "Click the button below to sign in. This link expires shortly and works once.";
  const buttonLabel = isRecovery ? "Reset password" : "Continue";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 8px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#e94560;">${escapeHtml(appName)}</p>
                <h1 style="margin:0;font-size:22px;line-height:1.3;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 24px;">
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">${lead}</p>
                <a href="${confirmationUrl}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">${buttonLabel}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">If you did not request this email, you can ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendWithBrevo(options: {
  apiKey: string;
  from: string;
  fallbackName: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const sender = parseFromAddress(options.from, options.fallbackName);

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": options.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo error (${response.status}): ${body}`);
  }
}

function getHookSecret(): string {
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!raw) {
    throw new Error("SEND_EMAIL_HOOK_SECRET is not configured.");
  }
  return raw.replace(/^v1,whsec_/, "");
}

Deno.serve(async (req) => {
  console.log(`send-email: ${req.method} ${req.url}`);

  if (req.method !== "POST") {
    console.warn("send-email: rejected non-POST request");
    return new Response("Method not allowed", { status: 405 });
  }

  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  const emailFrom = Deno.env.get("AUTH_EMAIL_FROM");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const appName = Deno.env.get("AUTH_APP_NAME") ?? "Power Music Ops";

  if (!brevoApiKey || !emailFrom || !supabaseUrl) {
    console.error("send-email: missing env", {
      hasBrevoKey: Boolean(brevoApiKey),
      hasFrom: Boolean(emailFrom),
      hasSupabaseUrl: Boolean(supabaseUrl),
    });
    return new Response(
      JSON.stringify({
        error: {
          message: "Missing BREVO_API_KEY, AUTH_EMAIL_FROM, or SUPABASE_URL.",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const payloadText = await req.text();
  const headers = Object.fromEntries(req.headers);

  let hookPayload: HookPayload;
  try {
    const wh = new Webhook(getHookSecret());
    hookPayload = wh.verify(payloadText, headers) as HookPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid hook signature.";
    console.error("send-email: webhook verify failed", message);
    return new Response(
      JSON.stringify({ error: { message } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const { user, email_data: emailData } = hookPayload;
  const actionType = emailData.email_action_type;
  console.log("send-email: verified hook", {
    to: user.email,
    action: actionType,
  });

  const send = (to: string, subject: string, html: string) =>
    sendWithBrevo({
      apiKey: brevoApiKey,
      from: emailFrom,
      fallbackName: appName,
      to,
      subject,
      html,
    });

  try {
    if (actionType === "email_change" && emailData.token_hash_new) {
      const currentUrl = buildVerifyUrl(
        supabaseUrl,
        emailData.token_hash_new,
        actionType,
        emailData.redirect_to,
      );
      await send(
        user.email,
        SUBJECTS.email_change,
        renderMagicLinkEmail({ appName, actionType, confirmationUrl: currentUrl }),
      );

      if (user.new_email && emailData.token_hash) {
        const newUrl = buildVerifyUrl(
          supabaseUrl,
          emailData.token_hash,
          actionType,
          emailData.redirect_to,
        );
        await send(
          user.new_email,
          SUBJECTS.email_change,
          renderMagicLinkEmail({ appName, actionType, confirmationUrl: newUrl }),
        );
      }
    } else if (actionType === "reauthentication") {
      await send(
        user.email,
        SUBJECTS.reauthentication,
        renderMagicLinkEmail({
          appName,
          actionType,
          confirmationUrl: buildVerifyUrl(
            supabaseUrl,
            emailData.token_hash,
            actionType,
            emailData.redirect_to,
          ),
        }),
      );
    } else {
      const confirmationUrl = buildVerifyUrl(
        supabaseUrl,
        emailData.token_hash,
        actionType,
        emailData.redirect_to,
      );
      const subject = SUBJECTS[actionType] ?? SUBJECTS.magiclink;

      await send(
        user.email,
        subject,
        renderMagicLinkEmail({
          appName,
          actionType,
          confirmationUrl,
        }),
      );
    }
    console.log("send-email: delivered via Brevo", { to: user.email, action: actionType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email.";
    console.error("send-email hook failed:", message);
    return new Response(
      JSON.stringify({ error: { message } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
