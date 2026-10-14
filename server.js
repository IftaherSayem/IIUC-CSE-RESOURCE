const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const https = require('https');

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

// In-memory cache for GitHub API responses
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

// Helper: parse request body
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

// MIME types for static files
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
    // Handle CORS preflight for all hosts and origins
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

    // 1. Health check endpoint
    if (pathname === '/health' || pathname === '/api/status') {
        return sendJson(res, 200, {
            status: 'ok',
            mode: 'server',
            uptime: Math.round(process.uptime()),
            timestamp: Date.now(),
            service: 'IIUC CSE Resource Hub Backend',
            activePort: PORT
        });
    }

    // 2. Telegram Send File Endpoint (Server Mode)
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

    // 2.2 Telegram Send Message with Reply Markup (Server Mode)
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

    // 2.5 Telegram Set Chat Menu Button Endpoint (Server Mode)
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

    // 3. Download Proxy Endpoint (Server Streams the File)
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

    // 4. GitHub API Proxy with In-Memory Caching
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

    // 4.1. Total Live Files Count (counting only files / blobs, not folders)
    if (pathname === '/api/total-resources' && req.method === 'GET') {
        const now = Date.now();
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

    // 5. User Registration & Retrieval Endpoint
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

    if (pathname === '/api/telegram-webhook' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            processTelegramUpdate(body).catch(e => console.error('[WEBHOOK] Error:', e.message));
            return sendJson(res, 200, { ok: true });
        } catch (err) {
            return sendJson(res, 400, { ok: false, error: err.message });
        }
    }

    // 6. Static File Server for frontend Mini App
    let targetPath = (pathname === '/' || !pathname) ? '/index.html' : pathname;

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
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        }
    });
});

// ========================================================================
// 8. NATIVE TELEGRAM BOT ENGINE & INTERACTIVE ADMIN BROADCAST PANEL
// ========================================================================
const ADMIN_ID = String(ADMIN_CHAT_ID);
const adminBroadcastState = new Map(); // adminId -> { step, msg }

// Direct HTTPS Agent with connection pooling & keep-alive
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 10000 });

