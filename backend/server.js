const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');

const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');

const os = require('os');

const app = express();

// Helper to get local IP
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    let preferredIp = '0.0.0.0';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Prioritize 192.168 (common WiFi) but skip VirtualBox (192.168.56.x)
                if (iface.address.startsWith('192.168') && !iface.address.startsWith('192.168.56.')) {
                    return iface.address;
                }
                preferredIp = iface.address;
            }
        }
    }
    return preferredIp;
}


// --- Configuration ---
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const PY_SCRIPT = path.join(__dirname, "..", "attendance.py");
const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";
const upload = multer({ dest: 'uploads/' });
const teacherPhotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed.'));
        }
        cb(null, true);
    }
});
function resolveAttendanceDbPath() {
    const configured = (process.env.ATTENDANCE_DB_PATH || '').trim();
    const candidates = configured
        ? [
            configured,
            path.join(__dirname, '..', 'attendance.db'),
            '/data/web_attendance.db',
        ]
        : [
            path.join(__dirname, '..', 'attendance.db'),
            '/data/web_attendance.db',
        ];

    for (const candidate of candidates) {
        if (fsSync.existsSync(candidate)) {
            return candidate;
        }
    }

    return configured || path.join(__dirname, '..', 'attendance.db');
}

const ATTENDANCE_DB_PATH = resolveAttendanceDbPath();
const TEACHER_PHOTO_DIR = path.join(__dirname, '..', 'frontend', 'public', 'teachers');
const TEACHER_PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const WEB_ACTIVITY_RETENTION = 600;
const ACTIVE_INTERACTION_WINDOW_MS = 15 * 60 * 1000;
const webActivityLog = [];

function ensureTeacherPhotoDir() {
    if (!fsSync.existsSync(TEACHER_PHOTO_DIR)) {
        fsSync.mkdirSync(TEACHER_PHOTO_DIR, { recursive: true });
    }
}

function getTeacherPhotoExtension(mimetype = '') {
    switch (String(mimetype).toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
        default:
            return null;
    }
}

async function removeTeacherPhotoFiles(teacherId) {
    ensureTeacherPhotoDir();
    const normalizedTeacherId = String(teacherId || '').trim();
    if (!normalizedTeacherId) return;

    const entries = await fs.readdir(TEACHER_PHOTO_DIR, { withFileTypes: true });
    await Promise.all(entries
        .filter((entry) => {
            if (!entry.isFile()) return false;
            const parsed = path.parse(entry.name);
            return parsed.name === normalizedTeacherId && TEACHER_PHOTO_EXTENSIONS.has(parsed.ext.toLowerCase());
        })
        .map((entry) => fs.unlink(path.join(TEACHER_PHOTO_DIR, entry.name)).catch(() => { })));
}

function getIstNow() {
    return new Date(Date.now() + (5.5 * 60 * 60 * 1000));
}

function getIstDateKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
}

function getIstTimestamp(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    return formatter.format(date).replace('T', ' ');
}

function getUserRoleLabel(user = {}) {
    if (user.role === 'admin') return 'Admin';
    if (user.role === 'Principal') return 'Principal';
    if (user.role === 'Vice Principal') return 'Vice Principal';
    if (user.role === 'Class Teacher') return 'Class Teacher';
    return 'Subject Teacher';
}

