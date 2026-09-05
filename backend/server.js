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
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

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
const NAMAZ_API_KEY = (process.env.NAMAZ_API_KEY || process.env.API_KEY || '').trim();
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
const TEACHER_PHOTO_DIR = process.env.TEACHER_PHOTO_DIR || path.join(path.dirname(ATTENDANCE_DB_PATH), 'teachers');
const TEACHER_PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const WEB_ACTIVITY_RETENTION = 600;
const ACTIVE_INTERACTION_WINDOW_MS = 15 * 1000;
const webActivityLog = [];

// ── WebAuthn Configuration ──
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'MARKHINS HUB';
const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const WEBAUTHN_ORIGIN = process.env.WEBAUTHN_ORIGIN || (WEBAUTHN_RP_ID === 'localhost' ? 'http://localhost:3000' : `https://${WEBAUTHN_RP_ID}`);
const WEBAUTHN_CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// In-memory challenge store (single-instance safe)
const challengeStore = new Map();

function storeChallenge(key, challenge) {
    challengeStore.set(key, { challenge, createdAt: Date.now() });
}

function getAndDeleteChallenge(key) {
    const entry = challengeStore.get(key);
    challengeStore.delete(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > WEBAUTHN_CHALLENGE_EXPIRY_MS) return null;
    return entry.challenge;
}

// Periodically clean expired challenges
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of challengeStore) {
        if (now - entry.createdAt > WEBAUTHN_CHALLENGE_EXPIRY_MS) {
            challengeStore.delete(key);
        }
    }
}, 60000);

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
    if (user.role === 'Majlis') return 'Majlis';
    if (user.role === 'Principal') return 'Principal';
    if (user.role === 'Vice Principal') return 'Vice Principal';
    if (user.role === 'Urdu Principal') return 'Urdu Principal';
    if (user.role === 'Class Teacher') return 'Class Teacher';
    return 'Subject Teacher';
}

function isUrduClass(classId) {
    return String(classId || '').toLowerCase().includes('u');
}

function isUrduPrincipal(user = {}) {
    return String(user.name || '').trim().toUpperCase() === 'MAHROOF QADIRI'
        || user.role === 'Urdu Principal';
}

