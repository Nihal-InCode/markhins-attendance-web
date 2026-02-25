// index.js
// Telegram interactive attendance bot (period -> class -> multi-select students -> status -> confirm)
// Requires: node-telegram-bot-api, xlsx
// Install: npm install node-telegram-bot-api xlsx dotenv

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const xlsx = require("xlsx");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Add logging to file
const logFile = fs.createWriteStream('bot_debug.log', { flags: 'a' });
const originalConsoleLog = console.log;
console.log = (...args) => {
  originalConsoleLog(...args);
  logFile.write(args.join(' ') + '\n');
};

// Night stop checker (IST) - DISABLED for 24/7 operation
// function isNightIST() {
//   const now = new Date();
//   const ist = new Date(
//     now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
//   );

//   const hour = ist.getHours();
//   const minute = ist.getMinutes();

//   return (
//     (hour === 22 && minute >= 0) || // 10:00 PM onwards
//     hour > 22 ||                    // 11 PM
//     hour < 5 ||                     // 12 AM – 4:59 AM
//     (hour === 5 && minute < 30)     // before 5:30 AM
//   );
// }

// Stop immediately if started at night - DISABLED for 24/7 operation
// if (isNightIST()) {
//   console.log("Night time IST (10:00 PM – 5:30 AM). Bot stopped.");
//   process.exit(0);
// }

// Global flag for DB sent status
let dbSentToday = false;

// Safe bot stop - ensures DB is sent before stopping
async function safeBotStop() {
  console.log("Safe bot stop triggered. Checking DB send status...");

  if (!dbSentToday) {
    console.log("DB not sent yet. Attempting to send before stopping...");
    try {
      await sendDailyDB();
    } catch (err) {
      console.error("Failed to send DB before stopping:", err);
    }
  }

  console.log("Bot stopping gracefully.");
  process.exit(0);
}

// Check every 60 seconds and stop when night starts (AFTER sending DB) - DISABLED for 24/7 operation
// setInterval(async () => {
//   if (isNightIST()) {
//     console.log("Night time IST reached. Initiating safe stop...");
//     await safeBotStop();
//   }
// }, 60 * 1000);

// ------------------ CONFIG ------------------
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const SECONDARY_ADMIN_ID = "8124392478"; // Hardcoded secondary admin
const DB_PATH = "/app/attendance.db";

// Global Admin Features
let debugMode = false;
let maintenanceMode = false;
let lastErrors = [];

// Helper for IST time for logging
function currentISTTime() {
  return new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Intercept console.error to store last 10 errors
const originalConsoleError = console.error;
console.error = (...args) => {
  const errorMsg = args.join(' ');
  originalConsoleError(...args);
  lastErrors.push(`[${currentISTTime()}] ${errorMsg}`);
  if (lastErrors.length > 10) lastErrors.shift();

  // Forward to admins if Debug Mode is ON
  if (debugMode) {
    const logMsg = `⚠️ ERROR\nContext : System\nMessage : ${escapeHTML(errorMsg)}\nTime    : ${currentISTTime()}`;
    broadcastToAdmins(logMsg).catch(err => originalConsoleError("Failed to forward error to admins:", err.message));
  }
};

// Hardcoded Admin Usernames
const ADMIN_USERNAMES = new Set(["library_number", "markhins_official"]);

let isBootstrapMode = false;
let adminCache = new Set(ADMIN_USERNAMES);

// Dummy function - admins are now hardcoded
async function refreshAdmins() {
  // No-op: admins are hardcoded
  console.log(`Admin cache (hardcoded): ${adminCache.size} admins active`);
}

function isAdmin(username) {
  // Check if username is in hardcoded admin list
  if (!username) return false;
  return ADMIN_USERNAMES.has(username.toLowerCase());
}

// EARLY ACCESS CONTROL
const RESTRICTED_MSG = `🚫 Access Restricted 

Your Telegram account is not registered in the attendance system.
Please contact the administrator to request access.`;

const authorizedCache = new Set();

async function verifyAuth(chatId, username) {
  const uname = username ? username.toLowerCase().replace('@', '') : 'unknown';
  const idStr = String(chatId);

  // Requirement 3: Allow system calls
  if (uname === 'system' || chatId === 0 || chatId === '0') return true;

  // Requirement 2: Authorization must check ONLY msg.from.id (prioritized)
  // We check against both ID and legacy username markers in the cache
  let isAuthorized = authorizedCache.has(idStr) || authorizedCache.has(uname) || isAdmin(uname);

  // Requirement 1: Log auth inputs
  console.log(`[AUTH CHECK] UserID: ${idStr}, Username: ${uname}, Result: ${isAuthorized ? 'ALLOWED' : 'DENIED'}`);

  if (isAuthorized) return true;

  // Requirement 4: Safe Fallback - If auth check fails but something is suspect (e.g. empty cache)
  // ALLOW access but log warning to prevent total lockout
  if (authorizedCache.size === 0) {
    console.warn(`[AUTH FALLBACK] Authorized cache is empty. Potentially failing to load. Allowing ID ${idStr} for safety.`);
    return true;
  }

  // Requirement 5: Keep block for confirmed unknown users (found nothing in populated cache)
  if (chatId) await bot.sendMessage(chatId, RESTRICTED_MSG);
  return false;
}

// --- ATTENDANCE EDIT FEATURE ---
const recentSubmissions = new Map(); // chatId -> lastSubmission data

function trackSubmission(chatId, s, currentCommand) {
  const submission = {
    timestamp: Date.now(),
    mode: s.mode,
    period: s.period,
    className: s.className,
    extraClassSubject: s.extraClassSubject,
    selected: [...s.selected],
    status: s.status,
    healthStartPeriod: s.healthStartPeriod,
    command: currentCommand
  };
  recentSubmissions.set(chatId, submission);
  return submission;
}

async function sendSuccessWithEdit(chatId, text, options = {}) {
  const markup = {
    inline_keyboard: [
      [{ text: "✏️ Edit Attendance", callback_data: "action:edit_last" }]
    ]
  };

  const msg = await safeSendMessage(chatId, text, {
    ...options,
    reply_markup: markup
  });

  if (msg) {
    // Automatically remove the edit button after 30 minutes
    setTimeout(async () => {
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: msg.message_id
        });
      } catch (err) {
        // Message might have been deleted or already edited
      }
    }, 30 * 60 * 1000);
  }
}

async function broadcastToAdmins(message, options = {}) {
  // Since we don't have telegram IDs for hardcoded admins,
  // we'll just log the message
  originalConsoleLog("📢 ADMIN BROADCAST:", message);
}

const MEMBERS_FILE = path.join(process.cwd(), "members.xlsx");
const PY_SCRIPT = "/app/attendance.py"; // path to Python script
const PYTHON = process.platform === "win32" ? "python" : "python3";
const ADMIN_USERNAME = "library_number"; // without @ (for legacy /download_db command)

// Initial refresh and periodic update
refreshAdmins();
setInterval(refreshAdmins, 60000); // Every 1 minute
// --------------------------------------------

if (!TOKEN) {
  console.error("Please set TELEGRAM_BOT_TOKEN in .env file.");
  process.exit(1);
}

if (!ADMIN_ID || ADMIN_ID === 'YOUR_NUMERIC_CHAT_ID_HERE') {
  console.error("⚠️ WARNING: ADMIN_CHAT_ID not set in .env file!");
  console.error("Daily DB backup will not work until you set your numeric chat ID.");
  console.error("To get your chat ID, send /claim_admin to the bot and check the logs.");
}

// Initialize bot with polling and error handling
const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 10,
      // Add any additional polling options here
    }
  }
});

// Log bot info
bot.getMe().then(me => {
  console.log(`✅ Bot @${me.username} is running...`);
  console.log(`Bot ID: ${me.id}, Name: ${me.first_name}`);
}).catch(err => {
  console.error('❌ Error getting bot info:', err.message);
});

// Helper to get IST time
function getISTTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
}

// Test Admin Configuration Command
bot.onText(/\/test_admin/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'unknown';

  console.log(`\n🧪 ADMIN TEST COMMAND`);
  console.log(`Requested by: @${username}`);
  console.log(`Chat ID: ${chatId}`);
  console.log(`Is Admin: ${isAdmin(username)}\n`);

  let statusMsg = `🧪 <b>Admin Status Report</b>\n\n`;
  statusMsg += `👤 Your Username: @${username}\n`;
  statusMsg += `🛡️ Admin Status: ${isAdmin(username) ? '✅ AUTHORIZED' : '❌ UNAUTHORIZED'}\n\n`;

  if (isAdmin(username)) {
    statusMsg += `✅ You have full access to the Admin Panel.\n`;
    statusMsg += `✅ Authorized Admin: @${username}\n`;
    statusMsg += `⚠️ You do not have admin privileges.\n`;
    statusMsg += `🔧 To gain access, ask an existing admin to add you or use /claim_admin if no admins exist.`;
  }

  try {
    await bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Error sending test message:', err);
  }
});

// Manual DB Download Command
bot.onText(/\/(db|download_db)/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'unknown';

  if (!isAdmin(username)) {
    return bot.sendMessage(chatId, "Unauthorized");
  }

  if (!fs.existsSync(DB_PATH)) {
    return bot.sendMessage(chatId, "❌ Database file not found.");
  }

  await sendDbToAdmin(bot, chatId);
});

// Manual DB Upload Handler
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'unknown';
  if (!isAdmin(username)) return;

  const fileName = msg.document.file_name;
  if (!fileName.endsWith(".db")) return;

  try {
    const fileId = msg.document.file_id;
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const res = await fetch(fileUrl);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(DB_PATH, Buffer.from(buffer));

    bot.sendMessage(msg.chat.id, "✅ Database uploaded successfully.");
  } catch (err) {
    console.error("DB upload error:", err);
    bot.sendMessage(msg.chat.id, "❌ Failed to upload DB.");
  }
});

// Log when bot is ready
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message);
});

bot.on('webhook_error', (error) => {
  console.error('❌ Webhook error:', error.message);
});

console.log('🤖 Bot is initializing...');

// In-memory per-chat state
const state = {}; // keyed by chatId { step, period, className, selected: Set, status, lastMessageId }

// Load students from database instead of Excel file
async function loadMembersFromDB() {
  try {
    console.log('Loading members from database...');

    const cmd = ".get_all_students";
    const pyRes = await callPython(cmd, 0, "system", 0);

    let students = [];
    try {
      // Parse the outer JSON to get the reply field
      const response = JSON.parse(pyRes.reply);
      students = JSON.parse(response.reply); // Parse the inner JSON
    } catch (e) {
      console.error("Failed to parse students from database:", e);
      console.error("Raw response:", pyRes);
      return {};
    }

    const classes = {}; // { "12A": [{roll:"1201", name:"Ali"}, ...] }
    let rowCount = 0;

    students.forEach(student => {
      const { roll_no, name, class: className } = student;

      if (!roll_no || !className) {
        console.warn(`Student missing roll or class: ${JSON.stringify(student)}`);
        return;
      }

      if (!classes[className]) {
        classes[className] = [];
      }

      classes[className].push({ roll: roll_no.toString(), name });
      rowCount++;
    });

    console.log(`Successfully loaded ${rowCount} students in ${Object.keys(classes).length} classes from database`);
    return classes;

  } catch (error) {
    console.error('Error loading members from database:', error);
    // Fallback to empty object if database fails
    return {};
  }
}

// Load registered teachers from database for early access control
async function loadTeachersFromDB() {
  try {
    console.log('Loading authorized teachers from database...');
    const pyRes = await callPython(".get_all_teachers", 0, "system", 0);

    try {
      const response = JSON.parse(pyRes.reply);
      const teachers = JSON.parse(response.reply);

      authorizedCache.clear();
      teachers.forEach(identifier => {
        if (identifier) {
          // Normalize (lowercase usernames, keep numeric IDs as strings)
          const cleanId = String(identifier).toLowerCase().replace('@', '');
          authorizedCache.add(cleanId);
        }
      });

      console.log(`Successfully loaded ${authorizedCache.size} authorized teachers`);
    } catch (e) {
      console.error("Failed to parse teachers from database:", e);
    }
  } catch (error) {
    console.error('Error loading teachers from database:', error);
  }
}

// Load members.xlsx and build class->students map (LEGACY - kept as fallback)
function loadMembers() {
  try {
    console.log(`Loading members from: ${MEMBERS_FILE}`);

    // Check if file exists
    if (!fs.existsSync(MEMBERS_FILE)) {
      console.error("Members file not found at:", MEMBERS_FILE);
      console.warn("Using sample data due to error");
      return {};
    }

    const workbook = xlsx.readFile(MEMBERS_FILE);
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('No sheets found in the Excel file');
    }

    const sheetName = workbook.SheetNames[0];
    console.log(`Reading sheet: ${sheetName}`);

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`Sheet ${sheetName} not found in the workbook`);
    }

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
    console.log(`Found ${rows.length} rows in the sheet`);

    if (rows.length === 0) {
      console.warn('No data rows found');
      return {};
    }

    // Log first row to help with debugging
    console.log('First row sample:', JSON.stringify(rows[0], null, 2));

    // Expect columns: Roll, Name, Class  (user said roll, name, class respectively)
    const classes = {}; // { "12A": [{roll:"1201", name:"Ali"}, ...] }
    let rowCount = 0;

    rows.forEach((r, index) => {
      try {
        // Try to find the keys heuristically
        const keys = Object.keys(r);
        if (keys.length < 3) {
          console.warn(`Row ${index + 1}: Not enough columns, skipping`);
          return;
        }

        let roll = (r[keys[0]] || '').toString().trim();
        let name = (r[keys[1]] || '').toString().trim();
        let className = (r[keys[2]] || '').toString().trim();

        if (!roll || !className) {
          console.warn(`Row ${index + 1}: Missing roll number or class, skipping`);
          return;
        }

        if (!classes[className]) {
          classes[className] = [];
        }

        classes[className].push({ roll, name });
        rowCount++;
      } catch (rowError) {
        console.error(`Error processing row ${index + 1}:`, rowError);
      }
    });

    console.log(`Successfully loaded ${rowCount} students in ${Object.keys(classes).length} classes`);
    return classes;

  } catch (error) {
    console.error('Error loading members:', error);
    // Create a sample class if there's an error (for testing)
    console.warn('Using sample data due to error');
    return {
      '12A': [
        { roll: '1201', name: 'John Doe' },
        { roll: '1202', name: 'Jane Smith' },
        { roll: '1203', name: 'Bob Johnson' }
      ],
      '12B': [
        { roll: '1204', name: 'Alice Brown' },
        { roll: '1205', name: 'Charlie Davis' }
      ]
    };
  }
}

