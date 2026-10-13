# IIUC CSE Academic Resource Hub — Standalone Backend Server

This folder contains the **isolated backend server** for the IIUC CSE Academic Resource Hub. It has **zero third-party npm dependencies** (uses native Node.js HTTP, crypto, and fetch) and can be uploaded and deployed directly to any server, VPS, or cloud platform.

---

## 📁 Package Contents

```text
server/
├── server.js            # Main backend server application
├── package.json         # Project manifest (Zero external dependencies)
├── .env.example         # Template for environment variables
├── Dockerfile           # Docker container configuration
├── README.md            # This deployment guide
└── data/
    ├── subscribers.json # Stored bot subscribers list
    └── config.json      # Dynamic admin settings & password
```

---

## 🚀 How to Run & Deploy

### Option 1: Quick Run Locally / On Any Machine
Requires **Node.js 18+**:
```bash
# 1. Navigate to the server directory
cd server

# 2. (Optional) Create .env from template
cp .env.example .env

# 3. Start the server
node server.js
```
The server will start at: `http://localhost:5000`

---

### Option 2: Deploy to Free Cloud Hosting (Render / Railway / Koyeb)

1. **Upload or Push**: Push this `server/` folder to GitHub.
2. **Create New Web Service** on [Render.com](https://render.com) or [Railway.app](https://railway.app).
3. **Root Directory**: Set root directory to `server` (or upload files directly).
4. **Build Command**: `npm install` (or leave empty)
5. **Start Command**: `node server.js`
6. **Environment Variables**:
   * `PORT`: `5000` (or host provided port)
   * `ADMIN_PASSWORD`: Your secret admin password (e.g. `6623`)
   * `BOT_TOKEN`: `7954499196:AAF7YiojzLccNyFe-wHDBueJMLVnal-9WhM`
   * `ADMIN_CHAT_ID`: `6623300482`
   * `GITHUB_TOKEN`: *(Optional)* Your GitHub Personal Access Token

Once deployed, Render/Railway gives you a live URL like: `https://your-app.onrender.com`.

---

### Option 3: Deploy on a Linux VPS (Ubuntu / Debian) with PM2

```bash
# 1. SSH into your VPS
ssh user@your-vps-ip

# 2. Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install PM2 process manager
sudo npm install -g pm2

# 4. Upload or clone the server folder to your VPS
mkdir -p /var/www/iiuc-server
cd /var/www/iiuc-server

# 5. Start with PM2
pm2 start server.js --name "iiuc-backend"
pm2 save
pm2 startup
```

---

### Option 4: Deploy using Docker

```bash
# Build the Docker image
docker build -t iiuc-cse-server .

# Run the container
docker run -d -p 5000:5000 --name iiuc-backend-service iiuc-cse-server
```

---

## 🔗 Connecting the Frontend to this Server

Once your server is live at `https://your-server-url.com`:

1. In the frontend app (`index.html`), students and users automatically connect when hosted together.
2. If your frontend is hosted separately on Netlify / Vercel / GitHub Pages:
   * Run in browser console on the frontend:
     ```javascript
     localStorage.setItem('backend_server_url', 'https://your-server-url.com');
     ```
   * Or configure `SERVER_URL` in `index.html` line 1266 to point to your live server URL.

---

## 🛡️ Available API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Health check for uptime monitoring |
| `/api/total-resources` | `GET` | Live count of total files (excluding folders) with caching |
| `/api/github` | `GET` | Upstream GitHub API caching proxy |
| `/api/telegram/send` | `POST` | Bot file sending & large file transfer link generator |
| `/api/download` | `GET` | Direct streaming download proxy |
| `/api/users` | `GET/POST`| Register or retrieve Telegram bot subscribers |
| `/api/admin/login` | `POST` | Secure password & Telegram ID admin authentication |
| `/api/admin/verify` | `POST` | Session token validation |
| `/api/admin/change-password` | `POST` | Change admin password dynamically |
