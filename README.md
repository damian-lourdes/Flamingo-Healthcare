# Flamingo Healthcare — WhatsApp Engagement Platform

Patient engagement platform for Flamingo Healthcare, Ambattur, Chennai.
Integrates MocDoc HMS with Meta WhatsApp Cloud API.

## Architecture

```
MocDoc HMS ──→ outbound/ (Node.js) ──→ PostgreSQL ──→ api/ (FastAPI) ──→ frontend/ (React)
                    ↓                                        ↑
              Meta WhatsApp API                       Dashboard UI
```

## Repository structure

```
flamingo-healthcare/
├── outbound/          Node.js — MocDoc polling, WhatsApp sends, webhooks, scheduler
├── api/               FastAPI (Python) — dashboard REST API
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

# 3. outbound service
cd outbound
cp ../.env.example .env   # fill in credentials
npm install
npm run dev               # port 3000

# 4. FastAPI (separate terminal)
cd api
cp ../.env.example .env   # set DATABASE_URL
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 5. React frontend (separate terminal)
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
pm2 status                      # check both services
pm2 logs flamingo-outbound      # WhatsApp + MocDoc activity
pm2 logs flamingo-api           # API requests
pm2 restart all                 # restart after code change
```