function getRequestActivityDescriptor(req) {
    const method = String(req.method || '').toUpperCase();
    const routePath = String(req.route?.path || req.path || '');

    if (routePath === '/daily-report' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed daily report', meta: req.query?.date || 'Today' };
    }
    if (routePath === '/weekly-report' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed weekly report', meta: 'Weekly overview' };
    }
    if (routePath === '/batch-report/:classId' && method === 'GET') {
        return { type: 'Reports', summary: `Viewed batch report for ${req.params?.classId || 'class'}`, meta: 'Batch report' };
    }
    if (routePath === '/student-history/:rollNo' && method === 'GET') {
        return { type: 'Reports', summary: `Viewed student history for roll ${req.params?.rollNo || '-'}`, meta: 'Student history' };
    }
    if (routePath === '/sick-leave-overview' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed sick and leave overview', meta: 'Health analytics' };
    }
    if (routePath === '/extra-classes-report' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed extra classes report', meta: req.query?.date || 'Today' };
    }
    if (routePath === '/full-timetable/:weekday' && method === 'GET') {
        return { type: 'Timetable', summary: 'Viewed full timetable', meta: `Weekday ${req.params?.weekday || '-'}` };
    }
    if (routePath === '/resolve-period' && method === 'GET') {
        return { type: 'Attendance', summary: 'Resolved timetable period', meta: `${req.query?.class || '-'} ${req.query?.period || '-'}` };
    }
    if (routePath === '/attendance/last' && method === 'GET') {
        return { type: 'Attendance', summary: 'Viewed last attendance', meta: 'Last recorded period' };
    }
    if (routePath === '/attendance/marked-periods' && method === 'GET') {
        return { type: 'Attendance', summary: 'Checked marked periods', meta: `${req.query?.class || '-'} ${req.query?.date || ''}`.trim() };
    }
    if (routePath === '/attendance/edit-last' && method === 'PUT') {
        return { type: 'Attendance', summary: 'Edited last attendance', meta: 'Manual correction' };
    }
    if (routePath === '/mark-attendance' && method === 'POST') {
        return { type: 'Attendance', summary: 'Submitted attendance', meta: `${req.body?.classId || req.body?.class || '-'} ${req.body?.period || '-'}` };
    }
    if (routePath === '/attendance/extra' && method === 'POST') {
        return { type: 'Extra Class', summary: 'Marked extra class attendance', meta: `${req.body?.classId || req.body?.class || '-'} ${req.body?.period || 'Extra'}` };
    }
    if (routePath === '/health/:type' && method === 'POST') {
        return { type: 'Health', summary: `Updated health status: ${req.params?.type || 'action'}`, meta: req.body?.classId || 'Class update' };
    }
    if (routePath === '/profile/me' && method === 'GET') {
        return { type: 'Profile', summary: 'Opened My Profile', meta: 'Profile view' };
    }
    if (routePath === '/profile/update-credentials' && method === 'POST') {
        return { type: 'Profile', summary: 'Updated login credentials', meta: 'Credentials changed' };
    }
    if (routePath === '/admin/teachers' && method === 'POST') {
        return { type: 'Admin', summary: 'Created teacher account', meta: req.body?.name || '' };
    }
    if (routePath === '/admin/teachers/:teacherId' && method === 'PUT') {
        return { type: 'Admin', summary: 'Updated teacher account', meta: req.body?.name || `Teacher ${req.params?.teacherId || ''}` };
    }
    if (routePath === '/admin/teachers/:teacherId' && method === 'DELETE') {
        return { type: 'Admin', summary: 'Deleted teacher account', meta: `Teacher ${req.params?.teacherId || ''}` };
    }
    if (routePath === '/admin/teachers/:teacherId/photo' && method === 'POST') {
        return { type: 'Admin', summary: 'Uploaded teacher photo', meta: `Teacher ${req.params?.teacherId || ''}` };
    }
    if (routePath === '/admin/teachers/:teacherId/photo' && method === 'DELETE') {
        return { type: 'Admin', summary: 'Removed teacher photo', meta: `Teacher ${req.params?.teacherId || ''}` };
    }
    if (routePath === '/admin/timetable/:weekday' && method === 'GET') {
        return { type: 'Admin', summary: 'Viewed timetable editor', meta: `Weekday ${req.params?.weekday || '-'}` };
    }
    if (routePath === '/admin/timetable/period' && method === 'PUT') {
        return { type: 'Admin', summary: 'Updated timetable period', meta: `${req.body?.classId || '-'} ${req.body?.period || '-'}` };
    }
    if (routePath === '/admin/revoke-session' && method === 'POST') {
        return { type: 'Admin', summary: 'Revoked teacher session', meta: `Teacher ${req.body?.teacherId || ''}` };
    }
    if (routePath === '/admin/update-password' && method === 'POST') {
        return { type: 'Security', summary: 'Updated admin password', meta: 'Security change' };
    }
    if (routePath === '/admin/upload-db' && method === 'POST') {
        return { type: 'Database', summary: 'Uploaded replacement database', meta: 'Database import' };
    }
    if (routePath === '/admin/download-db' && method === 'GET') {
        return { type: 'Database', summary: 'Downloaded database export', meta: 'Database export' };
    }
    return null;
}

