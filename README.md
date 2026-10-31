# Pixel Wall

A shared pixel canvas on Cloudflare Workers. Everyone paints on the same board, live.

- `src/index.ts`: Worker + `PixelBoard` Durable Object (WebSocket hibernation, validation, rate limiting, persistence)
- `public/index.html`: the frontend (static assets, no build step)

```
npm install
npm run dev      # http://localhost:8787
npm run deploy
```

Custom domain: Workers & Pages → your worker → Settings → Domains & Routes.

Ideas: per-room boards (`idFromName(room)`), D1 for history/timelapse, Turnstile against bots.
