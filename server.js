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

// Dynamically load Telegram Bot Handler Module
let telegramModule = null;
const possiblePaths = [
    path.join(__dirname, 'netlify', 'functions', 'telegram.js'),
    path.join(__dirname, '..', 'netlify', 'functions', 'telegram.js')
];
for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        try {
            telegramModule = require(p);
            console.log('[SERVER] Loaded Telegram Bot module from:', p);
            break;
        } catch (e) {
            console.error('[SERVER] Failed to load telegram module:', e.message);
        }
    }
}

// -------------------------------------------------------------
// STANDALONE 24/7 SCHEDULER & DISPATCH ENGINE (Zero Dependency)
// Works directly on Bot-Keep even if netlify/ folder is not uploaded
// -------------------------------------------------------------
const QUESTION_CATALOG = {
    1: {
        Mid: ["1st_Mid_Au23.pdf", "1st_Mid_Au25.pdf", "1st_Mid_Aut22.pdf", "1st_Mid_Sp22.pdf", "1st_Mid_Sp23.pdf", "1st_Mid_Sp25.pdf", "1st_Mid_Sp26.pdf", "1st_Mid_Spr24.pdf"],
        Final: ["1st_Final_Au22.pdf", "1st_Final_Au23.pdf", "1st_Final_Au25.pdf", "1st_Final_Sp22.pdf", "1st_Final_Sp23.pdf", "1st_Final_Sp24.pdf", "1st_Final_Sp25.pdf", "1st_Final_Sp26.pdf"]
    },
    2: {
        Mid: ["2nd_Mid_Au22.pdf", "2nd_Mid_Au23.pdf", "2nd_Mid_Au25.pdf", "2nd_Mid_Sp22.pdf", "2nd_Mid_Sp23.pdf", "2nd_Mid_Sp24.pdf", "2nd_Mid_Sp25.pdf", "2nd_Mid_Sp26.pdf"],
        Final: ["2nd_Final_Au22.pdf", "2nd_Final_Au23.pdf", "2nd_Final_Au24.pdf", "2nd_Final_Au25.pdf", "2nd_Final_Sp22.pdf", "2nd_Final_Sp23.pdf", "2nd_Final_Sp24.pdf", "2nd_Final_Sp25.pdf"]
    },
    3: {
        Mid: ["3rd_Mid_Au23.pdf", "3rd_Mid_Au25.pdf", "3rd_Mid_Sp22.pdf", "3rd_Mid_Sp23.pdf", "3rd_Mid_Sp24.pdf", "3rd_Mid_Sp25.pdf", "3rd_Mid_Sp26.pdf", "3rd_mid_Aut22.pdf"],
        Final: ["3rd_FInal_Au25.pdf", "3rd_Final_Au22.pdf", "3rd_Final_Au23.pdf", "3rd_Final_Au24.pdf", "3rd_Final_Sp22.pdf", "3rd_Final_Sp23.pdf", "3rd_Final_Sp24.pdf", "3rd_Final_Sp25.pdf", "3rd_Final_Sp26.pdf"]
    },
    4: {
        Mid: ["4th_Mid_Au21.pdf", "4th_Mid_Au22.pdf", "4th_Mid_Au23.pdf", "4th_Mid_Au25.pdf", "4th_Mid_Sp23.pdf", "4th_Mid_Sp24.pdf", "4th_Mid_Sp25.pdf"],
        Final: ["4th_Final_Au21.pdf", "4th_Final_Au22.pdf", "4th_Final_Au23.pdf", "4th_Final_Au25.pdf", "4th_Final_Sp23.pdf", "4th_Final_Sp24.pdf", "4th_Final_Sp25.pdf", "4th_Final_Sp26.pdf"]
    },
    5: {
        Mid: ["5th_Mid_Au23.pdf", "5th_Mid_Au25.pdf", "5th_Mid_Sp22.pdf", "5th_Mid_Sp23.pdf", "5th_Mid_Sp24.pdf", "5th_Mid_Sp25.pdf", "5th_Mid_Sp26.pdf"],
        Final: ["5th_Final-Sp23.pdf", "5th_Final_Au23.pdf", "5th_Final_Au25.pdf", "5th_Final_Sp22.pdf", "5th_Final_Sp24.pdf", "5th_Final_Sp25.pdf", "5th_Final_Sp26.pdf"]
    },
    6: {
        Mid: ["6th_Mid_Au21.pdf", "6th_Mid_Au22.pdf", "6th_Mid_Au25.pdf", "6th_Mid_Sp22.pdf", "6th_Mid_Sp24.pdf", "6th_Mid_Sp25.pdf", "6th_Mid_Sp26.pdf"],
        Final: ["6th_Final_Au21.pdf", "6th_Final_Au22.pdf", "6th_Final_Au23.pdf", "6th_Final_Au24.pdf", "6th_Final_Au25.pdf", "6th_Final_Sp22.pdf", "6th_Final_Sp24.pdf", "6th_Final_Sp25.pdf"]
    },
    7: {
        Mid: ["7th_Mid_Au21.pdf", "7th_Mid_Au22.pdf", "7th_Mid_Au25.pdf", "7th_Mid_Sp22.pdf", "7th_Mid_Sp23.pdf", "7th_Mid_Sp25.pdf", "7th_Mid_Sp26.pdf"],
        Final: ["7th_Final_Au21.pdf", "7th_Final_Au22.pdf", "7th_Final_Au25.pdf", "7th_Final_Sp22.pdf", "7th_Final_Sp25.pdf"]
    },
    8: {
        Mid: ["8th_Mid_Au25.pdf", "8th_Mid_Sp25.pdf", "8th_Mid_Sp26.pdf"],
        Final: ["8th_Final_Sp25.pdf"]
    }
};



function callTelegramRaw(method, params = {}) {
    return new Promise((resolve) => {
        const postData = JSON.stringify(params);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: 'JSON parse error' }); }
            });
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
        req.write(postData);
        req.end();
    });
}