// Initialize CLASSES from database (async initialization)
let CLASSES = {};

// Async function to initialize CLASSES and teachers from database
async function initializeClasses() {
  try {
    // Load authorized teachers first for access control
    await loadTeachersFromDB();

    CLASSES = await loadMembersFromDB();
    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      console.warn("⚠️ No classes loaded from database. Falling back to Excel file.");
      CLASSES = loadMembers(); // Fallback to Excel
    }
  } catch (error) {
    console.error("Error initializing classes from database:", error);
    console.warn("Falling back to Excel file.");
    CLASSES = loadMembers(); // Fallback to Excel
  }
}

// Initialize classes on startup
initializeClasses().then(() => {
  console.log("✅ Classes initialization completed");
}).catch(err => {
  console.error("❌ Failed to initialize classes:", err);
});

// utils: chunk array into rows of 2 buttons
function chunk(arr, size = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Helper to split long messages at newlines
function splitMessage(text, maxLength = 3500) {
  const parts = [];
  while (text.length > maxLength) {
    let sliceIndex = text.lastIndexOf("\n", maxLength);
    if (sliceIndex === -1) sliceIndex = maxLength;
    parts.push(text.slice(0, sliceIndex));
    text = text.slice(sliceIndex);
  }
  parts.push(text);
  return parts;
}

// helper: send python command and await JSON/text reply
function callPython(message, sender, username, chatId) {
  return new Promise((resolve, reject) => {
    console.log("\n=== CALLPYTHON DEBUG ===");
    console.log("Message:", message);
    console.log("Sender:", sender);
    console.log("Username:", username);
    console.log("Chat ID:", chatId);
    console.log("=====================");

    // spawn python script
    const py = spawn(PYTHON, [PY_SCRIPT], {
      cwd: process.cwd()
    });

    let out = "";
    let err = "";

    py.stdout.on("data", (data) => {
      console.log("PYTHON:", data.toString());
      out += data.toString();
    });

    py.stderr.on("data", (data) => {
      console.error("PYTHON ERROR:", data.toString());
      err += data.toString();
    });

    py.on("error", (err) => {
      console.error("Failed to start Python:", err);
    });

    py.on("close", (code) => {
      console.log("Python exited with code", code);
      console.log("\n=== PYTHON RESPONSE ===");
      console.log("Exit code:", code);
      console.log("Raw output:", out);
      console.log("Error:", err);
      console.log("=====================");

      if (code === 0) {
        // Try parse JSON, fallback to text
        const txt = out.trim();
        try {
          const json = JSON.parse(txt);
          resolve(json);
        } catch (e) {
          resolve({ reply: txt || "OK", notifications: [] });
        }
      } else {
        console.error("Python stderr:", err);
        console.error("Python stdout:", out);
        reject(err || `Python exited with code ${code}`);
      }
    });

    const payload = JSON.stringify({ message, sender, username, chat_id: chatId });
    console.log("\n=== PAYLOAD TO PYTHON ===");
    console.log(payload);
    console.log("==========================");
    py.stdin.write(payload);
    py.stdin.end();
  });
}


// Helper to handle response and notifications
async function handlePythonResponse(chatId, pyRes, showBackButton = false, backDestination = 'menu:back_main') {
  try {
    // 1. Check if pyRes is a string (raw response) and try to parse it
    let response = pyRes;
    if (typeof pyRes === 'string') {
      try {
        response = JSON.parse(pyRes);
      } catch (e) {
        // If it's not JSON, send it as a plain message
        await safeSendMessage(chatId, pyRes);
        if (showBackButton) {
          await showBackButtonMessage(chatId, backDestination);
        }
        return;
      }
    }

    // 2. Send the main reply to the user
    if (response && typeof response === 'object') {
      if (response.reply) {
        // Check if response indicates a warning/error (e.g. sequential check failed, blocked action)
        if (response.reply.startsWith('⚠️') || response.reply.startsWith('❌') || response.reply.startsWith('🚫')) {
          await safeSendMessage(chatId, response.reply, { parse_mode: 'HTML' });
        } else {
          // Send the regular reply with HTML formatting
          await safeSendMessage(chatId, response.reply, { parse_mode: 'HTML' });
        }
      } else if (response.error) {
        // Handle error responses
        await safeSendMessage(chatId, `⚠️ ${escapeHTML(response.error)}`);
      } else if (Object.keys(response).length > 0) {
        // For any other object response, send as JSON for debugging
        await safeSendMessage(chatId, '```\n' + JSON.stringify(response, null, 2) + '\n```', { parse_mode: 'HTML' });
      }

      // 3. Process notifications if any
      if (response.notifications && Array.isArray(response.notifications)) {
        try {
          await sendNotifications(response.notifications);
        } catch (notifyErr) {
          console.error("Failed to send notifications in handlePythonResponse:", notifyErr);
        }
      }
    } else if (response) {
      // Handle non-object responses
      await safeSendMessage(chatId, String(response));
    }

    // 4. Show back button if requested
    if (showBackButton) {
      await showBackButtonMessage(chatId, backDestination);
    }
  } catch (error) {
    console.error('Error in handlePythonResponse:', error);
    await safeSendMessage(chatId, '❌ An error occurred while processing the response.');
  }
}

// Helper to show a back button after displaying info
async function showBackButtonMessage(chatId, backDestination = 'menu:back_main') {
  const backText = backDestination === 'menu:teachers' ? '👨‍🏫 Teachers Menu' : '🏠 Main Menu';
  const kb = {
    inline_keyboard: [
      [{ text: `🔙 Back to ${backText}`, callback_data: backDestination }]
    ]
  };

  await bot.sendMessage(chatId, '───────────────', {
    reply_markup: kb
  });
}

// ---------- Menu rendering functions ----------

async function showMainMenu(chatId, username = 'unknown') {
  try {
    console.log(`Showing main menu for chat ${chatId}`);

    // Reset state when showing main menu
    state[chatId] = {
      step: "main",
      selected: [],
      mode: null,
      lastMessageId: state[chatId]?.lastMessageId // Preserve last message ID
    };

    const menuText = `📋 <b>Main Menu</b> - Select an option:`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Mark Attendance", callback_data: "menu:mark" }],
        [{ text: "🏥 Leave Status", callback_data: "menu:health" }],
        [{ text: "📊 View Reports", callback_data: "menu:reports" }],
        [{ text: "📘 Mark Extra Class", callback_data: "menu:extra_class" }],
        [{ text: "👨‍🏫 Teacher Options", callback_data: "menu:teachers" }],
        [{ text: "🆘 Help", callback_data: "menu:help" }]
      ]
    };

    // Add Admin Panel button if user is Admin
    if (isAdmin(username)) {
      keyboard.inline_keyboard.push([{ text: "🛠 Admin Panel", callback_data: "admin:panel" }]);
    }

    // Try to edit existing message first, if any
    if (state[chatId]?.lastMessageId) {
      try {
        console.log(`Editing existing message ${state[chatId].lastMessageId}`);
        await bot.editMessageText(menuText, {
          chat_id: chatId,
          message_id: state[chatId].lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log("Couldn't edit message, sending new one:", editError.message);
      }
    }

    // If no existing message or edit failed, send new one
    console.log("Sending new message");
    const sentMessage = await bot.sendMessage(chatId, menuText, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      state[chatId].lastMessageId = sentMessage.message_id;
      console.log(`New message sent with ID: ${sentMessage.message_id}`);
    } else {
      console.error("Failed to send message or get message ID");
    }
  } catch (error) {
    console.error("Error in showMainMenu:", error);
    try {
      await safeSendMessage(chatId, '❌ An error occurred while showing the menu. Please try again.');
    } catch (e) {
      console.error("Could not send error message to user:", e);
    }
  }
}

// Helper function to safely send messages with Markdown
async function safeSendMessage(chatId, text, options = {}) {
  try {
    // Use HTML as the default parse mode for consistency
    if (!options.parse_mode) {
      options.parse_mode = 'HTML';
    }

    // 🛠 UI FIX: Ensure any persistent reply keyboard is removed when sending a text message
    if (!options.reply_markup) {
      options.reply_markup = { remove_keyboard: true };
    }

    // Forward to admin if Debug Mode is ON
    if (debugMode && ADMIN_ID && String(chatId) !== String(ADMIN_ID)) {
      const logMsg = `🤖 BOT REPLY\nTo   : ${escapeHTML(state[chatId]?.teacherName || chatId)}\nText : ${escapeHTML(text.substring(0, 500))}${text.length > 500 ? '...' : ''}\nTime : ${currentISTTime()}`;
      bot.sendMessage(ADMIN_ID, logMsg).catch(err => originalConsoleError("Debug forward failed:", err.message));
    }

    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error('Error in safeSendMessage:', error.message);
    // Fallback to plain text if Markdown fails
    if (options.parse_mode) {
      delete options.parse_mode;
      try {
        return await bot.sendMessage(chatId, text, options);
      } catch (fallbackError) {
        console.error('Fallback send also failed:', fallbackError.message);
        throw fallbackError;
      }
    }
    throw error;
  }
}

async function safeEditMessage(bot, chatId, messageId, text, keyboard) {
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: keyboard
    },
    parse_mode: 'HTML'
  });
}

function buildStudentToggleKeyboard(students, selectedRolls) {
  const selectedSet = new Set((selectedRolls || []).map(r => String(r)));
  const studentButtons = students.map(student => {
    const studentRoll = String(student.roll);
    const isSelected = selectedSet.has(studentRoll);
    const isDefaultAbsent = student.status === 'S' || student.status === 'L';
    const isAbsent = isSelected ? !isDefaultAbsent : isDefaultAbsent;
    let emoji = isAbsent ? '❌' : '✅';
    let statusSuffix = '';

    if (student.status === 'S') {
      statusSuffix = ' (Sick)';
    } else if (student.status === 'L') {
      statusSuffix = ' (Leave)';
    }

    return {
      text: `${emoji} ${student.roll} - ${student.name}${statusSuffix}`,
      callback_data: `student:${studentRoll}`
    };
  });

  const actionButtons = [
    [{ text: '📤 Submit', callback_data: 'action:confirm' }],
    [{ text: '🔙 Back', callback_data: 'action:back_to_class' }]
  ];

  return [
    ...chunk(studentButtons, 2),
    ...actionButtons
  ];
}

function buildStudentToggleMessage(s) {
  const selectedCount = (s.selected || []).length;
  const modeText = s.mode === 'absent' ? 'Mark Absent' :
    s.mode === 'all_present' ? 'Mark All Present' :
      s.mode && s.mode.startsWith('health:') ? 'Leave Status' : 'Select Students';

  return `👥 <b>Class ${escapeHTML(s.className)}</b>\n` +
    `📝 Mode: ${escapeHTML(modeText)}\n` +
    `✅ Selected for Absence: ${selectedCount} student${selectedCount !== 1 ? 's' : ''}\n\n` +
    "Tap students to toggle between Present (✅) and Absent (❌):";
}

async function renderStudentToggleUI(bot, chatId, messageId, s) {
  const students = (s.studentList && s.studentList.length > 0)
    ? s.studentList
    : (CLASSES[s.className] || []);
  const selected = Array.isArray(s.selected) ? s.selected.map(r => String(r)) : [];
  s.selected = selected;
  const keyboard = buildStudentToggleKeyboard(students, s.selected);
  const message = buildStudentToggleMessage(s);
  await safeEditMessage(bot, chatId, messageId, message, keyboard);
}

