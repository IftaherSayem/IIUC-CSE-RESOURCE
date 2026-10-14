const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '7954499196:AAF7YiojzLccNyFe-wHDBueJMLVnal-9WhM';
const ADMIN_ID = process.env.ADMIN_CHAT_ID || '6623300482';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// File paths for persistence in serverless /tmp or local
const TMP_DATA_DIR = path.join('/tmp', 'data');
const LOCAL_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TMP_USERS_FILE = path.join(TMP_DATA_DIR, 'subscribers.json');
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, 'subscribers.json');
const TMP_BROADCAST_FILE = path.join('/tmp', 'broadcast_state.json');

// Ensure directories
try {
    if (!fs.existsSync(TMP_DATA_DIR)) fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
} catch (e) {}

// Raw direct HTTPS call to Telegram (bypasses node fetch socket issues with automatic retry)
function callTelegram(method, params = {}, timeoutMs = 12000) {
    if (params && params.reply_markup) {
        const validStyles = ['primary', 'success', 'danger'];
        const sanitize = (rows) => {
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
        if (Array.isArray(params.reply_markup.inline_keyboard)) {
            params.reply_markup.inline_keyboard = sanitize(params.reply_markup.inline_keyboard);
        }
        if (Array.isArray(params.reply_markup.keyboard)) {
            params.reply_markup.keyboard = sanitize(params.reply_markup.keyboard);
        }
    }

    return new Promise((resolve) => {
        let attempts = 0;
        const postData = JSON.stringify(params);

        function exec() {
            attempts++;
            const urlObj = new URL(`${API_BASE}/${method}`);
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
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
                    setTimeout(exec, 200);
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

        exec();
    });
}

// Subscriber storage
function loadSubscribers() {
    // Priority: /tmp (writable in Lambda) -> local data/subscribers.json -> admin fallback
    try {
        if (fs.existsSync(TMP_USERS_FILE)) {
            const data = fs.readFileSync(TMP_USERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) {}

    try {
        if (fs.existsSync(LOCAL_USERS_FILE)) {
            const data = fs.readFileSync(LOCAL_USERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {}

    return [{
        id: String(ADMIN_ID),
        first_name: 'Admin',
        username: 'e2re01',
        platform: 'Telegram Bot Admin',
        registeredAt: new Date().toISOString()
    }];
}

function saveSubscribers(list) {
    try {
        fs.writeFileSync(TMP_USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {}
    try {
        if (fs.existsSync(LOCAL_DATA_DIR)) {
            fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
        }
    } catch (e) {}
}

function trackUser(from) {
    if (!from || !from.id) return;
    const subs = loadSubscribers();
    const idStr = String(from.id);
    const idx = subs.findIndex(s => String(s.id) === idStr);
    const obj = {
        id: idStr,
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        username: from.username || '',
        platform: 'Telegram Bot',
        registeredAt: idx > -1 ? subs[idx].registeredAt : new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };
    if (idx > -1) subs[idx] = obj;
    else subs.push(obj);
    saveSubscribers(subs);
}

// Broadcast state storage in /tmp
function getBroadcastState(userId) {
    try {
        if (fs.existsSync(TMP_BROADCAST_FILE)) {
            const all = JSON.parse(fs.readFileSync(TMP_BROADCAST_FILE, 'utf8'));
            return all[String(userId)] || null;
        }
    } catch (e) {}
    return null;
}

function setBroadcastState(userId, state) {
    try {
        let all = {};
        if (fs.existsSync(TMP_BROADCAST_FILE)) {
            try { all = JSON.parse(fs.readFileSync(TMP_BROADCAST_FILE, 'utf8')); } catch (e) {}
        }
        if (state === null) {
            delete all[String(userId)];
        } else {
            all[String(userId)] = state;
        }
        fs.writeFileSync(TMP_BROADCAST_FILE, JSON.stringify(all), 'utf8');
    } catch (e) {}
}

// Admin Panel Payload
function getAdminPanelPayload() {
    const subscribers = loadSubscribers();
    const text =
        `👑 <b>Admin Control Panel</b>\n\n` +
        `👥 Registered Subscribers: <b>${subscribers.length}</b>\n` +
        `🤖 Bot: <b>@iiuccseresourcebot</b> (Cloud 24/7 🟢)\n` +
        `🌐 Portal: <b>https://cseresourceofiiuc.netlify.app</b>\n\n` +
        `Select an action below to manage broadcasts:`;

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

// Reply Keyboard (Single Button in 4-dot menu)
const ADMIN_REPLY_KEYBOARD = {
    keyboard: [
        [{ text: '👑 Admin Panel', style: 'primary' }]
    ],
    resize_keyboard: true,
    is_persistent: true
};

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ status: 'online', bot: 'iiuccseresourcebot', mode: 'webhook-serverless' })
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let update;
    try {
        update = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    // =========================================================================
    // 1. PROCESS INLINE BUTTON CALLBACKS (callback_query)
    // =========================================================================
    if (update.callback_query) {
        const query = update.callback_query;
        const from = query.from;
        if (!from) return { statusCode: 200, headers, body: '{"ok":true}' };

        trackUser(from);
        const userId = String(from.id);
        const isAdmin = (userId === String(ADMIN_ID));
        const data = query.data || '';
        const msgId = query.message ? query.message.message_id : null;

        // Immediate answer to dismiss the Telegram button loading spinner
        await callTelegram('answerCallbackQuery', { callback_query_id: query.id });

        if (!isAdmin) {
            await callTelegram('answerCallbackQuery', {
                callback_query_id: query.id,
                text: '⛔ Access Denied. Admin only.',
                show_alert: true
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: Return to Admin Menu
        if (data === 'admin_menu') {
            setBroadcastState(userId, null);
            const panel = getAdminPanelPayload();
            if (msgId) {
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            } else {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: Start Broadcast Prompt
        if (data === 'admin_broadcast_start') {
            setBroadcastState(userId, { step: 'waiting_for_message', promptMsgId: msgId });
            const promptText =
                `📢 <b>Broadcast Announcement Mode</b>\n\n` +
                `Send or forward the message you want to broadcast to all subscribers.\n` +
                `<i>Supports formatted text, photos with captions, and documents.</i>\n\n` +
                `You can also type <code>/broadcast Your message</code> directly.\n\n` +
                `Tap Cancel below to return.`;

            if (msgId) {
                await callTelegram('editMessageText', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: Cancel Broadcast
        if (data === 'admin_broadcast_cancel') {
            setBroadcastState(userId, null);
            const panel = getAdminPanelPayload();
            if (msgId) {
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: '❌ Broadcast cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: Confirm Broadcast Delivery
        if (data === 'admin_broadcast_confirm') {
            const state = getBroadcastState(userId);
            if (!state || state.step !== 'preview' || !state.msg) {
                await callTelegram('sendMessage', { chat_id: userId, text: '⚠️ No broadcast pending or session expired.' });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            setBroadcastState(userId, null);
            const pendingMsg = state.msg;
            const subscribers = loadSubscribers();

            if (msgId) {
                await callTelegram('editMessageText', {
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
                    const res = await callTelegram('copyMessage', {
                        chat_id: sub.id,
                        from_chat_id: pendingMsg.chat.id,
                        message_id: pendingMsg.message_id
                    });
                    if (res && res.ok) successCount++;
                    else failCount++;
                } catch (e) {
                    failCount++;
                }
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const reportText =
                `✅ <b>Broadcast Completed!</b>\n\n` +
                `• Successfully Sent: <b>${successCount}</b>\n` +
                `• Failed / Blocked: <b>${failCount}</b>\n` +
                `• Total Queue: <b>${subscribers.length}</b>\n` +
                `• Duration: <b>${elapsed}s</b>`;

            await callTelegram('sendMessage', {
                chat_id: userId,
                text: reportText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                    ]
                }
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: View Subscribers
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
                await callTelegram('editMessageText', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: System Status
        if (data === 'admin_status') {
            const subscribers = loadSubscribers();
            const text =
                `📊 <b>System Status</b>\n\n` +
                `• Bot: <b>@iiuccseresourcebot</b> (Active 🟢)\n` +
                `• Engine: <b>Netlify Serverless Cloud (24/7)</b>\n` +
                `• Registered Subscribers: <b>${subscribers.length}</b>\n` +
                `• Live Portal: <b>https://cseresourceofiiuc.netlify.app</b>`;

            if (msgId) {
                await callTelegram('editMessageText', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Action: Close Message
        if (data === 'admin_close') {
            if (msgId) {
                await callTelegram('deleteMessage', { chat_id: userId, message_id: msgId });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }
    }

    // =========================================================================
    // 2. PROCESS CHAT MESSAGES
    // =========================================================================
    if (update.message) {
        const msg = update.message;
        const from = msg.from;
        if (!from) return { statusCode: 200, headers, body: '{"ok":true}' };

        trackUser(from);
        const userId = String(from.id);
        const isAdmin = (userId === String(ADMIN_ID));
        const text = (msg.text || '').trim();

        // Check if Admin typed /broadcast <message>
        if (isAdmin && (text.startsWith('/broadcast') || text.startsWith('/bc'))) {
            const content = text.replace(/^\/(broadcast|bc)\s*/i, '').trim();
            if (!content) {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: '⚠️ Usage: <code>/broadcast Your announcement message here</code>',
                    parse_mode: 'HTML'
                });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            setBroadcastState(userId, { step: 'preview', msg: msg });
            const subscribers = loadSubscribers();

            await callTelegram('sendMessage', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Check if Admin is in waiting_for_message state
        const broadcastState = getBroadcastState(userId);
        if (isAdmin && broadcastState && broadcastState.step === 'waiting_for_message') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                setBroadcastState(userId, null);
                const panel = getAdminPanelPayload();
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: '❌ Broadcast cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            setBroadcastState(userId, { step: 'preview', msg: msg });
            const subscribers = loadSubscribers();

            await callTelegram('copyMessage', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Open Admin Panel on /admin or tapping bottom menu button '👑 Admin Panel'
        if (isAdmin && (text === '/admin' || text === '👑 Admin Panel' || text.toLowerCase() === 'admin' || text.toLowerCase().includes('admin panel'))) {
            const panel = getAdminPanelPayload();
            await callTelegram('sendMessage', {
                chat_id: userId,
                text: panel.text,
                parse_mode: 'HTML',
                reply_markup: panel.reply_markup
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Handle /start command
        if (text === '/start') {
            if (isAdmin) {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome Admin!</b>\n\nTap <b>👑 Admin Panel</b> in the menu below or type /admin anytime:`,
                    parse_mode: 'HTML',
                    reply_markup: ADMIN_REPLY_KEYBOARD
                });
                const panel = getAdminPanelPayload();
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
            } else {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome to IIUC CSE Resource Hub Bot!</b>\n\nBrowse question banks, lecture slides, and notes on our web app:\n🔗 https://cseresourceofiiuc.netlify.app`,
                    parse_mode: 'HTML'
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }
    }

    return { statusCode: 200, headers, body: '{"ok":true}' };
};
