// Supabase Edge Function: send-invoice
// Emails an invoice PDF to the billed entity via Resend. The Resend API key
// lives only in this function's secrets — never in the browser.
//
// Deploy:   via MCP/CLI, or paste into Dashboard → Edge Functions → New function
// Secrets:  RESEND_API_KEY  (required — from resend.com)
//           INVOICE_FROM    (optional — default "Resgro Capital <invoices@resgrocapital.com>")
//           INVOICE_CC      (optional — visible CC + reply-to, e.g. aphile@resgrocapital.com)
//
// JWT verification is ON (default): only signed-in app users can invoke this.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Resolve config: env secret wins; otherwise read from Supabase Vault via
// the service-role-only get_vault_secret() RPC.
async function secret(name: string): Promise<string | null> {
  const env = Deno.env.get(name);
  if (env) return env;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) return null;
    const r = await fetch(`${url}/rest/v1/rpc/get_vault_secret`, {
      method: "POST",
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secret_name: name }),
    });
    if (!r.ok) return null;
    const v = await r.json();
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: {
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
    pdf_base64?: string;
    filename?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { to, subject, html, text, pdf_base64, filename } = payload;
  if (!to || !subject || !pdf_base64) {
    return json({ error: "Missing required fields: to, subject, pdf_base64" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ error: "Invalid recipient email address" }, 400);
  }
  // ~10MB decoded ceiling — invoices are ~20-50KB, so this is generous.
  if (pdf_base64.length > 14_000_000) {
    return json({ error: "Attachment too large" }, 413);
  }

  const key = await secret("RESEND_API_KEY");
  if (!key) {
    return json(
      { error: "RESEND_API_KEY is not configured — add it to Vault or Edge Function secrets" },
      500,
    );
  }
  const from =
    (await secret("INVOICE_FROM")) ?? "Resgro Capital <invoices@resgrocapital.com>";
  const cc = (await secret("INVOICE_CC")) || undefined;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      ...(cc ? { cc: [cc], reply_to: [cc] } : {}),
      subject,
      html: html || undefined,
      text: text || undefined,
      attachments: [
        { filename: filename || "invoice.pdf", content: pdf_base64 },
      ],
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return json(
      { error: (data as { message?: string })?.message || `Resend error (${r.status})` },
      r.status,
    );
  }
  return json({ ok: true, id: (data as { id?: string })?.id });
});