// ---------- Admin Panel Rendering ----------
async function showAdminPanel(chatId) {
  const menuText = `🛠 <b>Admin Panel</b>\n\n` +
    `Bot Status: ${maintenanceMode ? '🚧 Maintenance' : '✅ Active'}\n` +
    `Debug Mode: ${debugMode ? '🟢 ON' : '🔴 OFF'}\n\n` +
    `Select an administrative action:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🟢 Debug ON", callback_data: "admin:debug_on" },
        { text: "🔴 Debug OFF", callback_data: "admin:debug_off" }
      ],
      [
        { text: "📊 Status", callback_data: "admin:status" },
        { text: "📦 DB Status", callback_data: "admin:db_status" }
      ],
      [
        { text: "💾 DB Backup Now", callback_data: "admin:backup" },
        { text: "📅 Today Summary", callback_data: "admin:summary" }
      ],
      [
        { text: "⏳ Pending Attendance", callback_data: "admin:pending" },
        { text: "🔁 Substitute Log", callback_data: "admin:sub_log" }
      ],
      [
        { text: "📣 Notification Test", callback_data: "admin:notif_test" },
        { text: "⚠️ Error Log", callback_data: "admin:error_log" }
      ],
      [
        { text: "🚧 Maintenance ON", callback_data: "admin:maint_on" },
        { text: "✅ Maintenance OFF", callback_data: "admin:maint_off" }
      ],
      [{ text: "👮 Manage Admins", callback_data: "admin:manage" }],
      [{ text: "⬅️ Back to Main Menu", callback_data: "menu:back_main" }]
    ]
  };

  if (state[chatId]?.lastMessageId) {
    try {
      await bot.editMessageText(menuText, {
        chat_id: chatId,
        message_id: state[chatId].lastMessageId,
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
      return;
    } catch (e) { }
  }

  const sent = await bot.sendMessage(chatId, menuText, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
  state[chatId] = state[chatId] || {};
  state[chatId].lastMessageId = sent.message_id;
}

// ---------- Admin Management Rendering ----------
async function showAdminManagement(chatId) {
  const menuText = `👮 <b>Manage Administrators</b>\n\n` +
    `You can add new admins or remove existing ones. ` +
    `Admin permissions are dynamic and require no restart.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "➕ Add Admin", callback_data: "admin:add_start" }],
      [{ text: "➖ Remove Admin", callback_data: "admin:remove_list" }],
      [{ text: "📋 List Admins", callback_data: "admin:list" }],
      [{ text: "⬅️ Back to Admin Panel", callback_data: "admin:panel" }]
    ]
  };

  try {
    await bot.editMessageText(menuText, {
      chat_id: chatId,
      message_id: state[chatId].lastMessageId,
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });
  } catch (e) {
    await bot.sendMessage(chatId, menuText, { reply_markup: keyboard, parse_mode: 'HTML' });
  }
}

async function showAdminRemoveList(chatId) {
  try {
    const pyRes = await callPython(".admin_list_ids", chatId, "system", chatId);
    const ids = pyRes.reply.split(",").filter(id => id.length > 0);

    // Don't show the current user in the remove list to prevent self-removal lockout
    const buttons = ids
      .filter(id => String(id) !== String(chatId))
      .map(id => ([{ text: `❌ Remove ${id}`, callback_data: `admin:rem:${id}` }]));

    const keyboard = {
      inline_keyboard: [
        ...buttons,
        [{ text: "⬅️ Back", callback_data: "admin:manage" }]
      ]
    };

    const message = "➖ <b>Remove Administrator</b>\nSelect an ID to remove from the administrators list:";

    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: state[chatId].lastMessageId,
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });
  } catch (e) {
    await safeSendMessage(chatId, "❌ Failed to load admin list.");
  }
}

// ✨ Helper function for dust effect deletion animation (Simplified to remove flicker)
async function dustEffectDelete(chatId, messageId) {
  if (!messageId) return;
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (error) {
    console.log('Could not delete message:', error.message);
  }
}

// Helper to send notifications robustly
async function sendNotifications(notifications) {
  if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
    return;
  }

  console.log(`Processing ${notifications.length} notifications...`);

  for (const note of notifications) {
    if (!note.chat_id || !note.message) {
      console.warn("Skipping invalid notification:", note);
      continue;
    }

    try {
      console.log(`Sending notification to ${note.chat_id} (${note.role || 'unknown role'})`);
      await safeSendMessage(note.chat_id, note.message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`Failed to notify ${note.chat_id}:`, err.message);
      // Continue to next notification even if this one fails
    }
  }
}

// ---------- handlers ----------

// Command handlers with error handling and logging
bot.onText(/\/start|\/menu/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? msg.from.username.toLowerCase() : 'unknown';

  // EARLY ACCESS CONTROL: Check authorization immediately
  if (!await verifyAuth(chatId, username)) return;

  console.log(`/start or /menu command received from ${chatId}`);

  try {
    // 1. HARD RESET: Remove any persistent Reply Keyboards (Menu Buttons)
    // We send a temporary message to trigger ReplyKeyboardRemove
    const resetMsg = await bot.sendMessage(chatId, "🔄 <b>Reloading Menu...</b>", {
      parse_mode: 'HTML',
      reply_markup: {
        remove_keyboard: true
      }
    });

    // 2. HARD RESET: Remove previous Inline Keyboards by deleting the last tracked message
    if (state[chatId] && state[chatId].lastMessageId) {
      try {
        await bot.deleteMessage(chatId, state[chatId].lastMessageId);
      } catch (e) {
        // Message might be too old or already deleted, ignore
      }
    }

    // Clear state completely for a fresh start
    state[chatId] = {
      step: "main",
      selected: new Set(),
      mode: null,
      lastMessageId: null // Force showMainMenu to send a new message
    };

    // 3. Delete the "Resetting" message after a tiny delay for a cleaner look
    setTimeout(async () => {
      try {
        await bot.deleteMessage(chatId, resetMsg.message_id);
      } catch (e) { }
    }, 800);

    // 4. Show the fresh Main Menu
    await showMainMenu(chatId);
  } catch (error) {
    console.error('Error in /start or /menu handler:', error);
    try {
      await safeSendMessage(chatId, '❌ Failed to load the menu. Please try again.');
    } catch (e) {
      console.error('Could not send error message to user:', e);
    }
  }
});

// Help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? msg.from.username.toLowerCase() : 'unknown';

  // EARLY ACCESS CONTROL: Check authorization immediately
  if (!await verifyAuth(chatId, username)) return;

  console.log(`/help command received from ${chatId}`);
  try {
    await showHelpMenu(chatId);
  } catch (error) {
    console.error('Error in /help handler:', error);
    try {
      await safeSendMessage(chatId, '❌ Failed to load help. Please try again.');
    } catch (e) {
      console.error('Could not send error message to user:', e);
    }
  }
});

// ======================
// Teacher Management Functions
// ======================

async function showTeacherList(chatId, username = 'system') {
  try {
    // Call Python script to get teacher list
    const pyRes = await callPython(".teacher list", chatId, username, chatId);

    if (pyRes && pyRes.reply) {
      // If we got a reply from Python, show it
      await safeSendMessage(chatId, `👨‍🏫 <b>Teacher List</b>\n\n${pyRes.reply}`, {
        parse_mode: 'HTML'
      });
    } else {
      await safeSendMessage(chatId, '📋 <b>No teachers found.</b>\n\nUse "Add Teacher" to add new teachers.', {
        parse_mode: 'HTML'
      });
    }

    // Show the teacher menu again
    await showTeachersMenu(chatId);
  } catch (error) {
    console.error('Error in showTeacherList:', error);
    await safeSendMessage(chatId, '❌ Failed to load teacher list. Please try again.');
  }
}

async function showAddTeacherForm(chatId) {
  try {
    const message = `👨‍🏫 <b>Add New Teacher</b>\n\n` +
      `Please send the teacher's details in this format:\n` +
      `\`\`\`\n` +
      `Name: Teacher's Full Name\n` +
      `Phone: Phone Number\n` +
      `Telegram: @username\n` +
      `Class: Class (optional)\n` +
      `\`\`\`\n` +
      `Example:\n` +
      `\`\`\`\n` +
      `Name: John Doe\n` +
      `Phone: 1234567890\n` +
      `Telegram: johndoe\n` +
      `Class: 12A\n` +
      `\`\`\``;

    const sentMessage = await safeSendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'menu:back_teachers' }]
        ]
      }
    });

    // Store state to handle the next message as teacher data
    const s = state[chatId] = state[chatId] || {};
    s.waitingFor = 'teacher_data';
    s.lastMessageId = sentMessage.message_id;

  } catch (error) {
    console.error('Error in showAddTeacherForm:', error);
    await safeSendMessage(chatId, '❌ Failed to load teacher form. Please try again.');
  }
}

async function showEditTeacherForm(chatId) {
  try {
    // First, show the teacher list for selection
    await showTeacherList(chatId);

    const message = `✏️ <b>Edit Teacher Details</b>\n\n` +
      `Please reply with the teacher's ID and updated details like this:\n` +
      `\`\`\`\n` +
      `ID: 1\n` +
      `Name: Updated Name\n` +
      `Phone: New Phone\n` +
      `Telegram: @newusername\n` +
      `Class: NewClass\n` +
      `\`\`\``;

    await safeSendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'menu:back_teachers' }]
        ]
      }
    });

    // Store state to handle the next message as updated teacher data
    const s = state[chatId] = state[chatId] || {};
    s.waitingFor = 'edit_teacher_data';

  } catch (error) {
    console.error('Error in showEditTeacherForm:', error);
    await safeSendMessage(chatId, '❌ Failed to load edit form. Please try again.');
  }
}

async function showRemoveTeacherConfirmation(chatId) {
  try {
    // First, show the teacher list for selection
    await showTeacherList(chatId);

    const message = `❌ <b>Remove Teacher</b>\n\n` +
      `Please reply with the ID of the teacher you want to remove.\n` +
      `Example: \`1\``;

    await safeSendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'menu:back_teachers' }]
        ]
      }
    });

    // Store state to handle the next message as teacher ID to remove
    const s = state[chatId] = state[chatId] || {};
    s.waitingFor = 'remove_teacher_id';

  } catch (error) {
    console.error('Error in showRemoveTeacherConfirmation:', error);
    await safeSendMessage(chatId, '❌ Failed to load remove confirmation. Please try again.');
  }
}

// Helper function to parse teacher data from message
function parseTeacherData(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const data = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':').map(part => part.trim());
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      switch (key.toLowerCase()) {
        case 'name': data.name = value; break;
        case 'phone': data.phone = value; break;
        case 'telegram':
          data.telegram = value.startsWith('@') ? value.substring(1) : value;
          break;
        case 'class': data.class = value; break;
      }
    }
  }

  return data.name && data.phone ? data : null;
}

// Helper function to parse teacher edit data
function parseTeacherEditData(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const data = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':').map(part => part.trim());
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      const lowerKey = key.toLowerCase();

      if (lowerKey === 'id') {
        data.id = value;
      } else if (['name', 'phone', 'class'].includes(lowerKey)) {
        data[lowerKey] = value;
      } else if (lowerKey === 'telegram') {
        data.telegram = value.startsWith('@') ? value.substring(1) : value;
      }
    }
  }

  return data.id ? data : null;
}

// ======================
// Menu Display Functions
// ======================

async function showPeriodMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_period';

    const periods = [
      { text: "Period 1", callback_data: "period:P1" },
      { text: "Period 2", callback_data: "period:P2" },
      { text: "Period 3", callback_data: "period:P3" },
      { text: "Period 4", callback_data: "period:P4" },
      { text: "Period 5", callback_data: "period:P5" },
      { text: "Period 6", callback_data: "period:P6" },
      { text: "Period 7", callback_data: "period:P7" }
    ];

    const keyboard = {
      inline_keyboard: [
        ...chunk(periods, 2),
        ...(s.mode === 'period_list' ? [[{ text: "📊 Daily Class Summary", callback_data: "mark:daily_summary" }]] : []),
        [{ text: "🔙 Back", callback_data: "menu:mark" }]
      ]
    };

    const message = s.mode === 'all_present'
      ? "<b>Mark All Present</b>\n\nSelect the period:"
      : s.mode === 'period_list'
        ? "<b>View Period List</b>\n\nSelect a period to view:"
        : "<b>Select Period</b>\n\nPlease select the period:";

    // Try to edit existing message first
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed or no previous message
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showPeriodMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load periods. Please try again.');
  }
}

async function showStudentMenu(chatId, className) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_students';
    s.className = className;

    // Fetch students with current status from Python
    const period = s.period || 'P1';
    const username = s.username || 'unknown';
    const pyRes = await callPython(`.get_students_for_marking ${className} ${period}`, chatId, username, chatId);

    let students = [];
    try {
      const response = JSON.parse(pyRes.reply);
      students = JSON.parse(response.reply);
    } catch (e) {
      console.error("Failed to parse students for marking:", e);
      // Fallback to static CLASSES if Python fails
      students = (CLASSES[className] || []).map(st => ({ ...st, status: 'P' }));
    }

    if (students.length === 0) {
      await safeSendMessage(chatId, `⚠️ No students found in class ${escapeHTML(className)}.`);
      return await showClassMenu(chatId);
    }

    // Store students in session for immediate toggle UI updates
    s.studentList = students;

    // Normalize selected state to an array of string rolls for reliable UI toggling
    const selectedSource = s.selected instanceof Set
      ? Array.from(s.selected)
      : Array.isArray(s.selected) ? s.selected : [];
    s.selected = selectedSource.map(r => String(r));

    // Create student buttons with the requested emojis
    const studentButtons = students.map(student => {
      const studentRoll = String(student.roll);
      const isSelected = s.selected.includes(studentRoll);

      // Initial display logic:
      // ✅ student.name for present
      // ❌ student.name (Status) for Sick/Leave
      // Toggling affects the emoji: ✅ -> ❌

      const isDefaultAbsent = student.status === 'S' || student.status === 'L';
      const isAbsent = isSelected ? !isDefaultAbsent : isDefaultAbsent;
      let emoji = isAbsent ? '❌' : '✅';
      let statusSuffix = '';

      if (student.status === 'S') {
        statusSuffix = ' (Sick)';
      } else if (student.status === 'L') {
        statusSuffix = ' (Leave)';
      }

      return {
        text: `${emoji} ${student.roll} - ${student.name}${statusSuffix}`,
        callback_data: `student:${studentRoll}`
      };
    });

    // Action buttons
    const actionButtons = [
      [
        { text: '📤 Submit', callback_data: 'action:confirm' }
      ],
      [
        { text: '🔙 Back', callback_data: 'action:back_to_class' }
      ]
    ];

    const keyboard = {
      inline_keyboard: [
        ...chunk(studentButtons, 2),
        ...actionButtons
      ]
    };

    const selectedCount = s.selected.length;
    const modeText = s.mode === 'absent' ? 'Mark Absent' :
      s.mode === 'all_present' ? 'Mark All Present' :
        s.mode && s.mode.startsWith('health:') ? 'Leave Status' : 'Select Students';

    const message = `👥 <b>Class ${escapeHTML(className)}</b>\n` +
      `📝 Mode: ${escapeHTML(modeText)}\n` +
      `✅ Selected for Absence: ${selectedCount} student${selectedCount !== 1 ? 's' : ''}\n\n` +
      "Tap students to toggle between Present (✅) and Absent (❌):";

    // Try to edit existing message
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }

  } catch (error) {
    console.error('Error in showStudentMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load student list. Please try again.');
  }
}

