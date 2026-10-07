import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Local-only bridge for source links read through the normal browser DOM.
// It neither contacts source websites nor reads browser cookies/credentials.
const html = `<!doctype html><html><meta charset="utf-8"><title>UI reference source export</title>
<body><h1>UI reference source export</h1><p>Local-only public image/source links. No account data.</p>
<form method="post" action="/export"><label>Source records<textarea name="records" rows="8" cols="70"></textarea></label><button>Save source records</button></form></body></html>`;
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
  if (req.method !== "POST" || req.url !== "/export" || req.headers.origin !== "http://127.0.0.1:43189") { res.writeHead(403).end(); return; }
  try {
    let body = "";
    for await (const chunk of req) { body += chunk.toString(); if (body.length > 2_000_000) throw new Error("Too large"); }
    const raw = new URLSearchParams(body).get("records") ?? "";
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 2000) throw new Error("Invalid source array");
    for (const row of rows) {
      const u = new URL(row.image);
      if (u.protocol !== "https:" || u.hostname !== "cdn.dribbble.com" || !u.pathname.startsWith("/userupload/") || !/^\/shots\/\d+(?:-[^/?#]*)?$/.test(row.source)) throw new Error("Invalid public source link");
      if (row.author !== undefined && (typeof row.author !== "string" || row.author.length > 120)) throw new Error("Invalid author");
    }
    const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    await mkdir("data/local/dribbble/source-exports", { recursive: true });
    await writeFile(`data/local/dribbble/source-exports/${digest}.json`, JSON.stringify(rows));
    console.log(`Saved ${rows.length} source records (${digest})`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<h1>Saved ${rows.length} source records</h1><p>Export ${digest}</p><a href="/">Export another batch</a>`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid source records");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.writeHead(400).end("Invalid source records; nothing saved");
  }
});
server.listen(43189, "127.0.0.1", () => console.log("Local source export ready: http://127.0.0.1:43189"));