function recordWebActivity(user, req) {
    const descriptor = getRequestActivityDescriptor(req);
    if (!descriptor) return;

    const now = new Date();
    appendWebActivityEvent({
        id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: getIstTimestamp(now),
        date: getIstDateKey(now),
        epochMs: now.getTime(),
        actor: user.name || 'Unknown User',
        username: user.username || '',
        role: getUserRoleLabel(user),
        type: descriptor.type,
        summary: descriptor.summary,
        meta: descriptor.meta || '',
    });
}

function appendWebActivityEvent(event) {
    webActivityLog.push(event);
    if (webActivityLog.length > WEB_ACTIVITY_RETENTION) {
        webActivityLog.splice(0, webActivityLog.length - WEB_ACTIVITY_RETENTION);
    }
}

function buildAdminActivitySnapshot(reportDate, baseData = {}) {
    const activeUsers = Array.isArray(baseData.activeUsers) ? baseData.activeUsers : [];
    const dbActions = Array.isArray(baseData.actions) ? baseData.actions : [];
    const dayWebActions = webActivityLog
        .filter((event) => event.date === reportDate)
        .map((event) => ({
            timestamp: event.timestamp,
            time: event.timestamp.split(' ')[1] || event.timestamp,
            actor: event.actor,
            username: event.username,
            role: event.role,
            type: event.type,
            summary: event.summary,
            meta: event.meta,
            source: 'Web',
        }));

    const mergedActions = [
        ...dbActions.map((action) => ({ ...action, source: 'Database' })),
        ...dayWebActions,
    ].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    const recentThreshold = Date.now() - ACTIVE_INTERACTION_WINDOW_MS;
    const recentUsersMap = new Map();
    for (const event of webActivityLog) {
        if (event.epochMs < recentThreshold) continue;
        const key = event.username || event.actor;
        if (!key) continue;
        const existing = recentUsersMap.get(key);
        if (!existing || existing.epochMs < event.epochMs) {
            recentUsersMap.set(key, event);
        }
    }

    const liveUsers = Array.from(recentUsersMap.values())
        .sort((a, b) => b.epochMs - a.epochMs)
        .map((event) => ({
            name: event.actor,
            username: event.username,
            role: event.role,
            lastAction: event.summary,
            lastSeen: event.timestamp,
        }));

    const uniqueActors = new Set();
    for (const action of mergedActions) {
        uniqueActors.add(action.username || action.actor || action.summary);
    }

    const featureUsageMap = new Map();
    for (const action of dayWebActions) {
        const entry = featureUsageMap.get(action.type) || { type: action.type, count: 0, users: new Set() };
        entry.count += 1;
        entry.users.add(action.username || action.actor);
        featureUsageMap.set(action.type, entry);
    }

    return {
        activeUsers,
        liveUsers,
        actions: mergedActions.slice(0, 120),
        summary: {
            activeSessions: activeUsers.length,
            currentlyInteracting: liveUsers.length,
            periodsTakenToday: dbActions.filter((action) => action.type === 'Attendance').length,
            reportViewsToday: dayWebActions.filter((action) => action.type === 'Reports').length,
            featureActionsToday: dayWebActions.length,
            adminActionsToday: dayWebActions.filter((action) => ['Admin', 'Database', 'Security'].includes(action.type)).length,
            uniqueActorsToday: uniqueActors.size,
        },
        featureUsage: Array.from(featureUsageMap.values())
            .map((entry) => ({
                type: entry.type,
                count: entry.count,
                users: entry.users.size,
            }))
            .sort((a, b) => b.count - a.count),
    };
}