async function showClassMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_class';

    // Ensure CLASSES is loaded before proceeding
    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      console.log("CLASSES not loaded yet, initializing from database...");
      await initializeClasses();
    }

    const classes = Object.keys(CLASSES).sort();

    if (classes.length === 0) {
      await safeSendMessage(chatId, '⚠️ No classes found. Please check your members.xlsx file.');
      return await showMainMenu(chatId);
    }

    const buttons = classes.map(cls => ({
      text: `👥 ${cls}`,
      callback_data: `class:${cls}`
    }));

    const keyboard = {
      inline_keyboard: [
        ...chunk(buttons, 2),
        [{ text: "🔙 Back", callback_data: s.mode === 'all_present' || s.mode === 'period_list' || s.mode === 'absent' ? 'action:back_to_period' : 'menu:mark' }]
      ]
    };

    const message = "<b>🏫 Select Class</b>\n\nPlease choose a class:";

    // Try to edit existing message first
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showClassMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load classes. Please try again.');
  }
}

async function showHealthMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'menu_health';

    const kb = {
      inline_keyboard: [
        [
          { text: "💊 Mark Sick", callback_data: "health:S" },
          { text: "🏠 Mark Leave", callback_data: "health:L" }
        ],
        [
          { text: "😊 Mark Cured", callback_data: "health:C" },
          { text: "🎉 Mark Returned", callback_data: "health:R" }
        ],
        [
          { text: "📋 View Sick List", callback_data: "health:view_sick" },
          { text: "📋 View Leave List", callback_data: "health:view_leave" }
        ],
        [
          { text: "🔙 Back to Menu", callback_data: "menu:back_main" }
        ]
      ]
    };

    const message = "🏥 <b>Leave Status Menu</b>\n\nSelect an option:";

    // Try to edit existing message first
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: kb,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showHealthMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load health menu. Please try again.');
  }
}

async function showReportsMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'menu_reports';

    const kb = {
      inline_keyboard: [
        [
          { text: "📅 Today's Report", callback_data: "report:today" },
          { text: "📆 This Week's Report", callback_data: "report:week" }
        ],
        [
          { text: "📊 Class-wise Report", callback_data: "report:class" },
          { text: "👨‍🎓 Student-wise Report", callback_data: "report:student" }
        ],
        [
          { text: "🕒 Period-wise Data", callback_data: "report:period_wise" },
          { text: "📋 Class Details", callback_data: "report:class_details" }
        ],
        [
          { text: "🧮Percentage🧮", callback_data: "report:batch" }
        ],
        [
          { text: "➕ Extra Class Report", callback_data: "report:extra_menu" }
        ],
        [
          { text: "Export Data", callback_data: "report:export" }
        ],
        [
          { text: "Back to Main Menu", callback_data: "menu:back_main" }
        ]
      ]
    };

    const message = "<b>Reports Menu</b>\n\nPlease select a report type:";

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }

    const sent = await bot.sendMessage(chatId, message, {
      reply_markup: kb,
      parse_mode: 'HTML'
    });
    if (sent) s.lastMessageId = sent.message_id;

  } catch (error) {
    console.error('Error in showReportsMenu:', error);
    await safeSendMessage(chatId, 'Error: Failed to load reports. Please try again.');
  }
}

// Helper to get last N days
function getLastNDays(n) {
  const dates = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

async function showTodayPeriodStatus(chatId, username, className) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.className = className;

    // Use existing .daily_status command to get today's period-wise status for this class
    const cmd = `.daily_status ${className}`;
    const sender = s.sender || chatId;
    const pyRes = await callPython(cmd, sender, username, chatId);

    await handlePythonResponse(chatId, pyRes, true, 'menu:reports');

    // Clear state after showing the report
    delete state[chatId];
  } catch (error) {
    console.error('Error in showTodayPeriodStatus:', error);
    await safeSendMessage(chatId, '❌ Failed to load period status. Please try again.');
  }
}

async function showTodayPeriodReportClassMenu(chatId, username = 'unknown') {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_today_period_class';
    s.mode = 'today_period_report';

    // Ensure CLASSES is loaded before proceeding
    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      console.log("CLASSES not loaded yet, initializing from database...");
      await initializeClasses();
    }

    const classButtons = Object.keys(CLASSES).map(className => ({
      text: className,
      callback_data: `today_period_class:${className}`
    }));

    if (classButtons.length === 0) {
      await safeSendMessage(chatId, "⚠️ No classes found.");
      return;
    }

    const keyboard = {
      inline_keyboard: [
        ...chunk(classButtons, 3),
        [{ text: "🔙 Back to Reports", callback_data: "menu:reports" }]
      ]
    };

    const messageText = `🕒 <b>Today's Period-wise Report</b>\n\n` +
      `Select a class to view today's period status:\n` +
      `• Shows timetable for today\n` +
      `• Shows attendance status for each period\n` +
      `• Taken / Not Taken / Free periods`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log("Couldn't edit message, sending new one:", editError.message);
      }
    }

    const sentMessage = await bot.sendMessage(chatId, messageText, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showTodayPeriodReportClassMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load classes. Please try again.');
  }
}

async function showClassDetailsClassMenu(chatId, username = 'unknown') {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_class_details_class';
    s.mode = 'class_details_report';

    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      await initializeClasses();
    }

    const classButtons = Object.keys(CLASSES).sort().map(className => ({
      text: `🏫 ${className}`,
      callback_data: `class_details_class:${className}`
    }));

    if (classButtons.length === 0) {
      await safeSendMessage(chatId, "⚠️ No classes found.");
      return;
    }

    const keyboard = {
      inline_keyboard: [
        ...chunk(classButtons, 3),
        [{ text: "🔙 Back", callback_data: "menu:reports" }]
      ]
    };

    const messageText = `📋 <b>Class Details</b>\n\nSelect a class to view today's overview:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) { }
    }

    const sentMessage = await bot.sendMessage(chatId, messageText, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showClassDetailsClassMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load class menu.');
  }
}

async function showBatchReportClassMenu(chatId, username = 'unknown') {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'select_batch_report_class';
    s.mode = 'batch_report';

    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      await initializeClasses();
    }

    const classButtons = Object.keys(CLASSES).sort().map(className => ({
      text: `🏫 ${className}`,
      callback_data: `batch_report_class:${className}`
    }));

    if (classButtons.length === 0) {
      await safeSendMessage(chatId, "⚠️ No classes found.");
      return;
    }

    const keyboard = {
      inline_keyboard: [
        ...chunk(classButtons, 3),
        [{ text: "🔙 Back", callback_data: "menu:reports" }]
      ]
    };

    const messageText = `📊 <b>Batch-wise Report</b>\n\nSelect a class to generate vertical individual reports:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) { }
    }

    const sentMessage = await bot.sendMessage(chatId, messageText, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showBatchReportClassMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load batch report menu.');
  }
}

async function showPeriodReportDateMenu(chatId, username) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'report_period_date';

    // Fetch available dates from Python
    const pyRes = await callPython(".get_dates", 0, username, chatId);
    let dates = [];
    try {
      dates = JSON.parse(pyRes.reply);
    } catch (e) {
      console.error("Failed to parse dates:", e);
    }

    if (!dates || dates.length === 0) {
      await safeSendMessage(chatId, "⚠️ No attendance records found in the last 30 days.");
      return;
    }

    const dateButtons = dates.map(date => {
      const d = new Date(date);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const isToday = date === new Date().toISOString().split('T')[0];
      const label = isToday ? `Today (${date})` : `${dayName} (${date})`;
      return { text: label, callback_data: `p_rep_date:${date}` };
    });

    const kb = {
      inline_keyboard: [
        ...chunk(dateButtons, 2),
        [{ text: "🔙 Back", callback_data: "menu:reports" }]
      ]
    };

    const message = "🕒 <b>Period-wise Report</b>\n\nSelect a date with records:";

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }
    const sent = await bot.sendMessage(chatId, message, { reply_markup: kb, parse_mode: 'HTML' });
    if (sent) s.lastMessageId = sent.message_id;

  } catch (error) {
    console.error('Error in showPeriodReportDateMenu:', error);
    await safeSendMessage(chatId, '❌ Error loading dates.');
  }
}

async function showPeriodReportClassMenu(chatId, username) {
  try {
    const s = state[chatId];
    s.step = 'report_period_class';

    // Fetch classes for the selected date
    const pyRes = await callPython(`.get_classes ${s.reportDate}`, 0, username, chatId);
    let classes = [];
    try {
      classes = JSON.parse(pyRes.reply);
    } catch (e) { }

    if (!classes || classes.length === 0) {
      await safeSendMessage(chatId, `⚠️ No classes found for ${s.reportDate}.`);
      return;
    }

    const classButtons = classes.map(cls => ({
      text: cls,
      callback_data: `p_rep_class:${cls}`
    }));

    const kb = {
      inline_keyboard: [
        ...chunk(classButtons, 3),
        [{ text: "🔙 Back", callback_data: "report:period_wise" }]
      ]
    };

    const message = `🕒 <b>Period-wise Report</b>\n📅 Date: ${escapeHTML(s.reportDate)}\n\nSelect the class:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }
    const sent = await bot.sendMessage(chatId, message, { reply_markup: kb, parse_mode: 'HTML' });
    if (sent) s.lastMessageId = sent.message_id;
  } catch (e) {
    console.error(e);
  }
}

async function showPeriodReportPeriodMenu(chatId, username) {
  try {
    const s = state[chatId];
    s.step = 'report_period_period';

    // Fetch periods
    const pyRes = await callPython(`.get_periods ${s.reportDate} ${s.reportClass}`, 0, username, chatId);
    let periods = [];
    try {
      periods = JSON.parse(pyRes.reply);
    } catch (e) { }

    if (!periods || periods.length === 0) {
      await safeSendMessage(chatId, `⚠️ No periods found for ${s.reportClass} on ${s.reportDate}.`);
      return;
    }

    const periodButtons = periods.map(p => ({
      text: p,
      callback_data: `p_rep_period:${p}`
    }));

    const kb = {
      inline_keyboard: [
        ...chunk(periodButtons, 2),
        [{ text: "🔙 Back", callback_data: "p_rep_back_class" }]
      ]
    };

    const message = `🕒 <b>Period-wise Report</b>\n📅 Date: ${escapeHTML(s.reportDate)}\n🏫 Class: ${escapeHTML(s.reportClass)}\n\nSelect the period:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }
    const sent = await bot.sendMessage(chatId, message, { reply_markup: kb, parse_mode: 'HTML' });
    if (sent) s.lastMessageId = sent.message_id;
  } catch (e) {
    console.error(e);
  }
}
async function showExtraReportDateMenu(chatId, username) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'report_extra_date';

    const pyRes = await callPython(".get_extra_dates", 0, username, chatId);
    let dates = [];
    try {
      dates = JSON.parse(pyRes.reply);
    } catch (e) {
      console.error("Failed to parse extra dates:", e);
    }

    if (!dates || dates.length === 0) {
      await safeSendMessage(chatId, "⚠️ No extra class records found.");
      return await showReportsMenu(chatId);
    }

    const dateButtons = dates.map(date => {
      const d = new Date(date);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      return { text: `${dayName} ${date}`, callback_data: `report:extra_date:${date}` };
    });

    const kb = {
      inline_keyboard: [
        ...chunk(dateButtons, 2),
        [{ text: "🔙 Back", callback_data: "menu:reports" }]
      ]
    };

    const message = "➕ <b>Extra Class Report</b>\n\nSelect a date:";

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }
    const sent = await bot.sendMessage(chatId, message, { reply_markup: kb, parse_mode: 'HTML' });
    if (sent) s.lastMessageId = sent.message_id;

  } catch (error) {
    console.error('Error in showExtraReportDateMenu:', error);
    await safeSendMessage(chatId, 'Error loading menu.');
  }
}