async function executeStandaloneDueTasks() {
    const tasks = loadScheduledTasks();
    const now = Date.now();
    let hasChanges = false;

    for (const task of tasks) {
        if (task.status === 'pending' && task.scheduledTime <= now) {
            task.status = 'executing';
            saveScheduledTasks(tasks);

            const subscribers = loadSubscribers();
            const isAll = (!task.semester || task.semester === 'all');
            const targetSubs = isAll
                ? subscribers.filter(s => s.semester && parseInt(s.semester, 10) >= 1 && parseInt(s.semester, 10) <= 8)
                : subscribers.filter(s => String(s.semester) === String(task.semester));

            const cleanExam = (task.examType && task.examType.toLowerCase().includes('mid')) ? 'Mid' : 'Final';
            let successCount = 0;
            let failCount = 0;
            let totalPdfs = 0;

            for (const sub of targetSubs) {
                const semNum = parseInt(sub.semester, 10);
                const filenames = (QUESTION_CATALOG[semNum] && QUESTION_CATALOG[semNum][cleanExam])
                    ? [...QUESTION_CATALOG[semNum][cleanExam]]
                    : [];

                if (filenames.length === 0) continue;

                const fileUrls = filenames.map(name =>
                    `https://raw.githubusercontent.com/11UCRES/cse/main/Semester${semNum}/PreviousQuestions/${cleanExam}/${encodeURIComponent(name)}`
                );

                try {
                    if (fileUrls.length === 1) {
                        await callTelegramRaw('sendDocument', {
                            chat_id: sub.id,
                            document: fileUrls[0],
                            caption: 'auto delivered from : @iiuccseresourcebot'
                        });
                        totalPdfs += 1;
                    } else {
                        const chunkSize = 10;
                        for (let i = 0; i < fileUrls.length; i += chunkSize) {
                            const chunk = fileUrls.slice(i, i + chunkSize);
                            if (chunk.length === 1) {
                                await callTelegramRaw('sendDocument', {
                                    chat_id: sub.id,
                                    document: chunk[0],
                                    caption: 'auto delivered from : @iiuccseresourcebot'
                                });
                                totalPdfs += 1;
                            } else {
                                const media = chunk.map((url, idx) => ({
                                    type: 'document',
                                    media: url,
                                    caption: (i === 0 && idx === 0) ? 'auto delivered from : @iiuccseresourcebot' : ''
                                }));
                                const res = await callTelegramRaw('sendMediaGroup', {
                                    chat_id: sub.id,
                                    media: media
                                });
                                if (!res || !res.ok) {
                                    for (const docUrl of chunk) {
                                        await callTelegramRaw('sendDocument', {
                                            chat_id: sub.id,
                                            document: docUrl,
                                            caption: 'auto delivered from : @iiuccseresourcebot'
                                        });
                                        await new Promise(r => setTimeout(r, 150));
                                    }
                                }
                                totalPdfs += chunk.length;
                            }
                        }
                    }
                    successCount++;
                } catch (e) {
                    failCount++;
                }
            }

            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            task.successCount = successCount;
            task.failCount = failCount;
            hasChanges = true;

            // Notify Admin
            try {
                const report =
                    `🔔 <b>Auto-Send Completed: Previous Questions from GitHub!</b>\n\n` +
                    `• Scope: <b>${task.semesterName || 'All Semesters (1st – 8th)'}</b>\n` +
                    `• Exam Category: <b>${task.examType} Term</b>\n` +
                    `• Delivered to: <b>${successCount} students</b>\n` +
                    `• Failed / Blocked: <b>${failCount}</b>\n` +
                    `• Repository PDFs Dispatched: <b>${totalPdfs} files</b>\n` +
                    `• Engine: <b>Bot-Keep 24/7 Dedicated Server</b> 🟢`;

                await callTelegramRaw('sendMessage', {
                    chat_id: task.adminChatId || ADMIN_CHAT_ID,
                    text: report,
                    parse_mode: 'HTML'
                });
            } catch (e) { }
        }
    }

    if (hasChanges) {
        saveScheduledTasks(tasks);
    }
}