// Ensure uploads directory exists
if (!fsSync.existsSync('uploads/')) {
    fsSync.mkdirSync('uploads/', { recursive: true });
}
ensureTeacherPhotoDir();

// ── Feature 3: Edited Attendance system now uses DB state directly ──

// --- Middleware ---
app.use(cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

// Console Middleware for Debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// --- Auth Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token.' });

        // --- SINGLE ACTIVE SESSION CHECK ---
        // Skip for system admin (they don't have a DB record)
        if (user.id !== 'system-admin' && user.role !== 'admin') {
            try {
                // Verify session with Python helper
                const result = await callPython({
                    action: "verify_session",
                    teacher_id: user.id,
                    sessionId: user.sessionId
                });

                if (!result.success) {
                    console.warn(`[Auth] Session invalidated for ${user.name} (ID: ${user.id})`);
                    return res.status(401).json({ message: 'Session expired or logged in from another device.' });
                }
            } catch (error) {
                console.error('[Auth] Session verification error:', error.message);
                // Fail-safe: allow if script fails but log it
            }
        }

        req.user = user;
        res.on('finish', () => {
            if (res.statusCode < 400) {
                recordWebActivity(user, req);
            }
        });
        next();
    });
};

/**
 * Bridge function to call attendance.py
 */
function callPython(data) {
    return new Promise((resolve, reject) => {
        let settled = false;
        console.log(`[API -> Python] Action: ${data.action}`);

        const py = spawn(PYTHON_CMD, [PY_SCRIPT], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, PYTHONIOENCODING: "utf-8" }
        });

        // 10s Timeout Protection
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                py.kill();
                console.error(`[Python Timeout] Action ${data.action} timed out after 10s`);
                reject(new Error("Python script execution timed out"));
            }
        }, 10000);

        let output = "";
        let errorOutput = "";

        py.stdout.on("data", (chunk) => { output += chunk.toString(); });
        py.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });

        py.on("error", (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                console.error(`[Python Spawn Error]:`, err);
                reject(err);
            }
        });

        py.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            if (code !== 0) {
                console.error(`[Python Exit ${code}] Error: ${errorOutput}`);
                return reject(new Error(errorOutput || `Python script failed with code ${code}`));
            }

            try {
                const trimmedOutput = output.trim();
                // Ensure we handle both single-line and multi-line output with debug prints
                // Regex looks for the last JSON object starting with {"success":
                const jsonPattern = /\{"success":\s*(true|false),[\s\S]*\}/g;
                const matches = trimmedOutput.match(jsonPattern);
                
                let jsonStr;
                if (matches && matches.length > 0) {
                    // Take the last complete JSON object found
                    jsonStr = matches[matches.length - 1];
                } else {
                    // Fallback to the last line logic
                    const lines = trimmedOutput.split('\n');
                    jsonStr = lines[lines.length - 1];
                }

                const result = JSON.parse(jsonStr);
                resolve(result);
            } catch (e) {
                console.error(`[Parse Error] Full Output: "${output}"`);
                console.error(`[Parse Error] Error detail:`, e.message);
                reject(new Error("Failed to parse Python JSON output. Check server logs for details."));
            }
        });

        py.stdin.on("error", (err) => {
            console.error(`[Stdin Error]:`, err);
        });

        py.stdin.write(JSON.stringify(data));
        py.stdin.end();
    });
}

