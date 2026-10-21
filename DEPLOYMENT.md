# Olino WMS — Deployment

Olino WMS runs as **one Node.js process** that serves both the screens and the API on a single
port. PostgreSQL runs on the same machine and is reachable **only from that machine**. Warehouse
PCs, tablets and scanners open `http://<server-ip>:4000` in a browser.

```
 Warehouse PCs / tablets ──LAN──►  :4000  Node (screens + /api)  ──localhost──►  PostgreSQL :5432
                                              │
                                              └──LAN──► TSC label printers :9100
```

Docker is used **only on development machines**. The server runs PostgreSQL natively.

---

## 1. Server prerequisites (Windows)

| Software | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | Install with the defaults (adds `node` / `npm` to PATH). |
| PostgreSQL | 16 | EnterpriseDB Windows installer. Remember the `postgres` superuser password. |
| Git | any | Or copy the project folder over another way. |
| NSSM | 2.24 | <https://nssm.cc> — runs the app as a Windows service. |

Give the server a **fixed IP address** on the LAN (DHCP reservation or static), so the
warehouse devices can always find it.

---

## 2. PostgreSQL — lock it to this machine

### 2.1 Listen on localhost only

Edit `C:\Program Files\PostgreSQL\16\data\postgresql.conf`:

```conf
listen_addresses = 'localhost'
```

> The Windows installer sets this to `'*'` (all network cards) by default. Change it.

### 2.2 Allow local connections only, with passwords

Edit `C:\Program Files\PostgreSQL\16\data\pg_hba.conf`. Keep **only** these non-comment lines:

```conf
# TYPE  DATABASE  USER  ADDRESS        METHOD
local   all       all                  scram-sha-256
host    all       all   127.0.0.1/32   scram-sha-256
host    all       all   ::1/128        scram-sha-256
```

Delete any line with `0.0.0.0/0`, `::/0`, a LAN range such as `192.168.x.x/24`, or the method `trust`.

Restart PostgreSQL: `services.msc` → **postgresql-x64-16** → Restart, or in an admin PowerShell:

```powershell
Restart-Service postgresql-x64-16
```

### 2.3 Firewall: do NOT open 5432

There must be **no** inbound firewall rule for port 5432. Check:

```powershell
Get-NetFirewallPortFilter | Where-Object LocalPort -eq 5432 | Get-NetFirewallRule
```

If anything is listed, remove it (`Remove-NetFirewallRule -Name <Name>`).

### 2.4 Create a dedicated database user

Generate a password made only of letters and digits, so it needs no escaping inside a URL:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Open **SQL Shell (psql)** as `postgres` and run (replace the password):

```sql
CREATE ROLE olino_app LOGIN PASSWORD 'PASTE_GENERATED_PASSWORD_HERE';
CREATE DATABASE olino_wms OWNER olino_app;
```

The app connects as `olino_app`, which owns only the `olino_wms` database. It is not a
superuser and cannot see other databases.

---

## 3. Install the application

Example location: `C:\olino-wms`.

```powershell
cd C:\
git clone <repository-url> olino-wms
cd C:\olino-wms
```

### 3.1 Configure `backend\.env`

```powershell
copy backend\.env.example backend\.env
notepad backend\.env
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

### 3.2 Install, build, create tables, create the admin

```powershell
npm run install:all     # installs backend + frontend packages
npm run build           # builds the screens (frontend\dist) and the server (backend\dist)
npm run db:migrate      # creates / updates the database tables
npm run db:seed         # creates the first admin account (only if none exists)
```

> Do not set `NODE_ENV=production` as a *system* environment variable before
> `npm run install:all`. npm would then skip the build tools that `npm run build` needs.
> Setting it inside `backend\.env` is correct.

### 3.3 Test run

```powershell
npm start
```

Open `http://localhost:4000` on the server. Log in with:

| | |
|---|---|
| Username | `admin` |
| Password | `admin123` |
| Badge / PIN | `EMP-0001` / `112233` |

You are asked to choose a new password (and a new PIN at the first badge login) straight away.
Then create the real user accounts under **Administration → Users**.

Press `Ctrl+C` to stop the test run.

---

## 4. Run as a Windows service

Admin PowerShell (adjust paths if Node or the app live elsewhere):