// 24/7 Background Scheduler Loop (checks every 10 seconds for exact-second auto-send delivery)
setInterval(async () => {
    try {
        if (telegramModule && typeof telegramModule.executeDueTasks === 'function') {
            await telegramModule.executeDueTasks();
        } else {
            await executeStandaloneDueTasks();
        }
        // Heartbeat ping to Netlify serverless endpoint so Netlify never sleeps and executes on time
        https.get('https://cseresourceofiiuc.netlify.app/.netlify/functions/telegram', () => { }).on('error', () => { });
    } catch (e) {
        console.error('[SERVER] 24/7 Scheduler execution error:', e.message);
    }
}, 10000);
console.log('[SERVER] 24/7 Auto-Send Scheduler loop active (checking & pinging every 10s)');

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
            activePort: PORT,
            telegramBotActive: !!telegramModule
        });
    }

    // 1.1 Telegram Webhook Handler (Bot-Keep 24/7 Server Endpoint)
    if (pathname === '/api/telegram/webhook' || pathname === '/api/telegram' || pathname === '/.netlify/functions/telegram') {
        if (telegramModule && typeof telegramModule.handler === 'function') {
            try {
                const body = (req.method === 'POST') ? await parseBody(req) : {};
                const event = {
                    httpMethod: req.method,
                    body: typeof body === 'string' ? body : JSON.stringify(body),
                    headers: req.headers
                };
                const result = await telegramModule.handler(event);
                res.writeHead(result.statusCode || 200, result.headers || { 'Content-Type': 'application/json' });
                return res.end(result.body || '{"ok":true}');
            } catch (e) {
                console.error('[SERVER] Webhook handling error:', e);
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        // Standalone Proxy: If telegram.js is not present on the server (e.g. BotKeep single-file upload),
        // seamlessly forward webhook payload to the Netlify production bot endpoint!
        try {
            const body = (req.method === 'POST') ? await parseBody(req) : {};
            const postData = typeof body === 'string' ? body : JSON.stringify(body);
            const netlifyReq = https.request('https://cseresourceofiiuc.netlify.app/.netlify/functions/telegram', {
                method: req.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers || { 'Content-Type': 'application/json' });
                proxyRes.pipe(res);
            });
            netlifyReq.on('error', (err) => {
                sendJson(res, 502, { ok: false, error: 'Netlify proxy error: ' + err.message });
            });
            netlifyReq.write(postData);
            netlifyReq.end();
            return;
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
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

    // 5. User Registration & Retrieval Endpoint (Persistent Disk Storage on Server)
    if (pathname === '/api/users' || pathname === '/api/subscribers') {
        if (req.method === 'POST') {
            const body = await parseBody(req);
            const incoming = body.user || body;
            if (incoming && incoming.id) {
                const subscribers = loadSubscribers();
                const existingIndex = subscribers.findIndex(u => String(u.id) === String(incoming.id));
                const userObj = {
                    id: String(incoming.id),
                    first_name: incoming.first_name || '',
                    last_name: incoming.last_name || '',
                    username: incoming.username || '',
                    platform: incoming.platform || 'Telegram Bot',
                    semester: incoming.semester !== undefined ? incoming.semester : (existingIndex > -1 ? subscribers[existingIndex].semester : null),
                    semester_name: incoming.semester_name || (existingIndex > -1 ? subscribers[existingIndex].semester_name : null),
                    registeredAt: existingIndex > -1 ? subscribers[existingIndex].registeredAt : new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                };

                if (existingIndex > -1) {
                    subscribers[existingIndex] = { ...subscribers[existingIndex], ...userObj };
                } else {
                    subscribers.push(userObj);
                }

                saveSubscribers(subscribers);
                console.log(`[SERVER] Saved user ${userObj.id} (${userObj.first_name}) to server storage. Total subscribers: ${subscribers.length}`);
                return sendJson(res, 200, { success: true, count: subscribers.length, user: userObj });
            }
            return sendJson(res, 400, { success: false, error: 'User ID is required' });
        }

        if (req.method === 'GET') {
            const subscribers = loadSubscribers();
            return sendJson(res, 200, { success: true, count: subscribers.length, users: subscribers, subscribers: subscribers });
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

const TASKS_FILE = path.join(DATA_DIR, 'scheduled_tasks.json');

function loadScheduledTasks() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
        }
    } catch (e) { }
    return [];
}

function saveScheduledTasks(tasks) {
    try {
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    } catch (e) {
        console.error('[TASKS] save error:', e.message);
    }
}

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

// Student Semester Selection Keyboard: 1-8th semester (1 per row, style primary) + 1 cancel button (style danger)
const SEMESTER_SELECTION_KEYBOARD = {
    inline_keyboard: [
        [{ text: '📘 1st Semester', callback_data: 'set_sem_1', style: 'primary' }],
        [{ text: '📘 2nd Semester', callback_data: 'set_sem_2', style: 'primary' }],
        [{ text: '📘 3rd Semester', callback_data: 'set_sem_3', style: 'primary' }],
        [{ text: '📘 4th Semester', callback_data: 'set_sem_4', style: 'primary' }],
        [{ text: '📘 5th Semester', callback_data: 'set_sem_5', style: 'primary' }],
        [{ text: '📘 6th Semester', callback_data: 'set_sem_6', style: 'primary' }],
        [{ text: '📘 7th Semester', callback_data: 'set_sem_7', style: 'primary' }],
        [{ text: '📘 8th Semester', callback_data: 'set_sem_8', style: 'primary' }],
        [{ text: '❌ Cancel', callback_data: 'cancel_sem', style: 'danger' }]
    ]
};

// Admin Persistent 4-dot menu Reply Keyboard
const ADMIN_REPLY_KEYBOARD = {
    keyboard: [
        [{ text: '👑 Admin Panel', style: 'primary' }]
    ],
    resize_keyboard: true,
    is_persistent: true
};

// Register user into subscribers database
function trackUser(from) {
    if (!from || !from.id) return null;
    const subscribers = loadSubscribers();
    const idStr = String(from.id);
    const existingIndex = subscribers.findIndex(u => String(u.id) === idStr);
    const existing = existingIndex > -1 ? subscribers[existingIndex] : null;

    const userObj = {
        id: idStr,
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        username: from.username || '',
        platform: 'Telegram Bot',
        semester: existing ? existing.semester : null,
        semester_name: existing ? existing.semester_name : null,
        registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };

    if (existingIndex > -1) {
        subscribers[existingIndex] = { ...existing, ...userObj };
    } else {
        subscribers.push(userObj);
    }
    saveSubscribers(subscribers);
    return userObj;
}

// Generate Admin Panel Text and Inline Buttons (100% inside Telegram)
function getAdminPanelPayload() {
    const subscribers = loadSubscribers();
    const tasks = loadScheduledTasks().filter(t => t.status === 'pending');
    const text =
        `👑 <b>Admin Control Panel</b>\n\n` +
        `👥 Registered Subscribers: <b>${subscribers.length}</b>\n` +
        `⏰ Pending Scheduled Auto-Sends: <b>${tasks.length}</b>\n` +
        `🤖 Bot: <b>@iiuccseresourcebot</b>\n` +
        `🌐 Portal: <b>https://cseresourceofiiuc.netlify.app</b>\n\n` +
        `Select an action below to manage previous questions & broadcasts:`;

    const reply_markup = {
        inline_keyboard: [
            [
                { text: '📝 Send / Schedule Previous Questions', callback_data: 'admin_questions_start', style: 'primary' }
            ],
            [
                { text: '🎓 Broadcast: Set Semester Button', callback_data: 'admin_prompt_sem_broadcast', style: 'primary' }
            ],
            [
                { text: '📢 General Announcement Broadcast', callback_data: 'admin_broadcast_start', style: 'primary' }
            ],
            [
                { text: `👥 Subscribers (${subscribers.length})`, callback_data: 'admin_subscribers', style: 'primary' },
                { text: `⏰ Scheduled (${tasks.length})`, callback_data: 'admin_scheduled_list', style: 'primary' }
            ],
            [
                { text: '📊 System Status', callback_data: 'admin_status', style: 'primary' },
                { text: '🔄 Refresh Panel', callback_data: 'admin_menu', style: 'primary' }
            ],
            [
                { text: '❌ Close', callback_data: 'admin_close', style: 'danger' }
            ]
        ]
    };

    return { text, reply_markup };
}

// Auto-Send Background Execution Engine
async function executeDueTasks() {
    const tasks = loadScheduledTasks();
    const now = Date.now();
    let hasChanges = false;

    for (const task of tasks) {
        if (task.status === 'pending' && task.scheduledTime <= now) {
            task.status = 'executing';
            saveScheduledTasks(tasks);

            const subscribers = loadSubscribers();
            const targetSubs = subscribers.filter(s => {
                if (task.targetSemester === 'all') return true;
                return String(s.semester) === String(task.targetSemester);
            });

            let success = 0, fail = 0;
            for (const sub of targetSubs) {
                try {
                    const res = await callTelegramApi('copyMessage', {
                        chat_id: sub.id,
                        from_chat_id: task.fromChatId,
                        message_id: task.messageId
                    });
                    if (res && res.ok) success++;
                    else fail++;
                } catch (e) {
                    fail++;
                }
            }

            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            task.successCount = success;
            task.failCount = fail;
            hasChanges = true;

            try {
                await callTelegramApi('sendMessage', {
                    chat_id: task.fromChatId,
                    text:
                        `🔔 <b>Auto-Send Previous Questions Completed!</b>\n\n` +
                        `• Target: <b>${task.targetSemName}</b>\n` +
                        `• Scheduled For: <b>${task.scheduledTimeFormatted}</b>\n` +
                        `• Successfully Sent: <b>${success}</b>\n` +
                        `• Failed / Inactive: <b>${fail}</b>\n` +
                        `• Total Targeted: <b>${targetSubs.length}</b>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👑 Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                        ]
                    }
                });
            } catch (e) { }
        }
    }

    if (hasChanges) {
        saveScheduledTasks(tasks);
    }
}

// Handle Incoming Telegram Updates (Messages & Button Callbacks)
async function processTelegramUpdate(update) {
    executeDueTasks().catch(e => console.error('[SCHEDULER] check error:', e.message));

    // 1. Process Callback Queries (Inline Buttons)
    if (update.callback_query) {
        const query = update.callback_query;
        const from = query.from;
        if (!from) return;

        const user = trackUser(from);
        const userId = String(from.id);
        const isAdmin = (userId === ADMIN_ID);
        const data = query.data || '';
        const msgId = query.message ? query.message.message_id : null;

        await callTelegramApi('answerCallbackQuery', { callback_query_id: query.id });

        // STUDENT: Semester Selection
        if (data.startsWith('set_sem_')) {
            const semNum = parseInt(data.replace('set_sem_', ''), 10);
            const semName = `${semNum}${getOrdinal(semNum)} Semester`;

            const subs = loadSubscribers();
            const idx = subs.findIndex(s => String(s.id) === userId);
            if (idx > -1) {
                subs[idx].semester = semNum;
                subs[idx].semester_name = semName;
                subs[idx].semesterUpdatedAt = new Date().toISOString();
                saveSubscribers(subs);
            }

            const successText =
                `🎓 <b>Semester Registered Successfully!</b>\n` +
                ` 🍄You are now registered for <b>${semName}</b>.\n` +
                ` 💡 Need to change semester later? Click on the button below.`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: successText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Change Semester', callback_data: 'select_semester', style: 'primary' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'cancel_sem') {
            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: `❌ <i>Semester selection cancelled.</i>\n\nYou can set your semester anytime by sending <code>/semester</code>.`,
                    parse_mode: 'HTML'
                });
            }
            return;
        }

        if (data === 'select_semester') {
            const semText =
                `🎓 <b>Which semester are you in?</b>\n\n` +
                `Please select your semester below so we can automatically deliver relevant previous exam questions and study resources for your semester:`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: semText,
                    parse_mode: 'HTML',
                    reply_markup: SEMESTER_SELECTION_KEYBOARD
                });
            } else {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: semText,
                    parse_mode: 'HTML',
                    reply_markup: SEMESTER_SELECTION_KEYBOARD
                });
            }
            return;
        }

        // Admin-only actions below
        if (!isAdmin) {
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

        // ADMIN: Previous Questions Broadcast / Scheduling
        if (data === 'admin_questions_start') {
            const subscribers = loadSubscribers();
            const getSemCount = (num) => subscribers.filter(s => String(s.semester) === String(num)).length;

            const qText =
                `📝 <b>Select Target Semester for Previous Questions</b>\n\n` +
                `Choose which semester's students should receive the question paper:\n\n` +
                `• 1st Sem: <b>${getSemCount(1)} students</b>\n` +
                `• 2nd Sem: <b>${getSemCount(2)} students</b>\n` +
                `• 3rd Sem: <b>${getSemCount(3)} students</b>\n` +
                `• 4th Sem: <b>${getSemCount(4)} students</b>\n` +
                `• 5th Sem: <b>${getSemCount(5)} students</b>\n` +
                `• 6th Sem: <b>${getSemCount(6)} students</b>\n` +
                `• 7th Sem: <b>${getSemCount(7)} students</b>\n` +
                `• 8th Sem: <b>${getSemCount(8)} students</b>\n\n` +
                `<i>Tap a semester below to proceed to upload:</i>`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: `1st Sem (${getSemCount(1)})`, callback_data: 'admin_q_sem_1', style: 'primary' },
                        { text: `2nd Sem (${getSemCount(2)})`, callback_data: 'admin_q_sem_2', style: 'primary' }
                    ],
                    [
                        { text: `3rd Sem (${getSemCount(3)})`, callback_data: 'admin_q_sem_3', style: 'primary' },
                        { text: `4th Sem (${getSemCount(4)})`, callback_data: 'admin_q_sem_4', style: 'primary' }
                    ],
                    [
                        { text: `5th Sem (${getSemCount(5)})`, callback_data: 'admin_q_sem_5', style: 'primary' },
                        { text: `6th Sem (${getSemCount(6)})`, callback_data: 'admin_q_sem_6', style: 'primary' }
                    ],
                    [
                        { text: `7th Sem (${getSemCount(7)})`, callback_data: 'admin_q_sem_7', style: 'primary' },
                        { text: `8th Sem (${getSemCount(8)})`, callback_data: 'admin_q_sem_8', style: 'primary' }
                    ],
                    [
                        { text: `🌐 All Semesters (${subscribers.length})`, callback_data: 'admin_q_sem_all', style: 'primary' }
                    ],
                    [
                        { text: '🔙 Back to Admin Panel', callback_data: 'admin_menu', style: 'danger' }
                    ]
                ]
            };

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: qText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
            return;
        }

        if (data.startsWith('admin_q_sem_')) {
            const sem = data.replace('admin_q_sem_', '');
            const semName = sem === 'all' ? 'All Semesters' : `${sem}${getOrdinal(parseInt(sem, 10))} Semester`;
            const subscribers = loadSubscribers();
            const count = sem === 'all' ? subscribers.length : subscribers.filter(s => String(s.semester) === String(sem)).length;

            adminBroadcastState.set(userId, {
                step: 'waiting_for_questions',
                targetSem: sem,
                targetSemName: semName,
                targetCount: count,
                promptMsgId: msgId
            });

            const promptText =
                `📄 <b>Upload Previous Question Paper</b>\n\n` +
                `Target Audience: <b>${semName}</b> (~${count} students)\n\n` +
                `Please send or forward the question paper now:\n` +
                `• PDF documents\n` +
                `• Image question scans\n` +
                `• Question text with drive links\n\n` +
                `<i>Tap Cancel below to abort.</i>`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: promptText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ Cancel', callback_data: 'admin_menu', style: 'danger' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'admin_q_send_now') {
            const state = adminBroadcastState.get(userId);
            if (!state || state.step !== 'preview_questions' || !state.msg) {
                await callTelegramApi('sendMessage', { chat_id: userId, text: '⚠️ No question paper upload pending or expired.' });
                return;
            }

            adminBroadcastState.delete(userId);
            const pendingMsg = state.msg;
            const subscribers = loadSubscribers();
            const targetSubs = subscribers.filter(s => {
                if (state.targetSem === 'all') return true;
                return String(s.semester) === String(state.targetSem);
            });

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: `⏳ <b>Delivering question paper to ${state.targetSemName}...</b>\nTarget queue: ${targetSubs.length} students, please wait...`,
                    parse_mode: 'HTML'
                });
            }

            const startTime = Date.now();
            let success = 0, fail = 0;

            for (const sub of targetSubs) {
                try {
                    const res = await callTelegramApi('copyMessage', {
                        chat_id: sub.id,
                        from_chat_id: pendingMsg.chat.id,
                        message_id: pendingMsg.message_id
                    });
                    if (res && res.ok) success++;
                    else fail++;
                } catch (e) {
                    fail++;
                }
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const report =
                `✅ <b>Previous Questions Delivered!</b>\n\n` +
                `• Target: <b>${state.targetSemName}</b>\n` +
                `• Successfully Sent: <b>${success}</b>\n` +
                `• Failed / Blocked: <b>${fail}</b>\n` +
                `• Total Targeted: <b>${targetSubs.length}</b>\n` +
                `• Duration: <b>${elapsed}s</b>`;

            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text: report,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                    ]
                }
            });
            return;
        }

        if (data === 'admin_q_schedule_options') {
            const state = adminBroadcastState.get(userId);
            if (!state || state.step !== 'preview_questions' || !state.msg) {
                await callTelegramApi('sendMessage', { chat_id: userId, text: '⚠️ No question upload found.' });
                return;
            }

            state.step = 'waiting_for_schedule_time';
            adminBroadcastState.set(userId, state);

            const schedText =
                `⏰ <b>Schedule Auto-Send for ${state.targetSemName}</b>\n\n` +
                `When should the bot automatically send this question paper?\n\n` +
                `Tap a quick delay below, OR reply in chat with a specific date & time (e.g. <code>tomorrow 10am</code>, <code>2026-10-15 14:30</code>, or <code>45m</code>):`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '⏱️ In 15 Minutes', callback_data: 'admin_q_sched_15m', style: 'primary' },
                        { text: '⏱️ In 30 Minutes', callback_data: 'admin_q_sched_30m', style: 'primary' }
                    ],
                    [
                        { text: '⏱️ In 1 Hour', callback_data: 'admin_q_sched_1h', style: 'primary' },
                        { text: '⏱️ In 3 Hours', callback_data: 'admin_q_sched_3h', style: 'primary' }
                    ],
                    [
                        { text: '⏱️ In 6 Hours', callback_data: 'admin_q_sched_6h', style: 'primary' },
                        { text: '⏱️ In 12 Hours', callback_data: 'admin_q_sched_12h', style: 'primary' }
                    ],
                    [
                        { text: '🌅 Tomorrow 9:00 AM', callback_data: 'admin_q_sched_tomorrow_9am', style: 'primary' },
                        { text: '🌙 Tomorrow 8:00 PM', callback_data: 'admin_q_sched_tomorrow_8pm', style: 'primary' }
                    ],
                    [
                        { text: '❌ Cancel', callback_data: 'admin_menu', style: 'danger' }
                    ]
                ]
            };

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: schedText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
            return;
        }

        if (data.startsWith('admin_q_sched_')) {
            const delayKey = data.replace('admin_q_sched_', '');
            const state = adminBroadcastState.get(userId);
            if (!state || !state.msg) {
                await callTelegramApi('sendMessage', { chat_id: userId, text: '⚠️ No pending question paper found.' });
                return;
            }

            let delayMs = 0;
            let label = '';
            const now = new Date();

            if (delayKey === '15m') { delayMs = 15 * 60 * 1000; label = 'In 15 Minutes'; }
            else if (delayKey === '30m') { delayMs = 30 * 60 * 1000; label = 'In 30 Minutes'; }
            else if (delayKey === '1h') { delayMs = 60 * 60 * 1000; label = 'In 1 Hour'; }
            else if (delayKey === '3h') { delayMs = 3 * 60 * 60 * 1000; label = 'In 3 Hours'; }
            else if (delayKey === '6h') { delayMs = 6 * 60 * 60 * 1000; label = 'In 6 Hours'; }
            else if (delayKey === '12h') { delayMs = 12 * 60 * 60 * 1000; label = 'In 12 Hours'; }
            else if (delayKey === 'tomorrow_9am') {
                const target = new Date(now);
                target.setDate(target.getDate() + 1);
                target.setHours(9, 0, 0, 0);
                delayMs = target.getTime() - now.getTime();
                label = 'Tomorrow at 9:00 AM';
            }
            else if (delayKey === 'tomorrow_8pm') {
                const target = new Date(now);
                target.setDate(target.getDate() + 1);
                target.setHours(20, 0, 0, 0);
                delayMs = target.getTime() - now.getTime();
                label = 'Tomorrow at 8:00 PM';
            }

            const targetTime = Date.now() + Math.max(delayMs, 10000);
            const targetDateStr = new Date(targetTime).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true });

            const tasks = loadScheduledTasks();
            const newTask = {
                id: 'task_' + Date.now(),
                targetSemester: state.targetSem,
                targetSemName: state.targetSemName,
                scheduledTime: targetTime,
                scheduledTimeFormatted: targetDateStr,
                fromChatId: state.msg.chat.id,
                messageId: state.msg.message_id,
                status: 'pending',
                createdAt: new Date().toISOString()
            };

            tasks.push(newTask);
            saveScheduledTasks(tasks);
            adminBroadcastState.delete(userId);

            const confirmText =
                `✅ <b>Auto-Send Scheduled Successfully!</b>\n\n` +
                `• Target: <b>${state.targetSemName}</b> (~${state.targetCount} students)\n` +
                `• Delivery Time: <b>${targetDateStr}</b> (${label})\n` +
                `• Cloud Scheduler: <b>Active (24/7)</b>\n\n` +
                `The bot will automatically deliver the previous questions to all <b>${state.targetSemName}</b> students at the scheduled time.`;

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: confirmText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⏰ View Scheduled Tasks', callback_data: 'admin_scheduled_list', style: 'primary' }],
                            [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                        ]
                    }
                });
            }
            return;
        }

        if (data === 'admin_scheduled_list') {
            const tasks = loadScheduledTasks();
            const pendingTasks = tasks.filter(t => t.status === 'pending');

            let text = `⏰ <b>Scheduled Auto-Send Tasks</b>\n\n`;
            const buttons = [];

            if (pendingTasks.length === 0) {
                text += `<i>No auto-send tasks currently scheduled.</i>`;
            } else {
                pendingTasks.forEach((t, i) => {
                    text += `<b>#${i + 1}. ${t.targetSemName}</b>\n• Auto-Send: <code>${t.scheduledTimeFormatted}</code>\n\n`;
                    buttons.push([{
                        text: `❌ Cancel Task #${i + 1} (${t.targetSemName})`,
                        callback_data: `admin_sched_del_${t.id}`,
                        style: 'danger'
                    }]);
                });
            }

            buttons.push([{ text: '🔙 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]);

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            }
            return;
        }

        if (data.startsWith('admin_sched_del_')) {
            const taskId = data.replace('admin_sched_del_', '');
            let tasks = loadScheduledTasks();
            tasks = tasks.filter(t => t.id !== taskId);
            saveScheduledTasks(tasks);

            await callTelegramApi('answerCallbackQuery', {
                callback_query_id: query.id,
                text: 'Scheduled auto-send task cancelled.',
                show_alert: true
            });

            const pendingTasks = tasks.filter(t => t.status === 'pending');
            let text = `⏰ <b>Scheduled Auto-Send Tasks</b>\n\n`;
            const buttons = [];

            if (pendingTasks.length === 0) {
                text += `<i>No auto-send tasks currently scheduled.</i>`;
            } else {
                pendingTasks.forEach((t, i) => {
                    text += `<b>#${i + 1}. ${t.targetSemName}</b>\n• Auto-Send: <code>${t.scheduledTimeFormatted}</code>\n\n`;
                    buttons.push([{
                        text: `❌ Cancel Task #${i + 1} (${t.targetSemName})`,
                        callback_data: `admin_sched_del_${t.id}`,
                        style: 'danger'
                    }]);
                });
            }

            buttons.push([{ text: '🔙 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]);

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            }
            return;
        }

        // Admin: Broadcast Semester Setup Prompt with inline button
        if (data === 'admin_prompt_sem_broadcast') {
            const subscribers = loadSubscribers();
            const previewText =
                `📢 <b>Broadcast Semester Setup to All Users</b>\n\n` +
                `Target Audience: <b>${subscribers.length} subscribers</b>\n\n` +
                `<b>Exact message students will receive:</b>\n` +
                `────────────────────────\n` +
                `👋 <b>Assalamu Alaikum & Welcome to IIUC CSE Resource Bot!</b>\n\n` +
                `👇 <b>Please select your current semester below so we can automatically deliver previous exam questions before your exams:</b>\n\n` +
                `[ 📘 1st Semester ]\n` +
                `[ 📘 2nd Semester ]\n` +
                `[ ... to 8th Semester ]\n` +
                `────────────────────────\n\n` +
                `<i>Tap confirm below to dispatch to all ${subscribers.length} students now:</i>`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: `🚀 Confirm & Send to All (${subscribers.length})`, callback_data: 'admin_confirm_sem_broadcast', style: 'primary' }
                    ],
                    [
                        { text: '❌ Cancel', callback_data: 'admin_menu', style: 'danger' }
                    ]
                ]
            };

            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: previewText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
            return;
        }

        if (data === 'admin_confirm_sem_broadcast') {
            if (msgId) {
                await callTelegramApi('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: `⏳ <b>Broadcasting semester selection prompt to all subscribers in progress...</b>\nPlease wait a moment...`,
                    parse_mode: 'HTML'
                });
            }

            const subscribers = loadSubscribers();
            let success = 0;
            let fail = 0;

            const messageText =
                `👋 <b>Assalamualaikum. Welcome to IIUC CSE Resource Bot!</b>\n\n` +
                `🎓 <b>Which semester are you in?</b>\n` +
                `<blockquote>Please select your semester below so we can automatically deliver relevant previous exam questions before the exam :</blockquote>`;

            const replyMarkup = SEMESTER_SELECTION_KEYBOARD;

            for (const sub of subscribers) {
                try {
                    const res = await callTelegramApi('sendMessage', {
                        chat_id: sub.id,
                        text: messageText,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    });
                    if (res && res.ok) success++;
                    else fail++;
                } catch (e) {
                    fail++;
                }
                await new Promise(r => setTimeout(r, 60));
            }

            try {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text:
                        `✅ <b>Semester Setup Broadcast Delivered!</b>\n\n` +
                        `• Successfully Sent: <b>${success}</b>\n` +
                        `• Failed / Blocked: <b>${fail}</b>\n` +
                        `• Total Target Queue: <b>${subscribers.length} students</b>\n\n` +
                        `All recipients received the interactive <b>[ 📘 Select Your Semester ]</b> inline button!`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                        ]
                    }
                });
            } catch (e) { }

            return;
        }

        if (data === 'admin_broadcast_start') {
            adminBroadcastState.set(userId, { step: 'waiting_for_broadcast', promptMsgId: msgId });
            const promptText =
                `📢 <b>General Announcement Broadcast Mode</b>\n\n` +
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
            if (!state || state.step !== 'preview_broadcast' || !state.msg) {
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
                    text: `⏳ <b>Broadcasting announcement in progress...</b>\nDelivering to ${subscribers.length} subscribers, please wait...`,
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
                await new Promise(r => setTimeout(r, 40));
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const reportText =
                `✅ <b>General Announcement Broadcast Completed!</b>\n\n` +
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
            const semCounts = {};
            for (let i = 1; i <= 8; i++) semCounts[i] = 0;
            let unassigned = 0;

            subscribers.forEach(s => {
                if (s.semester && semCounts[s.semester] !== undefined) semCounts[s.semester]++;
                else unassigned++;
            });

            let subList = subscribers.slice(-8).reverse().map((u, i) =>
                `${i + 1}. <b>${u.first_name || 'User'}</b> (@${u.username || 'n/a'}) - ${u.semester ? `[Sem ${u.semester}]` : '[No Sem]'}`
            ).join('\n');

            const text =
                `👥 <b>Subscribers & Semester Overview</b>\n\n` +
                `Total Registered: <b>${subscribers.length}</b>\n\n` +
                `<b>Semester Distribution:</b>\n` +
                `• 1st Sem: <b>${semCounts[1]}</b> | 2nd Sem: <b>${semCounts[2]}</b>\n` +
                `• 3rd Sem: <b>${semCounts[3]}</b> | 4th Sem: <b>${semCounts[4]}</b>\n` +
                `• 5th Sem: <b>${semCounts[5]}</b> | 6th Sem: <b>${semCounts[6]}</b>\n` +
                `• 7th Sem: <b>${semCounts[7]}</b> | 8th Sem: <b>${semCounts[8]}</b>\n` +
                `• Unassigned: <b>${unassigned}</b>\n\n` +
                `<b>Recent Users:</b>\n${subList || '<i>None yet</i>'}`;

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
            const tasks = loadScheduledTasks().filter(t => t.status === 'pending');
            const uptime = Math.round(process.uptime());
            const text =
                `📊 <b>System Status</b>\n\n` +
                `• Bot: <b>@iiuccseresourcebot</b> (Active 🟢)\n` +
                `• Server: <b>Node.js (Port ${PORT})</b>\n` +
                `• Uptime: <b>${Math.floor(uptime / 60)}m ${uptime % 60}s</b>\n` +
                `• Registered Subscribers: <b>${subscribers.length}</b>\n` +
                `• Pending Auto-Sends: <b>${tasks.length}</b>\n` +
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

    // 2. Process Incoming Messages
    if (update.message) {
        const msg = update.message;
        const from = msg.from;
        if (!from) return;
        const user = trackUser(from);

        const userId = String(from.id);
        const isAdmin = (userId === ADMIN_ID);
        const text = (msg.text || '').trim();

        const flowState = isAdmin ? adminBroadcastState.get(userId) : null;

        // Admin uploads question paper
        if (isAdmin && flowState && flowState.step === 'waiting_for_questions') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                adminBroadcastState.delete(userId);
                const panel = getAdminPanelPayload();
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: '❌ Question upload cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return;
            }

            flowState.step = 'preview_questions';
            flowState.msg = msg;
            adminBroadcastState.set(userId, flowState);

            await callTelegramApi('copyMessage', {
                chat_id: userId,
                from_chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `🚀 Send Now to ${flowState.targetSemName}`, callback_data: 'admin_q_send_now', style: 'primary' }
                        ],
                        [
                            { text: `⏰ Schedule Auto-Send Date/Time`, callback_data: 'admin_q_schedule_options', style: 'primary' }
                        ],
                        [
                            { text: '❌ Cancel', callback_data: 'admin_menu', style: 'danger' }
                        ]
                    ]
                }
            });
            return;
        }

        // Admin types custom schedule date/time
        if (isAdmin && flowState && flowState.step === 'waiting_for_schedule_time') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                adminBroadcastState.delete(userId);
                const panel = getAdminPanelPayload();
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: '❌ Auto-send scheduling cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return;
            }

            let parsedTime = NaN;
            if (/^\d+\s*m(in)?/i.test(text)) {
                const mins = parseInt(text, 10);
                parsedTime = Date.now() + (mins * 60 * 1000);
            } else if (/^\d+\s*h(our)?/i.test(text)) {
                const hours = parseInt(text, 10);
                parsedTime = Date.now() + (hours * 60 * 60 * 1000);
            } else {
                parsedTime = Date.parse(text);
            }

            if (isNaN(parsedTime) || parsedTime <= Date.now()) {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text:
                        `⚠️ <b>Could not recognize that future date/time.</b>\n\n` +
                        `Please enter a future time like:\n` +
                        `• <code>30m</code> (for 30 minutes)\n` +
                        `• <code>2h</code> (for 2 hours)\n` +
                        `• <code>2026-10-15 14:00</code>\n` +
                        `• <i>Or tap one of the quick schedule buttons above, or send /cancel.</i>`,
                    parse_mode: 'HTML'
                });
                return;
            }

            const targetDateStr = new Date(parsedTime).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true });
            const tasks = loadScheduledTasks();
            const newTask = {
                id: 'task_' + Date.now(),
                targetSemester: flowState.targetSem,
                targetSemName: flowState.targetSemName,
                scheduledTime: parsedTime,
                scheduledTimeFormatted: targetDateStr,
                fromChatId: flowState.msg.chat.id,
                messageId: flowState.msg.message_id,
                status: 'pending',
                createdAt: new Date().toISOString()
            };

            tasks.push(newTask);
            saveScheduledTasks(tasks);
            adminBroadcastState.delete(userId);

            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text:
                    `✅ <b>Auto-Send Scheduled Successfully!</b>\n\n` +
                    `• Target: <b>${flowState.targetSemName}</b> (~${flowState.targetCount} students)\n` +
                    `• Delivery Time: <b>${targetDateStr}</b>\n` +
                    `• Cloud Scheduler: <b>Active (24/7)</b>\n\n` +
                    `The bot will automatically deliver the previous questions to all <b>${flowState.targetSemName}</b> students when the time arrives.`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏰ View Scheduled Tasks', callback_data: 'admin_scheduled_list', style: 'primary' }],
                        [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                    ]
                }
            });
            return;
        }

        // Admin typed /broadcast <message>
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

            adminBroadcastState.set(userId, { step: 'preview_broadcast', msg: msg });
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

        // Check if Admin is in waiting_for_broadcast step
        if (isAdmin && flowState && flowState.step === 'waiting_for_broadcast') {
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

            flowState.step = 'preview_broadcast';
            flowState.msg = msg;
            adminBroadcastState.set(userId, flowState);
            const subscribers = loadSubscribers();

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

        // Student /semester command
        if (text === '/semester' || text.toLowerCase() === 'semester' || text.toLowerCase().includes('change semester')) {
            const currentSem = user && user.semester ? `\n(Current: <b>${user.semester_name || user.semester + 'th Semester'}</b>)` : '';
            await callTelegramApi('sendMessage', {
                chat_id: userId,
                text: `🎓 <b>Select Your Semester</b>${currentSem}\n\nChoose your semester below to receive previous exam questions and updates tailored for your semester:`,
                parse_mode: 'HTML',
                reply_markup: SEMESTER_SELECTION_KEYBOARD
            });
            return;
        }

        // /start command
        if (text === '/start') {
            if (isAdmin) {
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome Admin!</b>\n\nTap <b>👑 Admin Panel</b> below or type /admin anytime to manage previous questions & auto-sends:`,
                    parse_mode: 'HTML',
                    reply_markup: ADMIN_REPLY_KEYBOARD
                });
                const panel = getAdminPanelPayload();
                await callTelegramApi('sendMessage', {
                    chat_id: userId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            } else {
                if (!user || !user.semester) {
                    await callTelegramApi('sendMessage', {
                        chat_id: userId,
                        text:
                            `👋 <b>Welcome to IIUC CSE Resource Hub Bot!</b>\n\n` +
                            `🎓 <b>Which semester are you in?</b>\n` +
                            `Please select your semester below so we can automatically deliver relevant previous exam questions and question banks for your semester:`,
                        parse_mode: 'HTML',
                        reply_markup: SEMESTER_SELECTION_KEYBOARD
                    });
                } else {
                    await callTelegramApi('sendMessage', {
                        chat_id: userId,
                        text:
                            `Welcome back, ${user.first_name || 'Student'}!\n` +
                            `Registered for: <b>${user.semester_name || user.semester + 'th Semester'}</b>`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Change Semester', callback_data: 'select_semester', style: 'primary' }]
                            ]
                        }
                    });
                }
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
    // Check for due auto-send tasks every 60 seconds
    setInterval(() => executeDueTasks().catch(e => console.error('[SCHEDULER] error:', e.message)), 60000);
});