async function showExtraReportListMenu(chatId, username, date) {
  try {
    const s = state[chatId] = state[chatId] || {};

    const pyRes = await callPython(`.get_extra_list ${date}`, 0, username, chatId);
    let classes = [];
    try {
      classes = JSON.parse(pyRes.reply);
    } catch (e) {
      console.error("Failed to parse extra classes list:", e);
    }

    if (!classes || classes.length === 0) {
      await safeSendMessage(chatId, `⚠️ No extra classes found on ${date}.`);
      return await showExtraReportDateMenu(chatId, username);
    }

    const buttons = classes.map(c => {
      const label = `${c.class} - ${c.teacher} (${c.period})`;
      return [{ text: label, callback_data: `report:extra_detail:${c.id}` }];
    });

    buttons.push([{ text: "🔙 Back", callback_data: "report:extra_menu" }]);

    const kb = {
      inline_keyboard: buttons
    };

    const message = `➕ <b>Extra Classes on ${escapeHTML(date)}</b>\n\nSelect a class to view detailed report:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (e) { }
    }
    const sent = await bot.sendMessage(chatId, message, { reply_markup: kb, parse_mode: 'HTML' });
    if (sent) s.lastMessageId = sent.message_id;

  } catch (error) {
    console.error('Error in showExtraReportListMenu:', error);
  }
}

async function showTeachersMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'menu_teachers';

    const kb = {
      inline_keyboard: [
        [
          { text: "👤 My Profile (ME)", callback_data: "menu:.me" }
        ],
        [
          { text: "👨‍🏫 All Teachers", callback_data: "menu:.teacher" }
        ],
        [
          { text: "🔙 Back to Menu", callback_data: "menu:back_main" }
        ]
      ]
    };

    const message = "<b>Teachers Menu</b>\n\nSelect an option:";

    // Try to edit existing message
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: kb,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showTeachersMenu:', error);
    await safeSendMessage(chatId, 'Error: Failed to load teachers menu. Please try again.');
  }
}

async function showExtraClassMenu(chatId, username = 'unknown') {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'extra_class_select_class';
    s.mode = 'extra_class';

    // Ensure CLASSES is loaded before proceeding
    if (!CLASSES || Object.keys(CLASSES).length === 0) {
      console.log("CLASSES not loaded yet, initializing from database...");
      await initializeClasses();
    }

    const classes = Object.keys(CLASSES).sort();

    if (classes.length === 0) {
      await safeSendMessage(chatId, '⚠️ No classes found.');
      return await showMainMenu(chatId, username);
    }

    const buttons = classes.map(cls => ({
      text: `👥 ${cls}`,
      callback_data: `extra_class:${cls}`
    }));

    const keyboard = {
      inline_keyboard: [
        ...chunk(buttons, 2),
        [{ text: "🔙 Back to Menu", callback_data: "menu:back_main" }]
      ]
    };

    const message = "📘 <b>Mark Extra Class</b>\n\nSelect the class:";

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showExtraClassMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load extra class menu.');
  }
}


async function showExtraClassSubjectMenu(chatId, cls, username) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'extra_class_select_subject';
    s.extraClassSelected = cls;

    // Fetch subjects
    const pyRes = await callPython(`.get_subjects ${cls}`, 0, username, chatId);
    let subjects = [];
    try {
      // Handle both cases: direct list string or wrapped reply
      let raw = pyRes;
      if (pyRes.reply) raw = pyRes.reply;

      if (typeof raw === 'string') {
        subjects = JSON.parse(raw);
      } else if (Array.isArray(raw)) {
        subjects = raw;
      }
    } catch (e) {
      subjects = [];
    }

    if (!Array.isArray(subjects)) subjects = [];

    const buttons = subjects.map(sub => ({
      text: `📘 ${sub}`,
      callback_data: `extra_subject:${sub}`
    }));

    // Add Manual Input Option
    buttons.push({ text: "⌨️ Type Manually / Other", callback_data: "extra_subject:MANUAL_INPUT" });

    const keyboard = {
      inline_keyboard: [
        ...chunk(buttons, 2),
        [{ text: "🔙 Back", callback_data: "menu:extra_class" }]
      ]
    };

    const message = `📘 <b>Extra Class Subject</b>\n\nClass: <b>${escapeHTML(cls)}</b>\nSelect the Subject:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showExtraClassSubjectMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load subjects.');
  }
}

async function showExtraClassAttendanceMenu(chatId) {
  try {
    const s = state[chatId] || {};
    const cls = s.extraClassSelected;
    const subject = s.extraClassSubject;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✔ All Present", callback_data: "extra_attendance:all_present" },
          { text: "✔ Mark Absent", callback_data: "extra_attendance:mark_absent" }
        ],
        [{ text: "🔙 Back", callback_data: `extra_class:${cls}` }]
      ]
    };

    const message = `📘 <b>Attendance Marking</b>\n\n` +
      `🏫 Class: <b>${escapeHTML(cls)}</b>\n` +
      `📘 Subject: <b>${escapeHTML(subject)}</b>\n\n` +
      `Select attendance option:`;

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } catch (editError) {
        console.log('Could not edit message in showExtraClassAttendanceMenu, sending new one');
        const sent = await bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        s.lastMessageId = sent.message_id;
      }
    } else {
      const sent = await bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
      s.lastMessageId = sent.message_id;
    }
  } catch (error) {
    console.error('Error in showExtraClassAttendanceMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load attendance menu.');
  }
}

async function showTimetableMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'menu_timetable';

    const kb = {
      inline_keyboard: [
        [
          { text: "1️⃣ 👤 My Classes Today", callback_data: "timetable:my" }
        ],
        [
          { text: "2️⃣ 🏫 All Classes Today", callback_data: "timetable:all" }
        ],
        [
          { text: "🔙 Back", callback_data: "menu:mark" }
        ]
      ]
    };

    const message = "📘 <b>Timetable Menu</b>\n\nSelect an option:";

    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: kb,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showTimetableMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load timetable menu.');
  }
}

async function showMarkMenu(chatId) {
  try {
    const s = state[chatId] = state[chatId] || {};
    s.step = 'menu_mark';

    const kb = {
      inline_keyboard: [
        [{ text: "📝 Take Attendance", callback_data: "mark:absent" }],
        [{ text: "📘 Today’s Timetable", callback_data: "mark:timetable" }],
        [{ text: "📋 Period Status", callback_data: "mark:period_list" }],
        [{ text: "🔙 Back to Menu", callback_data: "menu:back_main" }]
      ]
    };

    const message = "<b>Mark Attendance Menu</b>\n\nPlease select an option:";

    // Try to edit existing message first
    if (s.lastMessageId) {
      try {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: kb,
          parse_mode: 'HTML'
        });
        return;
      } catch (editError) {
        console.log('Could not edit message, sending new one');
      }
    }

    // Send new message if edit failed
    const sentMessage = await bot.sendMessage(chatId, message, {
      reply_markup: kb,
      parse_mode: 'HTML'
    });

    if (sentMessage && sentMessage.message_id) {
      s.lastMessageId = sentMessage.message_id;
    }
  } catch (error) {
    console.error('Error in showMarkMenu:', error);
    await safeSendMessage(chatId, '❌ Failed to load attendance menu. Please try again.');
  }
}

async function showHelpMenu(chatId, username = 'unknown') {
  const helpText = '📚 <b>Help Menu</b>\n\n' +
    '🎯 <b>Quick Start</b>\n' +
    '• Use /start - To begin\n' +
    '• Use /menu - To return to main menu\n' +
    '• Use /help - To see this help\n\n' +
    '📝 <b>Marking Attendance</b>\n' +
    '1. Tap "📝 Mark Attendance"\n' +
    '2. Select period and class\n' +
    '3. Choose students and mark status\n\n' +
    '🏥 <b>Health & Leave</b>\n' +
    '• 💊 Mark students as Sick/Leave\n' +
    '• ✅ Update return/cure status\n' +
    '• 📋 View current sick/leave lists\n\n' +
    '<b>Reports</b>:\n' +
    '- View daily/weekly reports\n' +
    '- Check class attendance\n' +
    '- Export data as needed\n\n' +
    '<b>Commands</b>:\n' +
    '/start - Show main menu\n' +
    '/menu - Return to main menu\n' +
    '/help - Show this help\n\n' +
    '<b>Manual Marking</b>: Use buttons for best experience. You can also type commands like:\n' +
    '- `P1 A 101 102` (Mark roll 101,102 absent in P1)\n' +
    '- `S 101` (Mark roll 101 as sick)\n' +
    '- `L 101` (Mark roll 101 on leave)';

  await bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
  await showMainMenu(chatId, username);
}

bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const user = callbackQuery.from;
  const s = state[chatId] = state[chatId] || {};

  // Get username in lowercase or use 'unknown' if not available
  const username = user.username ? user.username.toLowerCase() : 'unknown';
  s.username = username; // Store for use in other functions

  // EARLY ACCESS CONTROL: Check authorization immediately
  if (!await verifyAuth(chatId, username)) return;

  console.log("Raw Telegram username:", user.username); // Debug log

  console.log(`Callback from ${username} (${user.id}): ${data}`);

  // Edit Last Submission Handler (within 30m)
  if (data === "action:edit_last") {
    const lastSub = recentSubmissions.get(chatId);
    if (!lastSub) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "⚠️ No recent submission found to edit.", show_alert: true });
      return;
    }

    const elapsedMs = Date.now() - lastSub.timestamp;
    if (elapsedMs > 30 * 60 * 1000) {
      await bot.editMessageText(`🔒 <b>Edit Window Closed</b>\nAttendance records can only be edited\nwithin 30 minutes of submission.`, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'HTML'
      });
      recentSubmissions.delete(chatId);
      return;
    }

    // Re-open marking screen
    s.mode = lastSub.mode;
    s.period = lastSub.period;
    s.className = lastSub.className;
    s.extraClassSubject = lastSub.extraClassSubject;
    s.selected = [...lastSub.selected];
    s.isEditing = true;

    await bot.answerCallbackQuery(callbackQuery.id, { text: "🔄 Reopening marking screen..." });
    await showStudentMenu(chatId, s.className);
    return;
  }

  // Acknowledge callback to remove loading spinner
  try {
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (ackError) {
    console.error('Error acknowledging callback:', ackError.message);
  }

  console.log(`Callback received from ${user.username || user.id}:`, data);

  // Forward button click to Admin if Debug mode is ON
  if (debugMode && !isAdmin(user.username)) {
    const logMsg = `🔘 BUTTON CLICK\nName : ${user.first_name || ''} ${user.last_name || ''} (@${user.username || 'no-username'})\nData : ${data}\nTime : ${currentISTTime()}`;
    broadcastToAdmins(logMsg).catch(err => console.error("Debug forward failed:", err.message));
  }

  // Maintenance Mode Check (Teachers only)
  if (maintenanceMode && !isAdmin(username)) {
    if (data.includes('mark') || data.includes('health') || data.includes('attendance') || data.includes('extra')) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "🚧 System is currently under maintenance. Attendance marking is temporarily disabled. Please try again later. 😊",
        show_alert: true
      });
      return;
    }
  }

  try {
    // Admin Panel Actions
    if (data.startsWith("admin:")) {
      if (!isAdmin(username)) return;

      if (data === "admin:panel") {
        await showAdminPanel(chatId);
        return;
      }
      if (data === "admin:manage") {
        await showAdminManagement(chatId);
        return;
      }
      if (data === "admin:add_start") {
        s.waitingFor = 'admin_id_to_add';
        await safeSendMessage(chatId, "➕ <b>Add Administrator</b>\n\nPlease send the Telegram user ID of the person you want to add as an administrator.\n\n_Note: You can get a user's ID by having them send /start to the bot (the ID is usually visible in logs or via helper bots)._");
        return;
      }
      if (data === "admin:remove_list") {
        await showAdminRemoveList(chatId);
        return;
      }
      if (data.startsWith("admin:rem:")) {
        const remId = data.split(":")[2];
        const pyRes = await callPython(`.admin_remove ${remId}`, user.id, username, chatId);
        await safeSendMessage(chatId, pyRes.reply);
        await refreshAdmins();
        await showAdminManagement(chatId);
        return;
      }
      if (data === "admin:list") {
        const pyRes = await callPython(".admin_list", user.id, username, chatId);
        await safeSendMessage(chatId, pyRes.reply);
        return;
      }
      if (data === "admin:debug_on") {
        debugMode = true;
        await safeSendMessage(chatId, "🟢 Debug Mode: ON");
        await showAdminPanel(chatId);
        return;
      }
      if (data === "admin:debug_off") {
        debugMode = false;
        await safeSendMessage(chatId, "🔴 Debug Mode: OFF");
        await showAdminPanel(chatId);
        return;
      }
      if (data === "admin:maint_on") {
        maintenanceMode = true;
        await safeSendMessage(chatId, "🚧 Maintenance Mode: ON");
        await showAdminPanel(chatId);
        return;
      }
      if (data === "admin:maint_off") {
        maintenanceMode = false;
        await safeSendMessage(chatId, "✅ Maintenance Mode: OFF");
        await showAdminPanel(chatId);
        return;
      }
      if (data === "admin:status") {
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);
        const activeUsers = Object.keys(state).length;

        const statusText = `📊 <b>System Status</b>\n\n` +
          `Uptime: ${h}h ${m}m ${s}s\n` +
          `Debug Mode: ${debugMode ? 'ON' : 'OFF'}\n` +
          `Maintenance: ${maintenanceMode ? 'ON' : 'OFF'}\n` +
          `Active Sessions (Today): ${activeUsers}\n` +
          `DB Path: ${escapeHTML(DB_PATH)}`;
        await safeSendMessage(chatId, statusText);
        return;
      }
      if (data === "admin:db_status") {
        try {
          const stats = fs.statSync(DB_PATH);
          const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
          const lastWrite = stats.mtime.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

          const dbText = `📦 <b>Database Status</b>\n\n` +
            `Type: SQLite\n` +
            `Size: ${sizeMb} MB\n` +
            `Last Write: ${lastWrite}\n` +
            `Location: ${DB_PATH}`;
          await safeSendMessage(chatId, dbText);
        } catch (e) {
          await safeSendMessage(chatId, `❌ Error getting DB status: ${e.message}`);
        }
        return;
      }
      if (data === "admin:backup") {
        await safeSendMessage(chatId, "⌛ Creating immediate backup...");
        await sendDbToAdmin(bot, chatId);
        await safeSendMessage(chatId, "✅ Manual backup complete.");
        return;
      }
      if (data === "admin:error_log") {
        const log = lastErrors.length > 0 ? lastErrors.join('\n\n') : 'No errors logged yet.';
        await safeSendMessage(chatId, `⚠️ <b>Recent Errors (Last 10)</b>\n\n${log}`);
        return;
      }
      if (data === "admin:notif_test") {
        await safeSendMessage(chatId, "📣 Sending test notifications...");
        // Test Principal
        const pyPrincipal = await callPython(".admin_test_principal", user.id, username, chatId);
        await sendNotifications(pyPrincipal.notifications);
        // Test Teacher
        const pyTeacher = await callPython(".admin_test_teacher", user.id, username, chatId);
        await sendNotifications(pyTeacher.notifications);

        await safeSendMessage(chatId, "✅ Test notifications dispatched.");
        return;
      }
      if (data === "admin:summary") {
        const pyRes = await callPython(".admin_summary", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'admin:panel');
        return;
      }
      if (data === "admin:pending") {
        const pyRes = await callPython(".admin_pending", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'admin:panel');
        return;
      }
      if (data === "admin:sub_log") {
        const pyRes = await callPython(".admin_sub_log", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'admin:panel');
        return;
      }
    }
    // Menu actions
    if (data === "menu:help") {
      await showHelpMenu(chatId);
      return;
    }

    // Teacher menu actions (simplified - now handled by menu: commands)
    if (data === "menu:mark") {
      await showMarkMenu(chatId);
      return;
    }
    if (data === "menu:health") {
      await showHealthMenu(chatId);
      return;
    }

    // Report menu actions
    if (data.startsWith("report:")) {
      const action = data.split(":")[1];

      if (action === "today") {
        const pyRes = await callPython(".today", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'menu:reports');
        return;
      }

      if (action === "week") {
        const pyRes = await callPython(".week", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'menu:reports');
        return;
      }

      if (action === "class") {
        s.waitingFor = 'report_class_name';
        await safeSendMessage(chatId, "Please enter the Class Name (e.g., 10A):");
        return;
      }

      if (action === "student") {
        s.waitingFor = 'report_student_roll';
        await safeSendMessage(chatId, "Please enter the Student Roll No (e.g., 1201):");
        return;
      }

      if (action === "export") {
        await safeSendMessage(chatId, "⚠️ Export feature is coming soon!");
        return;
      }

      if (action === "period_wise") {
        await showTodayPeriodReportClassMenu(chatId, username);
        return;
      }
      if (action === "class_details") {
        await showClassDetailsClassMenu(chatId, username);
        return;
      }
      if (action === "batch") {
        await showBatchReportClassMenu(chatId, username);
        return;
      }
      if (action === "extra_menu") {
        await showExtraReportDateMenu(chatId, username);
        return;
      }
      if (action.startsWith("extra_date:")) {
        const date = action.split(":")[1];
        await showExtraReportListMenu(chatId, username, date);
        return;
      }
      if (action.startsWith("extra_detail:")) {
        const ecId = action.split(":")[1];
        const pyRes = await callPython(`.report_extra ${ecId}`, user.id, username, chatId);

        const kb = {
          inline_keyboard: [
            [{ text: "🔙 Back", callback_data: "report:extra_menu" }]
          ]
        };

        if (s.lastMessageId) {
          try {
            await bot.editMessageText(pyRes.reply, {
              chat_id: chatId,
              message_id: s.lastMessageId,
              parse_mode: 'HTML',
              reply_markup: kb
            });
          } catch (e) {
            await safeSendMessage(chatId, pyRes.reply, { parse_mode: 'HTML', reply_markup: kb });
          }
        } else {
          await safeSendMessage(chatId, pyRes.reply, { parse_mode: 'HTML', reply_markup: kb });
        }
        return;
      }
    }

    // Period Report actions
    if (data.startsWith("p_rep_date:")) {
      const date = data.split(":")[1];
      s.reportDate = date;
      await showPeriodReportClassMenu(chatId, username);
      return;
    }

    if (data.startsWith("p_rep_class:")) {
      const cls = data.split(":")[1];
      s.reportClass = cls;
      await showPeriodReportPeriodMenu(chatId, username);
      return;
    }

    if (data === "p_rep_back_class") {
      await showPeriodReportClassMenu(chatId, username);
      return;
    }

    if (data.startsWith("p_rep_period:")) {
      const period = data.split(":")[1];
      // Call Python: .period_report <DATE> <CLASS> <PERIOD>
      const cmd = `.period_report ${s.reportDate} ${s.reportClass} ${period}`;

      const pyRes = await callPython(cmd, user.id, username, chatId);

      if (s.lastMessageId) {
        await dustEffectDelete(chatId, s.lastMessageId);
      }

      await handlePythonResponse(chatId, pyRes, true, 'menu:reports');
      return;
    }

    // Extra Class Action
    if (data.startsWith("extra_class:")) {
      const cls = data.split(":")[1];
      s.extraClassSelected = cls;
      await showExtraClassSubjectMenu(chatId, cls, username);
      return;
    }

    // Extra Class Subject Selection
    if (data.startsWith("extra_subject:")) {
      const subject = data.split(":")[1];
      const cls = s.extraClassSelected;

      if (subject === "MANUAL_INPUT") {
        s.waitingFor = 'extra_class_subject';
        if (s.lastMessageId) {
          await dustEffectDelete(chatId, s.lastMessageId);
        }
        await safeSendMessage(chatId, `Selected Class: <b>${escapeHTML(cls)}</b>\nPlease type the subject name:`, { parse_mode: 'HTML' });
        return;
      }

      // Store subject and show attendance options
      s.extraClassSubject = subject;
      await showExtraClassAttendanceMenu(chatId);
      return;
    }

    // Extra Class Attendance Options
    if (data.startsWith("extra_attendance:")) {
      const option = data.split(":")[1];
      s.className = s.extraClassSelected;
      s.mode = 'extra_attendance';

      if (option === 'all_present') {
        const username = callbackQuery.from.username;
        const sender = callbackQuery.from.id;
        const command = `.extra_att ${s.className} ${s.extraClassSubject}`; // Empty rolls means all present

        try {
          const pyRes = await callPython(command, sender, username, chatId);
          if (s.lastMessageId) await dustEffectDelete(chatId, s.lastMessageId);
          await handlePythonResponse(chatId, pyRes);
          delete state[chatId];
          await showMainMenu(chatId);
        } catch (error) {
          console.error("Error marking all present for extra class:", error);
          await safeSendMessage(chatId, "❌ Failed to record attendance.");
        }
        return;
      } else if (option === 'mark_absent') {
        s.selected = new Set(); // Reset selection
        await showStudentMenu(chatId, s.className);
        return;
      }
    }

    // Handle Status Confirm for Extra Class (MUST be above generic status_confirm:)
    if (data.startsWith("status_confirm:") && s.mode === 'extra_attendance') {
      const actionStatus = data.split(":")[1]; // P or A
      const cls = s.className;
      const subject = s.extraClassSubject;
      const selectedRolls = Array.from(s.selected || []);

      let absentRolls = [];

      if (actionStatus === 'A') {
        // In extra class "Mark Absent" mode, selected students are absent
        absentRolls = selectedRolls;
      } else { // P (Mark as Present)
        // Ensure CLASSES is loaded before proceeding
        if (!CLASSES || Object.keys(CLASSES).length === 0) {
          await initializeClasses();
        }
        // In extra class "Mark Absent" mode, students NOT selected are present.
        const allStudents = CLASSES[cls] || [];
        const selectedSet = s.selected || new Set();
        absentRolls = allStudents
          .filter(st => !selectedSet.has(st.roll))
          .map(st => st.roll);
      }

      const username = callbackQuery.from.username;
      const sender = callbackQuery.from.id;
      const command = `.extra_att ${cls} ${subject} ${absentRolls.join(" ")}`;

      try {
        const pyRes = await callPython(command, sender, username, chatId);
        if (s.lastMessageId) await dustEffectDelete(chatId, s.lastMessageId);
        await handlePythonResponse(chatId, pyRes);
      } catch (error) {
        console.error("Error saving extra class attendance:", error);
        await safeSendMessage(chatId, "❌ Failed to record attendance.");
      }

      delete state[chatId];
      await showMainMenu(chatId, username);
      return;
    }



    if (data === "report:today" || data === "menu:.today") {
      console.log(`Handling Today's Report request: ${data}`);
      s.mode = 'report_today';
      await showClassMenu(chatId);
      return;
    }

    // Extra Class Report Handlers
    if (data === "report:extra_menu") {
      await showExtraReportDateMenu(chatId, username);
      return;
    }

    if (data.startsWith("report:extra_date:")) {
      const date = data.split(":")[2];
      await showExtraReportListMenu(chatId, username, date);
      return;
    }

    if (data.startsWith("today_period_class:")) {
      const className = data.split(":")[1];
      await showTodayPeriodStatus(chatId, username, className);
      return;
    }

    if (data.startsWith("class_details_class:")) {
      const className = data.split(":")[1];
      const pyRes = await callPython(`.class_details ${className}`, callbackQuery.from.id, username, chatId);
      await handlePythonResponse(chatId, pyRes, true, 'report:class_details');
      return;
    }

    if (data.startsWith("batch_report_class:")) {
      const className = data.split(":")[1];
      const pyRes = await callPython(`.batch_report ${className}`, callbackQuery.from.id, username, chatId);

      // Batch report length check for safe chunking
      const reportText = (pyRes && typeof pyRes === 'object') ? pyRes.reply : pyRes;

      if (typeof reportText === 'string' && reportText.length > 3500) {
        const chunks = splitMessage(reportText, 3500);
        for (let i = 0; i < chunks.length; i++) {
          await safeSendMessage(chatId, chunks[i], { parse_mode: 'HTML' });
          if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        await showBackButtonMessage(chatId, 'report:batch');
      } else {
        await handlePythonResponse(chatId, pyRes, true, 'report:batch');
      }
      return;
    }

    if (data === "menu:reports") {
      await showReportsMenu(chatId);
      return;
    }
    if (data === "menu:teachers") {
      await showTeachersMenu(chatId);
      return;
    }
    if (data === "menu:extra_class") {
      await showExtraClassMenu(chatId, username);
      return;
    }
    if (data === "menu:back_main") {
      await showMainMenu(chatId, username);
      return;
    }
    if (data.startsWith("menu:")) {
      // direct commands like .sick .leave .teacher .me .export
      const cmd = data.replace("menu:", "");

      // Check if it's a teacher-related command to show back button
      const isTeacherCommand = cmd === '.me' || cmd === '.teacher';

      // forward to python as text command
      const pyRes = await callPython(cmd, user.id, username, chatId);

      // Show back button for teacher commands
      if (isTeacherCommand) {
        await handlePythonResponse(chatId, pyRes, true, 'menu:teachers');
      } else {
        await handlePythonResponse(chatId, pyRes);
      }
      return;
    }

    // Mark submenu actions
    if (data.startsWith("mark:")) {
      const action = data.split(":")[1];
      if (action === "absent") {
        s.mode = "absent";
        await showPeriodMenu(chatId);
        return;
      }
      if (action === "substitute") {
        s.mode = "substitute";
        await showPeriodMenu(chatId);
        return;
      }
      if (action === "all_present") {
        s.mode = "all_present";
        await showPeriodMenu(chatId);
        return;
      }
      if (action === "period_list") {
        s.mode = "period_list";
        await showPeriodMenu(chatId);
        return;
      }
      if (action === "confirm_y") {
        const sender = callbackQuery.from.id;
        const pyRes = await callPython("Y", sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        return;
      }
      if (action === "cancel_b") {
        const sender = callbackQuery.from.id;
        const pyRes = await callPython("B", sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        return;
      }
      if (action === "daily_summary") {
        const pyRes = await callPython(".daily_aggregate", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'menu:mark');
        return;
      }
    }

    // Health submenu actions
    if (data.startsWith("health:")) {
      const code = data.split(":")[1]; // S/L/R/C or view_sick/view_leave

      // Handle view commands differently (they don't need period/class selection)
      if (code === "view_sick") {
        const pyRes = await callPython(".sick", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'menu:health');
        return;
      }
      if (code === "view_leave") {
        const pyRes = await callPython(".leave", user.id, username, chatId);
        await handlePythonResponse(chatId, pyRes, true, 'menu:health');
        return;
      }

      // For S/L/C/R actions, go to class selection
      s.mode = `health:${code}`;
      await showClassMenu(chatId);
      return;
    }

    // Period selected
    if (data.startsWith("period:")) {
      const period = data.split(":")[1];
      s.period = period;

      // Next step based on mode
      if (s.mode === "extra_attendance") {
        // We already know the class, so go straight to student selection
        s.selected = new Set();
        await showStudentMenu(chatId, s.className);
      } else if (s.mode === "all_present" || s.mode === "period_list" || s.mode === "absent" || s.mode === "substitute") {
        await showClassMenu(chatId);
      } else {
        // default behavior
        await showClassMenu(chatId);
      }
      return;
    }

    // Class selected
    if (data.startsWith("class:")) {
      const className = data.split(":")[1];
      s.className = className;
      s.selected = [];
      // Depending on mode
      if (s.mode === "all_present") {
        // Send: all present Pn CLASS
        const cmd = `all present ${s.period} ${s.className}`;
        const sender = callbackQuery.from.id;
        const pyRes = await callPython(cmd, sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        delete state[chatId];
        await showMainMenu(chatId);
        return;
      }
      if (s.mode === "period_list") {
        // Send: .list Pn CLASS
        const cmd = `.list ${s.period} ${s.className}`;
        const sender = callbackQuery.from.id;
        const pyRes = await callPython(cmd, sender, username, chatId);
        // Show report with a Back button to return to period selection
        await handlePythonResponse(chatId, pyRes, true, 'action:back_to_period');
        return;
      }
      if (s.mode === "report_today") {
        const cmd = `.daily_status ${s.className}`;
        const sender = callbackQuery.from.id;
        const pyRes = await callPython(cmd, sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        delete state[chatId];
        await showMainMenu(chatId);
        return;
      }
      if (s.mode === "report_not_taken") {
        // Send: .not_taken CLASS
        const cmd = `.not_taken ${s.className}`;
        const sender = callbackQuery.from.id;
        const pyRes = await callPython(cmd, sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        delete state[chatId];
        await showMainMenu(chatId);
        return;
      }
      if (s.mode && s.mode.startsWith("health:")) {
        // Time-based health flow: go straight to student selection
        await showStudentMenu(chatId, s.className);
        return;
      }
      if (s.mode === "report_class") {
        // Send .class CLASS
        const cmd = `.class ${s.className}`;
        const sender = callbackQuery.from.id;
        const pyRes = await callPython(cmd, sender, username, chatId);
        await handlePythonResponse(chatId, pyRes);
        delete state[chatId];
        await showMainMenu(chatId);
        return;
      }
      // For absent or health flows, go to student selection
      await showStudentMenu(chatId, s.className);
      return;
    }

    // Toggle student selection (handle both 'toggle:' and 'student:' callbacks)
    if (data.startsWith("toggle:") || data.startsWith("student:")) {
      const roll = String(data.split(":")[1]);
      const selectedSource = s.selected instanceof Set
        ? Array.from(s.selected)
        : Array.isArray(s.selected) ? s.selected : [];
      const selected = selectedSource.map(r => String(r));

      // 2️⃣ Create a NEW updated array (No mutation)
      let newSelected;
      if (selected.includes(roll)) {
        newSelected = selected.filter(r => r !== roll);
      } else {
        newSelected = [...selected, roll];
      }

      // 3️⃣ Immediately update session state
      s.selected = newSelected;

      try {
        await renderStudentToggleUI(bot, chatId, callbackQuery.message.message_id, s);
      } catch (e) {
        console.error("Toggle UI update failed:", e.message);
      }
      return;
    }

    // Status confirmation
    if (data.startsWith("status_confirm:")) {
      const status = data.split(":")[1];
      s.status = status; // Store the selected status

      // Show confirmation message with buttons
      const statusText = {
        'P': '✅ Present',
        'A': '❌ Absent',
        'S': '💊 Sick',
        'L': '🏖️ Leave',
        'R': '🔁 Return'
      }[status] || status;

      const confirmText = `Are you sure you want to mark the selected students as ${statusText}?`;
      const confirmKb = {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `confirm_final:${status}` },
            { text: '❌ Cancel', callback_data: 'action:back_to_students' }
          ]
        ]
      };

      await bot.editMessageText(confirmText, {
        chat_id: chatId,
        message_id: s.lastMessageId,
        reply_markup: confirmKb
      });
      return;
    }

    // Final confirmation handler
    if (data.startsWith("confirm_final:")) {
      const status = data.split(":")[1];
      const sender = callbackQuery.from.id;
      const rolls = s.selected || [];

      if (rolls.length === 0) {
        await bot.sendMessage(chatId, "No students selected. Please try again.");
        await showStudentMenu(chatId);
        return;
      }

      // Build the command based on the mode
      let command = '';
      if (s.mode === 'absent' || s.mode === 'substitute') {
        command = `${s.period} ${s.className} ${status} ${rolls.join(" ")}`;
      } else if (s.mode && s.mode.startsWith('health:')) {
        const healthType = s.mode.split(':')[1];
        command = `${healthType} ${rolls.join(" ")}`;
      } else {
        command = `${s.period} ${s.className} ${status} ${rolls.join(" ")}`;
      }

      // Call Python script
      const pyRes = await callPython(command, sender, username, chatId);

      // Show success message
      await safeSendMessage(
        chatId,
        `✅ Successfully updated attendance:\n` +
        `Status: ${escapeHTML(status)}\n` +
        `Students: ${rolls.length}\n` +
        `<pre>${escapeHTML(pyRes.reply || 'Done')}</pre>`,
        { parse_mode: 'HTML' }
      );
      try {
        await sendNotifications(pyRes.notifications);
      } catch (notifyErr) {
        console.error("Failed to send notifications:", notifyErr);
      }

      // Reset state and return to main menu
      delete state[chatId];
      await showMainMenu(chatId);
      return;
    }

    // Show confirmation dialog or submit
    if (data === "action:show_confirm" || data === "action:submit") {
      if (!s.selected || s.selected.size === 0) {
        // Answer callback query with alert
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "⚠️ Please select at least one student first!",
          show_alert: true
        });
        return;
      }

      // For absent mode, proceed directly to mark
      if (s.mode === 'absent' && s.period && s.className) {
        const rolls = s.selected || [];
        const sender = callbackQuery.from.id;
        const command = `${s.period} ${s.className} A ${rolls.join(" ")}`;

        try {
          // 1. Save attendance to DB
          const pyRes = await callPython(command, sender, username, chatId);

          // ✨ Use dust effect deletion for smooth transition
          if (s.lastMessageId) {
            // Don't await this to prevent blocking
            dustEffectDelete(chatId, s.lastMessageId).catch(err => console.error("Dust effect failed:", err));
          }

          // Check if response indicates a warning/error (e.g. sequential check failed, blocked action)
          if (pyRes.reply && (pyRes.reply.startsWith('⚠️') || pyRes.reply.startsWith('❌') || pyRes.reply.startsWith('🚫'))) {
            await safeSendMessage(chatId, pyRes.reply);
          } else {
            // 2. Generate attendance summary message
            await safeSendMessage(
              chatId,
              pyRes.reply || "✅ Attendance marked successfully.",
              { parse_mode: 'HTML' }
            );

            // 3. Send notifications (Summary, Class Teacher, Principal, Substitute)
            if (pyRes.notifications && Array.isArray(pyRes.notifications)) {
              console.log("Attempting to send notifications...");
              // Wrap in try/catch to ensure it doesn't crash the bot
              try {
                await sendNotifications(pyRes.notifications);
              } catch (notifyErr) {
                console.error("CRITICAL: Failed to send notifications:", notifyErr);
              }
            }
          }

          // Reset state and return to main menu
          delete state[chatId];
          await showMainMenu(chatId);
        } catch (error) {
          console.error("Error in absent marking flow:", error);
          await safeSendMessage(chatId, "❌ An error occurred while marking attendance.");
        }
        return;
      }

      // For health mode, proceed directly to mark
      if (s.mode && s.mode.startsWith('health:')) {
        const rolls = s.selected || [];
        const sender = callbackQuery.from.id;
        const code = s.mode.split(':')[1]; // S/L/R/C
        // Build command: <code> <rolls>
        const command = `${code} ${rolls.join(" ")}`;

        try {
          const pyRes = await callPython(command, sender, username, chatId);

          // ✨ Use dust effect deletion for smooth transition
          if (s.lastMessageId) {
            await dustEffectDelete(chatId, s.lastMessageId);
          }

          // Check if response indicates a warning/error
          if (pyRes.reply && (pyRes.reply.startsWith('⚠️') || pyRes.reply.startsWith('❌') || pyRes.reply.startsWith('🚫'))) {
            await bot.sendMessage(chatId, pyRes.reply);
          } else {
            // Map codes to friendly names
            const statusNames = {
              'S': '💊 Sick',
              'L': '🏠 On Leave',
              'C': '😊 Cured',
              'R': '🎉 Returned'
            };

            // Show success message
            await safeSendMessage(
              chatId,
              `✅ <b>Health Status Updated!</b>\n\n` +
              `📋 Status: ${statusNames[code] || code}\n` +
              `👥 Students: ${rolls.length}\n\n` +
              `${pyRes.reply || 'Successfully updated'}\n\n` +
              `Notifications sent to relevant teachers and parents.`,
              { parse_mode: 'HTML' }
            );

            try {
              await sendNotifications(pyRes.notifications);
            } catch (notifyErr) {
              console.error("Failed to send notifications:", notifyErr);
            }
          }

          // Reset state and return to main menu
          delete state[chatId];
          await showMainMenu(chatId);
          return;
        } catch (error) {
          console.error('Error updating health status:', error);
          await bot.sendMessage(chatId, '❌ Failed to update health status. Please try again.');
          return;
        }
      }

      // For other modes, show status selection
      const confirmText = `You have selected ${s.selected.length} student(s).\n\nWhat would you like to do?`;
      const confirmKb = {
        inline_keyboard: [
          [
            { text: '✅ Mark Present', callback_data: 'status_confirm:P' },
            { text: '❌ Mark Absent', callback_data: 'status_confirm:A' }
          ],
          [
            { text: '🔙 Back', callback_data: 'action:back_to_students' }
          ]
        ]
      };

      try {
        await bot.editMessageText(confirmText, {
          chat_id: chatId,
          message_id: s.lastMessageId,
          reply_markup: confirmKb
        });
      } catch (e) {
        await bot.sendMessage(chatId, confirmText, { reply_markup: confirmKb });
      }
      return;
    }


    // Action handlers: confirm, back, select all, clear all
    if (data.startsWith("action:")) {
      const action = data.split(":")[1];
      if (action === "confirm") {
        // Allow submitting with 0 students (Implies All Present)

        // Context-aware confirm
        const rolls = s.selected || [];
        const sender = callbackQuery.from.id;

        if (s.mode === 'extra_attendance') {
          const command = `.extra_att ${s.className} ${s.extraClassSubject} ${rolls.join(" ")}`;
          try {
            const pyRes = await callPython(command, sender, username, chatId);
            if (s.lastMessageId) {
              await dustEffectDelete(chatId, s.lastMessageId);
            }

            // TRACK FOR EDIT
            trackSubmission(chatId, s, command);
            await sendSuccessWithEdit(chatId, pyRes.reply || "✅ Extra class attendance recorded successfully.");

            delete state[chatId];
            await showMainMenu(chatId);
          } catch (error) {
            console.error("Error saving extra class attendance:", error);
            await safeSendMessage(chatId, "❌ Failed to record attendance.");
          }
          return;
        }

        if (s.mode === "absent" || s.mode === "substitute") {
          const prefix = s.isEditing ? ".edit " : "";
          const cmdPrefix = s.mode === "substitute" ? "S" : "";
          const command = `${prefix}${cmdPrefix}${s.period} ${s.className} A ${rolls.join(" ")}`;

          try {
            // 1. Save attendance to DB
            const pyRes = await callPython(command, sender, username, chatId);

            // ✨ Use dust effect deletion for smooth transition
            if (s.lastMessageId) {
              dustEffectDelete(chatId, s.lastMessageId).catch(err => console.error("Dust effect failed:", err));
            }

            // Check if response indicates a warning/error
            if (pyRes.reply && (pyRes.reply.startsWith('⚠️') || pyRes.reply.startsWith('❌') || pyRes.reply.startsWith('🚫'))) {
              await safeSendMessage(chatId, pyRes.reply);
            } else {
              // 2. Track for potential edit and send success with button
              trackSubmission(chatId, s, command);
              await sendSuccessWithEdit(chatId, pyRes.reply || "✅ Attendance marked successfully.");

              // 3. Send notifications
              if (pyRes.notifications && Array.isArray(pyRes.notifications)) {
                try {
                  await sendNotifications(pyRes.notifications);
                } catch (notifyErr) {
                  console.error("Failed to send notifications:", notifyErr);
                }
              }
            }

            delete state[chatId];
            await showMainMenu(chatId);
          } catch (error) {
            console.error("Error in marking flow:", error);
            await safeSendMessage(chatId, "❌ An error occurred while marking attendance.");
          }
          return;
        }
        if (s.mode && s.mode.startsWith("health:")) {
          const code = s.mode.split(":")[1]; // S/L/R/C
          // Build command: <code> <rolls>
          const command = `${code} ${rolls.join(" ")}`;
          const username = callbackQuery.from.username;
          const pyRes = await callPython(command, sender, username, chatId);

          // ✨ Use dust effect deletion for smooth transition
          if (s.lastMessageId) {
            await dustEffectDelete(chatId, s.lastMessageId);
          }

          // Check if response indicates a warning/error
          if (pyRes.reply && (pyRes.reply.startsWith('⚠️') || pyRes.reply.startsWith('❌') || pyRes.reply.startsWith('🚫'))) {
            await bot.sendMessage(chatId, pyRes.reply);
          } else {
            // Map codes to friendly names
            const statusNames = {
              'S': '💊 Sick',
              'L': '🏠 On Leave',
              'C': '😊 Cured',
              'R': '🎉 Returned'
            };

            await bot.sendMessage(
              chatId,
              `✅ <b>Health Status Updated!</b>\n\n` +
              `📋 Status: ${statusNames[code] || code}\n` +
              `👥 Students: ${rolls.length}\n\n` +
              `${pyRes.reply || 'Done'}\n\n` +
              `Notifications sent to relevant teachers and parents.`,
              { parse_mode: 'HTML' }
            );
          }

          await sendNotifications(pyRes.notifications);
          delete state[chatId];
          await showMainMenu(chatId);
          return;
        }

        // For other unhandled modes, just return to main menu
        await bot.sendMessage(chatId, '⚠️ Unknown mode. Returning to main menu.');
        delete state[chatId];
        await showMainMenu(chatId);
        return;
      }
      if (action === "back_to_class") {
        // go back to class selection
        await showClassMenu(chatId);
        return;
      }
      if (action === "back_to_period") {
        // go back to period selection
        await showPeriodMenu(chatId);
        return;
      }
      if (action === "select_all") {
        // Ensure CLASSES is loaded before proceeding
        if (!CLASSES || Object.keys(CLASSES).length === 0) {
          await initializeClasses();
        }
        const students = (s.studentList && s.studentList.length > 0) ? s.studentList : (CLASSES[s.className] || []);
        s.selected = students.map(st => String(st.roll));

        try {
          await renderStudentToggleUI(bot, chatId, callbackQuery.message.message_id, s);
        } catch (e) { }
        return;
      }
      if (action === "toggle_all") {
        // Ensure CLASSES is loaded before proceeding
        if (!CLASSES || Object.keys(CLASSES).length === 0) {
          await initializeClasses();
        }
        const students = (s.studentList && s.studentList.length > 0) ? s.studentList : (CLASSES[s.className] || []);
        const selectedSource = s.selected instanceof Set
          ? Array.from(s.selected)
          : Array.isArray(s.selected) ? s.selected : [];
        const selected = selectedSource.map(r => String(r));
        const isAllSelected = (selected.length === students.length);
        if (isAllSelected) {
          s.selected = [];
        } else {
          s.selected = students.map(st => String(st.roll));
        }

        try {
          await renderStudentToggleUI(bot, chatId, callbackQuery.message.message_id, s);
        } catch (e) { }
        return;
      }
      if (action === "clear_all") {
        s.selected = [];

        try {
          await renderStudentToggleUI(bot, chatId, callbackQuery.message.message_id, s);
        } catch (e) { }
        return;
      }
      if (action === "back_to_students") {
        await showStudentMenu(chatId, s.className);
        return;
      }
    }

    // Status chosen (P, A, S, L, R)
    if (data.startsWith("status:")) {
      const status = data.split(":")[1]; // P/A/S/L/R
      s.status = status;
      // Build command string to send to Python
      const rolls = Array.from(s.selected || []);
      let command = "";
      if (status === "A") {
        command = `${s.period} ${s.className} ${status} ${rolls.join(" ")}`;
      } else {
        command = `${status} ${s.className} ${rolls.join(" ")}`;
      }
      // Send to python
      const sender = callbackQuery.from.id;
      const username = callbackQuery.from.username;
      const pyRes = await callPython(command, sender, username, chatId);
      // reply to chat
      const replyText = pyRes.reply || JSON.stringify(pyRes);
      await safeSendMessage(chatId, `✅ Done.\n${replyText}`);
      try {
        await sendNotifications(pyRes.notifications);
      } catch (notifyErr) {
        console.error("Failed to send notifications:", notifyErr);
      }
      // reset state or go to main menu
      delete state[chatId];
      await showMainMenu(chatId);
      return;
      return;
    }

    // Timetable menu
    if (data === "mark:timetable") {
      await showTimetableMenu(chatId);
      return;
    }

    if (data === "timetable:my") {
      const username = callbackQuery.from.username;
      const pyRes = await callPython(".timetable my", callbackQuery.from.id, username, chatId);
      await handlePythonResponse(chatId, pyRes, true, 'mark:timetable');
      return;
    }

    if (data === "timetable:all") {
      const username = callbackQuery.from.username;
      const pyRes = await callPython(".timetable all", callbackQuery.from.id, username, chatId);
      await handlePythonResponse(chatId, pyRes, true, 'mark:timetable');
      return;
    }

  } catch (err) {
    console.error("Error handling callback:", err);
    console.error("Error details:", {
      data,
      chatId,
      state: s,
      error: {
        message: err.message,
        stack: err.stack
      }
    });

    try {
      await bot.sendMessage(
        chatId,
        `⚠️ Error: ${err.message || 'Unknown error occurred'}\n\n` +
        'Please try again or use /menu to return to the main menu.'
      );
    } catch (sendError) {
      console.error('Could not send error message to user:', sendError);
    }
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const s = state[chatId] = state[chatId] || {};

  // Get username with fallback to 'unknown' if not available
  const username = (msg.from && msg.from.username) ?
    (msg.from.username.startsWith('@') ? msg.from.username : `@${msg.from.username}`) :
    'unknown';
  const usernameForCheck = msg.from.username ? msg.from.username.toLowerCase() : 'unknown';

  // EARLY ACCESS CONTROL: Check authorization immediately
  if (!await verifyAuth(chatId, usernameForCheck)) return;

  console.log("=== MESSAGE DEBUG ===");
  console.log("Full msg.from object:", JSON.stringify(msg.from, null, 2));
  console.log("======================");

  // Forward User Action to Admin if Debug Mode is ON
  if (debugMode && !isAdmin(usernameForCheck)) {
    const logMsg = `👨‍🏫 USER ACTION\nName   : ${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || 'no-username'})\nID     : ${msg.from.id}\nAction : ${text}\nTime   : ${currentISTTime()}`;
    broadcastToAdmins(logMsg).catch(err => console.error("Debug forward failed:", err.message));
  }

  // Maintenance Mode Check (Teachers only)
  if (maintenanceMode && !isAdmin(usernameForCheck)) {
    // Only block if it looks like an attendance command or they are in a marking flow
    const isMarkingCmd = /^[PL]\d+/i.test(text) || /^[S LRC] /i.test(text) || text.toLowerCase().includes('present');
    const isFlow = s.step && (s.step.includes('mark') || s.step.includes('health') || s.step.includes('extra'));

    if (isMarkingCmd || isFlow) {
      await safeSendMessage(chatId, "🚧 <b>System Maintenance</b>\n\nThe attendance system is currently undergoing maintenance. Attendance marking is temporarily disabled. Please try again in some time. Thank you for your patience! 😊");
      return;
    }
  }

  // Skip commands and non-text messages
  if (text.startsWith('/') && text !== '/claim_admin') return;

  try {
    // Handle claim admin command
    if (text === '/claim_admin') {
      const pyRes = await callPython("/claim_admin", msg.from.id, username, chatId);
      await safeSendMessage(chatId, pyRes.reply);
      await refreshAdmins();
      return;
    }

    // Handle adding admin ID input
    if (s.waitingFor === 'admin_id_to_add') {
      const newAdminId = text.trim();
      if (/^\d+$/.test(newAdminId)) {
        const pyRes = await callPython(`.admin_add ${newAdminId}`, msg.from.id, username, chatId);
        await safeSendMessage(chatId, pyRes.reply);
        await refreshAdmins();
      } else {
        await safeSendMessage(chatId, "❌ Invalid ID format. Please send a numeric Telegram ID.");
      }
      delete s.waitingFor;
      await showAdminManagement(chatId);
      return;
    }

    // Handle teacher data input
    if (s.waitingFor === 'teacher_data') {
      const teacherData = parseTeacherData(text);
      if (teacherData) {
        const command = `.teacher add "${teacherData.name}" "${teacherData.phone}" "${teacherData.telegram}" "${teacherData.class || ''}"`;
        const pyRes = await callPython(command, msg.from.id, username, chatId);

        if (pyRes && pyRes.reply) {
          await safeSendMessage(chatId, `✅ ${pyRes.reply}`);
        } else {
          await safeSendMessage(chatId, '✅ Teacher added successfully!');
        }
        await loadTeachersFromDB(); // SYNC: Refresh authorized users list
      } else {
        await safeSendMessage(chatId, '❌ Invalid format. Please use the format shown above.');
      }
      delete s.waitingFor;
      await showTeachersMenu(chatId);
      return;
    }

    // Handle edit teacher data
    if (s.waitingFor === 'edit_teacher_data') {
      const teacherData = parseTeacherEditData(text);
      if (teacherData && teacherData.id) {
        const command = `.teacher edit ${teacherData.id} "${teacherData.name || ''}" "${teacherData.phone || ''}" "${teacherData.telegram || ''}" "${teacherData.class || ''}"`;
        const pyRes = await callPython(command, msg.from.id, username, chatId);

        if (pyRes && pyRes.reply) {
          await safeSendMessage(chatId, `✅ ${pyRes.reply}`);
        } else {
          await safeSendMessage(chatId, '✅ Teacher updated successfully!');
        }
        await loadTeachersFromDB(); // SYNC: Refresh authorized users list
      } else {
        await safeSendMessage(chatId, '❌ Invalid format. Please include the teacher ID and updated fields.');
      }
      delete s.waitingFor;
      await showTeachersMenu(chatId);
      return;
    }

    // Handle remove teacher confirmation
    if (s.waitingFor === 'remove_teacher_id') {
      const teacherId = text.trim();
      if (/^\d+$/.test(teacherId)) {
        const command = `.teacher remove ${teacherId}`;
        const pyRes = await callPython(command, msg.from.id, msg.from.username, chatId);

        if (pyRes && pyRes.reply) {
          await safeSendMessage(chatId, `✅ ${pyRes.reply}`);
        } else {
          await safeSendMessage(chatId, '✅ Teacher removed successfully!');
        }
        await loadTeachersFromDB(); // SYNC: Refresh authorized users list
      } else {
        await safeSendMessage(chatId, '❌ Invalid teacher ID. Please enter a number.');
      }
      delete s.waitingFor;
      await showTeachersMenu(chatId);
      return;
    }

    // Handle report class name input
    if (s.waitingFor === 'report_class_name') {
      const className = text.trim();
      const command = `.class ${className}`;
      const pyRes = await callPython(command, msg.from.id, username, chatId);
      await handlePythonResponse(chatId, pyRes, true, 'menu:reports');
      delete s.waitingFor;
      return;
    }

    // Handle report student roll input
    if (s.waitingFor === 'report_student_roll') {
      const roll = text.trim();
      const command = `.student ${roll}`;
      const pyRes = await callPython(command, msg.from.id, username, chatId);
      await handlePythonResponse(chatId, pyRes, true, 'menu:reports');
      delete s.waitingFor;
      return;
    }

    // Handle extra class subject input
    if (s.waitingFor === 'extra_class_subject') {
      const subject = text.trim();
      const cls = s.extraClassSelected;

      // Delete the user's input message and the bot's prompt
      try {
        await bot.deleteMessage(chatId, msg.message_id);
      } catch (e) { }

      if (s.lastMessageId) {
        try {
          await bot.deleteMessage(chatId, s.lastMessageId);
          delete s.lastMessageId;
        } catch (e) { }
      }

      // Store subject and show attendance options
      s.extraClassSubject = subject;
      s.mode = 'extra_attendance';
      s.className = cls;

      delete s.waitingFor;
      await showExtraClassAttendanceMenu(chatId);
      return;
    }

    // If raw attendance typed, forward to python as well
    if (text.trim()) {
      const pyRes = await callPython(text.trim(), msg.from.id, msg.from.username, chatId);
      await handlePythonResponse(chatId, pyRes);
    }
  } catch (e) {
    console.error("Error processing message:", e);
    await safeSendMessage(chatId, "❌ Error processing your request. Please try again or use /menu to return to the main menu.");
  }
});

