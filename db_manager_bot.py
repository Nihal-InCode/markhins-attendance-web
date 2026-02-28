# db_manager_bot.py
import os
import telebot
import shutil
from datetime import datetime
import logging

# --- CONFIGURATION ---
TOKEN = os.environ.get("DB_MANAGER_BOT_TOKEN")
DB_PATH = os.environ.get("ATTENDANCE_DB_PATH", "/data/web_attendance.db")
BACKUP_DIR = os.path.dirname(DB_PATH) if os.path.dirname(DB_PATH) else "."

# --- ADMIN LIST ---
# REPLACE THESE WITH YOUR ACTUAL TELEGRAM USER IDS
# You can find your ID by messaging @userinfobot
ADMIN_IDS = [8291437833] 

bot = telebot.TeleBot(TOKEN)

# --- LOGGING ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("DB_Manager_Bot")

# --- UTILITIES ---
def is_admin(message):
    return message.from_user.id in ADMIN_IDS

def safe_replace_db(temp_path):
    """Atomically replaces the database file."""
    try:
        # 1. Backup existing before replacement
        if os.path.exists(DB_PATH):
            backup_path = f"{DB_PATH}.backup"
            shutil.copy2(DB_PATH, backup_path)
            logger.info(f"Created emergency backup at {backup_path}")
        
        # 2. Atomic rename
        os.replace(temp_path, DB_PATH)
        logger.info(f"Database replaced successfully with {temp_path}")
        return True
    except Exception as e:
        logger.error(f"Replace failed: {e}")
        return False

def create_backup(label="manual"):
    """Creates a timestamped backup of the DB."""
    if not os.path.exists(DB_PATH):
        return None
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    backup_filename = f"web_attendance_{timestamp}_{label}.db"
    backup_path = os.path.join(BACKUP_DIR, backup_filename)
    
    try:
        shutil.copy2(DB_PATH, backup_path)
        logger.info(f"Created backup: {backup_path}")
        return backup_path
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return None

# --- COMMAND HANDLERS ---

@bot.message_handler(commands=['start'])
def send_welcome(message):
    if not is_admin(message):
        return
    bot.reply_to(message, "🛡️ Database Manager Bot Active.\n\n"
                          "Commands:\n"
                          "/download_db - Get current DB file\n"
                          "/backup_db - Create timestamped backup\n"
                          "/restore_backup - Restore latest .backup file\n"
                          "Or simply upload a .db file to replace the database.")

@bot.message_handler(commands=['download_db'])
def download_db(message):
    if not is_admin(message): return
    
    if not os.path.exists(DB_PATH):
        bot.reply_to(message, "❌ Error: Database file not found at " + DB_PATH)
        return
    
    try:
        with open(DB_PATH, 'rb') as f:
            bot.send_document(message.chat.id, f, caption="📂 Current Database File")
    except Exception as e:
        bot.reply_to(message, f"❌ Failed to send file: {str(e)}")

@bot.message_handler(commands=['backup_db'])
def backup_now(message):
    if not is_admin(message): return
    
    bot.send_message(message.chat.id, "⏳ Creating backup...")
    path = create_backup("manual")
    if path:
        bot.reply_to(message, f"✅ Backup created:\n`{os.path.basename(path)}`", parse_mode="Markdown")
    else:
        bot.reply_to(message, "❌ Failed to create backup. check console.")

@bot.message_handler(commands=['restore_backup'])
def restore_db(message):
    if not is_admin(message): return
    
    backup_path = f"{DB_PATH}.backup"
    if not os.path.exists(backup_path):
        bot.reply_to(message, "❌ No .backup file found to restore.")
        return
    
    try:
        # Atomic restore
        temp_name = f"{DB_PATH}.restore_temp"
        shutil.copy2(backup_path, temp_name)
        os.replace(temp_name, DB_PATH)
        bot.reply_to(message, "✅ Successfully restored from web_attendance.db.backup")
        logger.info("Database restored from manual backup file.")
    except Exception as e:
        bot.reply_to(message, f"❌ Restore failed: {str(e)}")

@bot.message_handler(content_types=['document'])
def handle_upload(message):
    if not is_admin(message): return
    
    if not message.document.file_name.endswith('.db'):
        bot.reply_to(message, "❌ Invalid file. Please upload only .db files.")
        return
    
    bot.send_message(message.chat.id, "⏳ Processing database upload...")
    
    try:
        file_info = bot.get_file(message.document.file_id)
        downloaded_file = bot.download_file(file_info.file_path)
        
        temp_path = DB_PATH + ".uploading"
        with open(temp_path, 'wb') as new_file:
            new_file.write(downloaded_file)
            
        if safe_replace_db(temp_path):
            bot.reply_to(message, "✅ Database replaced successfully!\n\nOld version saved as: `web_attendance.db.backup`", parse_mode="Markdown")
        else:
            bot.reply_to(message, "❌ Critical: Failed to replace database file.")
            
    except Exception as e:
        bot.reply_to(message, f"❌ Error during upload: {str(e)}")

# --- STARTUP ---
if __name__ == "__main__":
    logger.info("Starting DB Manager Bot...")
    
    # Optional Feature: Daily backup at startup
    today_backup_prefix = f"web_attendance_{datetime.now().strftime('%Y%m%d')}"
    existing_backups = [f for f in os.listdir(BACKUP_DIR) if f.startswith(today_backup_prefix)]
    
    if not existing_backups and os.path.exists(DB_PATH):
        logger.info("No backup found for today. Creating automatic startup backup...")
        create_backup("auto_startup")
    
    bot.infinity_polling()