```powershell
mkdir C:\olino-wms\logs

nssm install OlinoWMS "C:\Program Files\nodejs\node.exe" "dist\index.js"
nssm set OlinoWMS AppDirectory "C:\olino-wms\backend"
nssm set OlinoWMS AppStdout "C:\olino-wms\logs\app.log"
nssm set OlinoWMS AppStderr "C:\olino-wms\logs\app.log"
nssm set OlinoWMS AppRotateFiles 1
nssm set OlinoWMS AppRotateBytes 10485760
nssm set OlinoWMS Start SERVICE_AUTO_START
nssm set OlinoWMS DependOnService postgresql-x64-16
nssm start OlinoWMS
```

`AppDirectory` must be the `backend` folder. That is where the app reads `.env` and stores
`printer-config.json` (the Printer Settings page).

The service starts on boot, after PostgreSQL, and restarts automatically if it crashes.
Useful commands: `nssm restart OlinoWMS`, `nssm stop OlinoWMS`, `nssm edit OlinoWMS`.

---

## 5. Open the app port on the LAN

Open **only** the app port, and only on private networks:

```powershell
New-NetFirewallRule -DisplayName "Olino WMS" -Direction Inbound -Protocol TCP `
  -LocalPort 4000 -Action Allow -Profile Domain,Private
```

Make sure the server's network connection is set to **Private**, not Public
(Settings → Network & internet → the connection → Network profile type).

Warehouse devices now use `http://<server-ip>:4000`.

**Label printers:** the server sends labels to the TSC printers on TCP 9100. The printers must
be on the same LAN with fixed **private** IP addresses (192.168.x.x, 10.x.x.x or
172.16–31.x.x). The app refuses other addresses. Add them under
**Administration → Printer Settings**.

---

## 6. Updating to a new version

```powershell
cd C:\olino-wms
nssm stop OlinoWMS
git pull
npm run install:all
npm run build
npm run db:migrate
nssm start OlinoWMS
```

`db:migrate` only applies new migrations. It never deletes existing data.

---

## 7. Backups

Back up the database every night, and copy the backups **off the server** (NAS, USB drive,
another PC).

`C:\olino-wms\backup.ps1`:

```powershell
$env:PGPASSWORD = 'PASTE_GENERATED_PASSWORD_HERE'
$dir = 'D:\olino-backups'
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir ("olino_wms_" + (Get-Date -Format 'yyyy-MM-dd_HHmm') + ".dump")
& 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe' -h localhost -U olino_app -F c -f $file olino_wms
Copy-Item C:\olino-wms\backend\printer-config.json $dir -ErrorAction SilentlyContinue
# keep 30 days
Get-ChildItem $dir -Filter *.dump | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
```

Schedule it with Task Scheduler (daily, "Run whether user is logged on or not").

**Restore** into an empty database (stop the service first):

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\pg_restore.exe' -h localhost -U olino_app -d olino_wms --clean --if-exists <file.dump>
```

Test a restore once on another machine, so you know the backups actually work.

---

## 8. Development machine (Docker only here)

```powershell
docker compose up -d                  # PostgreSQL 16 in a container (docker-compose.yml)
copy backend\.env.example backend\.env  # defaults already match docker-compose.yml
npm run install:all
npm run db:migrate
npm run db:seed
npm run dev                           # API on :4000 + screens with hot reload
```

Open **http://localhost:3000**. The dev screens forward `/api` calls to the API on port 4000.

When you change `backend/prisma/schema.prisma`, create a migration with
`cd backend` then `npx prisma migrate dev --name <what-changed>`, and commit the new folder
under `backend/prisma/migrations/`.

To try the production setup locally: `npm run build`, then `npm start`, then open
http://localhost:4000.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service stops immediately | `C:\olino-wms\logs\app.log`. Usually a missing `JWT_SECRET` or a wrong `DATABASE_URL` in `backend\.env`. |
| `password authentication failed` | The password in `DATABASE_URL` must match the `CREATE ROLE` password exactly. |
| Works on the server, not on other PCs | Firewall rule for 4000 is missing, or the network profile is Public. |
| Browser shows "Cannot GET /" | The log says "Frontend build not found". Run `npm run build`, then restart the service. |
| Printer not reachable | Ping the printer from the server. Its IP must be private, and port 9100 must be open on the printer. |