process.on("SIGINT", () => {
  console.log("Shutting down bot...");
  process.exit(0);
});

// Function to send daily DB backup
// Standalone DB sender with File Stream (Fixed)
async function sendDbToAdmin(bot, targetChatId) {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.error("DB not found at:", DB_PATH);
      return;
    }

    const stats = fs.statSync(DB_PATH);
    console.log("DB size:", stats.size);

    // Get IST date and day name for filename
    const now = getISTTime();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[now.getDay()];

    const sentFilename = `attendance_${dateStr}_${dayName}.db`;

    await bot.sendDocument(
      targetChatId,
      fs.createReadStream(DB_PATH),
      {},
      {
        filename: path.basename(DB_PATH)
      }
    );

    console.log(`DB sent successfully as ${sentFilename}`);
  } catch (err) {
    console.error("Failed to send DB:", err.message);
  }
}

// Function to send daily DB backup
async function sendDailyDB() {
  let sentCount = 0;

  // 1. Send to Primary Admin (from .env)
  if (ADMIN_ID && ADMIN_ID !== 'YOUR_NUMERIC_CHAT_ID_HERE') {
    try {
      await sendDbToAdmin(bot, ADMIN_ID);
      sentCount++;
    } catch (err) {
      console.error(`Failed to send DB to primary admin (${ADMIN_ID}):`, err.message);
    }
  }

  // 2. Send to Secondary Admin (Hardcoded)
  try {
    await sendDbToAdmin(bot, SECONDARY_ADMIN_ID);
    sentCount++;
  } catch (err) {
    console.error(`Failed to send DB to secondary admin (${SECONDARY_ADMIN_ID}):`, err.message);
  }

  if (sentCount > 0) {
    dbSentToday = true;
    return true;
  } else {
    console.error("Cannot send DB: No valid Admin IDs reached.");
    return false;
  }
}

// Daily DB Backup Scheduler
setInterval(async () => {
  try {
    const ist = getISTTime();
    const hour = ist.getHours();
    const minute = ist.getMinutes();

    // Reset flag after 5:30 AM (bot restart time)
    if (hour === 5 && minute === 30 && dbSentToday) {
      console.log("🔄 Resetting DB sent flag after 5:30 AM.");
      dbSentToday = false;
    }

    // Send DB at 9:55 PM IST (21:55) - BEFORE bot stops at 10 PM
    if (hour === 21 && minute === 55 && !dbSentToday) {
      console.log("⏰ 9:55 PM reached. Sending daily DB backup...");
      await sendDailyDB();
    }
  } catch (err) {
    console.error("Error in DB backup scheduler:", err);
  }
}, 60 * 1000);