// Helper for calling Telegram API directly via HTTPS (IPv4 / connection-resilient)
function callTelegramApi(method, payload = {}, timeoutMs = 15000) {
    const validStyles = ['primary', 'success', 'danger'];

    if (payload && payload.reply_markup) {
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
        if (Array.isArray(payload.reply_markup.inline_keyboard)) {
            payload.reply_markup.inline_keyboard = sanitizeButtons(payload.reply_markup.inline_keyboard);
        }
        if (Array.isArray(payload.reply_markup.keyboard)) {
            payload.reply_markup.keyboard = sanitizeButtons(payload.reply_markup.keyboard);
        }
    }

    return new Promise((resolve) => {
        let attempts = 0;
        const postData = JSON.stringify(payload);

        function doRequest() {
            attempts++;
            const urlObj = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`);
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                agent: httpsAgent,
                timeout: timeoutMs
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve({ ok: false, error: 'JSON parse error' });
                    }
                });
            });

            req.on('error', (err) => {
                if (attempts < 2 && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
                    setTimeout(doRequest, 150);
                } else {
                    resolve({ ok: false, error: err.message });
                }
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, error: 'Request timeout' });
            });

            req.write(postData);
            req.end();
        }

        doRequest();
    });
}

// Register user into subscribers database
function trackUser(from) {
    if (!from || !from.id) return;
    const subscribers = loadSubscribers();
    const idStr = String(from.id);
    const existingIndex = subscribers.findIndex(u => String(u.id) === idStr);

    const userObj = {
        id: idStr,
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        username: from.username || '',
        platform: 'Telegram Bot',
        registeredAt: existingIndex > -1 ? subscribers[existingIndex].registeredAt : new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };

    if (existingIndex > -1) {
        subscribers[existingIndex] = userObj;
    } else {
        subscribers.push(userObj);
    }
    saveSubscribers(subscribers);
}

// Generate Admin Panel Text and Inline Buttons (100% inside Telegram)
function getAdminPanelPayload() {
    const subscribers = loadSubscribers();
    const text = 
        `👑 <b>Admin Control Panel</b>\n\n` +
        `👥 Registered Subscribers: <b>${subscribers.length}</b>\n` +
        `🤖 Bot: <b>@iiuccseresourcebot</b>\n` +
        `🌐 Portal: <b>https://cseresourceofiiuc.netlify.app</b>\n\n` +
        `Select an action below to manage announcements:`;

    const reply_markup = {
        inline_keyboard: [
            [
                { text: '📢 Broadcast Announcement', callback_data: 'admin_broadcast_start', style: 'primary' }
            ],
            [
                { text: `👥 Subscribers (${subscribers.length})`, callback_data: 'admin_subscribers', style: 'primary' },
                { text: '📊 System Status', callback_data: 'admin_status', style: 'primary' }
            ],
            [
                { text: '🔄 Refresh Panel', callback_data: 'admin_menu', style: 'primary' },
                { text: '❌ Close', callback_data: 'admin_close', style: 'danger' }
            ]
        ]
    };

    return { text, reply_markup };
}

// Handle Incoming Telegram Updates (Messages & Button Callbacks)
async function processTelegramUpdate(update) {
    // 1. Process Incoming Messages
    if (update.message) {
        const msg = update.message;
        const from = msg.from;
        if (!from) return;
        trackUser(from);

        const userId = String(from.id);
        const isAdmin = (userId === ADMIN_ID);
        const text = (msg.text || '').trim();

        // Check if Admin typed /broadcast <message>
        if (isAdmin && (text.startsWith('/broadcast') || text.startsWith('/bc'))) {
            const content = text.replace(/^\/(broadcast|bc)\s*/i, '').trim();
            if (!content) {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: '⚠️ Usage: <code>/broadcast Your announcement message here</code>',
                    parse_mode: 'HTML'
                });
                return;
            }

            adminBroadcastState.set(userId, { step: 'preview', msg: msg });
            const subscribers = loadSubscribers();

            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text: `📢 <b>Broadcast Preview</b>\n\nRecipients: <b>${subscribers.length} subscribers</b>\n\n${content}`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `✅ Send Now (to ~${subscribers.length} users)`, callback_data: 'admin_broadcast_confirm', style: 'primary' },
                            { text: '❌ Cancel', callback_data: 'admin_broadcast_cancel', style: 'danger' }
                        ]
                    ]
                }
            });
            return;
        }

        // Check if Admin is in waiting_for_message broadcast step
        if (isAdmin && adminBroadcastState.has(userId) && adminBroadcastState.get(userId).step === 'waiting_for_message') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                adminBroadcastState.delete(userId);
                const panel = getAdminPanelPayload();
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: '❌ Broadcast cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return;
            }

            // Save pending broadcast message
            adminBroadcastState.set(userId, { step: 'preview', msg: msg });
            const subscribers = loadSubscribers();

            // Preview copied message back to admin with confirm / cancel inline buttons
            await callTelegramApi('copyMessage', {
                chat_id: userId,
                from_chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `✅ Send Now (to ~${subscribers.length} users)`, callback_data: 'admin_broadcast_confirm', style: 'primary' },
                            { text: '❌ Cancel', callback_data: 'admin_broadcast_cancel', style: 'danger' }
                        ]
                    ]
                }
            });
            return;
        }

        // Admin command to open inline admin panel
        if (isAdmin && (text === '/admin' || text === '👑 Admin Panel' || text.toLowerCase() === 'admin' || text.toLowerCase().includes('admin panel'))) {
            const panel = getAdminPanelPayload();
            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text: panel.text,
                parse_mode: 'HTML',
                reply_markup: panel.reply_markup
            });
            return;
        }

        // /start command
        if (text === '/start') {
            if (isAdmin) {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome Admin!</b>\n\nTap the button below or type /admin to manage broadcasts directly in Telegram:`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        keyboard: [
                            [{ text: '👑 Admin Panel', style: 'primary' }]
                        ],
                        resize_keyboard: true,
                        is_persistent: true
                    }
                });
                const panel = getAdminPanelPayload();
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            } else {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome to IIUC CSE Resource Hub Bot!</b>\n\nBrowse question banks, lecture slides, and notes directly on our web app:\n🔗 https://cseresourceofiiuc.netlify.app`,
                    parse_mode: 'HTML'
                });
            }
            return;
        }
    }

    // 2. Process Callback Queries (Inline Buttons)
    if (update.callback_query) {
        const query = update.callback_query;
        const from = query.from;
        if (!from) return;
        trackUser(from);

        const userId = String(from.id);
        const data = query.data || '';
        const msgId = query.message ? query.message.message_id : null;

        await callTelegramApi('answerCallbackQuery', { callback_query_id: query.id });

        if (userId !== ADMIN_ID) {
            await callTelegramApi('answerCallbackQuery', { callback_query_id: query.id, text: '⛔ Admin only', show_alert: true });
            return;
        }

        if (data === 'admin_menu') {
            adminBroadcastState.delete(userId);
            const panel = getAdminPanelPayload();
            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            } else {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            }
            return;
        }

        if (data === 'admin_broadcast_start') {
            adminBroadcastState.set(userId, { step: 'waiting_for_message' });
            const promptText = 
                `📢 <b>Broadcast Announcement Mode</b>\n\n` +
                `Please send or forward the message you want to broadcast now.\n` +
                `Supports text with formatting, photos with captions, and documents.\n\n` +
                `<i>Tap Cancel below to abort.</i>`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: promptText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Cancel Broadcast', callback_data: 'admin_broadcast_cancel', style: 'danger' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'admin_broadcast_cancel') {
            adminBroadcastState.delete(userId);
            const panel = getAdminPanelPayload();
            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: '❌ Broadcast cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            }
            return;
        }

        if (data === 'admin_broadcast_confirm') {
            const state = adminBroadcastState.get(userId);
            if (!state || state.step !== 'preview' || !state.msg) {
                await callTelegramApi('sendMessage', { chat_id: userId, text: '⚠️ No broadcast pending or expired.' });
                return;
            }

            adminBroadcastState.delete(userId);
            const pendingMsg = state.msg;
            const subscribers = loadSubscribers();

            if (subscribers.length === 0) {
                await callTelegramApi('sendMessage', { chat_id: userId, text: '⚠️ No subscribers found in database.' });
                return;
            }

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: `⏳ <b>Broadcasting in progress...</b>\nDelivering to ${subscribers.length} subscribers, please wait...`,
                    parse_mode: 'HTML'
                });
            }

            const startTime = Date.now();
            let successCount = 0;
            let failCount = 0;

            for (const sub of subscribers) {
                try {
                    const res = await callTelegramApi('copyMessage', {
                        chat_id: sub.id,
                        from_chat_id: pendingMsg.chat.id,
                        message_id: pendingMsg.message_id
                    });
                    if (res && res.ok) successCount++;
                    else failCount++;
                } catch (e) {
                    failCount++;
                }
                // Avoid Telegram rate limits
                await new Promise(r => setTimeout(r, 40));
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const reportText = 
                `✅ <b>Broadcast Completed!</b>\n\n` +
                `• Successfully Sent: <b>${successCount}</b>\n` +
                `• Failed / Blocked: <b>${failCount}</b>\n` +
                `• Total Queue: <b>${subscribers.length}</b>\n` +
                `• Duration: <b>${elapsed}s</b>`;

            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text: reportText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                    ]
                }
            });
            return;
        }

        if (data === 'admin_subscribers') {
            const subscribers = loadSubscribers();
            let subList = subscribers.slice(-10).reverse().map((u, i) => 
                `${i + 1}. <b>${u.first_name || 'User'}</b> (@${u.username || 'n/a'}) - <code>${u.id}</code>`
            ).join('\n');

            const text = 
                `👥 <b>Subscribers Overview</b>\n\n` +
                `Total Registered: <b>${subscribers.length}</b>\n\n` +
                `Recent Subscribers:\n${subList || '<i>None yet</i>'}`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'admin_status') {
            const subscribers = loadSubscribers();
            const uptime = Math.round(process.uptime());
            const text = 
                `📊 <b>System Status</b>\n\n` +
                `• Bot: <b>@iiuccseresourcebot</b> (Active 🟢)\n` +
                `• Server: <b>Node.js (Port ${PORT})</b>\n` +
                `• Uptime: <b>${Math.floor(uptime / 60)}m ${uptime % 60}s</b>\n` +
                `• Registered Subscribers: <b>${subscribers.length}</b>\n` +
                `• Live Portal: <b>https://cseresourceofiiuc.netlify.app</b>`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'admin_close') {
            if (msgId) {
                await callTelegramApi('deleteMessage', {
                    chat_id: userId,
                    message_id: msgId
                });
            }
            return;
        }
    }
}

