# Invoice Flash

Facturación web para autónomos y pequeños negocios (mercado español).

Stack, decisiones técnicas y contexto completo en [`CLAUDE.md`](./CLAUDE.md) y [`specs/001-invoice-flash/`](./specs/001-invoice-flash/).

## Desarrollo

```bash
pnpm install
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Comandos

- `pnpm lint` — Biome (lint + formato)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` / `pnpm test:integration` — Vitest
- `pnpm test:e2e` — Playwright
- `pnpm build` — build de Next.js
- `pnpm deploy:staging` / `pnpm deploy:production` — despliegue en Cloudflare Workers (OpenNext); ver `docs/operations/deployment-checklist.md`