// --- Health Check ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// --- Auth Routes ---
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // ── SYSTEM ADMIN CHECK (Railway Env Vars & DB) ──
        const sysAdminUser = process.env.WEB_ADMIN_USERNAME || "admin";
        let sysAdminPass = process.env.WEB_ADMIN_PASSWORD;

        // Check if there is a password set in the database
        try {
            const configResult = await callPython({ action: "get_admin_config" });
            if (configResult.success && configResult.admin_password) {
                sysAdminPass = configResult.admin_password;
            }
        } catch (dbErr) {
            console.error('[Login] Failed to fetch admin config from DB:', dbErr.message);
        }

        if (sysAdminPass && username.toLowerCase() === sysAdminUser.toLowerCase() && password === sysAdminPass) {
            const adminUser = {
                id: "system-admin",
                name: "System Administrator",
                username: sysAdminUser,
                role: "admin",
                sessionId: require('crypto').randomBytes(16).toString('hex')
            };
            const token = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '7d' });
            appendWebActivityEvent({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: getIstTimestamp(new Date()),
                date: getIstDateKey(new Date()),
                epochMs: Date.now(),
                actor: adminUser.name,
                username: adminUser.username,
                role: 'Admin',
                type: 'Login',
                summary: 'Logged into the admin console',
                meta: 'System administrator login',
            });
            console.log(`[Login] System Admin Access Granted`);
            return res.json({ success: true, user: adminUser, token });
        }

        // ── Normal Teacher Login ──
        console.log(`[Login Attempt] User: ${username}`);
        const result = await callPython({ action: "login", username, password });

        if (result.success) {
            const token = jwt.sign(result.user, JWT_SECRET, { expiresIn: '7d' });
            appendWebActivityEvent({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: getIstTimestamp(new Date()),
                date: getIstDateKey(new Date()),
                epochMs: Date.now(),
                actor: result.user?.name || username,
                username: result.user?.username || username,
                role: getUserRoleLabel(result.user || {}),
                type: 'Login',
                summary: 'Logged into the web app',
                meta: 'Successful login',
            });
            res.json({ ...result, token });
        } else {
            res.status(401).json(result);
        }
    } catch (error) {
        console.error(`[Login Error]:`, error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/validate-token', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// --- Data Routes ---
app.get('/classes', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_classes" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/subjects', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_subjects" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/students', authenticateToken, async (req, res) => {
    try {
        const { classId, subjectId, date } = req.query;
        const result = await callPython({ action: "get_students", classId, subjectId, date });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/timetable/:class', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_timetable", class: req.params.class });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/resolve-period', authenticateToken, async (req, res) => {
    try {
        const { class: cls, period, date } = req.query;
        const result = await callPython({ action: "resolve_period", class: cls, period, date });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/full-timetable/:weekday', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_full_timetable", weekday: parseInt(req.params.weekday) });
        res.json(result);
    } catch (error) {
        console.error(`[Route Error] /full-timetable:`, error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/student-history/:rollNo', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_student_history", rollNo: req.params.rollNo });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/period-summary', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_period_summary",
            class: req.query.class,
            period: req.query.period,
            date: req.query.date
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/daily-report', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_daily_report", date: req.query.date });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/batch-report/:classId', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_batch_report", classId: req.params.classId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/weekly-report', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_weekly_report" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/sick-leave-overview', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_sick_leave_overview" });
        recordWebActivity(req.user, req);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/extra-classes-report', authenticateToken, async (req, res) => {
    try {
        const { date, teacherId, classId } = req.query;
        const result = await callPython({ action: 'get_extra_classes_report', date, teacherId, classId });
        recordWebActivity(req.user, req);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Profile and Teacher list
app.get('/profile/me', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_teacher_profile", teacher_id: req.user.id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/teachers', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_teachers_list", teacher_id: req.user.id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/profile/update-credentials', authenticateToken, async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await callPython({
            action: "update_credentials",
            teacher_id: req.user.id,
            username,
            password
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/mark-attendance', authenticateToken, async (req, res) => {
    try {
        const teacher_id = req.user.id || 1;
        const result = await callPython({
            action: "mark_attendance",
            ...req.body,
            teacher_id
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/attendance/marked-periods', authenticateToken, async (req, res) => {
    try {
        const { class: classId, date } = req.query;
        const teacher_id = req.user.id || 1;

        // Use local date instead of UTC to match Python's dt.now()
        const localDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        const result = await callPython({
            action: "get_marked_periods",
            class: classId,
            date: date || localDate,
            teacher_id
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /attendance/last  — returns the last marked attendance for the logged-in teacher
app.get('/attendance/last', authenticateToken, async (req, res) => {
    try {
        const teacher_id = req.user.id || 1;
        const result = await callPython({ action: "get_last_attendance", teacher_id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /attendance/edit-last  — edit the last marked attendance
app.put('/attendance/edit-last', authenticateToken, async (req, res) => {
    try {
        const teacher_id = req.user.id || 1;
        const { classId, period, date, records } = req.body;

        if (!classId || !period || !date) {
            return res.status(400).json({ success: false, error: 'Missing classId, period or date. Cannot edit.' });
        }

        const result = await callPython({
            action: "edit_last_attendance",
            classId,
            period,
            date,
            teacher_id: Number(teacher_id),
            records: records,
        });

        if (!result.success && result.error?.includes("Unauthorized")) {
            return res.status(403).json(result);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// GET /health/sick-list and GET /health/leave-list
app.get('/health/:listType(sick-list|leave-list)', authenticateToken, async (req, res) => {
    try {
        const { listType } = req.params;
        const statusMap = { 'sick-list': 'S', 'leave-list': 'L' };
        const targetStatus = statusMap[listType];

        const user_role = req.user.role || 'Subject Teacher';
        const assigned_class = req.user.class_teacher_of;
        const isPrincipal = user_role === 'Principal' || user_role === 'Vice Principal';

        if (!isPrincipal && user_role !== 'Class Teacher') {
            return res.status(403).json({ success: false, error: 'Unauthorized: Only Class Teachers and Admin can view health lists.' });
        }

        const result = await callPython({ action: "get_health_list", status: targetStatus });

        // Remove the Class Teacher filter to allow whole campus view
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// POST /health/:type — mark sick, leave, cure, return
app.post('/health/:type', authenticateToken, async (req, res) => {
    const { type } = req.params;
    const { rollNos, classId } = req.body; // Added classId for verification
    const teacher_id = String(req.user.id || 1);
    const user_role = req.user.role || 'Subject Teacher';
    const assigned_class = req.user.class_teacher_of;

    console.log(`[Health Action Request] User: ${req.user.name}, Role: ${user_role}, Action: ${type}, Class: ${classId}`);

    // Permission Check: Class Teacher restriction
    const isPrincipal = user_role === 'Principal' || user_role === 'Vice Principal';
    if (!isPrincipal && user_role === 'Class Teacher') {
        if (assigned_class && classId && String(assigned_class) !== String(classId)) {
            console.warn(`[Permission Denied] Class Teacher ${req.user.name} tried to modify class ${classId} (Assigned: ${assigned_class})`);
            return res.status(403).json({
                success: false,
                error: `Unauthorized: As a Class Teacher, you can only manage students for class ${assigned_class}.`
            });
        }
    }

    if (!['sick', 'leave', 'cure', 'return'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Invalid health action type.' });
    }

    if (!rollNos || !Array.isArray(rollNos) || rollNos.length === 0) {
        return res.status(400).json({ success: false, error: 'No students selected.' });
    }

    try {
        const rollStr = rollNos.join(' ');
        const result = await callPython({
            action: "health_action",
            type,
            roll_no: rollStr,
            teacher_id: Number(teacher_id)
        });

        console.log(`[Health Action Result] Success: ${result.success}, Reply: ${result.reply?.substring(0, 50)}...`);

        if (!result.success) {
            // Return specific error from Python instead of generic message
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error(`[Health Action Error]`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Extra Class Subjects (used for manual subject selection)
app.get('/extra-subjects', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_extra_subjects" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mark Extra Class Attendance
app.post('/attendance/extra', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "mark_extra_attendance",
            ...req.body,
            teacher_id: req.user.id || 1
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Route: Upload and replace Database
app.post('/admin/upload-db', authenticateToken, upload.single('file'), async (req, res) => {
    console.log(`[Admin Upload] Route start: ${new Date().toISOString()}`);
    try {
        // Access Control: Admin only
        if (req.user.role !== 'admin') {
            console.warn('[Admin Upload] Permission Denied: Not an admin');
            if (req.file) {
                console.log('[Admin Upload] Unlinking file after permission denied');
                await fs.unlink(req.file.path).catch(() => { });
            }
            return res.status(403).json({ success: false, message: 'Access denied. Only System Admins can upload database.' });
        }

        console.log('[Admin Upload] Auth check passed');
        console.log('[Admin Upload] After file upload middleware. req.file:', req.file ? {
            path: req.file.path,
            originalname: req.file.originalname,
            size: req.file.size
        } : 'undefined');

        if (!req.file) {
            console.warn('[Admin Upload] Error: No file uploaded');
            return res.status(400).json({ success: false, message: 'No file uploaded.' });
        }

        if (!req.file.originalname.endsWith('.db')) {
            console.warn('[Admin Upload] Error: Invalid file type');
            await fs.unlink(req.file.path).catch(() => { });
            return res.status(400).json({ success: false, message: 'Invalid file type. Only .db files are allowed.' });
        }

        // Ensure target directory exists
        const targetDir = path.dirname(ATTENDANCE_DB_PATH);
        console.log(`[Admin Upload] Target directory: ${targetDir}`);
        try {
            const fsSync = require('fs');
            if (!fsSync.existsSync(targetDir)) {
                console.log(`[Admin Upload] Creating target directory...`);
                fsSync.mkdirSync(targetDir, { recursive: true });
            }
        } catch (dirErr) {
            console.error('[Admin Upload] Dir creation warning:', dirErr.message);
        }

        console.log('[Admin Upload] Before writing DB (performing atomic replacement)...');
        // Atomic replacement (move temp file to target path)
        try {
            await fs.rename(req.file.path, ATTENDANCE_DB_PATH);
        } catch (renameErr) {
            console.warn('[Admin Upload] Rename failed, probable cross-device mount. Falling back to copy-then-unlink.', renameErr.message);
            // Fallback for EXDEV or other move issues
            await fs.copyFile(req.file.path, ATTENDANCE_DB_PATH);
            await fs.unlink(req.file.path).catch(() => { });
        }

        console.log('[Admin Upload] After writing DB (replacement successful)');
        console.log(`[Admin Upload] Success: Database uploaded and replaced by ${req.user.name}`);

        // No Python call needed here as DB is now in place for future Python worker calls
        console.log('[Admin Upload] Before sending response');
        return res.json({ success: true, message: 'Database updated successfully' });

    } catch (error) {
        console.error(`[Admin Upload Error]:`, error);
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
                console.log('[Admin Upload] Cleaned up temp file after error');
            } catch (unlinkErr) { /* ignore cleanup errors */ }
        }
        // Always ensure a response is sent
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: error.message || 'Internal server error during DB upload' });
        }
    }
});

// Admin Route: Download Database
app.get('/admin/download-db', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const fsSync = require('fs');
        if (!fsSync.existsSync(ATTENDANCE_DB_PATH)) {
            return res.status(404).json({ success: false, message: 'Database file not found.' });
        }

        res.download(ATTENDANCE_DB_PATH, 'attendance_export.db');
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Route: Get All Sessions
app.get('/admin/batch-report/:classId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'Principal' && req.user.role !== 'Vice Principal') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_batch_report", classId: req.params.classId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/absentees-report', authenticateToken, async (req, res) => {
    try {
        const { classId, date, filter } = req.body;
        const result = await callPython({ action: "get_absentees_report", classId, date, filter });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/admin/absentees-report', authenticateToken, async (req, res) => {
    try {
        const { classId, date, filter } = req.body;
        const result = await callPython({ action: "get_absentees_report", classId, date, filter });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/activity-log', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const reportDate = String(req.query.date || getIstDateKey(new Date())).trim();
        const result = await callPython({ action: "get_admin_activity_log", date: reportDate });
        const snapshot = buildAdminActivitySnapshot(reportDate, result?.data || {});
        res.json({ success: true, ...snapshot });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/teachers', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_admin_teachers" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/admin/teachers', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { name, username, password } = req.body;
        const result = await callPython({ action: "create_teacher", name, username, password });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/admin/teachers/:teacherId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { name, username, password } = req.body;
        const result = await callPython({
            action: "update_teacher",
            teacherId: req.params.teacherId,
            name,
            username,
            password
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/admin/teachers/:teacherId/photo', authenticateToken, teacherPhotoUpload.single('file'), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

        const teacherId = String(req.params.teacherId || '').trim();
        if (!teacherId) {
            return res.status(400).json({ success: false, message: 'Teacher ID is required.' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file uploaded.' });
        }

        const extension = getTeacherPhotoExtension(req.file.mimetype);
        if (!extension) {
            return res.status(400).json({ success: false, message: 'Unsupported image type. Use JPG, PNG or WEBP.' });
        }

        await removeTeacherPhotoFiles(teacherId);

        const filename = `${teacherId}${extension}`;
        const targetPath = path.join(TEACHER_PHOTO_DIR, filename);
        await fs.writeFile(targetPath, req.file.buffer);

        const version = Date.now();
        return res.json({
            success: true,
            message: 'Teacher photo uploaded successfully.',
            imageUrl: `/teachers/${filename}?v=${version}`
        });
    } catch (error) {
        console.error('[Teacher Photo Upload Error]:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to upload teacher photo.' });
    }
});

app.delete('/admin/teachers/:teacherId/photo', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

        const teacherId = String(req.params.teacherId || '').trim();
        if (!teacherId) {
            return res.status(400).json({ success: false, message: 'Teacher ID is required.' });
        }

        await removeTeacherPhotoFiles(teacherId);
        return res.json({ success: true, message: 'Teacher photo removed successfully.' });
    } catch (error) {
        console.error('[Teacher Photo Delete Error]:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to remove teacher photo.' });
    }
});

app.delete('/admin/teachers/:teacherId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "delete_teacher", teacherId: req.params.teacherId });
        if (result?.success) {
            await removeTeacherPhotoFiles(req.params.teacherId);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/timetable/:weekday', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_admin_timetable", weekday: parseInt(req.params.weekday, 10) });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/teacher-subjects/:teacherId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_teacher_subject_options", teacherId: req.params.teacherId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/admin/timetable/period', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { classId, weekday, period, teacherId, subject } = req.body;
        const result = await callPython({
            action: "update_timetable_period",
            classId,
            weekday,
            period,
            teacherId,
            subject
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Route: Get All Sessions
app.get('/admin/sessions', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_admin_sessions" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Route: Revoke Session
app.post('/admin/revoke-session', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { teacherId } = req.body;
        const result = await callPython({ action: "revoke_session", teacher_id: teacherId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Route: System Info
app.get('/admin/system-info', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_system_info" });

        // Add server uptime
        if (result.success) {
            const uptimeSeconds = Math.floor(process.uptime());
            result.data.serverUptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/admin/update-password', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Access denied.' });
        const { password } = req.body;
        if (!password) return res.status(400).json({ success: false, message: 'Password is required' });

        const result = await callPython({ action: "update_admin_password", password });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// --- Server Startup ---
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
