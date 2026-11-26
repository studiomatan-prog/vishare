# VISHARE – notes for Claude

Product: wedding/event guests open a link (no app), film the couple, videos upload straight to R2.
After uploads close, an auto-edit pipeline (not built yet) makes moment videos; LOCO approves before the couple gets them.
Owner: LOCO GROUP (Matan & Jenia). All user-facing text is Hebrew, RTL.

## Stack (no npm dependencies on purpose)
- Cloudflare Worker + static assets (`wrangler.toml`), account 42cc50597bbe48a1e5f80e95fdbb741c, domain vishare.co.il.
- R2 bucket `vishare-videos`; browser uploads via presigned PUT (`worker/src/sigv4.js`, verified against AWS test vector).
- Supabase project `nwtclrujsjwvtlrohdma` (Frankfurt) via PostgREST with the service key. RLS on, no policies; browsers never call Supabase.
- Guest auth: random token kept in localStorage, only its sha256 stored. Re-joining with the same phone creates a new guest (by design: phone alone must not grant access to someone's videos).

## Rules
- Never commit secrets. Secrets: SUPABASE_SERVICE_KEY, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, ADMIN_TOKEN.
- Run `node test/smoke.mjs` after API changes.
- Guests only ever see their own videos. Guests can always delete their own videos (file is removed from R2).

## Built
Guest page (/e/<slug>), couple page (/couple#token: link+message, WhatsApp share, sign PDF/QR, Excel guest list -> invitees table, all guest videos, edited videos), admin page (/admin: events, create, links + QR, close time, videos by guest, download, delete).
Supabase note: tables needed explicit `grant ... to service_role` (project created without auto-grant).

## Print materials
Every sign generated on the couple page carries LOCO's booking line: BRAND in public/couple.js
(phone 052-6549971, vishare.co.il). Keep it on any new print material.

## Message quota
events.invited_count = how many invitees the couple's package allows (0 = unlimited). Enforced on PUT /api/couple/invitees.

## Retention
Raw guest videos are deleted by the daily cron 30 days after uploads close, ONLY if LOCO marked the event as backed up
(events.raw_backed_up_at). Events, links and edited videos (edits) are never deleted.

## Auto-edit spec (agreed with LOCO, for when the pipeline is built)
- Output: short vertical reels up to ~1 min per moment (חופה, ריקודים, סלואו, צילומי חוץ); greetings video length follows the number of greeters.
- Logo watermark: logo fades in for a few seconds like a credit (default: VISHARE logo, lower corner, from ~1s for ~3s). Logo files: Drive VISHARE/לוגו.
- Music: Envato Elements tracks from Drive VISHARE/מוזיקה/<moment>; Envato is per-project, so the approval screen must list the tracks used so LOCO can register a license per event.
- Every edit goes to LOCO for approval before the couple gets it.

## Not built yet
WhatsApp Cloud API sending (invite to all invitees not yet sent; end-of-event + morning reminders only to guests who joined; 'video ready'; couple raw-deletion warning) — templates drafted in chat, auto-edit pipeline with approval flow, resumable/multipart uploads.
