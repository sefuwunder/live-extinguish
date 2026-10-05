// LIVE/EXTINGUISH static server — Bun, zero dependencies.
const server = Bun.serve({
  port: 3022,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path === "/") path = "/index.html";
    const file = Bun.file(`${import.meta.dir}${path}`);
    if (await file.exists()) {
      const type =
        path.endsWith(".html") ? "text/html" :
        path.endsWith(".js") ? "text/javascript" :
        path.endsWith(".css") ? "text/css" :
        "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": type } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`LIVE/EXTINGUISH on http://127.0.0.1:${server.port}`);
