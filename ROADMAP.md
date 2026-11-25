# Chat App Roadmap: Toy → Portfolio-Grade

## 1. Quick Wins
- **Read receipts** — per-message `deliveredTo`/`readBy` arrays, emit on `ack`/focus.
- **Reactions** — emoji react map per message; reuse existing Socket.IO events.
- **Reply/quote** — store `replyToId` on message; render quoted snippet.
- **Message editing** — add `editedAt`, broadcast `message:edited`.
- **@mentions** — regex-parse on send, highlight, trigger notification.
- **Link previews** — Open Graph scraper (`open-graph-scraper` or `metascraper`) run server-side, cache result.
- **Dark mode** — CSS variables + `prefers-color-scheme`, toggle persisted in localStorage.
- **Desktop/browser notifications** — `Notification` API, request permission on login.
- **Emoji picker** — `emoji-picker-react`.

## 2. Core Scaling/Production Concerns
- **Database**: replace `server/db.js` JSON file with Postgres (via Prisma) or MongoDB (via Mongoose). Fixes race conditions, enables indexing/pagination/transactions.
- **Horizontal scaling**: `@socket.io/redis-adapter` + Redis pub/sub so multiple Node instances share socket state (presence, rooms).
- **Object storage**: move uploads off local disk (`multer.diskStorage`) to S3/S3-compatible (MinIO, Cloudflare R2) via `multer-s3` or presigned URLs; required once you run >1 server instance.
- **Pagination**: cursor-based infinite scroll for message history (`?before=messageId&limit=50`), indexed by `conversationId + createdAt`.
- **Rate limiting/abuse protection**: `express-rate-limit` on REST, per-socket message-rate throttling, basic profanity/spam heuristics.
- **Input validation**: `zod` or `joi` on every REST/socket payload; sanitize HTML to prevent XSS in messages.
- **Auth hardening**: short-lived access JWT + refresh token stored in httpOnly cookie, rotation on use.
- **Config/secrets**: `.env` + `dotenv`, never commit secrets, separate configs per environment, validate env vars at boot (`envalid`).

## 3. Advanced/Differentiating Features
- **Voice/video calls**: WebRTC with a signaling layer over existing Socket.IO; use `simple-peer` or mediasoup/LiveKit for SFU at scale.
- **End-to-end encryption**: Signal-protocol-style (`libsignal-protocol-javascript`) for 1:1 chats; harder for groups — scope carefully.
- **Voice messages**: `MediaRecorder` API client-side, upload as audio blob like existing media pipeline.
- **Full-text search**: Postgres `tsvector`/GIN index, or MongoDB text index, or Elasticsearch/Meilisearch for larger scale.
- **Web Push for offline users**: `web-push` library + service worker, triggered when recipient is offline.
- **PWA**: manifest + service worker (Vite PWA plugin) for installability and offline shell.
- **Blocking/reporting**: block list per user, report flag stored with message/user reference for moderation.
- **Group admin tools**: roles (owner/admin/member), kick/mute, message pinning, join approval.
- **Mute/archive conversations**: per-user conversation metadata, exclude from unread badge/notifications.
- **Multi-device sync**: move presence/session state to DB/Redis keyed by userId, not socketId, so multiple sessions reconcile.
- **Rich profiles**: avatar upload, status text, bio, last-seen privacy toggle.
- **Broadcast channels**: read-only room type where only admins can post.

## 4. Engineering Practices That Impress
- **Testing**: Jest for unit tests, Supertest for REST integration, Playwright or Cypress for e2e (login → send message → receive in second browser context).
- **CI/CD**: GitHub Actions — lint, test, build on PR; auto-deploy on merge (Render/Fly.io/Railway).
- **Docker**: `docker-compose.yml` wiring server, client build, Postgres, Redis, MinIO — one-command local env.
- **API docs**: OpenAPI/Swagger spec (`swagger-jsdoc` + `swagger-ui-express`) for REST; document socket events in a markdown contract.
- **Error monitoring**: Sentry (client + server) for crash/error visibility.
- **Structured logging**: `pino` with request IDs, replacing `console.log`.
- **TypeScript migration**: start with server models/DTOs, then shared types for socket event payloads.
- **Accessibility**: keyboard navigation, ARIA roles on chat list/message log, focus management on new messages.
- **Responsive/mobile-first**: verify layout at 375px width, collapsible sidebar.
- **Code quality**: ESLint + Prettier + Husky pre-commit hooks, lint-staged.

## 5. Time-Boxed Priorities (Solo Dev)

**Weekend**: Dark mode, emoji reactions, read receipts, desktop notifications, ESLint/Prettier + Husky. Fast, visible, low risk.

**Month**: Migrate JSON → Postgres/Prisma, S3-compatible media storage, pagination for message history, input validation (zod), rate limiting, Docker Compose for local dev, basic Jest/Supertest test suite, CI pipeline.

**Quarter**: Redis adapter for multi-instance scaling, refresh-token auth flow, full-text search, WebRTC voice/video calls, web push notifications, PWA support, group admin/moderation tools, TypeScript migration, Playwright e2e suite, Sentry + structured logging. This is the set that moves the project from "demo" to "production-credible."
