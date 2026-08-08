/* Resgro Operating App — Microsoft 365 data adapter.
 *
 * A drop-in, Supabase-compatible client backed entirely by the user's own
 * Microsoft 365 Business Basic tenant via Microsoft Graph:
 *   • Auth      → MSAL (Entra ID "Sign in with Microsoft")
 *   • Database  → SharePoint Lists (one list per table; each row a JSON blob)
 *   • Storage   → SharePoint document library (drive)
 *   • Email     → Graph /me/sendMail (sends as the user, copy in Sent Items)
 *
 * It exposes the same surface the app already uses: sb.from(...).select/insert/
 * update/delete/eq/in/match/order/single/upsert, sb.auth, sb.storage,
 * sb.functions.invoke. Data volumes are small (dozens of rows/table), so all
 * filtering and ordering run client-side after a single fetch — no Graph
 * $filter/index gymnastics, and schema-agnostic (no per-column mapping).
 *
 * Requires MSAL browser loaded as window.msal (script tag in the page head).
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Tables the app uses. Each becomes a SharePoint list with two columns:
// uid (indexed text, the row's stable id) + Data (multi-line text, JSON blob).
const TABLES = [
  'profiles', 'decisions', 'comments', 'verifications', 'attachments',
  'opportunities', 'documents', 'meeting_minutes', 'investor_targets',
  'invoices', 'p1_versions', 'proposals',
];

export async function createM365Client(cfg) {
  const CONFIG = {
    scopes: ['User.Read', 'Sites.ReadWrite.All', 'Sites.Manage.All', 'Mail.Send'],
    listPrefix: 'resgro_',      // SharePoint list display-name prefix
    driveFolder: 'ResgroApp',   // top folder in the document library
    ...cfg,
  };

  // ── MSAL ────────────────────────────────────────────────────────────────
  const pca = new window.msal.PublicClientApplication({
    auth: {
      clientId: CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${CONFIG.tenant}`,
      redirectUri: location.href.split('#')[0].split('?')[0],
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  await pca.handleRedirectPromise().catch(() => {});
  let account = pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
  if (account) pca.setActiveAccount(account);

  async function getToken(interactiveOk = false) {
    if (!account) {
      if (!interactiveOk) throw new Error('Not signed in');
      const r = await pca.loginPopup({ scopes: CONFIG.scopes, prompt: 'select_account' });
      account = r.account; pca.setActiveAccount(account);
    }
    try {
      const r = await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account });
      return r.accessToken;
    } catch (e) {
      if (!interactiveOk) throw e;
      const r = await pca.acquireTokenPopup({ scopes: CONFIG.scopes, account });
      return r.accessToken;
    }
  }

  async function graph(method, path, body, opts = {}) {
    const token = await getToken(false);
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && !opts.raw ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
      body: body ? (opts.raw ? body : JSON.stringify(body)) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      let msg = txt;
      try { msg = JSON.parse(txt).error?.message || txt; } catch (_) {}
      throw new Error(`Graph ${method} ${path} → ${res.status}: ${msg}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  // ── Site + list resolution (cached) ──────────────────────────────────────
  let siteId = null;
  const listId = {};   // table → SharePoint list id

  async function ensureSite() {
    if (siteId) return siteId;
    if (CONFIG.site) {
      // CONFIG.site like "resgrocapital.sharepoint.com:/sites/ResgroOps"
      const s = await graph('GET', `/sites/${CONFIG.site}`);
      siteId = s.id;
    } else {
      const s = await graph('GET', '/sites/root');
      siteId = s.id;
    }
    return siteId;
  }

  async function ensureList(table) {
    if (listId[table]) return listId[table];
    await ensureSite();
    const name = CONFIG.listPrefix + table;
    const found = await graph('GET',
      `/sites/${siteId}/lists?$filter=displayName eq '${name}'&$select=id,displayName`);
    if (found.value && found.value.length) {
      listId[table] = found.value[0].id;
      return listId[table];
    }
    const created = await graph('POST', `/sites/${siteId}/lists`, {
      displayName: name,
      list: { template: 'genericList' },
      columns: [
        { name: 'uid', text: {}, indexed: true },
        { name: 'Data', text: { allowMultipleLines: true, maximumLength: 1000000 } },
      ],
    });
    listId[table] = created.id;
    return listId[table];
  }

  // Provision every list up-front (used by the setup/first-run flow).
  async function ensureAllLists(onStep) {
    await ensureSite();
    for (const t of TABLES) {
      await ensureList(t);
      if (onStep) onStep(t);
    }
  }

  // ── Row <-> SharePoint item mapping ──────────────────────────────────────
  const toRow = (item) => {
    let data = {};
    try { data = JSON.parse(item.fields?.Data || '{}'); } catch (_) {}
    return { ...data, id: item.fields?.uid, __spid: item.id };
  };

  async function fetchAll(table) {
    const lid = await ensureList(table);
    let url = `/sites/${siteId}/lists/${lid}/items?expand=fields(select=uid,Data)&$top=999`;
    const rows = [];
    while (url) {
      const page = await graph('GET', url);
      (page.value || []).forEach((it) => rows.push(toRow(it)));
      url = page['@odata.nextLink'] || null;
    }
    return rows;
  }

  // ── Supabase-compatible query builder (client-side eval) ─────────────────
  class Query {
    constructor(table) {
      this.table = table;
      this._filters = [];     // {op, col, val}
      this._orders = [];      // {col, asc}
      this._single = false;
      this._action = 'select';
      this._payload = null;
    }
    select() { this._action = this._action === 'select' ? 'select' : this._action; return this; }
    insert(v) { this._action = 'insert'; this._payload = v; return this; }
    update(v) { this._action = 'update'; this._payload = v; return this; }
    upsert(v) { this._action = 'upsert'; this._payload = v; return this; }
    delete() { this._action = 'delete'; return this; }
    eq(col, val) { this._filters.push({ op: 'eq', col, val }); return this; }
    neq(col, val) { this._filters.push({ op: 'neq', col, val }); return this; }
    in(col, vals) { this._filters.push({ op: 'in', col, val: vals }); return this; }
    match(obj) { Object.entries(obj).forEach(([col, val]) => this._filters.push({ op: 'eq', col, val })); return this; }
    order(col, o = {}) { this._orders.push({ col, asc: o.ascending !== false }); return this; }
    limit(n) { this._limit = n; return this; }
    single() { this._single = true; return this; }
    maybeSingle() { this._single = true; return this; }

    _apply(rows) {
      let out = rows.filter((r) => this._filters.every((f) => {
        if (f.op === 'eq') return r[f.col] === f.val;
        if (f.op === 'neq') return r[f.col] !== f.val;
        if (f.op === 'in') return f.val.includes(r[f.col]);
        return true;
      }));
      for (let i = this._orders.length - 1; i >= 0; i--) {
        const { col, asc } = this._orders[i];
        out = out.slice().sort((a, b) => {
          const x = a[col], y = b[col];
          if (x == null && y == null) return 0;
          if (x == null) return asc ? -1 : 1;
          if (y == null) return asc ? 1 : -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this._limit) out = out.slice(0, this._limit);
      return out;
    }

    async _run() {
      const lid = await ensureList(this.table);
      const base = `/sites/${siteId}/lists/${lid}/items`;

      if (this._action === 'select') {
        const rows = this._apply(await fetchAll(this.table));
        return { data: this._single ? (rows[0] || null) : rows, error: null };
      }

      if (this._action === 'insert' || this._action === 'upsert') {
        const arr = Array.isArray(this._payload) ? this._payload : [this._payload];
        const inserted = [];
        for (const raw of arr) {
          const row = { ...raw };
          if (!row.id) row.id = (crypto.randomUUID ? crypto.randomUUID()
            : 'id-' + Date.now() + '-' + Math.round(performance.now() * 1000));
          if (!row.created_at) row.created_at = new Date().toISOString();
          const { __spid, ...clean } = row;
          const created = await graph('POST', base, {
            fields: { Title: row.id, uid: row.id, Data: JSON.stringify(clean) },
          });
          inserted.push(toRow(created));
        }
        return { data: Array.isArray(this._payload) ? inserted : inserted[0], error: null };
      }

      if (this._action === 'update') {
        const targets = this._apply(await fetchAll(this.table));
        const updated = [];
        for (const t of targets) {
          const { id, __spid, ...cur } = t;
          const merged = { ...cur, ...this._payload };
          await graph('PATCH', `${base}/${__spid}/fields`, { Data: JSON.stringify(merged) });
          updated.push({ ...merged, id });
        }
        return { data: updated, error: null };
      }

      if (this._action === 'delete') {
        const targets = this._apply(await fetchAll(this.table));
        for (const t of targets) await graph('DELETE', `${base}/${t.__spid}`);
        return { data: targets, error: null };
      }
      return { data: null, error: null };
    }

    then(resolve, reject) {
      return this._run().then(
        (r) => resolve(r),
        (e) => (reject ? reject(e) : resolve({ data: null, error: { message: e.message } })),
      );
    }
  }

  const from = (table) => new Query(table);

  // ── Auth surface ─────────────────────────────────────────────────────────
  function userFromAccount(a) {
    return { id: a.localAccountId, email: a.username, user_metadata: { full_name: a.name } };
  }
  async function ensureProfile(u) {
    const { data } = await from('profiles').select('*').eq('id', u.id).single();
    if (!data) {
      await from('profiles').insert({ id: u.id, email: u.email, full_name: u.user_metadata.full_name });
    }
  }
  const auth = {
    async getSession() {
      if (!account) return { data: { session: null } };
      try { await getToken(false); } catch (_) { return { data: { session: null } }; }
      const user = userFromAccount(account);
      await ensureProfile(user);
      return { data: { session: { user } } };
    },
    async signIn() {
      await getToken(true);            // triggers loginPopup if needed
      account = pca.getActiveAccount();
      const user = userFromAccount(account);
      await ensureProfile(user);
      return { data: { user }, error: null };
    },
    async signOut() {
      const a = account; account = null;
      try { await pca.logoutPopup({ account: a }); } catch (_) {}
      return { error: null };
    },
  };

  // ── Storage surface (SharePoint drive) ────────────────────────────────────
  const urlCache = {};
  const storage = {
    from(bucket) {
      return {
        async upload(path, file) {
          try {
            await ensureSite();
            const p = `${CONFIG.driveFolder}/${bucket}/${path}`.replace(/\/+/g, '/');
            const res = await graph('PUT',
              `/sites/${siteId}/drive/root:/${encodeURI(p)}:/content`,
              file, { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
            urlCache[bucket + '/' + path] = res.webUrl;
            return { data: { path }, error: null };
          } catch (e) { return { data: null, error: { message: e.message } }; }
        },
        getPublicUrl(path) {
          return { data: { publicUrl: urlCache[bucket + '/' + path] || '' } };
        },
      };
    },
  };

  // ── Functions surface (invoice email via Graph) ──────────────────────────
  const functions = {
    async invoke(name, { body } = {}) {
      if (name !== 'send-invoice') return { data: null, error: { message: 'Unknown function ' + name } };
      try {
        const msg = {
          subject: body.subject,
          body: { contentType: 'HTML', content: body.html || body.text || '' },
          toRecipients: [{ emailAddress: { address: body.to } }],
          attachments: body.pdf_base64 ? [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: body.filename || 'invoice.pdf',
            contentType: 'application/pdf',
            contentBytes: body.pdf_base64,
          }] : [],
        };
        if (CONFIG.cc) {
          msg.ccRecipients = [{ emailAddress: { address: CONFIG.cc } }];
          msg.replyTo = [{ emailAddress: { address: CONFIG.cc } }];
        }
        await graph('POST', '/me/sendMail', { message: msg, saveToSentItems: true });
        return { data: { ok: true }, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };

  return { from, auth, storage, functions, _graph: graph, _ensureAllLists: ensureAllLists, _account: () => account };
}