// Telegram Bot Long Polling Loop
let botPollOffset = 0;
let isBotPollingActive = false;

async function runTelegramBotPolling() {
    if (isBotPollingActive) return;
    isBotPollingActive = true;
    console.log('[TELEGRAM] Native Bot Engine & Admin Panel Polling Started');

    while (isBotPollingActive) {
        try {
            const data = await callTelegramApi('getUpdates', {
                offset: botPollOffset,
                timeout: 20,
                allowed_updates: ['message', 'callback_query']
            }, 30000);

            if (data && data.ok && Array.isArray(data.result)) {
                for (const update of data.result) {
                    botPollOffset = update.update_id + 1;
                    await processTelegramUpdate(update);
                }
            }
        } catch (err) {
            console.error('[TELEGRAM] Poll loop error:', err.message);
        }
        await new Promise(r => setTimeout(r, 400));
    }
}

server.listen(PORT, HOST, () => {
    console.log(`===============================================`);
    console.log(`🚀 IIUC CSE Resource Backend Server Running`);
    console.log(`📡 Host: ${HOST} (Listening on all interfaces)`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🏥 Health Check: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
    console.log(`🤖 Telegram Bot Admin Panel: @iiuccseresourcebot (Chat ID: ${ADMIN_CHAT_ID})`);
    console.log(`🌐 Live Portal: https://cseresourceofiiuc.netlify.app`);
    console.log(`===============================================`);

    // Start Native Telegram Bot Long-Polling
    runTelegramBotPolling().catch(err => console.error('[TELEGRAM] Polling error:', err));
});

