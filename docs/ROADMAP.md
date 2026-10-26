# Roadmap to a commercial product

## 1. Foundation (do first)
- [ ] Tests: Vitest for `src/lib/*` (dates, streak, action parsing, danteActions), Playwright smoke tests for each page. Add to CI.
- [ ] Error monitoring (Sentry) on client and server.
- [ ] Update vulnerable npm packages (`npm audit`), pin Node 22.
- [ ] Split the main bundle (Login, Modals, motion) to cut first load.
- [ ] Google Calendar: store refresh token server-side so it stops expiring hourly.

## 2. Accounts & data
- [ ] Supabase in production; email templates; delete-account + data export (GDPR).
- [ ] Sync localStorage data into the account when a demo user signs up.
- [ ] Realtime sync across devices (Supabase Realtime).

## 3. Product features
- [ ] Recurring tasks, reminders/notifications (Web Push), subtasks UI on Board.
- [ ] Dante memory: long-term facts per user (table `dante_memory`), weekly review summary.
- [ ] Dante tools: delete with confirmation, search vault, summarize meetings → tasks.
- [ ] Better voice: a TTS model (server) for natural voice; optional wake word.
- [ ] Teams/workspaces (shared boards) — needs `workspace_id` on tables + RLS.

## 4. Commercial
- [ ] Plans + payments (Stripe): free (limited Dante messages/day) vs Pro. Store plan in `profiles` table, enforce limits in `server/auth.ts` rate limiter.
- [ ] Usage metering per user for AI cost control.
- [ ] Landing page, pricing page, terms, privacy policy (AI + voice data disclosure), cookie notice.
- [ ] Custom domain + HTTPS hosting (Render/Fly/Railway or VPS + Docker), backups, uptime monitoring.
- [ ] Check PSNC usage terms allow commercial use; otherwise plan a commercial LLM provider (the code is provider-agnostic).
