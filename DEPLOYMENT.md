# Olino WMS — Deployment

Olino WMS runs as **one Node.js process** that serves both the screens and the API on a single
port. PostgreSQL runs on the same machine and is reachable **only from that machine**. Warehouse
PCs, tablets and scanners open `http://<server-ip>:4000` in a browser (the touch screens run Edge
in kiosk mode).

```
 Warehouse PCs / tablets ──LAN──►  :4000  Node (screens + /api)  ──localhost──►  PostgreSQL :5432
                                              │
                                              └──LAN──► TSC label printers :9100
```

The server is a Linux machine (`olinowms1`). The app lives in `/opt/olino-wms` and runs as the
systemd service `olino-wms`. Docker is used **only on development machines**.

---

## 1. Server prerequisites

| Software | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | e.g. from NodeSource: `node -v` must show v22+. |
| PostgreSQL | 16 | `sudo apt install postgresql-16` (or the distribution's package). |
| Git | any | To pull new versions. |

Give the server a **fixed IP address** on the LAN (DHCP reservation or static), so the
warehouse devices can always find it.

---

## 2. PostgreSQL — lock it to this machine

### 2.1 Listen on localhost only

In `/etc/postgresql/16/main/postgresql.conf`:

```conf
listen_addresses = 'localhost'
```

### 2.2 Allow local connections only, with passwords

In `/etc/postgresql/16/main/pg_hba.conf`, keep **only** these non-comment lines:

```conf
# TYPE  DATABASE  USER      ADDRESS        METHOD
local   all       postgres                 peer
local   all       all                      scram-sha-256
host    all       all       127.0.0.1/32   scram-sha-256
host    all       all       ::1/128        scram-sha-256
```

Delete any line with `0.0.0.0/0`, `::/0`, a LAN range such as `192.168.x.x/24`, or the method
`trust`. Then `sudo systemctl restart postgresql`.

Port 5432 must **not** be opened in the firewall.

### 2.3 Create a dedicated database user

Generate a password made only of letters and digits, so it needs no escaping inside a URL:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE olino_app LOGIN PASSWORD 'PASTE_GENERATED_PASSWORD_HERE';
CREATE DATABASE olino_wms OWNER olino_app;
```

The app connects as `olino_app`, which owns only the `olino_wms` database. It is not a
superuser and cannot see other databases.

---

## 3. Install the application

```bash
sudo git clone <repository-url> /opt/olino-wms
cd /opt/olino-wms
```

### 3.1 Configure `backend/.env`

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

```env
DATABASE_URL="postgresql://olino_app:PASTE_GENERATED_PASSWORD_HERE@localhost:5432/olino_wms"

# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=PASTE_A_DIFFERENT_LONG_RANDOM_VALUE_HERE

PORT=4000
NODE_ENV=production
```

- `JWT_SECRET` is **required**. The app refuses to start without it. Changing it later logs
  everyone out, which is harmless.
- `.env` is never committed to git. Keep a copy of it somewhere safe.
- If a reverse proxy (e.g. Nginx) is ever put in front on this machine, add `HOST=127.0.0.1`
  so the app is reachable only through the proxy.

### 3.2 Install, build, create tables, create the admin

```bash
npm run install:all     # installs backend + frontend packages
npm run build           # builds the screens (frontend/dist) and the server (backend/dist)
npm run db:migrate      # creates / updates the database tables
npm run db:seed         # creates the first admin account (only if none exists)
```

> Don't export `NODE_ENV=production` in the shell before `npm run install:all`; npm would then
> skip the build tools that `npm run build` needs. Setting it inside `backend/.env` is correct.

First login: username `admin`, password `admin123`. You are asked to choose a new password
straight away. Then create the real user accounts under **Administration → Users & Roles**.

Signing in with a badge and PIN opens only the Warehouse screens, whatever else the account may
do; everything else needs the password.

---

## 4. Run as a systemd service

`/etc/systemd/system/olino-wms.service`:

```ini
[Unit]
Description=Olino WMS
After=network.target postgresql.service
Requires=postgresql.service

[Service]
WorkingDirectory=/opt/olino-wms/backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
# Run as a normal account that owns /opt/olino-wms, never as root
User=olino

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now olino-wms
```

`WorkingDirectory` must be the `backend` folder. That is where the app reads `.env` and stores
`printer-config.json` (the Printer Settings page).

Useful commands: `sudo systemctl restart olino-wms`, `sudo systemctl status olino-wms`,
`journalctl -u olino-wms -f` (live log: one line per API call, plus any errors).

---

## 5. Open the app port on the LAN

Open **only** the app port, and only to the warehouse network, e.g. with ufw:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 4000 proto tcp
```

**Label printers:** the server sends labels to the TSC printers on TCP 9100. The printers must
be on the same LAN with fixed **private** IP addresses (192.168.x.x, 10.x.x.x or
172.16–31.x.x). The app refuses other addresses. Add them under **Printer Settings**.

---

## 6. Updating to a new version

```bash
cd /opt/olino-wms
pg_dump -h localhost -U olino_app -F c -f ~/olino_wms_before_update.dump olino_wms   # safety copy
git pull
npm run install:all
npm run build
npm run db:migrate
sudo systemctl restart olino-wms
```

`db:migrate` only applies new migrations (folders under `backend/prisma/migrations/`). It never
deletes existing data. An applied migration is never edited; every schema change gets a new one.

---

## 7. Backups

Back up the database every night, and copy the backups **off the server** (NAS, USB drive,
another PC).

`/opt/olino-wms/backup.sh` (make it executable with `chmod +x`):

```bash
#!/bin/sh
export PGPASSWORD='PASTE_GENERATED_PASSWORD_HERE'
dir=/var/backups/olino
mkdir -p "$dir"
pg_dump -h localhost -U olino_app -F c -f "$dir/olino_wms_$(date +%Y-%m-%d_%H%M).dump" olino_wms
cp /opt/olino-wms/backend/printer-config.json "$dir/" 2>/dev/null
# keep 30 days
find "$dir" -name '*.dump' -mtime +30 -delete
```

Schedule it nightly with `crontab -e`:

```
30 23 * * * /opt/olino-wms/backup.sh
```

**Restore** into the database (stop the service first):

```bash
sudo systemctl stop olino-wms
pg_restore -h localhost -U olino_app -d olino_wms --clean --if-exists <file.dump>
sudo systemctl start olino-wms
```

Test a restore once on another machine, so you know the backups actually work.

---

## 8. Development machine (Docker only here)

```bash
docker compose up -d                  # PostgreSQL 16 in a container (docker-compose.yml)
cp backend/.env.example backend/.env  # defaults already match docker-compose.yml
npm run install:all
npm run db:migrate
npm run db:seed
npm run dev                           # API on :4000 + screens with hot reload
```

Open **http://localhost:3000**. The dev screens forward `/api` calls to the API on port 4000.

When you change `backend/prisma/schema.prisma`, create a **new** migration with
`cd backend` then `npx prisma migrate dev --name <what-changed>`, and commit the new folder
under `backend/prisma/migrations/`.

To try the production setup locally: `npm run build`, then `npm start`, then open
http://localhost:4000.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service stops immediately | `journalctl -u olino-wms -n 50`. Usually a missing `JWT_SECRET` or a wrong `DATABASE_URL` in `backend/.env`. |
| `password authentication failed` | The password in `DATABASE_URL` must match the `CREATE ROLE` password exactly. |
| 500 errors mentioning a missing column after an update | `npm run db:migrate` was not run. Run it, then restart the service. |
| Works on the server, not on other PCs | Port 4000 is not open in the firewall for the LAN. |
| Browser shows "Cannot GET /" | The log says "Frontend build not found". Run `npm run build`, then restart the service. |
| Printer not reachable | Ping the printer from the server. Its IP must be private, and port 9100 must be open on the printer. |
