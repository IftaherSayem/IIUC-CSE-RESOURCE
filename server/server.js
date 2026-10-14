const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Lightweight native .env loader (Zero dependency, works on all Node versions)
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const idx = trimmed.indexOf('=');
                    const key = trimmed.substring(0, idx).trim();
                    const val = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
                    if (val && !process.env[key]) {
                        process.env[key] = val;
                    }
                }
            });
            console.log('[SERVER] Loaded environment variables from .env');
        } catch (e) {
            console.warn('[SERVER] Could not parse .env file:', e.message);
        }
    }
}
loadEnv();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 listens to all incoming hosts/interfaces
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '7954499196:AAF7YiojzLccNyFe-wHDBueJMLVnal-9WhM';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '6623300482';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'subscribers.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// 🔐 SYSTEM ADMIN PASSWORD CONFIGURATION
// Precedence: 1. Environment Variable (Highest) -> 2. config.json -> 3. '6623'
// ============================================================================
function getActiveAdminPassword() {
    // 1. Environment Variable (Always highest priority)
    const envPass = process.env.ADMIN_PASSWORD || process.env.admin_password || process.env.ADMIN_PASS;
    if (envPass && String(envPass).trim()) {
        return String(envPass).trim().replace(/^['"]|['"]$/g, '');
    }

    // 2. Saved Config File (if set dynamically)
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (cfg.adminPassword && String(cfg.adminPassword).trim()) {
                return String(cfg.adminPassword).trim().replace(/^['"]|['"]$/g, '');
            }
        }
    } catch (e) {
        console.error('[SERVER] Config read error:', e.message);
    }

    // 3. Fallback default
    return '6623';
}

function saveServerConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {
        console.error('[SERVER] Config save error:', e.message);
    }
}

// Session Token Manager for Admin Panel
const activeSessions = new Map(); // token -> { expiresAt }

function generateSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours validity
    activeSessions.set(token, { expiresAt });
    return { token, expiresAt };
}

function isValidSession(token) {
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}

// In-memory cache for GitHub API & stats
const githubCache = {};
let cachedTotalFiles = null;
let lastTotalFilesFetch = 0;

// Helper: load stored subscribers
function loadSubscribers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[SERVER] Error reading subscribers file:', e.message);
    }
    return [];
}

// Helper: save subscribers
function saveSubscribers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error('[SERVER] Error saving subscribers file:', e.message);
    }
}

// Helper: send JSON response with standard open CORS headers (accessible to all hosts)
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Private-Network': 'true'
    });
    res.end(JSON.stringify(data));
}

// Helper: parse JSON request body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

// MIME types for static files if served alongside
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain'
};

