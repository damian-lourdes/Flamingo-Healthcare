# Flamingo Healthcare — WhatsApp Engagement Platform

Patient engagement platform for Flamingo Healthcare, Ambattur, Chennai.
Integrates MocDoc HMS with Meta WhatsApp Cloud API.

## Architecture

```
MocDoc HMS ──→ outbound/ (Node.js) ──→ PostgreSQL
                    ↓          ↑
              Meta WhatsApp    └──→ frontend/ (React) — dashboard UI
                  API
```

A single Node.js service (`outbound/`) handles MocDoc webhooks, PBX/dialer
webhooks, WhatsApp sends, the scheduler, and the dashboard REST API
(`/api/*`) that the React frontend talks to.

## Repository structure

```
flamingo-healthcare/
├── outbound/          Node.js — MocDoc webhooks, dialer webhooks, WhatsApp sends,
│                       scheduler, and the dashboard REST API (/api/*)
├── frontend/          React + Vite + TypeScript — dashboard UI
├── scripts/           DB migration and seed scripts
├── deploy/            Nginx config, PM2 ecosystem, deploy script
└── .env.example       Credential template
```

## Quick start (local development)

```bash
# 1. PostgreSQL — start your local instance and create the DB
createdb flamingo

# 2. Run DB migration
node scripts/migrate.js

# 3. outbound service (Node.js + dashboard API)
cd outbound
cp ../.env.example .env   # fill in credentials
npm install
npm run dev               # port 3000

# 4. React frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

## Production deployment (Bigrock VPS)

```bash
# On your local machine — edit credentials first
nano deploy/deploy.sh    # fill in DB_PASS, DOMAIN, META_*, MOCDOC_*

# Upload and run
zip -r flamingo-healthcare.zip flamingo-healthcare/
scp flamingo-healthcare.zip root@YOUR_VPS_IP:/root/
ssh root@YOUR_VPS_IP "unzip /root/flamingo-healthcare.zip -d /root/ && bash /root/flamingo-healthcare/deploy/deploy.sh"
```

## MocDoc API

- Base URL: `https://mocdoc.com`
- EntityKey: `flamingo-healthcare-centre`
- Auth: HMAC-SHA256 (`Authorization: MD {AccessKey}:{Signature}`)
- Docs: https://mocdoc.com/api/docs
- Credentials: request from MocDoc support

## Webhook URLs (configure after deployment)

| Service | URL |
|---------|-----|
| MocDoc events | `https://yourdomain.com/hooks/mocdoc` |
| PBX call events | `https://yourdomain.com/hooks/dialer/call` |

## PM2 commands

```bash
pm2 status                      # check the service
pm2 logs flamingo-outbound      # WhatsApp + MocDoc + dashboard API activity
pm2 restart all                 # restart after code change
```
