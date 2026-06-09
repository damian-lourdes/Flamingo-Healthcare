#!/bin/bash
# =============================================================================
# Flamingo Healthcare — One-shot VPS Deployment
# Target: Bigrock VPS, Ubuntu 22.04 LTS
# Run as root: bash deploy/deploy.sh
#
# Prerequisites — upload these to /root/ on the server before running:
#   flamingo-healthcare.zip   ← this repo
# =============================================================================

set -e

# ── EDIT THESE BEFORE RUNNING ────────────────────────────────────────────────
DB_PASS="change_this_password"
DOMAIN="your-server-ip-or-domain"

# Meta WhatsApp Cloud API
META_PHONE_NUMBER_ID="your_meta_phone_number_id"
META_ACCESS_TOKEN="your_meta_access_token"

# Dashboard login
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="changeme"     # set a strong password before deploying
# JWT secret — auto-generated if left empty
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change_this_jwt_secret_$(date +%s)")

# MocDoc (request from MocDoc support — mocdoc.com/api/docs)
MOCDOC_BASE_URL="https://mocdoc.com"
MOCDOC_ENTITY_KEY="flamingo-healthcare-centre"
MOCDOC_ACCESS_KEY="your_mocdoc_access_key"
MOCDOC_SECRET="your_mocdoc_base64_secret"
# ─────────────────────────────────────────────────────────────────────────────

APP_DIR="/var/www/flamingo"
DB_NAME="flamingo"
DB_USER="flamingo"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date +%H:%M:%S)] $1${NC}"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING: $1${NC}"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR: $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash deploy/deploy.sh"

log "=== Flamingo Healthcare — Deployment Starting ==="

# ── 1. System packages ────────────────────────────────────────────────────────
log "Updating system..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl wget git unzip build-essential \
  software-properties-common ca-certificates gnupg ufw fail2ban

# ── 2. Node.js 20 LTS ─────────────────────────────────────────────────────────
log "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

# ── 3. Python 3.11 ───────────────────────────────────────────────────────────
log "Installing Python 3.11..."
apt-get install -y python3.11 python3.11-venv python3-pip

# ── 4. PostgreSQL 15 ─────────────────────────────────────────────────────────
log "Installing PostgreSQL 15..."
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq && apt-get install -y postgresql-15
systemctl start postgresql && systemctl enable postgresql

# ── 5. Nginx ──────────────────────────────────────────────────────────────────
log "Installing Nginx..."
apt-get install -y nginx && systemctl enable nginx

# ── 6. PostgreSQL — DB + user ─────────────────────────────────────────────────
log "Creating database..."
sudo -u postgres psql << SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
CREATE DATABASE IF NOT EXISTS ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

# ── 7. Extract app to /var/www/flamingo ───────────────────────────────────────
log "Extracting application..."
mkdir -p ${APP_DIR}/logs

if [[ -f /root/flamingo-healthcare.zip ]]; then
  unzip -q /root/flamingo-healthcare.zip -d /tmp/flamingo-src
  # Handle nested directory if present
  INNER=$(ls /tmp/flamingo-src/)
  cp -r /tmp/flamingo-src/${INNER}/. ${APP_DIR}/
  rm -rf /tmp/flamingo-src
else
  err "flamingo-healthcare.zip not found in /root/"
fi

# ── 8. Write .env for outbound service ───────────────────────────────────────
log "Writing outbound .env..."
cat > ${APP_DIR}/outbound/.env << ENV
NODE_ENV=production
PORT=3000

# PostgreSQL
PGHOST=localhost
PGPORT=5432
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASS}

# Meta WhatsApp Cloud API
META_PHONE_NUMBER_ID=${META_PHONE_NUMBER_ID}
META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
META_API_VERSION=v19.0

# MocDoc HMS
MOCDOC_BASE_URL=${MOCDOC_BASE_URL}
MOCDOC_ENTITY_KEY=${MOCDOC_ENTITY_KEY}
MOCDOC_ACCESS_KEY=${MOCDOC_ACCESS_KEY}
MOCDOC_SECRET=${MOCDOC_SECRET}
MOCDOC_POLL_INTERVAL_MS=30000

LOG_DIR=${APP_DIR}/logs
ENV

# ── 9. Write .env for FastAPI ─────────────────────────────────────────────────
log "Writing API .env..."
cat > ${APP_DIR}/api/.env << ENV
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
ENVIRONMENT=production
DEBUG=false
ENV

# ── 10. Install Node.js dependencies ─────────────────────────────────────────
log "Installing Node.js dependencies..."
cd ${APP_DIR}/outbound
npm install --production --silent

# ── 11. Run DB migration ──────────────────────────────────────────────────────
log "Running database migration..."
cd ${APP_DIR}
node scripts/migrate.js && log "Migration complete" || warn "Migration failed — check scripts/migrate.js"

# ── 12. Python venv + install ─────────────────────────────────────────────────
log "Setting up Python venv..."
cd ${APP_DIR}/api
python3.11 -m venv venv
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
pip install --quiet gunicorn
deactivate

# ── 13. Build React frontend ──────────────────────────────────────────────────
log "Building React frontend..."
cd ${APP_DIR}/frontend
npm install --silent
npm run build
log "Frontend built → ${APP_DIR}/frontend/dist/"

# ── 14. Nginx config ──────────────────────────────────────────────────────────
log "Configuring Nginx..."
cp ${APP_DIR}/deploy/nginx.conf /etc/nginx/sites-available/flamingo
# Inject domain
sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/flamingo
# Point root to built frontend
sed -i "s|root.*flamingo/frontend;|root ${APP_DIR}/frontend/dist;|" /etc/nginx/sites-available/flamingo
ln -sf /etc/nginx/sites-available/flamingo /etc/nginx/sites-enabled/flamingo
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 15. PM2 — start services ──────────────────────────────────────────────────
log "Starting services via PM2..."
cd ${APP_DIR}
pm2 start deploy/ecosystem.config.js
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
systemctl enable pm2-root 2>/dev/null || true

# ── 16. Firewall ──────────────────────────────────────────────────────────────
log "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 17. Health checks ─────────────────────────────────────────────────────────
log "Running health checks..."
sleep 4
API=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health || echo "000")
NODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
[[ "$API"  == "200" ]] && log "FastAPI: OK" || warn "FastAPI not responding (${API}) — check: pm2 logs flamingo-api"
[[ "$NODE" == "200" ]] && log "outbound: OK" || warn "outbound not responding (${NODE}) — check: pm2 logs flamingo-outbound"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
log "=== Deployment complete ==="
echo ""
echo "  Dashboard:     http://${DOMAIN}"
echo "  API docs:      http://${DOMAIN}/api/docs"
echo "  Health:        http://${DOMAIN}/health"
echo ""
echo "  pm2 status     — check services"
echo "  pm2 logs       — view all logs"
echo ""
warn "Next steps:"
warn "  1. Point DNS A record → ${DOMAIN}"
warn "  2. Add SSL: certbot --nginx -d ${DOMAIN}"
warn "  3. Set MocDoc webhook in MocDoc admin: https://${DOMAIN}/hooks/mocdoc"
warn "  4. Set PBX webhook: https://${DOMAIN}/hooks/dialer/call"