const server = http.createServer(async (req, res) => {
    // 1. Handle CORS preflight for all origins and hosts (no restrictions)
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Max-Age': '86400'
        });
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    console.log(`[SERVER] ${req.method} ${pathname}`);

    // ========================================================================
    // API ROUTE 1: Health & Uptime Status
    // ========================================================================
    if (pathname === '/health' || pathname === '/api/status') {
        return sendJson(res, 200, {
            status: 'ok',
            mode: 'server',
            uptime: Math.round(process.uptime()),
            timestamp: Date.now(),
            service: 'IIUC CSE Resource Hub Backend API',
            activePort: PORT,
            totalSubscribers: loadSubscribers().length
        });
    }

    // ========================================================================
    // API ROUTE 2: Telegram Send File (Server Mode)
    // ========================================================================
    if (pathname === '/api/telegram/send' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { file, userId, botToken } = body;
            const activeToken = botToken || BOT_TOKEN;

            if (!file || !userId) {
                return sendJson(res, 400, { ok: false, error: 'File object and userId are required' });
            }

            const isLarge = file.size > 20 * 1024 * 1024; // > 20MB

            if (isLarge) {
                // Large file: send message with download link
                const apiUrl = `https://api.telegram.org/bot${activeToken}/sendMessage`;
                const params = new URLSearchParams({
                    chat_id: userId,
                    text: `The file "${file.name}" is too large to send directly (>20MB).\n\nYou can download it here:\n${file.url}\n\nRequested via Server from: @iiuccseresourcebot`,
                    parse_mode: 'HTML'
                });

                const tgRes = await fetch(`${apiUrl}?${params}`);
                const tgData = await tgRes.json();
                return sendJson(res, tgRes.ok ? 200 : 400, {
                    ok: tgData.ok,
                    viaServer: true,
                    result: tgData
                });
            } else {
                // Normal file: send document directly
                const apiUrl = `https://api.telegram.org/bot${activeToken}/sendDocument`;
                const params = new URLSearchParams({
                    chat_id: userId,
                    document: file.url,
                    caption: `Requested via Server from: @iiuccseresourcebot`
                });

                const tgRes = await fetch(`${apiUrl}?${params}`);
                const tgData = await tgRes.json();
                return sendJson(res, tgRes.ok ? 200 : 400, {
                    ok: tgData.ok,
                    viaServer: true,
                    result: tgData
                });
            }
        } catch (error) {
            console.error('[SERVER] Telegram send error:', error);
            return sendJson(res, 500, { ok: false, viaServer: true, error: error.message });
        }
    }

    // ========================================================================
    // API ROUTE 2.2: Telegram Send Message with Reply Markup (Server Mode)
    // ========================================================================
    if (pathname === '/api/telegram/send-message' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { chatId, text, photoUrl, replyMarkup, botToken } = body;
            const activeToken = botToken || BOT_TOKEN;

            if (!chatId) {
                return sendJson(res, 400, { ok: false, error: 'chatId is required' });
            }

            const endpoint = photoUrl ? 'sendPhoto' : 'sendMessage';
            const apiUrl = `https://api.telegram.org/bot${activeToken}/${endpoint}`;

            const payload = {
                chat_id: chatId,
                parse_mode: 'HTML'
            };

            if (photoUrl) {
                payload.photo = photoUrl;
                if (text) payload.caption = text;
            } else {
                payload.text = text || '🟢 IIUC CSE Resource Hub';
            }

            if (replyMarkup) {
                // Support and preserve Telegram button styles ('success', 'primary', 'danger') like Ishan Bhai OTP bot
                const validStyles = ['primary', 'success', 'danger'];
                const sanitizeButtons = (rows) => {
                    if (!Array.isArray(rows)) return rows;
                    return rows.map(row => {
                        if (!Array.isArray(row)) return row;
                        return row.map(btn => {
                            if (btn && btn.style && !validStyles.includes(btn.style)) {
                                delete btn.style;
                            }
                            return btn;
                        });
                    });
                };
                if (Array.isArray(replyMarkup.inline_keyboard)) {
                    replyMarkup.inline_keyboard = sanitizeButtons(replyMarkup.inline_keyboard);
                }
                if (Array.isArray(replyMarkup.keyboard)) {
                    replyMarkup.keyboard = sanitizeButtons(replyMarkup.keyboard);
                }
                payload.reply_markup = replyMarkup;
            }

            const tgRes = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const tgData = await tgRes.json();
            return sendJson(res, tgRes.ok ? 200 : 400, tgData);
        } catch (error) {
            console.error('[SERVER] Telegram send-message error:', error);
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    // ========================================================================
    // API ROUTE 2.5: Telegram Set Chat Menu Button Endpoint (Server Mode)
    // ========================================================================
    if (pathname === '/api/telegram/set-menu-button' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { botToken, menuButton } = body;
            const activeToken = botToken || BOT_TOKEN;

            const apiUrl = `https://api.telegram.org/bot${activeToken}/setChatMenuButton`;
            const tgRes = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    menu_button: menuButton || {
                        type: 'web_app',
                        text: '🟢 Resource Hub',
                        web_app: { url: 'https://cseresourceofiiuc.netlify.app' }
                    }
                })
            });
            const tgData = await tgRes.json();
            return sendJson(res, tgRes.ok ? 200 : 400, tgData);
        } catch (error) {
            console.error('[SERVER] Set menu button error:', error);
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    // ========================================================================
    // API ROUTE 3: Download Stream Proxy
    // ========================================================================
    if (pathname === '/api/download' && req.method === 'GET') {
        const fileUrl = query.url;
        const fileName = query.filename || path.basename(fileUrl) || 'resource-file';

        if (!fileUrl) {
            return sendJson(res, 400, { error: 'url parameter is required' });
        }

        try {
            const fileStream = await fetch(fileUrl);
            if (!fileStream.ok) {
                return sendJson(res, fileStream.status, { error: 'Failed to fetch upstream file' });
            }

            const contentType = fileStream.headers.get('content-type') || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
                'Access-Control-Allow-Origin': '*',
                'X-Served-By': 'IIUC-CSE-Server'
            });

            const arrayBuffer = await fileStream.arrayBuffer();
            return res.end(Buffer.from(arrayBuffer));
        } catch (error) {
            console.error('[SERVER] Proxy download error:', error);
            return sendJson(res, 500, { error: error.message });
        }
    }

    // ========================================================================
    // API ROUTE 4: GitHub API Proxy with Cache
    // ========================================================================
    if (pathname === '/api/github' && req.method === 'GET') {
        const endpoint = query.endpoint;
        if (!endpoint) {
            return sendJson(res, 400, { error: 'endpoint parameter is required' });
        }

        if (githubCache[endpoint]) {
            return sendJson(res, 200, githubCache[endpoint]);
        }

        try {
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (GITHUB_TOKEN) {
                headers['Authorization'] = `token ${GITHUB_TOKEN}`;
            }

            const ghRes = await fetch(`https://api.github.com${endpoint}`, { headers });
            const data = await ghRes.json();

            if (ghRes.ok) {
                githubCache[endpoint] = data;
            }
            return sendJson(res, ghRes.status, data);
        } catch (error) {
            console.error('[SERVER] GitHub proxy error:', error);
            return sendJson(res, 500, { error: error.message });
        }
    }

    // ========================================================================
    // API ROUTE 4.1: Total Live Resources Count (Blobs only, excludes folders)
    // ========================================================================
    if (pathname === '/api/total-resources' && req.method === 'GET') {
        const now = Date.now();
        // Return cached count if within 5 minutes
        if (typeof cachedTotalFiles === 'number' && (now - lastTotalFilesFetch < 5 * 60 * 1000)) {
            return sendJson(res, 200, { ok: true, totalFiles: cachedTotalFiles, cached: true });
        }

        try {
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (GITHUB_TOKEN) {
                headers['Authorization'] = `token ${GITHUB_TOKEN}`;
            }

            const ghRes = await fetch(`https://api.github.com/repos/11UCRES/cse/git/trees/main?recursive=1`, { headers });
            if (ghRes.ok) {
                const data = await ghRes.json();
                const filesOnly = (data.tree || []).filter(item => item.type === 'blob');
                cachedTotalFiles = filesOnly.length;
                lastTotalFilesFetch = now;
                return sendJson(res, 200, { ok: true, totalFiles: cachedTotalFiles });
            }
        } catch (e) {
            console.error('[SERVER] Total resources live count error:', e.message);
        }

        return sendJson(res, 200, { ok: true, totalFiles: cachedTotalFiles || 1367, fallback: true });
    }

    // ========================================================================
    // API ROUTE 5: User Registration & Retrieval Endpoint
    // ========================================================================
    if (pathname === '/api/users') {
        if (req.method === 'POST') {
            const body = await parseBody(req);
            if (body && body.id) {
                const subscribers = loadSubscribers();
                const existingIndex = subscribers.findIndex(u => String(u.id) === String(body.id));
                const userObj = {
                    id: String(body.id),
                    first_name: body.first_name || '',
                    last_name: body.last_name || '',
                    username: body.username || '',
                    platform: body.platform || 'Telegram WebApp',
                    registeredAt: existingIndex > -1 ? subscribers[existingIndex].registeredAt : new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                };

                if (existingIndex > -1) {
                    subscribers[existingIndex] = { ...subscribers[existingIndex], ...userObj };
                } else {
                    subscribers.unshift(userObj);
                }

                saveSubscribers(subscribers);
                return sendJson(res, 200, { success: true, count: subscribers.length, user: userObj });
            }
            return sendJson(res, 400, { success: false, error: 'User ID is required' });
        }

        if (req.method === 'GET') {
            const subscribers = loadSubscribers();
            return sendJson(res, 200, { success: true, count: subscribers.length, users: subscribers });
        }
    }

    // ========================================================================
    // API ROUTE 6: Admin Authentication & Management Endpoints
    // ========================================================================
    if (pathname === '/api/admin/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { password, telegramUserId } = body;

            // Verified via Telegram Admin ID
            if (telegramUserId && String(telegramUserId) === String(ADMIN_CHAT_ID)) {
                const session = generateSession();
                return sendJson(res, 200, {
                    ok: true,
                    token: session.token,
                    expiresAt: session.expiresAt,
                    message: 'Authenticated via Admin Telegram ID'
                });
            }

            // Verified via Server Configured Password (or environment password)
            const activePass = getActiveAdminPassword();
            const inputPass = String(password || '').trim().replace(/^['"]|['"]$/g, '');
            const envPass = (process.env.ADMIN_PASSWORD || process.env.admin_password || '').trim().replace(/^['"]|['"]$/g, '');

            if (inputPass && (inputPass === activePass || (envPass && inputPass === envPass))) {
                const session = generateSession();
                return sendJson(res, 200, {
                    ok: true,
                    token: session.token,
                    expiresAt: session.expiresAt,
                    message: 'Authenticated via Server Admin Password'
                });
            }

            return sendJson(res, 401, {
                ok: false,
                error: 'Invalid admin password. Please try again.'
            });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    }

    if (pathname === '/api/admin/verify' && req.method === 'POST') {
        const body = await parseBody(req);
        const token = body.token || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
        const valid = isValidSession(token);
        return sendJson(res, 200, { ok: true, valid });
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
        const body = await parseBody(req);
        const token = body.token;
        if (token) activeSessions.delete(token);
        return sendJson(res, 200, { ok: true, message: 'Logged out successfully' });
    }

    if (pathname === '/api/admin/change-password' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { token, currentPassword, newPassword } = body;

            if (!isValidSession(token)) {
                return sendJson(res, 401, { ok: false, error: 'Unauthorized session' });
            }

            if (String(currentPassword).trim() !== String(ADMIN_PASSWORD).trim()) {
                return sendJson(res, 400, { ok: false, error: 'Current password is incorrect' });
            }

            if (!newPassword || String(newPassword).trim().length < 4) {
                return sendJson(res, 400, { ok: false, error: 'New password must be at least 4 characters' });
            }

            ADMIN_PASSWORD = String(newPassword).trim();
            saveServerConfig({ adminPassword: ADMIN_PASSWORD, updatedAt: new Date().toISOString() });
            return sendJson(res, 200, { ok: true, message: 'Admin password updated successfully in server!' });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    }

    // ========================================================================
    // ROOT LANDING & STATIC FALLBACK: Server Info Page
    // ========================================================================
    let targetPath = pathname;
    if (targetPath === '/acc/ad' || targetPath === '/acc/ad/') {
        targetPath = '/acc/ad/index.html';
    } else if (targetPath === '/') {
        // If static index.html doesn't exist in server dir, return a beautiful status page
        const localIndexPath = path.join(__dirname, 'index.html');
        if (!fs.existsSync(localIndexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>IIUC CSE Resource Hub - Backend Server</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 40px 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; box-sizing: border-box; }
                        .card { max-width: 580px; width: 100%; background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; margin-bottom: 16px; }
                        .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; }
                        h1 { margin: 0 0 8px; font-size: 1.6rem; color: #ffffff; }
                        p { margin: 0 0 20px; color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
                        .endpoint { background: #0f172a; padding: 10px 14px; border-radius: 8px; font-family: monospace; font-size: 0.85rem; margin-bottom: 8px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
                        .endpoint .badge { background: #3b82f6; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="status"><span class="dot"></span> SERVER ONLINE (Server Mode)</div>
                        <h1>IIUC CSE Resource Backend</h1>
                        <p>This is the standalone Node.js API backend for the Academic Resource Hub.</p>
                        <div class="endpoint"><span>GET /health</span><span class="badge">Health Check</span></div>
                        <div class="endpoint"><span>GET /api/total-resources</span><span class="badge">Live File Count</span></div>
                        <div class="endpoint"><span>GET /api/github</span><span class="badge">GitHub Proxy</span></div>
                        <div class="endpoint"><span>POST /api/telegram/send</span><span class="badge">Telegram Bot</span></div>
                        <div class="endpoint"><span>GET /api/download</span><span class="badge">File Stream</span></div>
                        <div class="endpoint"><span>POST /api/admin/login</span><span class="badge">Admin Auth</span></div>
                    </div>
                </body>
                </html>
            `);
        }
        targetPath = '/index.html';
    }

    let filePath = path.join(__dirname, targetPath);
    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            // Check if directory with index.html
            const indexPath = path.join(filePath, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
                return fs.createReadStream(indexPath).pipe(res);
            }
            // Not found
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Endpoint not found', path: pathname }));
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`===============================================`);
    console.log(`🚀 IIUC CSE Resource Backend Server Running`);
    console.log(`📡 Host: ${HOST} (Listening on all interfaces)`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🏥 Health Check: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
    console.log(`🔑 Admin Password: ${getActiveAdminPassword()}`);
    console.log(`===============================================`);
});