function isTimetableEditor(user, editors) {
    return user.role === 'admin' || editors.includes(String(user.id)) || editors.includes(String(user.username));
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
    if (routePath === '/class-averages' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed class averages', meta: 'Performance overview' };
    }
    if (routePath === '/period-summary' && method === 'GET') {
        return { type: 'Reports', summary: `Viewed period summary for ${req.query?.class || '-'} ${req.query?.period || ''}`, meta: req.query?.date || 'Today' };
    }
    if (routePath === '/teacher-register-report' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed teacher register report', meta: `${req.query?.fromDate || ''} to ${req.query?.toDate || ''}` };
    }
    if (routePath === '/event-attendance' && method === 'GET') {
        return { type: 'Reports', summary: 'Viewed event attendance', meta: 'Event analytics' };
    }
    if (routePath === '/full-timetable/:weekday' && method === 'GET') {
        return { type: 'Timetable', summary: 'Viewed full timetable', meta: `Weekday ${req.params?.weekday || '-'}` };
    }
    if (routePath === '/timetable/:class' && method === 'GET') {
        return { type: 'Timetable', summary: `Viewed timetable for ${req.params?.class || '-'}`, meta: 'Class schedule' };
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
        return { type: 'AttendanceEdit', summary: 'Edited last attendance', meta: 'Manual correction' };
    }
    if (routePath === '/attendance/delete-last' && method === 'POST') {
        return { type: 'AttendanceDelete', summary: 'Deleted last attendance record', meta: 'Undo attendance' };
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
    if (routePath === '/health/:listType(sick-list|leave-list)' && method === 'GET') {
        return { type: 'Health', summary: `Viewed ${req.params?.listType === 'sick-list' ? 'sick list' : 'leave list'}`, meta: 'Health overview' };
    }
    if (routePath === '/profile/me' && method === 'GET') {
        return { type: 'Profile', summary: 'Opened My Profile', meta: 'Profile view' };
    }
    if (routePath === '/profile/teaching-stats' && method === 'GET') {
        return { type: 'Profile', summary: 'Viewed teaching stats', meta: 'Performance data' };
    }
    if (routePath === '/profile/update-credentials' && method === 'POST') {
        return { type: 'Profile', summary: 'Updated login credentials', meta: 'Credentials changed' };
    }
    if (routePath === '/api/syllabus' && method === 'GET') {
        return { type: 'Syllabus', summary: 'Viewed syllabus topics', meta: req.query?.classId || 'All classes' };
    }
    if (routePath === '/api/syllabus/config' && method === 'POST') {
        return { type: 'Syllabus', summary: 'Saved syllabus config', meta: req.body?.className || 'Config update' };
    }
    if (routePath === '/api/syllabus/progress' && method === 'POST') {
        return { type: 'Syllabus', summary: 'Updated syllabus progress', meta: req.body?.className || 'Progress update' };
    }
    if (routePath === '/api/syllabus/config/:id' && method === 'DELETE') {
        return { type: 'Syllabus', summary: 'Deleted syllabus config', meta: `Config ${req.params?.id || ''}` };
    }
    if (routePath === '/api/permissions' && method === 'GET') {
        return { type: 'Permission', summary: 'Viewed permissions', meta: req.query?.view || 'History' };
    }
    if (routePath === '/api/permissions' && method === 'POST') {
        return { type: 'Permission', summary: 'Created permission request', meta: req.body?.permission_type || 'Permission' };
    }
    if (routePath === '/api/permissions/:id/approve' && method === 'POST') {
        return { type: 'Permission', summary: 'Approved permission request', meta: `Permission ${req.params?.id || ''}` };
    }
    if (routePath === '/api/permissions/:id/reject' && method === 'DELETE') {
        return { type: 'Permission', summary: 'Rejected permission request', meta: `Permission ${req.params?.id || ''}` };
    }
    if (routePath === '/api/permissions/:id/return/teacher' && method === 'POST') {
        return { type: 'Permission', summary: 'Submitted leave card return', meta: `Permission ${req.params?.id || ''}` };
    }
    if (routePath === '/api/permissions/:id/return/principal' && method === 'POST') {
        return { type: 'Permission', summary: 'Closed leave card return', meta: `Permission ${req.params?.id || ''}` };
    }
    if (routePath === '/extra-subjects' && method === 'GET') {
        return { type: 'Extra Class', summary: 'Viewed extra class subjects', meta: req.query?.classId || 'All' };
    }
    if (routePath === '/announcements/:announcementKey/dismiss' && method === 'POST') {
        return { type: 'Profile', summary: 'Dismissed announcement', meta: req.params?.announcementKey || '' };
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
    if (routePath === '/admin/announcements' && method === 'POST') {
        return { type: 'Admin', summary: 'Created announcement', meta: req.body?.heading || '' };
    }
    if (routePath === '/admin/announcements/:announcementId' && method === 'PUT') {
        return { type: 'Admin', summary: 'Updated announcement', meta: `Announcement ${req.params?.announcementId || ''}` };
    }
    if (routePath === '/admin/announcements/:announcementId' && method === 'DELETE') {
        return { type: 'Admin', summary: 'Deleted announcement', meta: `Announcement ${req.params?.announcementId || ''}` };
    }
    if (routePath === '/admin/reset-namaz-data' && method === 'POST') {
        return { type: 'Admin', summary: 'Reset namaz data', meta: 'Namaz reset' };
    }
    if (routePath === '/absentees-report' && method === 'POST') {
        return { type: 'Reports', summary: 'Generated absentees report', meta: req.body?.classId || 'All classes' };
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
    const isNonAdmin = (event) => {
        const role = String(event.role || '').toLowerCase();
        const name = String(event.actor || event.name || '').trim().toLowerCase();
        return role !== 'admin' && name !== 'system administrator';
    };

    const activeUsers = (Array.isArray(baseData.activeUsers) ? baseData.activeUsers : [])
        .filter(isNonAdmin);
    const dbActions = Array.isArray(baseData.actions) ? baseData.actions : [];
    const dayWebActions = webActivityLog
        .filter((event) => (
            event.date === reportDate
            && isNonAdmin(event)
            && event.summary !== 'Active in app'
            && !/^Viewed\b/i.test(String(event.summary || ''))
        ))
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

    const ADMIN_ACTION_TYPES = new Set(['Admin', 'Database', 'Security', 'Login']);

    const mergedActions = [
        ...dbActions.map((action) => ({ ...action, source: 'Database' })),
        ...dayWebActions,
    ].filter((action) => !ADMIN_ACTION_TYPES.has(action.type) && isNonAdmin(action))
     .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    const recentThreshold = Date.now() - ACTIVE_INTERACTION_WINDOW_MS;
    const recentUsersMap = new Map();
    for (const event of webActivityLog) {
        if (event.epochMs < recentThreshold) continue;
        if (!isNonAdmin(event)) continue;
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
app.use('/teachers', express.static(TEACHER_PHOTO_DIR));

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
        // Skip for system admin and majlis (they don't have a DB record)
        if (user.id !== 'system-admin' && user.role !== 'admin' && user.id !== 'majlis-user') {
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

        // ── MAJLIS LOGIN (reports-only access) ──
        if (username === 'majlis' && password === 'admin') {
            const majlisUser = {
                id: "majlis-user",
                name: "Majlis",
                username: "majlis",
                role: "Majlis",
                sessionId: require('crypto').randomBytes(16).toString('hex')
            };
            const token = jwt.sign(majlisUser, JWT_SECRET, { expiresIn: '7d' });
            appendWebActivityEvent({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: getIstTimestamp(new Date()),
                date: getIstDateKey(new Date()),
                epochMs: Date.now(),
                actor: majlisUser.name,
                username: majlisUser.username,
                role: 'Majlis',
                type: 'Login',
                summary: 'Logged into the admin console',
                meta: 'Majlis reports-only access',
            });
            console.log(`[Login] Majlis Access Granted`);
            return res.json({ success: true, user: majlisUser, token });
        }

                // ── SYSTEM ADMIN CHECK (Railway Env Vars & DB) ──
        const sysAdminUser = process.env.WEB_ADMIN_USERNAME || "admin";
        let sysAdminPass = process.env.WEB_ADMIN_PASSWORD || "admin";

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

app.get('/validate-token', authenticateToken, async (req, res) => {
    try {
        let user = req.user;
        if (user && user.id && user.role !== 'admin' && user.role !== 'Majlis') {
            const dbCheck = await callPython({ action: "get_teacher_by_id", teacher_id: user.id });
            if (dbCheck && dbCheck.success && dbCheck.teacher) {
                user = { ...user, is_teacher: dbCheck.teacher.is_teacher };
            }
        }
        res.json({ success: true, user });
    } catch (e) {
        res.json({ success: true, user: req.user });
    }
});

// ── Create Auth Token Helper ──
// Reusable JWT creation matching the existing login format
function createAuthToken(user) {
    return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

// ── WebAuthn Endpoints ──

// POST /webauthn/register/options — Get registration options (authenticated)
app.post('/webauthn/register/options', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { deviceName } = req.body || {};

        // Get existing credentials to exclude
        const existingResult = await callPython({
            action: "get_webauthn_credentials",
            teacher_id: user.id
        });
        const existingCredentials = (existingResult.success ? existingResult.data : []).map(cred => ({
            id: cred.credential_id,
            transports: (cred.transports || 'internal').split(','),
        }));

        const options = await generateRegistrationOptions({
            rpName: WEBAUTHN_RP_NAME,
            rpID: WEBAUTHN_RP_ID,
            userName: String(user.username),
            userID: new TextEncoder().encode(String(user.id)),
            userDisplayName: String(user.name || user.username),
            excludeCredentials: existingCredentials,
            authenticatorSelection: {
                residentKey: 'required',
                userVerification: 'required',
            },
        });

        // Store challenge keyed by username (for login) and user id (for registration)
        storeChallenge(`reg:${user.id}`, options.challenge);

        res.json({ success: true, options, deviceName: deviceName || '' });
    } catch (error) {
        console.error('[WebAuthn Register Options Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /webauthn/register/verify — Verify registration (authenticated)
app.post('/webauthn/register/verify', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { credential, deviceName } = req.body;

        const expectedChallenge = getAndDeleteChallenge(`reg:${user.id}`);
        if (!expectedChallenge) {
            return res.status(400).json({ success: false, error: 'Challenge expired or not found. Please try again.' });
        }

        const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: WEBAUTHN_ORIGIN,
            expectedRPID: WEBAUTHN_RP_ID,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ success: false, error: 'Registration verification failed' });
        }

        const { credential: regCredential } = verification.registrationInfo;

        // Store credential in database
        const storeResult = await callPython({
            action: "register_webauthn_credential",
            teacher_id: user.id,
            credential_id: regCredential.id,
            public_key: JSON.stringify(Array.from(regCredential.publicKey)),
            counter: regCredential.counter,
            device_name: deviceName || '',
            transports: (credential.response?.transports || ['internal']).join(','),
            created_at: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
        });

        if (!storeResult.success) {
            return res.status(400).json({ success: false, error: storeResult.error || 'Failed to store credential' });
        }

        res.json({ success: true, message: 'Passkey registered successfully' });
    } catch (error) {
        console.error('[WebAuthn Register Verify Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /webauthn/credentials — List user's registered passkeys (authenticated)
app.get('/webauthn/credentials', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_webauthn_credentials",
            teacher_id: req.user.id
        });
        res.json(result);
    } catch (error) {
        console.error('[WebAuthn Credentials Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /webauthn/credentials/:id — Remove a passkey (authenticated, own only)
app.delete('/webauthn/credentials/:id', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "delete_webauthn_credential",
            credential_id: req.params.id,
            teacher_id: req.user.id
        });
        res.json(result);
    } catch (error) {
        console.error('[WebAuthn Delete Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /webauthn/login/options — Get authentication options (unauthenticated, usernameless)
app.post('/webauthn/login/options', async (req, res) => {
    try {
        // Discoverable credentials: no allowCredentials, no username required.
        // The browser/OS will present the user's saved passkeys and they choose one.
        const options = await generateAuthenticationOptions({
            rpID: WEBAUTHN_RP_ID,
            timeout: 60000,
            allowCredentials: [],
            userVerification: 'required',
        });

        // Store challenge keyed by a session token for this login attempt
        const loginSessionId = require('crypto').randomBytes(16).toString('hex');
        storeChallenge(`login:${loginSessionId}`, options.challenge);

        res.json({ success: true, options, loginSessionId });
    } catch (error) {
        console.error('[WebAuthn Login Options Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /webauthn/login/verify — Verify authentication (unauthenticated)
app.post('/webauthn/login/verify', async (req, res) => {
    try {
        const { credential, loginSessionId } = req.body;

        const expectedChallenge = getAndDeleteChallenge(`login:${loginSessionId}`);
        if (!expectedChallenge) {
            return res.status(400).json({ success: false, error: 'Challenge expired or not found. Please try again.' });
        }

        // Look up the credential in the database
        const credResult = await callPython({
            action: "get_webauthn_credential",
            credential_id: credential.id
        });

        if (!credResult.success || !credResult.data) {
            return res.status(400).json({ success: false, error: 'Credential not recognized' });
        }

        const storedCred = credResult.data;
        console.log('[WebAuthn Login] storedCred:', JSON.stringify({ teacher_id: storedCred.teacher_id, credential_id: storedCred.credential_id, counter: storedCred.counter, hasPublicKey: !!storedCred.publicKey, publicKeyType: typeof storedCred.publicKey, publicKeyLength: Array.isArray(storedCred.publicKey) ? storedCred.publicKey.length : 'N/A' }));
        const pk = Array.isArray(storedCred.publicKey) ? storedCred.publicKey : Array.from(storedCred.publicKey);
        const publicKeyBytes = new Uint8Array(pk);

        const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: WEBAUTHN_ORIGIN,
            expectedRPID: WEBAUTHN_RP_ID,
            credential: {
                id: storedCred.credential_id,
                publicKey: publicKeyBytes,
                counter: storedCred.counter,
                transports: storedCred.transports ? storedCred.transports.split(',') : ['internal'],
            },
            requireUserVerification: true,
        });

        if (!verification.verified) {
            return res.status(401).json({ success: false, error: 'Authentication verification failed' });
        }

        // Update counter
        await callPython({
            action: "update_webauthn_counter",
            credential_id: credential.id,
            new_counter: verification.authenticationInfo.newCounter,
            last_used_at: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
        });

        // Get teacher info and create session (same as normal login)
        console.log('[WebAuthn Login] Loading teacher_id:', storedCred.teacher_id);
        const teacherResult = await callPython({
            action: "get_teacher_with_role",
            teacher_id: storedCred.teacher_id
        });
        console.log('[WebAuthn Login] Teacher result:', JSON.stringify(teacherResult));

        let teacher;
        if (teacherResult.success && teacherResult.data) {
            teacher = teacherResult.data;
        } else if (storedCred.teacher_id === 'system-admin') {
            // System admin doesn't have a teachers table record
            teacher = { id: 'system-admin', name: 'System Administrator', username: 'system-admin', role: 'admin', class_teacher_of: null, subject: '' };
        } else {
            console.error('[WebAuthn Login] Failed to load teacher:', teacherResult);
            return res.status(500).json({ success: false, error: 'Failed to load user profile' });
        }

        // Generate session token (single active session)
        const sessionId = require('crypto').randomBytes(16).toString('hex');
        const nowStr = getIstTimestamp(new Date());

        // Store session via Python
        await callPython({
            action: "update_session",
            teacher_id: teacher.id,
            session_id: sessionId,
            last_login: nowStr
        });

        const userPayload = {
            id: teacher.id,
            name: teacher.name,
            username: teacher.username || '',
            role: teacher.role,
            class_teacher_of: teacher.class_teacher_of,
            subject: teacher.subject || '',
            sessionId: sessionId
        };

        const token = createAuthToken(userPayload);

        appendWebActivityEvent({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: getIstTimestamp(new Date()),
            date: getIstDateKey(new Date()),
            epochMs: Date.now(),
            actor: teacher.name || '',
            username: teacher.username || '',
            role: getUserRoleLabel(userPayload),
            type: 'Login',
            summary: 'Logged into the web app',
            meta: 'Passkey authentication',
        });

        res.json({ success: true, user: userPayload, token });
    } catch (error) {
        console.error('[WebAuthn Login Verify Error]', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/track-event', authenticateToken, (req, res) => {
    try {
        const { action, target, meta } = req.body || {};
        if (!action) return res.json({ success: true });
        appendWebActivityEvent({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: getIstTimestamp(new Date()),
            date: getIstDateKey(new Date()),
            epochMs: Date.now(),
            actor: req.user.name || req.user.username || 'Unknown',
            username: req.user.username || '',
            role: getUserRoleLabel(req.user || {}),
            type: 'UI',
            summary: action,
            meta: meta || target || '',
        });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

app.post('/api/namaz-session', async (req, res) => {
    const providedKey = String(req.headers['x-api-key'] || '').trim();
    const source = req.body?.source || 'unknown';
    const sessionId = req.body?.sessionId || null;

    if (!NAMAZ_API_KEY || providedKey !== NAMAZ_API_KEY) {
        console.warn(`[Namaz API] Unauthorized request from ${req.ip || 'unknown'} for session ${sessionId || '-'}`);
        try {
            await callPython({
                action: "log_namaz_api_event",
                status: "unauthorized",
                sessionId,
                source,
                ip: req.ip || '',
                message: NAMAZ_API_KEY ? "Invalid X-API-KEY" : "NAMAZ_API_KEY is not configured"
            });
        } catch (error) {
            console.error('[Namaz API] Failed to log unauthorized attempt:', error.message);
        }
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const result = await callPython({
            action: "create_namaz_session",
            ...req.body,
            ip: req.ip || '',
        });

        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[Namaz API] Session processing failed:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
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
        const { date } = req.query;
        const result = await callPython({ action: "get_full_timetable", weekday: parseInt(req.params.weekday), date });
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

app.get('/teacher-register-report', authenticateToken, async (req, res) => {
    try {
        console.log("REQ QUERY:", req.query);
        const { classId, teacherId, fromDate, toDate } = req.query;
        const payload = { 
            action: "get_teacher_register_report", 
            classId, 
            teacherId, 
            fromDate, 
            toDate 
        };
        console.log("PYTHON INPUT:", payload);
        const result = await callPython(payload);
        console.log("PYTHON OUTPUT:", result);
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

app.get('/class-averages', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_class_average_attendance" });
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

app.get('/namaz-analytics', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_namaz_analytics",
            fromDate: req.query.fromDate,
            toDate: req.query.toDate,
            className: req.query.className,
            studentId: req.query.studentId,
            sessionType: req.query.sessionType,
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/event-attendance', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_event_attendance"
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/permissions/students', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_permission_students",
            teacher_id: req.user.id,
            user_role: req.user.role,
            class_teacher_of: req.user.class_teacher_of,
            for_history: req.query.for_history === '1' ? 1 : 0
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/permissions/summary', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_permission_summary",
            teacher_id: req.user.id,
            user_role: req.user.role,
            class_teacher_of: req.user.class_teacher_of
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/permissions', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_permissions",
            view: req.query.view || "history",
            filters: {
                student: req.query.student,
                class: req.query.class,
                date: req.query.date,
                from_date: req.query.from_date,
                to_date: req.query.to_date,
                permission_number: req.query.permission_number,
                permission_type: req.query.permission_type,
                attendance_status: req.query.attendance_status,
                created_by: req.query.created_by,
                approved_by: req.query.approved_by,
                reason: req.query.reason,
            },
            teacher_id: req.user.id,
            user_role: req.user.role,
            class_teacher_of: req.user.class_teacher_of
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/permissions', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "create_permission",
            ...req.body,
            teacher_id: req.user.id,
            teacher_name: req.user.name,
            user_role: req.user.role,
            class_teacher_of: req.user.class_teacher_of
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/permissions/:id/approve', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Principal' && req.user.role !== 'Vice Principal') {
            return res.status(403).json({ success: false, message: 'Only Principal and Vice Principal can approve permissions.' });
        }
        const result = await callPython({
            action: "approve_permission",
            permission_id: Number(req.params.id),
            teacher_id: req.user.id,
            user_role: req.user.role
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/permissions/:id/reject', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Principal' && req.user.role !== 'Vice Principal') {
            return res.status(403).json({ success: false, message: 'Only Principal and Vice Principal can reject permissions.' });
        }
        const result = await callPython({
            action: "reject_permission",
            permission_id: Number(req.params.id),
            user_role: req.user.role
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/permissions/:id/return/teacher', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Class Teacher') {
            return res.status(403).json({ success: false, message: 'Only Class Teachers can approve student return first.' });
        }
        const result = await callPython({
            action: "teacher_return_approval",
            permission_id: Number(req.params.id),
            teacher_id: req.user.id,
            user_role: req.user.role,
            class_teacher_of: req.user.class_teacher_of
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/permissions/:id/return/principal', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Principal' && req.user.role !== 'Vice Principal') {
            return res.status(403).json({ success: false, message: 'Only Principal and Vice Principal can approve final return.' });
        }
        const result = await callPython({
            action: "principal_return_approval",
            permission_id: Number(req.params.id),
            teacher_id: req.user.id,
            user_role: req.user.role
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/permissions/:id/return/principal', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Principal' && req.user.role !== 'Vice Principal') {
            return res.status(403).json({ success: false, message: 'Only Principal and Vice Principal can reject final return.' });
        }
        const result = await callPython({
            action: "reject_return_approval",
            permission_id: Number(req.params.id),
            user_role: req.user.role
        });
        res.status(result.success ? 200 : 400).json(result);
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

app.get('/profile/teaching-stats', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_teaching_stats", teacher_id: req.user.id });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



// Admin Route: Reset Namaz & Event Data
app.post('/admin/reset-namaz-data', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Access denied.' });
        const { category, className, date } = req.body;
        const result = await callPython({
            action: "reset_namaz_data",
            category: category || "all",
            className: className || "all",
            date: date || "all"
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/announcements/:announcementKey', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_teacher_announcement",
            teacher_id: req.user.id,
            announcement_key: req.params.announcementKey
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/announcements/pending/current', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "get_pending_teacher_announcement",
            teacher_id: req.user.id
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/announcements/:announcementKey/dismiss', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "dismiss_teacher_announcement",
            teacher_id: req.user.id,
            announcement_key: req.params.announcementKey
        });
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

// ── Teacher Permanent QR Attendance Endpoints ──
app.post('/api/teacher-attendance/scan', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.id || user.id === 'system-admin' || user.id === 'majlis-user' || user.role === 'admin' || user.role === 'Majlis') {
            return res.status(403).json({ success: false, message: "Only authenticated teachers are authorized to scan office QR attendance." });
        }

        const { qrToken } = req.body || {};
        if (!qrToken) {
            return res.status(400).json({ success: false, message: "QR token is required." });
        }

        const expected_secret = process.env.OFFICE_ATTENDANCE_QR_SECRET || 'MARKHINS_OFFICE_SECRET_KEY_2026';
        const result = await callPython({
            action: "mark_teacher_attendance",
            teacher_id: user.id,
            qr_token: qrToken,
            expected_secret
        });

        res.json(result);
    } catch (error) {
        console.error('[Teacher Attendance Scan Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/teacher-attendance/today-status', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.id || user.id === 'system-admin' || user.id === 'majlis-user') {
            return res.json({ success: true, markedToday: false });
        }

        const result = await callPython({
            action: "get_today_teacher_attendance_status",
            teacher_id: user.id
        });

        res.json(result);
    } catch (error) {
        console.error('[Teacher Attendance Today Status Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/teacher-attendance/today-list', authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;
        const result = await callPython({
            action: "get_today_all_teachers_attendance",
            date: date || null
        });
        res.json(result);
    } catch (error) {
        console.error('[Teacher Attendance Today List Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/teacher-attendance/history/:teacherId', authenticateToken, async (req, res) => {
    try {
        const { teacherId } = req.params;
        const result = await callPython({
            action: "get_teacher_attendance_history",
            teacher_id: teacherId
        });
        res.json(result);
    } catch (error) {
        console.error('[Teacher Attendance History Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/teachers/create', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only administrators can create staff members." });
        }
        const result = await callPython({
            action: "create_staff",
            ...req.body
        });
        res.json(result);
    } catch (error) {
        console.error('[Create Staff Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/teachers/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only administrators can update staff members." });
        }
        const result = await callPython({
            action: "update_staff",
            teacher_id: req.params.id,
            ...req.body
        });
        res.json(result);
    } catch (error) {
        console.error('[Update Staff Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/teachers/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only administrators can delete staff members." });
        }
        const result = await callPython({
            action: "delete_staff",
            teacher_id: req.params.id
        });
        res.json(result);
    } catch (error) {
        console.error('[Delete Staff Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/teacher-attendance/clear-all', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only administrators can clear attendance data." });
        }
        const result = await callPython({
            action: "clear_all_teacher_attendance"
        });
        res.json(result);
    } catch (error) {
        console.error('[Clear Teacher Attendance Error]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});


// --- Syllabus Tracker Endpoints ---
app.get('/api/syllabus', authenticateToken, async (req, res) => {
    try {
        const { class: classId, subject } = req.query;
        // Teachers only see their own configs unless they are admin/principal
        const isManager = req.user.role === 'admin' || req.user.role === 'Principal' || req.user.role === 'Vice Principal';
        const teacher_id = isManager ? req.query.teacherId : req.user.id;
        
        const result = await callPython({
            action: "get_syllabus_configs",
            teacher_id: teacher_id ? Number(teacher_id) : undefined,
            class: classId,
            subject: subject
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/syllabus/config', authenticateToken, async (req, res) => {
    try {
        // Only admin can manage configurations
        const isAdmin = req.user.role === 'admin';
        if (!isAdmin) {
            return res.status(403).json({ success: false, message: "Unauthorized to save syllabus configuration." });
        }
        const result = await callPython({
            action: "save_syllabus_config",
            ...req.body
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/syllabus/progress', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({
            action: "update_syllabus_progress",
            syllabus_config_id: Number(req.body.syllabus_config_id),
            current_page: Number(req.body.current_page),
            teacher_id: req.user.id
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/syllabus/config/:id', authenticateToken, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        if (!isAdmin) {
            return res.status(403).json({ success: false, message: "Unauthorized to delete syllabus configuration." });
        }
        const result = await callPython({
            action: "delete_syllabus_config",
            id: Number(req.params.id)
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

// POST /attendance/delete-last — delete the last marked attendance
app.post('/attendance/delete-last', authenticateToken, async (req, res) => {
    try {
        const teacher_id = req.user.id || 1;
        const { classId, period, date } = req.body;

        if (!classId || !period || !date) {
            return res.status(400).json({ success: false, error: 'Missing classId, period or date. Cannot delete.' });
        }

        const result = await callPython({
            action: "delete_last_attendance",
            classId,
            period,
            date,
            teacher_id: Number(teacher_id),
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
        const isPrincipal = user_role === 'admin' || user_role === 'Principal' || user_role === 'Vice Principal';
        const isScopedUrduPrincipal = isUrduPrincipal(req.user);

        const result = await callPython({ action: "get_health_list", status: targetStatus });

        if (isScopedUrduPrincipal && !isPrincipal && Array.isArray(result.health_list)) {
            result.health_list = result.health_list.filter(group => isUrduClass(group.class));
            result.total_count = result.health_list.reduce((total, group) => total + (group.students?.length || 0), 0);
        }

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
    const isScopedUrduPrincipal = isUrduPrincipal(req.user);
    if (isScopedUrduPrincipal && !isPrincipal && !isUrduClass(classId)) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized: Urdu Principal can manage Sick/Leave only for Urdu classes.'
        });
    }

    if (!isPrincipal && !isScopedUrduPrincipal && user_role !== 'Class Teacher') {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized: Only Principal, Urdu Principal, Vice Principal, and Class Teachers can manage health status.'
        });
    }

    if (!isPrincipal && !isScopedUrduPrincipal && user_role === 'Class Teacher') {
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
        const classId = req.query.classId;
        const action = classId ? "get_subjects_by_class" : "get_extra_subjects";
        const params = classId ? { class_id: classId } : {};
        const result = await callPython({ action, ...params });
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

app.get('/admin/namaz-api-monitor', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_namaz_api_monitor" });
        if (result?.data) {
            result.data.apiStatus = NAMAZ_API_KEY ? result.data.apiStatus : 'Not Configured';
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/announcements', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_admin_announcements" });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/admin/announcements', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { heading, content, footer, active, targetTeacherIds } = req.body;
        const result = await callPython({ action: "create_admin_announcement", heading, content, footer, active, target_teacher_ids: targetTeacherIds || [] });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/admin/announcements/:announcementId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { heading, content, footer, active, targetTeacherIds } = req.body;
        const result = await callPython({
            action: "update_admin_announcement",
            announcement_id: req.params.announcementId,
            heading,
            content,
            footer,
            active,
            target_teacher_ids: targetTeacherIds || []
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/admin/announcements/:announcementId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({
            action: "delete_admin_announcement",
            announcement_id: req.params.announcementId
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/announcements/:announcementKey/viewers', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const result = await callPython({
            action: "get_announcement_viewers",
            announcement_key: req.params.announcementKey
        });
        res.json(result);
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
        const { name, username, password, is_teacher } = req.body;
        const result = await callPython({ action: "create_teacher", name, username, password, is_teacher });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/admin/teachers/:teacherId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
        const { name, username, password, is_teacher } = req.body;
        const result = await callPython({
            action: "update_teacher",
            teacherId: req.params.teacherId,
            name,
            username,
            password,
            is_teacher
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
            imageUrl: `/api/proxy/teachers/${filename}?v=${version}`
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
        const editorRes = await callPython({ action: "get_timetable_editors" });
        const editors = editorRes.editors || [];
        if (!isTimetableEditor(req.user, editors)) return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_admin_timetable", weekday: parseInt(req.params.weekday, 10) });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/admin/teacher-subjects/:teacherId', authenticateToken, async (req, res) => {
    try {
        const editorRes = await callPython({ action: "get_timetable_editors" });
        const editors = editorRes.editors || [];
        if (!isTimetableEditor(req.user, editors)) return res.status(403).send('Forbidden');
        const result = await callPython({ action: "get_teacher_subject_options", teacherId: req.params.teacherId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/admin/timetable/period', authenticateToken, async (req, res) => {
    try {
        const editorRes = await callPython({ action: "get_timetable_editors" });
        const editors = editorRes.editors || [];
        if (!isTimetableEditor(req.user, editors)) return res.status(403).send('Forbidden');
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


// ── Manual Substitute System Endpoints ──

// Get substitute coordinator status.
// All authenticated users need the coordinator IDs so the dashboard can decide
// whether to show the planner. Only admins receive the full teacher list used
// by the coordinator-management UI.
app.get('/api/substitute/coordinators', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_substitute_coordinators" });
        if (req.user.role === 'admin') {
            return res.json(result);
        }
        res.json({
            success: result.success,
            coordinators: result.coordinators || []
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update substitute coordinators (Admin only)
app.post('/api/substitute/coordinators', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
        const { coordinators } = req.body;
        const result = await callPython({ action: "save_substitute_coordinators", coordinators });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── Timetable Editors ──

// Get timetable editors (any authenticated user needs this to check permission)
app.get('/api/timetable/editors', authenticateToken, async (req, res) => {
    try {
        const result = await callPython({ action: "get_timetable_editors" });
        if (req.user.role === 'admin') {
            return res.json(result);
        }
        res.json({
            success: result.success,
            editors: result.editors || []
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update timetable editors (Admin only)
app.post('/api/timetable/editors', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
        const { editors } = req.body;
        const result = await callPython({ action: "save_timetable_editors", editors });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get planner data (Admin or authorized coordinator)
app.get('/api/substitute/planner-data', authenticateToken, async (req, res) => {
    try {
        const { date, on_leave_teacher_ids, not_working_classes, leaves } = req.query;
        
        // Authorization check: Admin or coordinator in system settings
        const coordRes = await callPython({ action: "get_substitute_coordinators" });
        const coordinators = coordRes.coordinators || [];
        const isAuthorized = req.user.role === 'admin' || coordinators.includes(String(req.user.id)) || coordinators.includes(String(req.user.username));
        if (!isAuthorized) return res.status(403).json({ success: false, message: 'Access denied. You are not an authorized coordinator.' });

        const idsArray = on_leave_teacher_ids ? on_leave_teacher_ids.split(',').map(x => parseInt(x)).filter(x => !isNaN(x)) : [];
        const notWorkingClasses = not_working_classes ? not_working_classes.split(',').map(x => String(x).trim()).filter(Boolean) : [];
        
        let parsedLeaves = [];
        if (leaves) {
            try {
                parsedLeaves = JSON.parse(leaves);
            } catch (e) {}
        }

        const result = await callPython({ 
            action: "get_substitute_planner_data", 
            date, 
            on_leave_teacher_ids: idsArray, 
            not_working_classes: notWorkingClasses,
            leaves: parsedLeaves
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Assign substitutes (Admin or authorized coordinator)
app.post('/api/substitute/assign', authenticateToken, async (req, res) => {
    try {
        const { date, assignments, leaves } = req.body;
        
        // Authorization check
        const coordRes = await callPython({ action: "get_substitute_coordinators" });
        const coordinators = coordRes.coordinators || [];
        const isAuthorized = req.user.role === 'admin' || coordinators.includes(String(req.user.id)) || coordinators.includes(String(req.user.username));
        if (!isAuthorized) return res.status(403).json({ success: false, message: 'Access denied.' });

        const result = await callPython({ 
            action: "save_substitute_assignments", 
            date, 
            assignments, 
            leaves: leaves || [],
            coordinator: req.user.name || req.user.username || 'Coordinator' 
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get substitute report
app.get('/api/substitute/report', authenticateToken, async (req, res) => {
    try {
        const { fromDate, toDate, classId, teacherId } = req.query;
        const result = await callPython({ 
            action: "get_substitute_assignments_report", 
            fromDate, 
            toDate, 
            classId, 
            teacherId: teacherId ? parseInt(teacherId) : null 
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get dashboard widget details
app.get('/api/substitute/dashboard-widget', authenticateToken, async (req, res) => {
    try {
        // Find tomorrow's date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Fetch dashboard widget details from Python
        const result = await callPython({ 
            action: "get_substitute_dashboard_widget_data", 
            date: tomorrowStr
        });
        
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
