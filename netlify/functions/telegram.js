const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '7954499196:AAF7YiojzLccNyFe-wHDBueJMLVnal-9WhM';
const ADMIN_ID = process.env.ADMIN_CHAT_ID || '6623300482';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// File paths for persistence in serverless /tmp or local workspace
const TMP_DATA_DIR = path.join('/tmp', 'data');
const LOCAL_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TMP_USERS_FILE = path.join(TMP_DATA_DIR, 'subscribers.json');
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, 'subscribers.json');
const TMP_TASKS_FILE = path.join(TMP_DATA_DIR, 'scheduled_tasks.json');
const LOCAL_TASKS_FILE = path.join(LOCAL_DATA_DIR, 'scheduled_tasks.json');
const TMP_STATE_FILE = path.join('/tmp', 'admin_flow_state.json');

// Ensure tmp directory exists
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

// -------------------------------------------------------------
// 1. DATA PERSISTENCE HELPERS
// -------------------------------------------------------------
function loadSubscribers() {
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
        semester: null,
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
    if (!from || !from.id) return null;
    const subs = loadSubscribers();
    const idStr = String(from.id);
    const idx = subs.findIndex(s => String(s.id) === idStr);
    const existing = idx > -1 ? subs[idx] : null;

    const obj = {
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

    if (idx > -1) subs[idx] = { ...existing, ...obj };
    else subs.push(obj);

    saveSubscribers(subs);
    return obj;
}

function loadScheduledTasks() {
    try {
        if (fs.existsSync(TMP_TASKS_FILE)) {
            return JSON.parse(fs.readFileSync(TMP_TASKS_FILE, 'utf8'));
        }
    } catch (e) {}
    try {
        if (fs.existsSync(LOCAL_TASKS_FILE)) {
            return JSON.parse(fs.readFileSync(LOCAL_TASKS_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveScheduledTasks(tasks) {
    try {
        fs.writeFileSync(TMP_TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    } catch (e) {}
    try {
        if (fs.existsSync(LOCAL_DATA_DIR)) {
            fs.writeFileSync(LOCAL_TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
        }
    } catch (e) {}
}

function getFlowState(userId) {
    try {
        if (fs.existsSync(TMP_STATE_FILE)) {
            const all = JSON.parse(fs.readFileSync(TMP_STATE_FILE, 'utf8'));
            return all[String(userId)] || null;
        }
    } catch (e) {}
    return null;
}

function setFlowState(userId, state) {
    try {
        let all = {};
        if (fs.existsSync(TMP_STATE_FILE)) {
            try { all = JSON.parse(fs.readFileSync(TMP_STATE_FILE, 'utf8')); } catch (e) {}
        }
        if (state === null) {
            delete all[String(userId)];
        } else {
            all[String(userId)] = state;
        }
        fs.writeFileSync(TMP_STATE_FILE, JSON.stringify(all), 'utf8');
    } catch (e) {}
}

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

// -------------------------------------------------------------
// 2. KEYBOARD LAYOUTS
// -------------------------------------------------------------

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

// Admin Control Panel Payload
function getAdminPanelPayload() {
    const subscribers = loadSubscribers();
    const tasks = loadScheduledTasks().filter(t => t.status === 'pending');
    const text =
        `👑 <b>Admin Control Panel</b>\n\n` +
        `👥 Registered Subscribers: <b>${subscribers.length}</b>\n` +
        `⏰ Pending Scheduled Auto-Sends: <b>${tasks.length}</b>\n` +
        `🤖 Bot: <b>@iiuccseresourcebot</b> (Cloud 24/7 🟢)\n` +
        `🌐 Portal: <b>https://cseresourceofiiuc.netlify.app</b>\n\n` +
        `Select an action below to manage previous questions & broadcasts:`;

    const reply_markup = {
        inline_keyboard: [
            [
                { text: '📝 Send / Schedule Previous Questions', callback_data: 'admin_questions_start', style: 'primary' }
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

// -------------------------------------------------------------
// 3. AUTO-SEND BACKGROUND EXECUTION ENGINE
// -------------------------------------------------------------
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
                    const res = await callTelegram('copyMessage', {
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

            // Notify Admin of completed auto-send
            try {
                await callTelegram('sendMessage', {
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
            } catch (e) {}
        }
    }

    if (hasChanges) {
        saveScheduledTasks(tasks);
    }
}

// -------------------------------------------------------------
// 4. MAIN NETLIFY SERVERLESS WEBHOOK HANDLER
// -------------------------------------------------------------
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'GET') {
        // Trigger auto-send check and return health status
        await executeDueTasks();
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

    // Check for any due scheduled auto-send tasks on each event
    executeDueTasks().catch(e => console.error('[SCHEDULER] check error:', e.message));

    // =========================================================================
    // 5. PROCESS INLINE BUTTON CALLBACKS (callback_query)
    // =========================================================================
    if (update.callback_query) {
        const query = update.callback_query;
        const from = query.from;
        if (!from) return { statusCode: 200, headers, body: '{"ok":true}' };

        const user = trackUser(from);
        const userId = String(from.id);
        const isAdmin = (userId === String(ADMIN_ID));
        const data = query.data || '';
        const msgId = query.message ? query.message.message_id : null;

        // Immediate answer to dismiss button loading indicator
        await callTelegram('answerCallbackQuery', { callback_query_id: query.id });

        // ---------------------------------------------------------------------
        // STUDENT: Semester Selection Callbacks
        // ---------------------------------------------------------------------
        if (data.startsWith('set_sem_')) {
            const semNum = parseInt(data.replace('set_sem_', ''), 10);
            const semName = `${semNum}${getOrdinal(semNum)} Semester`;

            // Save semester for subscriber
            const subs = loadSubscribers();
            const idx = subs.findIndex(s => String(s.id) === userId);
            if (idx > -1) {
                subs[idx].semester = semNum;
                subs[idx].semester_name = semName;
                subs[idx].semesterUpdatedAt = new Date().toISOString();
                saveSubscribers(subs);
            }

            const successText =
                `🎓 <b>Semester Registered Successfully!</b>\n\n` +
                `You are now registered for <b>${semName}</b>.\n\n` +
                `Whenever previous exam questions, solutions, and notices are released for <b>${semName}</b>, they will be automatically sent to you here!\n\n` +
                `🌐 <i>Browse all slides, syllabus & questions anytime on our web app:</i>\n` +
                `🔗 https://cseresourceofiiuc.netlify.app\n\n` +
                `💡 <i>Need to change semester later? Send /semester anytime.</i>`;

            if (msgId) {
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: successText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Change Semester', callback_data: 'select_semester', style: 'primary' }]
                        ]
                    }
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        if (data === 'cancel_sem') {
            if (msgId) {
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: `❌ <i>Semester selection cancelled.</i>\n\nYou can set your semester anytime by sending <code>/semester</code>.`,
                    parse_mode: 'HTML'
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        if (data === 'select_semester') {
            const semText =
                `🎓 <b>Which semester are you in?</b>\n\n` +
                `Please select your semester below so we can automatically deliver relevant previous exam questions and study resources for your semester:`;

            if (msgId) {
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: semText,
                    parse_mode: 'HTML',
                    reply_markup: SEMESTER_SELECTION_KEYBOARD
                });
            } else {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: semText,
                    parse_mode: 'HTML',
                    reply_markup: SEMESTER_SELECTION_KEYBOARD
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // ---------------------------------------------------------------------
        // ADMIN-ONLY ACTIONS CHECK
        // ---------------------------------------------------------------------
        if (!isAdmin) {
            await callTelegram('answerCallbackQuery', {
                callback_query_id: query.id,
                text: '⛔ Access Denied. Admin only.',
                show_alert: true
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Admin Menu Return
        if (data === 'admin_menu') {
            setFlowState(userId, null);
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

        // ---------------------------------------------------------------------
        // ADMIN: PREVIOUS QUESTIONS BROADCAST & AUTO-SEND WIZARD
        // ---------------------------------------------------------------------
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
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: qText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Admin selects target semester for questions
        if (data.startsWith('admin_q_sem_')) {
            const sem = data.replace('admin_q_sem_', '');
            const semName = sem === 'all' ? 'All Semesters' : `${sem}${getOrdinal(parseInt(sem, 10))} Semester`;
            const subscribers = loadSubscribers();
            const count = sem === 'all' ? subscribers.length : subscribers.filter(s => String(s.semester) === String(sem)).length;

            setFlowState(userId, {
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
                await callTelegram('editMessageText', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Admin chooses Send Immediately for Questions
        if (data === 'admin_q_send_now') {
            const state = getFlowState(userId);
            if (!state || state.step !== 'preview_questions' || !state.msg) {
                await callTelegram('sendMessage', { chat_id: userId, text: '⚠️ No question paper upload pending or expired.' });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            setFlowState(userId, null);
            const pendingMsg = state.msg;
            const subscribers = loadSubscribers();
            const targetSubs = subscribers.filter(s => {
                if (state.targetSem === 'all') return true;
                return String(s.semester) === String(state.targetSem);
            });

            if (msgId) {
                await callTelegram('editMessageText', {
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
                    const res = await callTelegram('copyMessage', {
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

            await callTelegram('sendMessage', {
                chat_id: userId,
                text: report,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👑 Back to Admin Panel', callback_data: 'admin_menu', style: 'primary' }]
                    ]
                }
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Admin chooses Schedule Auto-Send Options for Questions
        if (data === 'admin_q_schedule_options') {
            const state = getFlowState(userId);
            if (!state || state.step !== 'preview_questions' || !state.msg) {
                await callTelegram('sendMessage', { chat_id: userId, text: '⚠️ No question upload found.' });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            state.step = 'waiting_for_schedule_time';
            setFlowState(userId, state);

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
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text: schedText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Quick schedule delay selected
        if (data.startsWith('admin_q_sched_')) {
            const delayKey = data.replace('admin_q_sched_', '');
            const state = getFlowState(userId);
            if (!state || !state.msg) {
                await callTelegram('sendMessage', { chat_id: userId, text: '⚠️ No pending question paper found.' });
                return { statusCode: 200, headers, body: '{"ok":true}' };
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
            setFlowState(userId, null);

            const confirmText =
                `✅ <b>Auto-Send Scheduled Successfully!</b>\n\n` +
                `• Target: <b>${state.targetSemName}</b> (~${state.targetCount} students)\n` +
                `• Delivery Time: <b>${targetDateStr}</b> (${label})\n` +
                `• Cloud Scheduler: <b>Active (24/7)</b>\n\n` +
                `The bot will automatically deliver the previous questions to all <b>${state.targetSemName}</b> students at the scheduled time.`;

            if (msgId) {
                await callTelegram('editMessageText', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // View and Manage Scheduled Auto-Sends
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
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Cancel a specific scheduled task
        if (data.startsWith('admin_sched_del_')) {
            const taskId = data.replace('admin_sched_del_', '');
            let tasks = loadScheduledTasks();
            tasks = tasks.filter(t => t.id !== taskId);
            saveScheduledTasks(tasks);

            await callTelegram('answerCallbackQuery', {
                callback_query_id: query.id,
                text: 'Scheduled auto-send task cancelled.',
                show_alert: true
            });

            // Return to updated list
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
                await callTelegram('editMessageText', {
                    chat_id: userId,
                    message_id: msgId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // ---------------------------------------------------------------------
        // ADMIN: GENERAL BROADCAST ACTIONS
        // ---------------------------------------------------------------------
        if (data === 'admin_broadcast_start') {
            setFlowState(userId, { step: 'waiting_for_broadcast', promptMsgId: msgId });
            const promptText =
                `📢 <b>General Announcement Broadcast Mode</b>\n\n` +
                `Send or forward the announcement message you want to broadcast to all subscribers.\n` +
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

        if (data === 'admin_broadcast_cancel') {
            setFlowState(userId, null);
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

        if (data === 'admin_broadcast_confirm') {
            const state = getFlowState(userId);
            if (!state || state.step !== 'preview_broadcast' || !state.msg) {
                await callTelegram('sendMessage', { chat_id: userId, text: '⚠️ No broadcast pending or session expired.' });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            setFlowState(userId, null);
            const pendingMsg = state.msg;
            const subscribers = loadSubscribers();

            if (msgId) {
                await callTelegram('editMessageText', {
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
                `✅ <b>General Announcement Broadcast Completed!</b>\n\n` +
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

        if (data === 'admin_status') {
            const subscribers = loadSubscribers();
            const tasks = loadScheduledTasks().filter(t => t.status === 'pending');
            const text =
                `📊 <b>System Status</b>\n\n` +
                `• Bot: <b>@iiuccseresourcebot</b> (Active 🟢)\n` +
                `• Engine: <b>Netlify Serverless Cloud (24/7)</b>\n` +
                `• Registered Subscribers: <b>${subscribers.length}</b>\n` +
                `• Pending Auto-Sends: <b>${tasks.length}</b>\n` +
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

        if (data === 'admin_close') {
            if (msgId) {
                await callTelegram('deleteMessage', { chat_id: userId, message_id: msgId });
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }
    }

    // =========================================================================
    // 6. PROCESS CHAT MESSAGES
    // =========================================================================
    if (update.message) {
        const msg = update.message;
        const from = msg.from;
        if (!from) return { statusCode: 200, headers, body: '{"ok":true}' };

        const user = trackUser(from);
        const userId = String(from.id);
        const isAdmin = (userId === String(ADMIN_ID));
        const text = (msg.text || '').trim();

        // ---------------------------------------------------------------------
        // Check Admin Flow States (Question upload or Custom Schedule Time)
        // ---------------------------------------------------------------------
        const flowState = isAdmin ? getFlowState(userId) : null;

        // Step A: Admin uploads question paper for a semester
        if (isAdmin && flowState && flowState.step === 'waiting_for_questions') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                setFlowState(userId, null);
                const panel = getAdminPanelPayload();
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: '❌ Question upload cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            // Save question paper preview
            flowState.step = 'preview_questions';
            flowState.msg = msg;
            setFlowState(userId, flowState);

            await callTelegram('copyMessage', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Step B: Admin replies with custom date/time for scheduling
        if (isAdmin && flowState && flowState.step === 'waiting_for_schedule_time') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                setFlowState(userId, null);
                const panel = getAdminPanelPayload();
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: '❌ Auto-send scheduling cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            // Parse custom date/time or minute delay (e.g., '30m', '2h', or ISO date)
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
                await callTelegram('sendMessage', {
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
                return { statusCode: 200, headers, body: '{"ok":true}' };
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
            setFlowState(userId, null);

            await callTelegram('sendMessage', {
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
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Step C: Admin in general broadcast mode
        if (isAdmin && flowState && flowState.step === 'waiting_for_broadcast') {
            if (text === '/cancel' || text.toLowerCase() === 'cancel') {
                setFlowState(userId, null);
                const panel = getAdminPanelPayload();
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: '❌ Broadcast cancelled.\n\n' + panel.text,
                    parse_mode: 'HTML',
                    reply_markup: panel.reply_markup
                });
                return { statusCode: 200, headers, body: '{"ok":true}' };
            }

            flowState.step = 'preview_broadcast';
            flowState.msg = msg;
            setFlowState(userId, flowState);
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

        // Step D: Admin typed /broadcast <message>
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

            setFlowState(userId, { step: 'preview_broadcast', msg: msg });
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

        // Step E: Open Admin Panel
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

        // Step F: /semester command for any user to select/change semester
        if (text === '/semester' || text.toLowerCase() === 'semester' || text.toLowerCase().includes('change semester')) {
            const currentSem = user && user.semester ? `\n(Current: <b>${user.semester_name || user.semester + 'th Semester'}</b>)` : '';
            await callTelegram('sendMessage', {
                chat_id: userId,
                text: `🎓 <b>Select Your Semester</b>${currentSem}\n\nChoose your semester below to receive previous exam questions and updates tailored for your semester:`,
                parse_mode: 'HTML',
                reply_markup: SEMESTER_SELECTION_KEYBOARD
            });
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }

        // Step G: /start command
        if (text === '/start') {
            if (isAdmin) {
                await callTelegram('sendMessage', {
                    chat_id: userId,
                    text: `👋 <b>Welcome Admin!</b>\n\nTap <b>👑 Admin Panel</b> below or type /admin anytime to manage previous questions & auto-sends:`,
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
                // If user didn't set their semester yet, ask immediately!
                if (!user || !user.semester) {
                    await callTelegram('sendMessage', {
                        chat_id: userId,
                        text:
                            `👋 <b>Welcome to IIUC CSE Resource Hub Bot!</b>\n\n` +
                            `🎓 <b>Which semester are you in?</b>\n` +
                            `Please select your semester below so we can automatically deliver relevant previous exam questions and question banks for your semester:`,
                        parse_mode: 'HTML',
                        reply_markup: SEMESTER_SELECTION_KEYBOARD
                    });
                } else {
                    await callTelegram('sendMessage', {
                        chat_id: userId,
                        text:
                            `👋 <b>Welcome back, ${user.first_name || 'Student'}!</b>\n\n` +
                            `🎓 Registered for: <b>${user.semester_name || user.semester + 'th Semester'}</b>\n\n` +
                            `Previous exam questions for your semester will be delivered to you here automatically.\n\n` +
                            `🌐 <b>Open Web App Portal:</b>\n🔗 https://cseresourceofiiuc.netlify.app`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 Change Semester', callback_data: 'select_semester', style: 'primary' }]
                            ]
                        }
                    });
                }
            }
            return { statusCode: 200, headers, body: '{"ok":true}' };
        }
    }

    return { statusCode: 200, headers, body: '{"ok":true}' };
};
