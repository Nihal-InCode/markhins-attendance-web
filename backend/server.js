require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const path = require('path');

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

// ── Feature 3: Edited Attendance system now uses DB state directly ──

// --- Middleware ---
app.use(cors({
    origin: "*",
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

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
        req.user = user;
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
                // Ensure we only parse the last line if there's multiple (due to print debugs)
                const lines = trimmedOutput.split('\n');
                const lastLine = lines[lines.length - 1];

                const result = JSON.parse(lastLine);
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
    console.log(`[DEBUG] Login Route Hit: ${req.method} ${req.url}`);
    try {
        const { username, password } = req.body;
        console.log(`[Login Attempt] User: ${username}`);

        const result = await callPython({ action: "login", username, password });
        console.log(`[Login Result] Success: ${result.success}`);

        if (result.success) {
            // Token includes id, name, and role for frontend permission checks
            const token = jwt.sign(result.user, JWT_SECRET, { expiresIn: '7d' });
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
        const { class: cls, period } = req.query;
        const result = await callPython({ action: "resolve_period", class: cls, period });
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


// --- Server Startup ---
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
