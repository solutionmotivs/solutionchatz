// Local stand-in for QuickBooks Online, Zoho Books and Xero (OAuth + journal endpoints). NOT those services: it mimics only
// the calls Vaulte makes, from their public API reference. Used by the e2e suite and for local demos.
//   ERP_STUB_PORT=39922 node scripts/erp-stub.mjs
// Control:  POST /_stub/mode {"expire_next":true}  -> next journal call answers 401 once (tests token refresh)
//           POST /_stub/mode {"reject":true}      -> journal calls answer 400 (tests failure handling)
import http from "node:http";
const port = Number(process.env.ERP_STUB_PORT ?? 39922);
const state = { tokens: { qbo: 0, zoho: 0, xero: 0 }, refreshes: 0, journals: { qbo: [], zoho: [], xero: [] }, mode: { expire_next: false, reject: false }, validAccess: new Set() };
const issue = (kind, refresh = false) => { const t = `${kind}-access-${++state.tokens[kind]}`; state.validAccess.add(t); if (refresh) state.refreshes++; return { access_token: t, refresh_token: `${kind}-refresh-1`, expires_in: 3600 }; };

http.createServer((req, res) => {
  let raw = ""; req.on("data", c => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const send = (code, json) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    const body = () => { try { return raw ? JSON.parse(raw) : {}; } catch { return Object.fromEntries(new URLSearchParams(raw)); } };
    const bearer = () => (req.headers.authorization ?? "").replace(/^(Bearer|Zoho-oauthtoken) /, "");
    const authed = () => {
      if (state.mode.expire_next) { state.mode.expire_next = false; state.validAccess.clear(); }
      return state.validAccess.has(bearer());
    };
    const p = url.pathname;
    if (p === "/_stub/state") return send(200, { ...state, validAccess: [...state.validAccess] });
    if (p === "/_stub/mode") { Object.assign(state.mode, body()); return send(200, state.mode); }

    // OAuth token endpoints
    if (p === "/qbo/oauth/token" || p === "/zoho/oauth/v2/token" || p === "/xero/connect/token") {
      const kind = p.startsWith("/qbo") ? "qbo" : p.startsWith("/zoho") ? "zoho" : "xero";
      const f = Object.fromEntries(new URLSearchParams(raw));
      if (f.grant_type === "authorization_code") return f.code === "goodcode" ? send(200, issue(kind)) : send(400, { error: "invalid_grant" });
      if (f.grant_type === "refresh_token") return f.refresh_token === `${kind}-refresh-1` ? send(200, issue(kind, true)) : send(400, { error: "invalid_grant" });
      return send(400, { error: "unsupported_grant_type" });
    }
    // QuickBooks
    let m = /^\/qbo\/v3\/company\/([^/]+)\/journalentry$/.exec(p);
    if (m) {
      if (!authed()) return send(401, { fault: "AuthenticationFault" });
      if (state.mode.reject) return send(400, { Fault: { Error: [{ Detail: "Account 99 not found" }] } });
      const b = body(); const rid = url.searchParams.get("requestid");
      const dup = state.journals.qbo.find(j => j.requestid === rid); if (dup) return send(200, { JournalEntry: { Id: dup.id } });
      const id = String(100 + state.journals.qbo.length); state.journals.qbo.push({ id, realm: m[1], requestid: rid, body: b });
      return send(200, { JournalEntry: { Id: id } });
    }
    // Zoho Books
    if (p === "/zoho/books/v3/organizations") return authed() ? send(200, { organizations: [{ organization_id: "zoho-org-77" }] }) : send(401, { message: "invalid token" });
    if (p === "/zoho/books/v3/journals") {
      if (!authed()) return send(401, { message: "invalid token" });
      if (state.mode.reject) return send(400, { message: "Invalid account" });
      const id = `zj-${state.journals.zoho.length + 1}`; state.journals.zoho.push({ id, org: url.searchParams.get("organization_id"), body: body() });
      return send(201, { journal: { journal_id: id } });
    }
    // Xero
    if (p === "/xero/connections") return authed() ? send(200, [{ tenantId: "xero-tenant-9" }]) : send(401, {});
    if (p === "/xero/api.xro/2.0/ManualJournals") {
      if (!authed()) return send(401, {});
      if (state.mode.reject) return send(400, { Message: "Account code does not exist" });
      const key = req.headers["idempotency-key"]; const dup = state.journals.xero.find(j => j.key === key); if (dup) return send(200, { ManualJournals: [{ ManualJournalID: dup.id }] });
      const id = `xj-${state.journals.xero.length + 1}`; state.journals.xero.push({ id, key, tenant: req.headers["xero-tenant-id"], body: body() });
      return send(200, { ManualJournals: [{ ManualJournalID: id }] });
    }
    send(404, { error: "not_found", path: p });
  });
}).listen(port, "127.0.0.1", () => console.log(`erp stub on ${port}`));
