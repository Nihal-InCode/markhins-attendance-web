"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  getClasses,
  getFullTimetable,
  getTimetable,
  getDailyReport,
  getStudentHistory,
  resolvePeriod,
  getBatchReport,
  getWeeklyReport,
  getClassAverages,
  getSickLeaveOverview,
  getSickList,
  getLeaveList,
  getPeriodSummary,
  getLastAttendance,
  getMarkedPeriods,
  apiRequest,
  getAdminActivityLog,
  trackEvent,
  getExtraClassesReport,
  getTeachersList,
  getTeacherRegisterReport,
  getPendingAnnouncement,
  dismissAnnouncement,
  getNamazAnalytics,
  getEventAttendance,
  getSyllabusConfigs,
  saveSyllabusConfig,
  updateSyllabusProgress,
  deleteSyllabusConfig,
  getSubstituteCoordinators,
  getSubstitutePlannerData,
  saveSubstituteAssignments,
  getSubstituteReport,
  getSubstituteDashboardWidget,
  getTimetableEditors,
  getAdminTimetable,
  getTeacherSubjectOptions,
  updateTimetablePeriod,
  getPermissionStudents,
  getPermissionSummary,
  createPermission,
  getPermissions,
  approvePermission,
  rejectPermission,
  approveTeacherReturn,
  approvePrincipalReturn,
  rejectPrincipalReturn
} from "@/lib/api";
import { useLoading } from "@/context/LoadingContext";
import PencilLoader from "@/components/PencilLoader";
import VolumeToggle from "@/components/VolumeToggle";
import { playSound } from "@/lib/sound";
import { generateSubstituteTimetablePng, getSubstituteTeacherCode } from "@/lib/substituteTimetableImage";

const formatTime = (createdAtStr) => {
  if (!createdAtStr) return "";
  try {
    const parts = createdAtStr.split(" ");
    if (parts.length === 2) {
      const timeParts = parts[1].split(":");
      if (timeParts.length >= 2) {
        const hour = parseInt(timeParts[0], 10);
        const minute = timeParts[1];
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minute} ${ampm}`;
      }
    }
    const date = new Date(createdAtStr);
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    }
    return createdAtStr;
  } catch (e) {
    return createdAtStr;
  }
};

const parseTimeTo12HrParts = (timeStr) => {
  if (!timeStr) return { hour: "12", minute: "00", period: "PM" };
  const parts = timeStr.split(":");
  if (parts.length >= 2) {
    let hour24 = parseInt(parts[0], 10);
    let minute = parts[1].substring(0, 2);
    let period = hour24 >= 12 ? "PM" : "AM";
    let hour12 = hour24 % 12;
    hour12 = hour12 ? hour12 : 12;
    return { hour: String(hour12), minute, period };
  }
  return { hour: "12", minute: "00", period: "PM" };
};

const formatPartsTo24Hr = (hour, minute, period) => {
  let hr = parseInt(hour, 10);
  if (period === "PM" && hr < 12) hr += 12;
  if (period === "AM" && hr === 12) hr = 0;
  return `${String(hr).padStart(2, "0")}:${minute}`;
};

const StampSeal = ({ name, title, date, color = "text-blue-800" }) => {
  if (!name) {
    return (
      <div className="flex flex-col items-center justify-center h-[72px] w-[72px] rounded-full border-2 border-dashed border-gray-250 opacity-40 select-none">
        <span className="text-[8px] font-black uppercase tracking-wider text-gray-400">Pending</span>
      </div>
    );
  }
  
  // Clean name for seal presentation (truncate/format if needed)
  const displayName = name.length > 22 ? name.substring(0, 20) + ".." : name;

  return (
    <div className={`relative h-[72px] w-[72px] -rotate-[8deg] rounded-full bg-transparent ${color} opacity-85 mix-blend-multiply flex-shrink-0`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <path
            id={`seal-ring-${name.replace(/[^a-zA-Z]/g, "")}`}
            d="M 50,50 m -39,0 a 39,39 0 1,1 78,0 a 39,39 0 1,1 -78,0"
          />
          <mask id={`seal-wear-${name.replace(/[^a-zA-Z]/g, "")}`}>
            <rect width="100" height="100" fill="white" />
            <g fill="black">
              <rect x="8" y="29" width="13" height="2.8" rx="1.4" transform="rotate(-18 8 29)" />
              <rect x="18" y="12" width="8" height="2.2" rx="1.1" transform="rotate(24 18 12)" />
              <rect x="39" y="7" width="15" height="2.5" rx="1.2" transform="rotate(-4 39 7)" />
              <rect x="68" y="12" width="10" height="2.4" rx="1.2" transform="rotate(18 68 12)" />
              <rect x="83" y="29" width="9" height="3" rx="1.5" transform="rotate(55 83 29)" />
              <rect x="84" y="63" width="11" height="2.5" rx="1.2" transform="rotate(-58 84 63)" />
              <rect x="65" y="84" width="14" height="2.8" rx="1.4" transform="rotate(-20 65 84)" />
              <rect x="31" y="89" width="11" height="2.5" rx="1.2" transform="rotate(8 31 89)" />
              <rect x="9" y="68" width="12" height="3" rx="1.5" transform="rotate(48 9 68)" />
              <circle cx="26" cy="20" r="1.8" />
              <circle cx="58" cy="9" r="1.5" />
              <circle cx="89" cy="48" r="1.8" />
              <circle cx="50" cy="90" r="1.7" />
              <circle cx="12" cy="51" r="1.5" />
            </g>
          </mask>
        </defs>
        <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="3.5" mask={`url(#seal-wear-${name.replace(/[^a-zA-Z]/g, "")})`} />
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="currentColor" strokeWidth="1.2" mask={`url(#seal-wear-${name.replace(/[^a-zA-Z]/g, "")})`} />
        <text fill="currentColor" fontSize="8" fontWeight="900" letterSpacing="0.8" mask={`url(#seal-wear-${name.replace(/[^a-zA-Z]/g, "")})`}>
          <textPath href={`#seal-ring-${name.replace(/[^a-zA-Z]/g, "")}`} startOffset="1%">
            MARKHINS BENGALURU • MARKHINS BENGALURU •
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-[6px] flex flex-col items-center justify-center rounded-full border border-current/30 px-1 text-center">
        <span className="line-clamp-2 w-full break-words text-[5px] font-black leading-[1.05] uppercase tracking-tighter text-current">
          {displayName}
        </span>
        {date && (
          <span className="text-[4px] font-extrabold opacity-75 mt-0.5 whitespace-nowrap text-current">
            {date}
          </span>
        )}
      </div>
    </div>
  );
};

const formatTo12Hr = (timeStr) => {
  if (!timeStr) return "";
  try {
    const spaceIndex = timeStr.indexOf(" ");
    let t = spaceIndex !== -1 ? timeStr.substring(spaceIndex + 1) : timeStr;
    if (t.toLowerCase().includes("am") || t.toLowerCase().includes("pm")) {
      return t;
    }
    const parts = t.split(":");
    if (parts.length >= 2) {
      let hour = parseInt(parts[0], 10);
      const minute = parts[1].substring(0, 2);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12;
      hour = hour ? hour : 12;
      return `${hour}:${minute} ${ampm}`;
    }
    return timeStr;
  } catch (e) {
    return timeStr;
  }
};

const formatDate = (dateStr) => {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch (e) {
    return dateStr;
  }
};

const canManageHealthStatus = (user) => {
  return user?.role === 'Principal'
    || user?.role === 'Vice Principal'
    || user?.role === 'Class Teacher'
    || user?.role === 'Urdu Principal'
    || user?.name?.trim?.().toUpperCase() === 'MAHROOF QADIRI';
};

const canUsePermissionManager = (user) => {
  return user?.role === 'Class Teacher'
    || user?.role === 'Principal'
    || user?.role === 'Vice Principal'
    || user?.role === 'admin';
};

const canApprovePermissions = (user) => user?.role === 'Principal' || user?.role === 'Vice Principal' || user?.role === 'admin';

const getDashboardRoleBadge = (user) => {
  const role = user?.role || 'Teacher';
  const isMahroof = user?.name?.trim?.().toUpperCase() === 'MAHROOF QADIRI';
  const displayRole = isMahroof && role !== 'Urdu Principal' ? 'Urdu Principal' : role;

  const styles = {
    Principal: 'border-amber-300/60 bg-amber-300/15 text-amber-100',
    'Urdu Principal': 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100',
    'Vice Principal': 'border-sky-300/60 bg-sky-300/15 text-sky-100',
    admin: 'border-violet-300/60 bg-violet-300/15 text-violet-100',
    'Class Teacher': 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100',
  };

  return {
    label: displayRole,
    className: styles[displayRole] || styles[role] || 'border-white/20 bg-white/10 text-white/80',
  };
};

function EventOccurrenceRow({ occurrence }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeListTab, setActiveListTab] = useState("present");

  const allStudents = occurrence.students || [];
  const presentStudents = allStudents.filter(s => s.status === "present");
  const absentStudents = allStudents.filter(s => s.status === "absent");
  const totalCount = occurrence.totalCount || allStudents.length;
  const presentCount = presentStudents.length;
  const absentCount = Math.max(0, totalCount - presentCount);
  const attendancePercentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  return (
    <div className="bg-gray-55/40 rounded-2xl border border-gray-100 p-4 hover:border-blue-200 hover:bg-white transition-all shadow-xs duration-200">
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-gray-800">{formatDate(occurrence.date)}</span>
            {occurrence.createdAt && (
              <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">
                {formatTime(occurrence.createdAt)}
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-gray-500">
            Class: <span className="text-blue-600 font-black">{occurrence.className}</span>
          </p>
        </div>
        <div className="flex items-center gap-4 self-end sm:self-auto">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider">
            <span className="text-slate-400">Total: {totalCount}</span>
            <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">P: {presentCount}</span>
            <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded-md">A: {absentCount}</span>
            <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{attendancePercentage}%</span>
          </div>
          <span className="text-xs text-gray-400 font-bold w-4 text-center">
            {isExpanded ? "▼" : "▶"}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-150/50 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Summary Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/50 p-4 rounded-3xl border border-slate-100">
            <div className="text-center p-1">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Students</p>
              <p className="text-lg font-black text-slate-800 mt-1">{totalCount}</p>
            </div>
            <div className="text-center p-1">
              <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Present</p>
              <p className="text-lg font-black text-emerald-600 mt-1">{presentCount}</p>
            </div>
            <div className="text-center p-1">
              <p className="text-[9px] font-black text-red-400 uppercase tracking-widest">Absent</p>
              <p className="text-lg font-black text-red-650 mt-1">{absentCount}</p>
            </div>
            <div className="text-center p-1">
              <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Attendance %</p>
              <p className="text-lg font-black text-blue-700 mt-1">{attendancePercentage}%</p>
            </div>
          </div>

          {/* Optional Tab Layout */}
          <div className="flex gap-2 border-b border-gray-100 pb-1">
            <button
              onClick={() => setActiveListTab("present")}
              className={`pb-2 px-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeListTab === "present"
                  ? "border-emerald-500 text-emerald-600 font-extrabold"
                  : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
            >
              Present ({presentCount})
            </button>
            <button
              onClick={() => setActiveListTab("absent")}
              className={`pb-2 px-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeListTab === "absent"
                  ? "border-red-500 text-red-600 font-extrabold"
                  : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
            >
              Absent ({absentCount})
            </button>
          </div>

          {/* Student Lists */}
          {activeListTab === "present" ? (
            presentCount > 0 ? (
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {presentStudents.map((student) => (
                  <div
                    key={student.rollNo}
                    className="bg-white rounded-xl border border-emerald-100 p-2.5 shadow-xs flex items-center justify-between hover:border-emerald-300 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 text-xs truncate" title={student.name}>
                        {student.name}
                      </p>
                      <p className="text-[8px] font-bold text-gray-400">Roll {student.rollNo}</p>
                    </div>
                    <span className="text-xs text-emerald-500 font-bold">✓</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-bold text-gray-450 text-center py-4 bg-gray-50/50 rounded-2xl border border-dashed border-gray-150">No students attended this session</p>
            )
          ) : (
            absentCount > 0 ? (
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {absentStudents.map((student) => (
                  <div
                    key={student.rollNo}
                    className="bg-white rounded-xl border border-red-100 p-2.5 shadow-xs flex items-center justify-between hover:border-red-300 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 text-xs truncate" title={student.name}>
                        {student.name}
                      </p>
                      <p className="text-[8px] font-bold text-gray-400">Roll {student.rollNo}</p>
                    </div>
                    <span className="text-xs text-red-500 font-bold">✗</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-bold text-gray-450 text-center py-4 bg-gray-50/50 rounded-2xl border border-dashed border-gray-150">No students absent for this session</p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function EventGroupCard({ group }) {
  const occurrences = group.occurrences || [];
  const totalRuns = occurrences.length;

  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-gray-50 pb-4">
        <div className="space-y-1">
          <h4 className="font-black text-gray-900 text-lg leading-tight">{group.eventName}</h4>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            {totalRuns} {totalRuns === 1 ? "session" : "sessions"} in history
          </p>
        </div>
        <span className="text-[9px] font-black text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-3 py-1 uppercase tracking-widest">
          🎉 Special Program
        </span>
      </div>

      <div className="relative pl-1">
        {occurrences.map((occurrence, idx) => {
          const isLast = idx === occurrences.length - 1;
          return (
            <div key={occurrence.recordKey || `${occurrence.sessionId || "event"}-${idx}`} className="relative pl-6 pb-2 last:pb-0">
              {/* Vertical connector line segment */}
              {!isLast && (
                <div className="absolute left-[7px] top-[20px] bottom-0 w-[2px] bg-gray-150" />
              )}
              {/* Horizontal branch line segment */}
              <div className="absolute left-[7px] top-[20px] w-4.5 h-[2px] bg-gray-150" />
              {/* Node indicator dot */}
              <div className="absolute left-[4px] top-[17px] w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white shadow-xs z-10" />

              <EventOccurrenceRow occurrence={occurrence} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NamazSessionRow({ s, isExpanded, onToggle }) {
  const prayerEmojis = { Fajr: "🌅", Dhuhr: "☀️", Asr: "🌇", Maghrib: "🌆", Isha: "🌙" };
  const emoji = prayerEmojis[s.sessionName] || "🕌";

  const presentCount = (s.students || []).filter(st => st.status === "present").length;
  const totalCount = (s.students || []).length;
  const absentCount = Math.max(0, totalCount - presentCount);
  const percent = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  const timeParts = (() => {
    const source = s.createdAt || s.date;
    if (!source) return { hour: "--", minute: "--", period: "" };
    const match = String(source).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const hour24 = Number(match[1]);
      const displayHour = hour24 % 12 || 12;
      return {
        hour: String(displayHour).padStart(2, "0"),
        minute: match[2],
        period: hour24 >= 12 ? "PM" : "AM",
      };
    }
    const date = new Date(source);
    if (isNaN(date.getTime())) return { hour: "--", minute: "--", period: "" };
    const formatted = new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    return {
      hour: formatted.find(part => part.type === "hour")?.value || "--",
      minute: formatted.find(part => part.type === "minute")?.value || "--",
      period: formatted.find(part => part.type === "dayPeriod")?.value || "",
    };
  })();

  const formattedTime = `${timeParts.hour}:${timeParts.minute} ${timeParts.period}`;

  return (
    <div className="px-3.5 py-3 hover:bg-gray-50/50 transition-all">
      <button onClick={onToggle} className="w-full flex flex-col sm:flex-row sm:items-center justify-between text-left gap-2">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center text-xs shrink-0">{emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-gray-800">{s.sessionName}</span>
              <span className="text-[9px] font-bold text-gray-300">•</span>
              <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{s.className}</span>
            </div>
            <span className="text-[9px] font-bold text-gray-400">{formattedTime}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${percent >= 90 ? "text-emerald-600 bg-emerald-50" : percent >= 80 ? "text-amber-600 bg-amber-50" : "text-red-500 bg-red-50"}`}>
            {presentCount}/{totalCount} ({percent}%)
          </span>
          <span className="text-gray-400 text-[10px]">{isExpanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-2.5 ml-9 space-y-2 animate-in fade-in duration-150">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50/60 border border-emerald-100/50 rounded-lg p-2 text-center">
              <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Present</p>
              <p className="text-sm font-black text-emerald-700">{presentCount}</p>
            </div>
            <div className="bg-red-50/60 border border-red-100/50 rounded-lg p-2 text-center">
              <p className="text-[9px] font-black text-red-400 uppercase tracking-widest">Absent</p>
              <p className="text-sm font-black text-red-600">{absentCount}</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-2 text-center">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Source</p>
              <p className="text-[10px] font-black text-gray-600 truncate" title={s.source}>{s.source || "System"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[9px] text-gray-400 font-bold">
            <span className="font-mono">ID: {s.sessionId}</span>
            <span>{s.createdAt ? new Date(s.createdAt).toLocaleString("en-IN") : s.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const regularFormRef = useRef(null);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [resolvedSubject, setResolvedSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("attendance");

  // Substitute Planner System States
  const [subCoordinators, setSubCoordinators] = useState([]);
  const [subWidget, setSubWidget] = useState(null);
  const [plannerDate, setPlannerDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [selectedLeaveTeachers, setSelectedLeaveTeachers] = useState([]);
  const [plannerData, setPlannerData] = useState(null);
  const [assigningPeriod, setAssigningPeriod] = useState(null);
  const [assigningTeacher, setAssigningTeacher] = useState(null);
  const [temporaryAssignments, setTemporaryAssignments] = useState({});
  const [subReportFilter, setSubReportFilter] = useState({
    fromDate: new Date().toISOString().split('T')[0],
    toDate: new Date().toISOString().split('T')[0],
    classId: '',
    teacherId: ''
  });
  const [subReportData, setSubReportData] = useState([]);
  const [subTab, setSubTab] = useState("planner");
  const [leaveSearch, setLeaveSearch] = useState("");
  const [substituteTimetablePreview, setSubstituteTimetablePreview] = useState(null);
  const [substituteTimetableError, setSubstituteTimetableError] = useState("");
  const [lastSavedSubstituteTimetable, setLastSavedSubstituteTimetable] = useState(null);

  // Feature specific states
  const [fullTimetable, setFullTimetable] = useState(null);
  const [selectedDay, setSelectedDay] = useState((new Date().getDay() + 6) % 7); // 0=Mon, 6=Sun
  const [timetableZoom, setTimetableZoom] = useState(60);
  const [timetablePdfOpen, setTimetablePdfOpen] = useState(false);
  const [timetableEditors, setTimetableEditors] = useState([]);
  const [timetableEditMode, setTimetableEditMode] = useState(false);
  const [timetableEditingCell, setTimetableEditingCell] = useState(null);
  const [timetableEditorData, setTimetableEditorData] = useState({ teacherId: "", subject: "" });
  const [timetableSubjectOptions, setTimetableSubjectOptions] = useState([]);
  const [timetableManualSubject, setTimetableManualSubject] = useState(false);
  const [timetableSaveBusy, setTimetableSaveBusy] = useState(false);
  const getIstDateString = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  };
  const getIstTimeString = () => {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  };
  const getUpcomingDateForWeekday = (weekdayIndex) => {
    const [year, month, day] = getIstDateString().split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const todayIndex = (date.getUTCDay() + 6) % 7;
    const daysAhead = (Number(weekdayIndex) - todayIndex + 7) % 7;
    date.setUTCDate(date.getUTCDate() + daysAhead);
    return date.toISOString().slice(0, 10);
  };
  const [selectedDate, setSelectedDate] = useState(getIstDateString());
  const [absenteeReport, setAbsenteeReport] = useState(null);
  const [absenteeFilter, setAbsenteeFilter] = useState("ALL");
  const [loadingAbsentees, setLoadingAbsentees] = useState(false);
  const [dailyReportData, setDailyReportData] = useState(null);
  const [studentHistory, setStudentHistory] = useState(null);
  const [loadingFeature, setLoadingFeature] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [adminActivityLog, setAdminActivityLog] = useState(null);
  const [batchReport, setBatchReport] = useState(null);
  const [selectedClassForAnalysis, setSelectedClassForAnalysis] = useState("");
  const [classAverages, setClassAverages] = useState(null);
  const [loadingClassAverages, setLoadingClassAverages] = useState(false);
  const [sickLeaveOverview, setSickLeaveOverview] = useState(null);
  const [viewingHealthList, setViewingHealthList] = useState(null);
  const [healthListData, setHealthListData] = useState(null);
  const [healthListLoading, setHealthListLoading] = useState(false);
  const [timetableError, setTimetableError] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportType, setReportType] = useState(null);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [extraClassesReport, setExtraClassesReport] = useState([]);
  const [digitalRegisterData, setDigitalRegisterData] = useState([]);
  const [digitalRegisterSessionLabels, setDigitalRegisterSessionLabels] = useState([]);
  const [digitalRegisterSummary, setDigitalRegisterSummary] = useState({ classesTaken: 0, assignedPeriods: 0, teachingPercentage: 0 });
  const [myAssignedPeriods, setMyAssignedPeriods] = useState([]);
  const [registerFromDate, setRegisterFromDate] = useState(getIstDateString());
  const [registerToDate, setRegisterToDate] = useState(getIstDateString());
  const [selectedTeacherForRegister, setSelectedTeacherForRegister] = useState("");
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [selectedTeacherForExtra, setSelectedTeacherForExtra] = useState("");
  const [selectedClassForExtra, setSelectedClassForExtra] = useState("");
  const [teachers, setTeachers] = useState([]);
  const [namazAnalytics, setNamazAnalytics] = useState(null);
  const [loadingNamaz, setLoadingNamaz] = useState(false);
  const [namazFromDate, setNamazFromDate] = useState(getIstDateString());
  const [namazToDate, setNamazToDate] = useState(getIstDateString());
  const [selectedNamazClass, setSelectedNamazClass] = useState("");
  const [selectedNamazStudent, setSelectedNamazStudent] = useState("");
  const [selectedNamazSession, setSelectedNamazSession] = useState("");
  const [eventAttendance, setEventAttendance] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEventClassFilter, setSelectedEventClassFilter] = useState("");
  const [selectedEventNameFilter, setSelectedEventNameFilter] = useState("");
  const [selectedEventDateFilter, setSelectedEventDateFilter] = useState("");
  const [expandedRecentSessionId, setExpandedRecentSessionId] = useState(null);
  const [expandedNamaz, setExpandedNamaz] = useState(null);
  const [expandedClasses, setExpandedClasses] = useState({});
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const [semesterPopupOpen, setSemesterPopupOpen] = useState(false);
  const [semesterPopupSaving, setSemesterPopupSaving] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef(null);

  // Period detail modal
  const [periodModal, setPeriodModal] = useState(null);
  const [dailyRefreshTs, setDailyRefreshTs] = useState(Date.now());
  // Last attendance edit card
  const [lastAttendance, setLastAttendance] = useState(null);
  const [markedPeriods, setMarkedPeriods] = useState([]);
  const [markedDetails, setMarkedDetails] = useState([]);
  const [searchRollNo, setSearchRollNo] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(getIstDateString());

  // Syllabus tracker states
  const [syllabusConfigs, setSyllabusConfigsState] = useState([]);
  const [loadingSyllabus, setLoadingSyllabus] = useState(false);
  const [syllabusPopupOpen, setSyllabusPopupOpen] = useState(false);
  const [syllabusFormData, setSyllabusFormData] = useState({
    id: null,
    class: "",
    subject: "",
    teacher_id: "",
    academic_year: new Date().getFullYear().toString(),
    semester: "Semester 1",
    book_name: "",
    start_page: "",
    end_page: "",
  });
  const [syllabusMonthTargets, setSyllabusMonthTargets] = useState({
    June: "", July: "", August: "", September: "", October: "", November: "", December: "",
    January: "", February: "", March: "", April: "", May: ""
  });
  const [selectedSyllabusClassFilter, setSelectedSyllabusClassFilter] = useState("");
  const [selectedSyllabusTeacherFilter, setSelectedSyllabusTeacherFilter] = useState("");
  const [selectedSyllabusSubjectFilter, setSelectedSyllabusSubjectFilter] = useState("");
  const [mySyllabusClassFilter, setMySyllabusClassFilter] = useState("");
  const [syllabusPageProgressData, setSyllabusPageProgressData] = useState({});
  const [permissionView, setPermissionView] = useState("new");
  const [permissionStudents, setPermissionStudents] = useState([]);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionRecords, setPermissionRecords] = useState([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const [permissionActionBusyId, setPermissionActionBusyId] = useState(null);
  const [permissionSummary, setPermissionSummary] = useState({
    pendingApprovals: 0,
    todaysOutpasses: 0,
    activeLeaveCards: 0,
    todaysPermissions: 0,
  });
  const [permissionHistoryFilters, setPermissionHistoryFilters] = useState({
    student: "",
    class: "",
    date: "",
    from_date: "",
    to_date: "",
    permission_number: "",
    permission_type: "",
    attendance_status: "",
    created_by: "",
    approved_by: "",
    reason: "",
  });
  const [permissionForm, setPermissionForm] = useState({
    student_id: "",
    permission_type: "Outpass",
    reason: "Hospital",
    custom_reason: "",
    destination: "",
    attendance_status: "Absent",
    remarks: "",
    leaving_time: getIstTimeString(),
    leaving_date: getIstDateString(),
    expected_return_time: "",
    expected_return_date: "",
  });
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [permissionErrors, setPermissionErrors] = useState({});
  const [historyType, setHistoryType] = useState("");
  const [historyStudentId, setHistoryStudentId] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySelectedRecord, setHistorySelectedRecord] = useState(null);
  const [historyStudents, setHistoryStudents] = useState([]);

  const fetchHistoryStudents = async () => {
    try {
      const clsList = await getClasses();
      const visibleClasses = Array.isArray(clsList) ? clsList : [];
      if (visibleClasses.length > 0) {
        const promises = visibleClasses.map(c => getStudents(c.id, "", "").catch(() => []));
        const results = await Promise.all(promises);
        const allStudents = results.flat().filter(Boolean);
        const uniqueStudents = [];
        const seenIds = new Set();
        for (const s of allStudents) {
          if (s && s.id && !seenIds.has(s.id)) {
            seenIds.add(s.id);
            uniqueStudents.push({
              id: String(s.id),
              name: s.name,
              rollNo: s.rollNo || s.roll,
              class: s.class
            });
          }
        }
        setHistoryStudents(uniqueStudents);
      } else {
        const data = await getPermissionStudents(true);
        setHistoryStudents(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Parallel student fetch error, falling back:", err);
      const data = await getPermissionStudents(true).catch(() => []);
      setHistoryStudents(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => {
    const handleFocusIn = (e) => {
      if (e.target && ['input', 'textarea', 'select'].includes(e.target.tagName?.toLowerCase())) {
        setIsInputFocused(true);
      }
    };
    const handleFocusOut = (e) => {
      setIsInputFocused(false);
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const getTrackingLabels = (trackingType) => {
    const h = trackingType === 'hadith';
    return {
      start: h ? 'Start Hadith Number' : 'Start Page',
      end: h ? 'End Hadith Number' : 'End Page',
      current: h ? 'Current Hadith Number' : 'Current Page',
      total: h ? 'Total Hadith' : 'Total Pages',
      remaining: h ? 'Remaining Hadith' : 'Remaining Pages',
      completed: h ? 'Completed Hadith' : 'Completed Pages',
      target: h ? 'Target Hadith' : 'Target Page',
      pages: h ? 'Hadith' : 'Pages',
      page: h ? 'Hadith' : 'Page',
      update: h ? 'Update Hadith' : 'Update Page',
      updateNum: h ? 'Update Current Hadith Number' : 'Update Current Page Number',
      targetPages: h ? 'Monthly Target Hadith Numbers' : 'Monthly Target End Pages',
      targetSubtitle: h ? 'Set the target final hadith number expected by the end of each month' : 'Set the target final page index expected by the end of each month',
      targetPlaceholder: h ? 'Target hadith' : 'Target page',
      placeholder: h ? 'e.g. 500' : 'e.g. 187',
      pagesLeft: h ? 'Hadiths Left' : 'Pages Left',
    };
  };

  const [principalAccessMode, setPrincipalAccessMode] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedPeriods, setSelectedPeriods] = useState([]);


  const { logout, user } = useAuth();
  const { showLoader, hideLoader } = useLoading();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Sync activeTab with URL (?tab=attendance) so back button works ──
  const switchTab = useCallback((tab) => {
    if (user?.role === 'Majlis' && tab !== 'reports') return;
    setActiveTab(tab);
    setTimetableError("");
    setReportError("");
    if (tab === "reports") {
      setReportType(null);
      router.push(`/?tab=reports`, { scroll: false });
    } else {
      router.push(`/?tab=${tab}`, { scroll: false });
    }
    setTimeout(() => trackEvent(`Switched to ${tab} tab`), 0);
  }, [router, user?.role]);

  // On mount (and URL change): read tab from URL
  useEffect(() => {
    if (user?.role === 'Majlis') {
      setActiveTab("reports");
      setReportType(null);
      return;
    }
    const urlTab = searchParams.get('tab');
    if (urlTab && ['attendance', 'timetable', 'reports', 'permission_manager'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
    if (urlTab === 'reports') {
      const type = searchParams.get('type');
      if (type && ['overview', 'syllabus', 'namaz', 'events', 'extra', 'analysis', 'register', 'substitute'].includes(type)) {
        setReportType(type);
      } else {
        setReportType(null);
      }
    } else {
      setReportType(null);
    }
  }, [searchParams]);

  // ── Close period modal on browser/phone back button ──
  useEffect(() => {
    const onPopState = () => {
      setPeriodModal(null);
      setTimetablePdfOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!headerMenuOpen) return;

    const closeOnOutsidePress = (event) => {
      if (!headerMenuRef.current?.contains(event.target)) {
        setHeaderMenuOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setHeaderMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!user?.id || user?.role === "admin") return;

    let cancelled = false;
    async function checkSemesterPopup() {
      try {
        const announcement = await getPendingAnnouncement();
        if (!cancelled) {
          if (announcement?.announcementKey) {
            setActiveAnnouncement((prev) => {
              if (prev?.announcementKey !== announcement.announcementKey) {
                setSemesterPopupOpen(true);
                return announcement;
              }
              return prev;
            });
          } else {
            setActiveAnnouncement(null);
            setSemesterPopupOpen(false);
          }
        }
      } catch (err) {
        console.error("Failed to load announcement status:", err);
      }
    }

    checkSemesterPopup();
    const interval = setInterval(checkSemesterPopup, 30000); // Poll every 30 seconds for active announcements

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id, user?.role]);

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const periods = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
  const isReportsTab = activeTab === "reports";
  const isPermissionTab = activeTab === "permission_manager";
  const canEditTimetable = user?.role === 'admin' || timetableEditors.includes(String(user?.id)) || timetableEditors.includes(user?.username);
  const mainShellClass = activeTab === "timetable"
    ? "max-w-7xl px-4 sm:px-6 lg:px-8"
    : (isReportsTab || isPermissionTab)
      ? "max-w-6xl px-4 sm:px-6 lg:px-8"
      : "max-w-md px-6";

  async function loadAbsenteesReport(customDate) {
    const targetDate = customDate || selectedDate;
    if (!selectedClassForAnalysis || !targetDate) return;
    setLoadingAbsentees(true);
    setReportError("");
    try {
      const normalizedFilter = String(absenteeFilter || "ALL").trim().toUpperCase();
      const res = await apiRequest("/absentees-report", {
        method: "POST",
        body: JSON.stringify({
          classId: selectedClassForAnalysis,
          date: targetDate,
          filter: normalizedFilter
        })
      });

      if (Array.isArray(res)) {
        setAbsenteeReport(res);
        return;
      }

      if (res?.success && Array.isArray(res.data)) {
        setAbsenteeReport(res.data);
        return;
      }

      if (res?.success) {
        setAbsenteeReport([]);
        return;
      }

      throw new Error(res?.message || "Unable to load absentees report.");
    } catch (err) {
      setReportError("Absentees report failed: " + err.message);
      setAbsenteeReport([]);
    } finally {
      setLoadingAbsentees(false);
    }
  }

  useEffect(() => {
    if (selectedClassForAnalysis) loadAbsenteesReport();
  }, [selectedClassForAnalysis, absenteeFilter, selectedDate]);

  useEffect(() => {
    async function fetchData() {
      trackEvent('Opened dashboard');
      try {
        const classesRes = await getClasses();
        setClasses(Array.isArray(classesRes) ? classesRes : []);
      } catch (err) {
        setError("Failed to load classes.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    async function fetchTimetableEditors() {
      try {
        const res = await getTimetableEditors();
        setTimetableEditors(res?.editors?.map(String) || []);
      } catch (err) {
        console.error("Failed to load timetable editors:", err);
      }
    }
    fetchTimetableEditors();

    // Feature 3: Fetch last attendance from API (teacher-specific & strict ownership)
    async function fetchLastAttendance() {
      try {
        const res = await getLastAttendance();
        if (res) {
          // apiRequest in lib/api.js already returns data.data if it exists.
          // The previous check (res && res.data) was double-unwrapping.
          setLastAttendance(res);
        } else {
          setLastAttendance(null);
        }
      } catch (err) {
        console.error("Failed to fetch last attendance", err);
      }
    }

    if (activeTab === 'attendance') {
      fetchLastAttendance();
    }
    if (activeTab === 'attendance' || activeTab === 'reports') {
      fetchSubstituteData();
    }
  }, [activeTab]);

  // ── APP RESUME AND DATE AUTO-SYNC Lifecycle ──
  // Triggers when app is resumed from background (recent apps drawer) or window is focused
  useEffect(() => {
    if (!user?.id || user?.role === "admin") return;

    const handleAppResume = async () => {
      console.log("App resumed from background or focused. Checking dates and syncing data...");
      const todayIst = getIstDateString();

      // 1. Check if date changed (e.g. overnight sleep) and update states
      setAttendanceDate((prev) => (prev !== todayIst ? todayIst : prev));
      setSelectedDate((prev) => (prev !== todayIst ? todayIst : prev));

      const currentDayIndex = (new Date().getDay() + 6) % 7;
      setSelectedDay((prev) => (prev !== currentDayIndex ? currentDayIndex : prev));

      // 2. Fetch/Refresh general app data
      try {
        // Refresh classes list
        const classesRes = await getClasses();
        setClasses(Array.isArray(classesRes) ? classesRes : []);
      } catch (err) {
        console.error("Failed to refresh classes on resume:", err);
      }

      // Recheck announcements (in case new alert is published while app was backgrounded)
      try {
        const announcement = await getPendingAnnouncement();
        if (announcement?.announcementKey) {
          setActiveAnnouncement(announcement);
          setSemesterPopupOpen(true);
        } else {
          setActiveAnnouncement(null);
          setSemesterPopupOpen(false);
        }
      } catch (err) {
        console.error("Failed to recheck announcements on resume:", err);
      }

      // 3. Tab-specific data refresh
      if (activeTab === 'attendance') {
        try {
          const lastAttRes = await getLastAttendance();
          setLastAttendance(lastAttRes || null);
        } catch (err) {
          console.error("Failed to refresh last attendance on resume:", err);
        }

        // Refresh marked periods list using the updated date string directly
        fetchMarked(todayIst);

        if (selectedClass && selectedPeriod) {
          handleResolvePeriod(selectedClass, selectedPeriod, todayIst);
        }
      } else if (activeTab === 'timetable') {
        fetchFullTimetable(currentDayIndex);
      } else if (activeTab === 'reports') {
        fetchDailyReport(todayIst);
        fetchWeeklyReport();
        fetchSickLeaveOverview();
        fetchAdminLog(todayIst);
        fetchExtraClassesReport(todayIst);
        fetchTeachers();
        fetchClassAverages();
        if (selectedClassForAnalysis) {
          fetchBatchReport(selectedClassForAnalysis);
          loadAbsenteesReport(todayIst);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleAppResume();
      }
    };

    const onFocus = () => {
      handleAppResume();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [
    user?.id,
    user?.role,
    activeTab,
    selectedClass,
    selectedPeriod,
    selectedClassForAnalysis,
    selectedTeacherForExtra,
    selectedClassForExtra,
  ]);

  async function fetchMarked(customDate) {
    const targetDate = customDate || attendanceDate;
    if (selectedClass && activeTab === 'attendance') {
      try {
        const res = await getMarkedPeriods(selectedClass, targetDate);
        setMarkedPeriods(res?.marked_periods || []);
        setMarkedDetails(res?.marked_details || []);
      } catch (err) {
        console.error("Failed to fetch marked periods", err);
      }
    } else if (!selectedClass) {
      setMarkedPeriods([]);
      setMarkedDetails([]);
    }
  }

  // Fetch marked periods for the selected class
  useEffect(() => {
    fetchMarked();
  }, [selectedClass, activeTab, dailyRefreshTs, attendanceDate]);

  // Fetch timetable to identify teacher's assigned periods for selected class
  useEffect(() => {
    if (!selectedClass || activeTab !== 'attendance') { setMyAssignedPeriods([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await getTimetable(selectedClass);
        if (cancelled) return;
        const todayWeekday = (new Date().getDay() + 6) % 7;
        const myPeriods = (Array.isArray(data) ? data : [])
          .filter(row => row.weekday === todayWeekday && String(row.teacherId) === String(user?.id))
          .map(row => row.period);
        setMyAssignedPeriods(myPeriods);
      } catch { setMyAssignedPeriods([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedClass, activeTab, user?.id]);

  // Auto-resolve subject when class or period changes
  useEffect(() => {
    if (selectedClass && selectedPeriod) {
      handleResolvePeriod(selectedClass, selectedPeriod, attendanceDate);
    } else {
      setResolvedSubject(null);
    }
  }, [selectedClass, selectedPeriod, attendanceDate]);

  const handleResolvePeriod = async (cls, prd, date) => {
    setResolving(true);
    setResolvedSubject(null);
    try {
      const res = await resolvePeriod(cls, prd, date);
      setResolvedSubject(res);
    } catch (err) {
      setResolvedSubject({ error: err.message || "No subject scheduled." });
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (activeTab === "timetable") {
      fetchFullTimetable(selectedDay);
      if (teachers.length === 0) fetchTeachers();
    }
  }, [activeTab, selectedDay]);

  useEffect(() => {
    if (activeTab === "reports") {
      fetchDailyReport(selectedDate);
      fetchWeeklyReport();
      fetchSickLeaveOverview();
      fetchAdminLog(selectedDate);
      fetchExtraClassesReport();
      fetchTeachers();
      fetchClassAverages();
    }
  }, [activeTab, selectedDate, dailyRefreshTs, user?.role, selectedTeacherForExtra, selectedClassForExtra]);

  useEffect(() => {
    if (activeTab !== "reports" || reportType !== "overview" || user?.role !== "admin") return;

    fetchAdminLog(selectedDate, true);
    const monitorInterval = window.setInterval(() => {
      fetchAdminLog(selectedDate, true);
    }, 5000);

    return () => window.clearInterval(monitorInterval);
  }, [activeTab, reportType, selectedDate, user?.role]);

  useEffect(() => {
    if (activeTab !== "permission_manager" || !canUsePermissionManager(user)) return;
    fetchPermissionSummary();
    fetchPermissionStudents();
    if (permissionView !== "new") fetchPermissionRecords(permissionView);
  }, [activeTab, user?.id, user?.role]);

  // Auto-refresh daily report every 30 seconds when on reports tab
  useEffect(() => {
    if (activeTab !== "reports") return;
    const interval = setInterval(() => {
      setDailyRefreshTs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "reports" && selectedClassForAnalysis) {
      fetchBatchReport(selectedClassForAnalysis);
    }
  }, [selectedClassForAnalysis, activeTab]);

  useEffect(() => {
    if (activeTab === "reports" && reportType === "namaz") {
      fetchNamazAnalytics();
    }
  }, [activeTab, reportType, namazFromDate, namazToDate, selectedNamazClass, selectedNamazSession]);

  useEffect(() => {
    if (activeTab === "reports" && reportType === "events") {
      fetchEventAttendance();
    }
  }, [activeTab, reportType]);

  useEffect(() => {
    const isSyllabusTab = activeTab === "syllabus_management" || activeTab === "syllabus_overview" || activeTab === "my_syllabus" || (activeTab === "reports" && reportType === "syllabus");
    if (isSyllabusTab) {
      fetchSyllabusConfigs();
      fetchTeachers();
    }
  }, [activeTab, reportType, selectedSyllabusClassFilter, selectedSyllabusTeacherFilter, selectedSyllabusSubjectFilter]);

  useEffect(() => {
    if ((activeTab === "attendance" || activeTab === "my_syllabus") && user && user.role !== "admin") {
      fetchSyllabusConfigs();
    }
  }, [activeTab, user]);

  const fetchSubstituteData = async () => {
    try {
      const coordRes = await getSubstituteCoordinators();
      const coordinators = coordRes?.coordinators || (Array.isArray(coordRes) ? coordRes : []);
      setSubCoordinators(coordinators.map(String));
    } catch (err) {
      console.error("Failed to load substitute coordinators:", err);
    }
    try {
      const widgetRes = await getSubstituteDashboardWidget();
      if (widgetRes) {
        const wData = widgetRes.success ? widgetRes.data : widgetRes;
        if (wData && wData.date) {
          setSubWidget(wData);
        }
      }
    } catch (err) {
      console.error("Failed to load substitute widget:", err);
    }
  };

  const fetchPlannerData = async (date, leaveTeacherIds) => {
    setLoadingFeature(true);
    showLoader("Loading planner data...");
    try {
      const res = await getSubstitutePlannerData(date, leaveTeacherIds);
      const pData = res?.success ? res.data : res;
      if (pData && pData.affected_periods) {
        setPlannerData(pData);
        const temp = {};
        pData.affected_periods.forEach(p => {
          if (p.assigned_substitute_id) {
            temp[`${p.class}-${p.period}-${p.original_teacher_id}`] = {
              substitute_teacher_id: p.assigned_substitute_id,
              subject: p.assigned_subject
            };
          }
        });
        setTemporaryAssignments(temp);
      } else {
        setError(res?.message || "Failed to load planner data: Invalid response structure.");
      }
    } catch (err) {
      setError("Failed to load planner data: " + err.message);
    } finally {
      setLoadingFeature(false);
      hideLoader();
    }
  };

  const buildSavedSubstituteTimetable = (savedAssignments) => {
    const teacherById = new Map(teachers.map((teacher) => [String(teacher.id), teacher]));
    return {
      date: plannerDate,
      assignments: savedAssignments.map((assignment) => {
        const teacher = teacherById.get(String(assignment.substitute_teacher_id));
        return {
          class: assignment.class,
          period: assignment.period,
          teacherCode: getSubstituteTeacherCode(teacher)
        };
      })
    };
  };

  const openSubstituteTimetablePreview = (timetableData) => {
    try {
      const imageUrl = generateSubstituteTimetablePng(timetableData);
      setSubstituteTimetableError("");
      setSubstituteTimetablePreview({ ...timetableData, imageUrl });
    } catch (err) {
      setSubstituteTimetableError("Assignments were saved, but the timetable image could not be generated. You can retry from this preview.");
      setSubstituteTimetablePreview({ ...timetableData, imageUrl: null });
    }
  };

  const retrySubstituteTimetableImage = () => {
    if (lastSavedSubstituteTimetable) {
      openSubstituteTimetablePreview(lastSavedSubstituteTimetable);
    }
  };

  const downloadSubstituteTimetableImage = () => {
    if (!substituteTimetablePreview?.imageUrl) return;
    const link = document.createElement("a");
    link.href = substituteTimetablePreview.imageUrl;
    link.download = `substitute-timetable-${substituteTimetablePreview.date || "schedule"}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const shareSubstituteTimetableImage = async () => {
    if (!substituteTimetablePreview?.imageUrl) {
      downloadSubstituteTimetableImage();
      return;
    }
    try {
      const response = await fetch(substituteTimetablePreview.imageUrl);
      const blob = await response.blob();
      const file = new File([blob], `substitute-timetable-${substituteTimetablePreview.date || "schedule"}.png`, { type: "image/png" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: "Substitute Timetable" });
      } else {
        downloadSubstituteTimetableImage();
      }
    } catch (err) {
      downloadSubstituteTimetableImage();
    }
  };
  const saveAssignments = async () => {
    showLoader("Saving assignments...");
    try {
      const list = Object.entries(temporaryAssignments).map(([key, val]) => {
        const [cls, prd, otId] = key.split('-');
        return {
          class: cls,
          period: prd,
          original_teacher_id: otId,
          substitute_teacher_id: val.substitute_teacher_id,
          subject: val.subject
        };
      });

      const res = await saveSubstituteAssignments(plannerDate, list);
      const isSuccess = res?.success || res?.message?.includes("successfully");
      if (isSuccess) {
        playSound('success');
        alert("Assignments saved successfully.");
        const timetableData = buildSavedSubstituteTimetable(list);
        setLastSavedSubstituteTimetable(timetableData);
        await fetchPlannerData(plannerDate, selectedLeaveTeachers.map(t => t.id));
        const widgetRes = await getSubstituteDashboardWidget();
        if (widgetRes) {
          const wData = widgetRes.success ? widgetRes.data : widgetRes;
          if (wData && wData.date) setSubWidget(wData);
        }
        openSubstituteTimetablePreview(timetableData);
      } else {
        setError(res?.message || "Failed to save assignments.");
      }
    } catch (err) {
      setError("Failed to save assignments: " + err.message);
    } finally {
      hideLoader();
    }
  };

  const fetchSubstituteReportData = async () => {
    setLoadingFeature(true);
    showLoader("Loading substitute report...");
    try {
      const res = await getSubstituteReport(subReportFilter);
      const list = res?.success ? res.data : res;
      if (Array.isArray(list)) {
        setSubReportData(list);
      } else {
        setSubReportData([]);
      }
    } catch (err) {
      setError("Failed to load substitute report: " + err.message);
    } finally {
      setLoadingFeature(false);
      hideLoader();
    }
  };

  const fetchFullTimetable = async (day) => {
    setLoadingFeature(true);
    showLoader("Loading timetable...");
    setTimetableError("");
    try {
      const data = await getFullTimetable(day, getUpcomingDateForWeekday(day));
      setFullTimetable(Array.isArray(data) ? data : []);
    } catch (err) {
      setTimetableError("Failed to load timetable. Is the backend running?");
    } finally {
      setLoadingFeature(false);
      hideLoader();
    }
  };

  const openTimetableEditCell = async (classId, period, cell) => {
    if (timetableEditingCell?.classId === classId && timetableEditingCell?.period === period) {
      setTimetableEditingCell(null);
      setTimetableSubjectOptions([]);
      setTimetableManualSubject(false);
      setTimetableEditorData({ teacherId: "", subject: "" });
      return;
    }
    setTimetableEditingCell({ classId, period });
    setTimetableEditorData({ teacherId: cell?.teacherId ? String(cell.teacherId) : "", subject: cell?.subject || "" });
    setTimetableManualSubject(false);
    const teacherId = cell?.teacherId ? String(cell.teacherId) : "";
    if (!teacherId) { setTimetableSubjectOptions([]); return; }
    try {
      const options = await getTeacherSubjectOptions(teacherId);
      const normalized = Array.isArray(options) ? options : [];
      setTimetableSubjectOptions(normalized);
      if (cell?.subject && !normalized.includes(cell.subject)) setTimetableManualSubject(true);
    } catch (err) { setTimetableSubjectOptions([]); }
  };

  const handleTimetableEditorTeacherChange = async (teacherId) => {
    setTimetableEditorData((prev) => ({ ...prev, teacherId, subject: "" }));
    setTimetableManualSubject(false);
    if (!teacherId) { setTimetableSubjectOptions([]); return; }
    try { const opts = await getTeacherSubjectOptions(teacherId); setTimetableSubjectOptions(Array.isArray(opts) ? opts : []); }
    catch (err) { setTimetableSubjectOptions([]); }
  };

  const saveTimetableEditCell = async () => {
    if (!timetableEditingCell) return;
    setTimetableSaveBusy(true);
    try {
      await updateTimetablePeriod({ classId: timetableEditingCell.classId, weekday: selectedDay, period: timetableEditingCell.period, teacherId: timetableEditorData.teacherId || null, subject: timetableEditorData.subject });
      setTimetableEditingCell(null);
      setTimetableEditorData({ teacherId: "", subject: "" });
      setTimetableSubjectOptions([]);
      setTimetableManualSubject(false);
      await fetchFullTimetable(selectedDay);
    } catch (err) { /* silent */ }
    finally { setTimetableSaveBusy(false); }
  };

  const fetchDailyReport = async (date) => {
    setLoadingFeature(true);
    // showLoader("Loading daily report...");
    try {
      const data = await getDailyReport(date);
      setDailyReportData(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportError("Failed to load daily report.");
    } finally {
      setLoadingFeature(false);
      // hideLoader();
    }
  };

  const handleStudentSearch = async () => {
    if (!searchRollNo) return;
    trackEvent(`Searched student roll ${searchRollNo}`);
    setLoadingFeature(true);
    showLoader("Searching student...");
    try {
      const data = await getStudentHistory(searchRollNo);
      setStudentHistory(data);
    } catch (err) {
      alert("Student not found or error loading history.");
    } finally {
      setLoadingFeature(false);
      hideLoader();
    }
  };

  const fetchBatchReport = async (classId) => {
    if (!classId) return;
    setLoadingFeature(true);
    try {
      const data = await getBatchReport(classId);
      setBatchReport(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportError("Failed to load batch report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchClassAverages = async () => {
    setLoadingClassAverages(true);
    try {
      const res = await getClassAverages();
      if (res && Array.isArray(res)) {
        setClassAverages(res);
      } else if (res && res.success && Array.isArray(res.data)) {
        setClassAverages(res.data);
      } else {
        setClassAverages([]);
      }
    } catch (err) {
      setReportError("Failed to load class averages.");
      setClassAverages([]);
    } finally {
      setLoadingClassAverages(false);
    }
  };

  const fetchWeeklyReport = async () => {
    setLoadingFeature(true);
    try {
      const data = await getWeeklyReport();
      setWeeklyReport(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportError("Failed to load weekly report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const fetchSyllabusConfigs = async () => {
    setLoadingSyllabus(true);
    try {
      const data = await getSyllabusConfigs({
        class: selectedSyllabusClassFilter,
        teacherId: selectedSyllabusTeacherFilter,
        subject: selectedSyllabusSubjectFilter
      });
      setSyllabusConfigsState(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load syllabus configs:", err);
    } finally {
      setLoadingSyllabus(false);
    }
  };

  const handleSaveSyllabusConfig = async (e) => {
    if (e) e.preventDefault();
    showLoader("Saving syllabus configuration...");
    try {
      const formattedTargets = Object.entries(syllabusMonthTargets)
        .filter(([_, value]) => value !== "")
        .map(([month, value]) => ({ month, target_end_page: Number(value) }));

      const payload = {
        ...syllabusFormData,
        start_page: Number(syllabusFormData.start_page),
        end_page: Number(syllabusFormData.end_page),
        targets: formattedTargets
      };

      const res = await saveSyllabusConfig(payload);
      if (res.success) {
        trackEvent('Saved syllabus config', syllabusFormData.className || '');
        setSyllabusPopupOpen(false);
        fetchSyllabusConfigs();
      } else {
        alert(res.message || "Failed to save syllabus configuration.");
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      hideLoader();
    }
  };

  const handleUpdateSyllabusProgress = async (configId, pageNum) => {
    if (!pageNum) return;
    showLoader("Updating syllabus progress...");
    try {
      const res = await updateSyllabusProgress({
        syllabus_config_id: configId,
        current_page: Number(pageNum)
      });
      if (res.success) {
        trackEvent('Updated syllabus progress', `page ${pageNum}`);
        setSyllabusPageProgressData(prev => ({ ...prev, [configId]: "" }));
        fetchSyllabusConfigs();
      } else {
        alert(res.message || "Failed to update progress.");
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      hideLoader();
    }
  };

  const selectedPermissionStudent = permissionStudents.find(s => String(s.id) === String(permissionForm.student_id));
  const filteredPermissionStudents = permissionStudents.filter((student) => {
    const query = permissionSearch.trim().toLowerCase();
    if (!query) return true;
    return `${student.name} ${student.rollNo} ${student.class}`.toLowerCase().includes(query);
  }).slice(0, 80);

  const fetchPermissionStudents = async () => {
    if (!canUsePermissionManager(user)) return;
    try {
      const data = await getPermissionStudents();
      setPermissionStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      setPermissionMessage(err.message || "Failed to load students.");
    }
  };

  const fetchPermissionSummary = async () => {
    if (!canUsePermissionManager(user)) return;
    try {
      const data = await getPermissionSummary();
      setPermissionSummary(data || {});
    } catch (err) {
      setPermissionSummary({ pendingApprovals: 0, todaysOutpasses: 0, activeLeaveCards: 0, todaysPermissions: 0 });
    }
  };

  const fetchPermissionRecords = async (view = permissionView, filters = permissionHistoryFilters) => {
    if (!canUsePermissionManager(user) || view === "new") return;
    if (view === "pending" && !canApprovePermissions(user)) {
      setPermissionMessage("Only Principal and Vice Principal can access pending approvals.");
      setPermissionRecords([]);
      return;
    }
    setLoadingPermissions(true);
    try {
      const apiView = view === "pending" ? "pending" : view === "active" ? "active_leave" : "history";
      const data = await getPermissions(apiView, apiView === "history" ? filters : {});
      setPermissionRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      setPermissionMessage(err.message || "Failed to load permissions.");
      setPermissionRecords([]);
    } finally {
      setLoadingPermissions(false);
    }
  };

  const handlePermissionViewChange = (view) => {
    if (view === "pending" && !canApprovePermissions(user)) {
      setPermissionMessage("Only Principal and Vice Principal can access pending approvals.");
      return;
    }
    setPermissionView(view);
    setPermissionMessage("");
    setHistoryType("");
    setHistoryStudentId("");
    setHistorySearch("");
    setHistorySelectedRecord(null);
    if (view === "history") {
      fetchHistoryStudents();
    } else if (view !== "new") {
      fetchPermissionRecords(view);
    }
  };

  const handlePermissionHistorySearch = (e) => {
    e.preventDefault();
    fetchPermissionRecords("history", permissionHistoryFilters);
  };

  const handleApprovePermission = async (permissionId) => {
    if (!canApprovePermissions(user)) return;
    setPermissionActionBusyId(permissionId);
    setPermissionMessage("");
    try {
      const res = await approvePermission(permissionId);
      setPermissionMessage(res.message || "Permission approved.");
      fetchPermissionSummary();
      await fetchPermissionRecords("pending");
    } catch (err) {
      setPermissionMessage(err.message || "Failed to approve permission.");
    } finally {
      setPermissionActionBusyId(null);
    }
  };

  const handleRejectPermission = async (permissionId) => {
    if (!canApprovePermissions(user)) return;
    setPermissionActionBusyId(permissionId);
    setPermissionMessage("");
    try {
      const res = await rejectPermission(permissionId);
      setPermissionMessage(res.message || "Permission rejected.");
      fetchPermissionSummary();
      await fetchPermissionRecords("pending");
    } catch (err) {
      setPermissionMessage(err.message || "Failed to reject permission.");
    } finally {
      setPermissionActionBusyId(null);
    }
  };

  const handleTeacherReturnApproval = async (permissionId) => {
    setPermissionActionBusyId(permissionId);
    setPermissionMessage("");
    try {
      const res = await approveTeacherReturn(permissionId);
      setPermissionMessage(res.message || "Return submitted.");
      fetchPermissionSummary();
      await fetchPermissionRecords("active");
    } catch (err) {
      setPermissionMessage(err.message || "Failed to submit return.");
    } finally {
      setPermissionActionBusyId(null);
    }
  };

  const handlePrincipalReturnApproval = async (permissionId) => {
    setPermissionActionBusyId(permissionId);
    setPermissionMessage("");
    try {
      const res = await approvePrincipalReturn(permissionId);
      setPermissionMessage(res.message || "Leave card closed.");
      fetchPermissionSummary();
      await fetchPermissionRecords("active");
    } catch (err) {
      setPermissionMessage(err.message || "Failed to approve return.");
    } finally {
      setPermissionActionBusyId(null);
    }
  };

  const handlePrincipalReturnReject = async (permissionId) => {
    setPermissionActionBusyId(permissionId);
    setPermissionMessage("");
    try {
      const res = await rejectPrincipalReturn(permissionId);
      setPermissionMessage(res.message || "Return rejected.");
      fetchPermissionSummary();
      await fetchPermissionRecords("active");
    } catch (err) {
      setPermissionMessage(err.message || "Failed to reject return.");
    } finally {
      setPermissionActionBusyId(null);
    }
  };

  const handleCreatePermission = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setPermissionMessage("");
    setPermissionErrors({});

    const errors = {};
    if (!permissionForm.student_id) {
      errors.student_id = true;
    }
    const finalReason = permissionForm.reason === "Other" ? permissionForm.custom_reason.trim() : permissionForm.reason;
    if (!finalReason) {
      errors.reason = true;
    }
    if (permissionForm.permission_type === "Outpass") {
      if (!permissionForm.leaving_time) errors.leaving_time = true;
      if (!permissionForm.expected_return_time) errors.expected_return_time = true;
      if (permissionForm.leaving_time && permissionForm.expected_return_time && permissionForm.leaving_time >= permissionForm.expected_return_time) {
        errors.leaving_time = true;
        errors.expected_return_time = true;
        playSound('error');
        setPermissionMessage("Leaving time must be before the returning time.");
        setPermissionErrors(errors);
        return;
      }
    } else {
      if (!permissionForm.leaving_date) errors.leaving_date = true;
    }

    if (Object.keys(errors).length > 0) {
      setPermissionErrors(errors);
      playSound('error');
      setPermissionMessage("Please fill in all required fields highlighted in red.");
      return;
    }

    showLoader("Creating permission...");
    try {
      const res = await createPermission({
        student_id: Number(permissionForm.student_id),
        permission_type: permissionForm.permission_type,
        reason: finalReason,
        destination: finalReason,
        attendance_status: permissionForm.attendance_status,
        remarks: permissionForm.remarks.trim(),
        leaving_time: permissionForm.permission_type === "Outpass" ? permissionForm.leaving_time : "",
        leaving_date: permissionForm.permission_type === "Leave Card" ? permissionForm.leaving_date : "",
        expected_return_time: permissionForm.permission_type === "Outpass" ? permissionForm.expected_return_time : "",
        expected_return_date: "",
      });
      playSound('success');
      setPermissionMessage(`${res.message || "Permission created successfully."} ${res.data?.permissionNumber ? `No: ${res.data.permissionNumber}` : ""}`);
      setPermissionForm({
        student_id: "",
        permission_type: "Outpass",
        reason: "Hospital",
        custom_reason: "",
        destination: "",
        attendance_status: "Absent",
        remarks: "",
        leaving_time: getIstTimeString(),
        leaving_date: getIstDateString(),
        expected_return_time: "",
        expected_return_date: "",
      });
      setPermissionSearch("");
      fetchPermissionSummary();
      trackEvent("Created permission request", res.data?.status || "");
    } catch (err) {
      playSound('error');
      setPermissionMessage(err.message || "Failed to create permission.");
    } finally {
      hideLoader();
    }
  };

  const handleDeleteSyllabusConfig = async (configId) => {
    if (!confirm("Are you sure you want to delete this syllabus configuration?")) return;
    showLoader("Deleting configuration...");
    try {
      const res = await deleteSyllabusConfig(configId);
      if (res.success) {
        trackEvent('Deleted syllabus config');
        fetchSyllabusConfigs();
      } else {
        alert(res.message || "Failed to delete.");
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      hideLoader();
    }
  };

  async function fetchExtraClassesReport(customDate) {
    const targetDate = customDate || selectedDate;
    setLoadingExtra(true);
    try {
      const data = await getExtraClassesReport({
        date: targetDate,
        teacherId: selectedTeacherForExtra,
        classId: selectedClassForExtra
      });
      setExtraClassesReport(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Extra classes report failed:", err);
    } finally {
      setLoadingExtra(false);
    }
  }

  async function fetchNamazAnalytics() {
    setLoadingNamaz(true);
    setReportError("");
    try {
      const data = await getNamazAnalytics({
        fromDate: namazFromDate,
        toDate: namazToDate,
        className: selectedNamazClass,
        studentId: selectedNamazStudent.trim(),
        sessionType: selectedNamazSession,
      });
      setNamazAnalytics(data || null);
    } catch (err) {
      setReportError("Namaz analytics failed: " + err.message);
      setNamazAnalytics(null);
    } finally {
      setLoadingNamaz(false);
    }
  }

  async function fetchEventAttendance() {
    setLoadingEvents(true);
    setReportError("");
    try {
      const data = await getEventAttendance();
      setEventAttendance(data || []);
    } catch (err) {
      setReportError("Failed to fetch event attendance: " + err.message);
      setEventAttendance([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  async function exportNamazExcel() {
    if (!namazAnalytics) return;
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Namaz Analytics");
    sheet.addRow(["Namaz & Event Analytics"]);
    sheet.addRow(["From", namazFromDate, "To", namazToDate, "Class", selectedNamazClass || "All", "Student", selectedNamazStudent || "All", "Session", selectedNamazSession || "All"]);
    sheet.addRow([]);
    sheet.addRow(["Metric", "Value"]);
    Object.entries(namazAnalytics.cards || {}).forEach(([key, value]) => sheet.addRow([key, value]));
    sheet.addRow([]);
    sheet.addRow(["Roll No", "Name", "Present", "Total", "Percent"]);
    (namazAnalytics.students || []).forEach((student) => {
      sheet.addRow([student.rollNo, student.name, student.present, student.total, student.percent]);
    });
    sheet.columns.forEach((column) => { column.width = 18; });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `namaz_analytics_${namazFromDate}_${namazToDate}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function exportNamazPdf() {
    if (!namazAnalytics) return;
    const rows = (namazAnalytics.students || []).map((student) => `
      <tr><td>${student.rollNo}</td><td>${student.name}</td><td>${student.present}</td><td>${student.total}</td><td>${student.percent}%</td></tr>
    `).join("");
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`
      <html><head><title>Namaz Analytics</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#111827}
        h1{margin:0 0 8px;font-size:24px} p{color:#4b5563}
        table{width:100%;border-collapse:collapse;margin-top:20px}
        th,td{border:1px solid #e5e7eb;padding:9px;text-align:left;font-size:12px}
        th{background:#f3f4f6}
        .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}
        .card{border:1px solid #e5e7eb;border-radius:10px;padding:12px}
        .label{font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:700}
        .value{font-size:20px;font-weight:800;margin-top:4px}
      </style></head><body>
      <h1>Namaz & Event Analytics</h1>
      <p>${namazFromDate} to ${namazToDate} | Class: ${selectedNamazClass || "All"} | Student: ${selectedNamazStudent || "All"} | Session: ${selectedNamazSession || "All"}</p>
      <div class="cards">
        ${Object.entries(namazAnalytics.cards || {}).map(([key, value]) => `<div class="card"><div class="label">${key}</div><div class="value">${value}</div></div>`).join("")}
      </div>
      <table><thead><tr><th>Roll No</th><th>Name</th><th>Present</th><th>Total</th><th>Percent</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function fetchDigitalRegister() {
    if (!selectedClassForAnalysis || !selectedTeacherForRegister) return;
    setLoadingRegister(true);
    setReportError("");
    try {
      console.log("REQUEST PARAMS:", {
        classId: selectedClassForAnalysis,
        teacherId: selectedTeacherForRegister,
        fromDate: registerFromDate,
        toDate: registerToDate
      });
      const res = await getTeacherRegisterReport({
        classId: selectedClassForAnalysis,
        teacherId: selectedTeacherForRegister,
        fromDate: registerFromDate,
        toDate: registerToDate
      });
      console.log("API RESPONSE:", res);
      setDigitalRegisterData(Array.isArray(res?.data) ? res.data : []);
      setDigitalRegisterSessionLabels(Array.isArray(res?.sessionLabels) ? res.sessionLabels : []);
      setDigitalRegisterSummary(res?.summary || { classesTaken: 0, assignedPeriods: 0, teachingPercentage: 0 });
    } catch (err) {
      console.error("Digital register report failed:", err);
      setReportError("Failed to load digital register.");
    } finally {
      setLoadingRegister(false);
    }
  }

  const exportToExcel = async () => {
    if (digitalRegisterData.length === 0) return;
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Digital Register');

      const teacherName = selectedTeacherForRegister === "all"
        ? "All Teachers"
        : teachers.find((t) => String(t.id) === String(selectedTeacherForRegister))?.name || "Teacher";
      const className = classes.find((c) => String(c.id) === String(selectedClassForAnalysis))?.name || selectedClassForAnalysis || "Class";

      const fromDateObj = new Date(registerFromDate);
      const toDateObj = new Date(registerToDate);
      const sameMonth = fromDateObj.getFullYear() === toDateObj.getFullYear() && fromDateObj.getMonth() === toDateObj.getMonth();
      const monthLabel = sameMonth
        ? fromDateObj.toLocaleString('en-US', { month: 'long' })
        : `${fromDateObj.toLocaleString('en-US', { month: 'short' })}-${toDateObj.toLocaleString('en-US', { month: 'short' })}`;
      const compactSessionLabels = (digitalRegisterSessionLabels.length > 0 ? digitalRegisterSessionLabels : []).map((label) => {
        const [datePart, ...periodParts] = String(label || "").split(" ");
        const periodPart = periodParts.join(" ");
        const parsed = new Date(datePart);
        const compactDate = Number.isNaN(parsed.getTime())
          ? datePart
          : `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}`;
        return `${compactDate} ${periodPart}`.trim();
      });

      // 1. Setup Columns
      const headers = [
        "Roll",
        "Name",
        ...compactSessionLabels,
        "Total",
        "%"
      ];

      sheet.columns = headers.map((h, i) => ({
        header: h,
        key: `col_${i}`,
        width: i === 1 ? 22 : (i > 1 && i < headers.length - 2 ? 8 : 7)
      }));
      sheet.pageSetup = {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 }
      };
      sheet.pageSetup.printTitlesRow = '1:5';
      sheet.properties.defaultRowHeight = 18;

      // 2. Add Title & Metadata Header
      sheet.insertRow(1, ["ATTENDANCE REGISTER"]);
      sheet.insertRow(2, ["Teacher", teacherName, "Class", className, "Period", `${registerFromDate} to ${registerToDate}`]);
      sheet.insertRow(3, ["Classes Taken", digitalRegisterSummary.classesTaken || 0, "Assigned", digitalRegisterSummary.assignedPeriods || 0, "Teaching %", `${digitalRegisterSummary.teachingPercentage || 0}%`]);
      sheet.insertRow(4, ["Legend", "Present = numbered count", "A = Absent", "SL = Special Leave", "S = Sick", "L = Leave"]);
      sheet.insertRow(5, []);

      const titleCell = sheet.getCell('A1');
      titleCell.font = { size: 14, bold: true, color: { argb: 'FF1D4ED8' } };
      sheet.mergeCells(1, 1, 1, Math.max(headers.length, 6));
      [2, 3, 4].forEach((rowNumber) => {
        const row = sheet.getRow(rowNumber);
        row.height = 18;
        row.eachCell((cell) => {
          cell.font = { size: 9, bold: true, color: { argb: 'FF334155' } };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        });
      });

      // 3. Header Row Styling
      const headerRow = sheet.getRow(6);
      headerRow.values = headers;
      headerRow.height = 28;
      headerRow.eachCell((cell) => {
        cell.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
        };
      });

      // 4. Add Data
      digitalRegisterData.forEach((row) => {
        const bodyRowValues = [
          row.rollNo,
          row.name,
          ...(row.attendanceCells || []),
          row.total,
          `${row.percentage}%`
        ];
        const newRow = sheet.addRow(bodyRowValues);
        newRow.height = 17;

        newRow.eachCell((cell, colNum) => {
          cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
          cell.font = { size: 9 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };

          // Conditional Styling for attendance cells
          if (colNum > 2 && colNum <= headers.length - 2) {
            const val = String(cell.value || "");
            if (val === 'A') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } }; // Light Red
              cell.font = { color: { argb: 'FFDC2626' }, bold: true };
            } else if (val === 'S') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }; // Light Orange
              cell.font = { color: { argb: 'FFD97706' }, bold: true };
            } else if (val === 'L') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5FF' } }; // Light Purple
              cell.font = { color: { argb: 'FF9333EA' }, bold: true };
            } else if (val === 'SL') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; // Special Leave Blue
              cell.font = { color: { argb: 'FF1D4ED8' }, bold: true };
            } else if (val !== "" && val !== "-") {
              // Numbers (Present)
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Light Green
              cell.font = { color: { argb: 'FF059669' }, bold: true };
            }
          }

          if (colNum === 2) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', shrinkToFit: true };
            cell.font = { size: 9, bold: true };
          }
          if (colNum === 1) cell.font = { size: 9, bold: true };
        });
      });

      sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 6 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (s) => String(s || "").replace(/[^a-z0-9]/gi, '_');
      a.href = url;
      a.download = `${safeName(teacherName)}_${safeName(className)}_${monthLabel.replace(/\s+/g, '_')}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Excel Export Error:", error);
      alert("Failed to export Excel. Please check console.");
    }
  };

  async function fetchTeachers() {
    try {
      const data = await getTeachersList();
      setTeachers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch teachers:", err);
    }
  }

  async function fetchAdminLog(date, silent = false) {
    if (user?.role !== "admin") return;
    try {
      const data = await getAdminActivityLog(date);
      setAdminActivityLog(data && typeof data === "object" ? data : { activeUsers: [], actions: [] });
    } catch (err) {
      if (!silent) setReportError("Failed to load admin activity log.");
    }
  }

  const fetchSickLeaveOverview = async () => {
    setLoadingFeature(true);
    try {
      const data = await getSickLeaveOverview();
      setSickLeaveOverview(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportError("Failed to load health report.");
    } finally {
      setLoadingFeature(false);
    }
  };

  const handleViewHealthList = async (type) => {
    setHealthListLoading(true);
    showLoader(`Fetching ${type} list...`);
    setViewingHealthList(type);
    setHealthListData(null);
    try {
      const res = type === 'sick' ? await getSickList() : await getLeaveList();
      if (res.success) {
        setHealthListData(res);
      } else {
        setReportError(res.error || "Failed to fetch list.");
        setViewingHealthList(null);
      }
    } catch (err) {
      setReportError("Connectivity error.");
      setViewingHealthList(null);
    } finally {
      setHealthListLoading(false);
      hideLoader();
    }
  };

  const openPeriodModal = async (cls, period, date) => {
    // Push a history entry so the phone back button closes the modal
    history.pushState({ modal: 'period' }, '');
    setPeriodModal({ class: cls, period, date, data: null, loading: true });
    try {
      const data = await getPeriodSummary(cls, period, date);
      setPeriodModal({ class: cls, period, date, data, loading: false });
    } catch (err) {
      setPeriodModal({ class: cls, period, date, data: null, loading: false, error: err.message });
    }
  };

  // Close modal AND pop the history entry we pushed when opening it
  const closeModal = () => {
    setPeriodModal(null);
    if (history.state?.modal === 'period') history.back();
  };

  const openTimetablePdf = () => {
    history.pushState({ ...history.state, timetablePdf: true }, "");
    setTimetablePdfOpen(true);
  };

  const closeTimetablePdf = () => {
    if (history.state?.timetablePdf) {
      history.back();
    } else {
      setTimetablePdfOpen(false);
    }
  };

  const dismissSemesterPopup = async () => {
    if (!activeAnnouncement?.announcementKey) return;
    setSemesterPopupSaving(true);
    try {
      await dismissAnnouncement(activeAnnouncement?.announcementKey);
      setSemesterPopupOpen(false);
      setActiveAnnouncement(null);
    } catch (err) {
      console.error("Failed to dismiss announcement:", err);
      alert("Could not save this popup as dismissed. Please try again.");
    } finally {
      setSemesterPopupSaving(false);
    }
  };

  const handleLoadStudents = () => {
    if (!selectedClass) {
      alert("Please select a class.");
      return;
    }

    if (multiMode) {
      if (selectedPeriods.length === 0) {
        alert("Please select at least one period.");
        return;
      }
    } else {
      if (!selectedPeriod || !resolvedSubject || resolvedSubject.error) {
        alert("Please select a period with a scheduled subject.");
        return;
      }
    }

    sessionStorage.setItem("attendance_params", JSON.stringify({
      classId: selectedClass,
      period: multiMode ? selectedPeriods.join(", ") : selectedPeriod,
      periods: multiMode ? selectedPeriods : [selectedPeriod],
      subjectId: multiMode ? "Multiple" : resolvedSubject.subject,
      date: attendanceDate,
      className: classes.find(c => c.id === selectedClass)?.name,
      subjectName: multiMode ? "Multi-Period Attendance" : resolvedSubject.subject,
      multiMode: multiMode
    }));

    router.push("/attendance");
  };

  if (loading) return <PencilLoader />;

  const roleBadge = getDashboardRoleBadge(user);

  return (
    <div className="flex min-h-dvh flex-col font-sans text-gray-900" style={{ backgroundColor: 'rgba(55, 151, 169, 0.08)' }}>
      <style>{`@keyframes softBlink{0%,100%{opacity:1}50%{opacity:.35}}.animate-soft-blink{animation:softBlink 2s ease-in-out infinite}`}</style>

      {/* ── HEADER — scrolls away, not sticky ── */}
      <header className="anim-header relative z-[70] border-b border-white/10 px-4 py-5 sm:px-6 rounded-b-3xl" style={{ background: 'linear-gradient(135deg, #082231 0%, #063a43 100%)', boxShadow: '0 8px 24px rgba(8,34,49,0.18)' }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.1] p-1.5 shadow-md overflow-hidden">
              <img
                src="/logo.png"
                alt="MARKHINS HUB"
                className="h-full w-full object-contain drop-shadow-sm scale-110"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black leading-tight tracking-tight text-white sm:text-2xl">MARKHINS HUB</h1>
              <div className="mt-1 flex items-center gap-2">
                <p className="truncate text-[11px] font-bold text-teal-200/80 max-w-[130px] sm:max-w-none">
                  {user?.name || 'Teacher'}
                </p>
                <span className={`inline-flex items-center truncate rounded-full border px-3 py-0.5 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm ${roleBadge.className}`}>
                  {roleBadge.label}
                </span>
              </div>
            </div>
          </div>

          <div ref={headerMenuRef} className="relative shrink-0">
            <label
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); setHeaderMenuOpen((prev) => !prev); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setHeaderMenuOpen((prev) => !prev);
                }
              }}
              className="hamburger relative z-[60] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white/70 transition-all hover:bg-white/15 hover:text-white"
              title="Menu"
            >
              <input type="checkbox" checked={headerMenuOpen} readOnly />
              <svg viewBox="0 0 32 32">
                <path className="line line-top-bottom" d="M27 10H13C10.8 10 9 8.2 9 6S10.8 2 13 2H20" />
                <path className="line" d="M7 16H27" />
                <path className="line line-top-bottom" d="M27 22H13C10.8 22 9 23.8 9 26S10.8 30 13 30H20" />
              </svg>
            </label>

            <div
              className={`fixed inset-0 z-[59] transition-opacity duration-200 ${headerMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
              onClick={() => setHeaderMenuOpen(false)}
            />
            <div className={`bubble-menu absolute right-0 top-12 z-[60] w-56 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl shadow-gray-200/40 ${headerMenuOpen ? 'bubble-menu-open' : 'bubble-menu-closed'}`}>
                  {user?.role === 'admin' && (
                    <button
                      onClick={() => { router.push("/settings"); setHeaderMenuOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-gray-700 transition-all hover:bg-gray-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Settings
                    </button>
                  )}
                  <button
                    onClick={() => { router.push("/profile"); setHeaderMenuOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-gray-700 transition-all hover:bg-gray-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    My Profile
                  </button>
                  <div className="border-t border-gray-100" />
                  <div className="flex items-center gap-3 px-4 py-3">
                    <VolumeToggle className="!h-auto !w-auto !p-0 !rounded-none !bg-transparent !border-none" />
                    <span className="text-sm font-bold text-gray-700">Sound</span>
                  </div>
                  <div className="border-t border-gray-100" />
                  <button
                    onClick={() => { logout(); setHeaderMenuOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-red-600 transition-all hover:bg-red-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Log out
                  </button>
                </div>
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      {semesterPopupOpen && activeAnnouncement && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-5 py-8 backdrop-blur-md perspective-1000">
          <div className="w-full max-w-md overflow-hidden rounded-[2.5rem] bg-slate-900/90 border border-slate-800/80 shadow-[0_30px_70px_rgba(0,0,0,0.75),_0_0_50px_rgba(99,102,241,0.15)] ring-1 ring-white/10 card-3d-broadcast animate-modal-in">
            {/* Header Block */}
            <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950 px-6 py-8 text-white relative overflow-hidden border-b border-slate-850">
              <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="flex items-start gap-4 relative z-10">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 p-2.5 border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.15)] anim-logo">
                  <img
                    src="/logo.png"
                    alt="Campus logo"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div>
                  <p
                    className="text-4xl font-extrabold leading-none bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                    style={{ fontFamily: "'Amiri', 'Noto Naskh Arabic', 'Times New Roman', serif" }}
                  >
                    السلام عليكم
                  </p>
                  <h2 className="mt-3 text-2xl font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                    {activeAnnouncement.heading}
                  </h2>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-200">
                    {activeAnnouncement.content.replaceAll("{teacherName}", user?.name || "Teacher")}
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Content Area */}
            <div className="space-y-6 bg-slate-950/90 px-6 py-7">
              {activeAnnouncement.footer && (
                <div className="flex items-start gap-3.5 rounded-2xl border border-indigo-500/20 bg-indigo-950/40 px-4 py-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05)]">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.2)]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <p className="text-xs font-bold leading-relaxed text-slate-300">
                    {activeAnnouncement.footer.replaceAll("{teacherName}", user?.name || "Teacher")}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href={`https://wa.me/918123312736?text=${encodeURIComponent("السلام عليكم")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-emerald-50 px-5 py-4 text-center text-xs font-black uppercase tracking-widest border border-emerald-500/30 btn-glow-emerald transition-all active:scale-[0.97]"
                >
                  Contact Developer
                </a>
                <button
                  onClick={dismissSemesterPopup}
                  disabled={semesterPopupSaving}
                  className="rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-5 py-4 text-xs font-black uppercase tracking-widest btn-glow-indigo transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {semesterPopupSaving ? "Saving..." : "Got it"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main
        className={`flex-1 ${mainShellClass} mx-auto w-full py-6 space-y-6 transition-[max-width,padding] duration-300`}
        style={{
          paddingBottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 1.5rem)"
        }}
      >

        {error && (
          <div className="max-w-md mx-auto p-4 text-red-600 bg-red-50 rounded-xl border border-red-100 text-sm font-medium">
            {error}
          </div>
        )}

        {/* --- ATTENDANCE TAB (OVERHAULED) --- */}
        {activeTab === "attendance" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* ── Substitute Planner Dashboard Widget ── */}
            {(user?.role === 'admin' || subCoordinators.includes(String(user?.id)) || subCoordinators.includes(user?.username)) && subWidget && (
              <div onClick={() => { setReportType('substitute'); setActiveTab('reports'); router.push('/?tab=reports&type=substitute', { scroll: false }); }}
                className="hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#5eead4] bg-[#5eead4]/10 px-2 py-0.5 rounded-full">Substitute Planner</span>
                    <h3 className="text-lg font-black mt-2">Tomorrow&apos;s Coverage</h3>
                    <p className="text-[10px] text-white/50 mt-0.5 font-bold uppercase tracking-wider">{subWidget.date}</p>
                  </div>
                  <span className="text-2xl">📅</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4 border-t border-white/10 pt-4">
                  <div className="text-center">
                    <p className="text-xl font-black text-amber-300">{subWidget.totalSubstitutes}</p>
                    <p className="text-[8px] font-bold uppercase text-white/60 tracking-wider">Affected Slots</p>
                  </div>
                  <div className="text-center border-x border-white/10">
                    <p className="text-xl font-black text-emerald-400">{subWidget.assigned}</p>
                    <p className="text-[8px] font-bold uppercase text-white/60 tracking-wider">Assigned</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-black text-rose-400">{subWidget.pending}</p>
                    <p className="text-[8px] font-bold uppercase text-white/60 tracking-wider">Pending</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── MODE SELECTOR ── */}
            <div className="grid grid-cols-2 gap-4 anim-fade-up" style={{ animationDelay: '0.05s' }}>
              {/* Regular Attendance — click scrolls to form */}
              <button
                onClick={() => regularFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="anim-float-regular bg-blue-600 hover:bg-blue-700 p-6 rounded-[2.5rem] shadow-xl shadow-blue-100 flex flex-col gap-3 relative overflow-hidden text-left transition-all active:scale-95 group"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl" />
                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center text-xl">🟢</div>
                <div>
                  <p className="text-white font-black text-sm leading-tight">Regular</p>
                  <p className="text-blue-100 text-[10px] font-bold mt-0.5">Timetable-based</p>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <span className="text-white/70 text-[9px] font-black uppercase tracking-widest">Tap to mark</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white/60 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Extra Class — navigates to /extra */}
              <button
                onClick={() => router.push("/extra")}
                className="anim-float-extra bg-amber-400 hover:bg-amber-500 p-6 rounded-[2.5rem] shadow-xl shadow-amber-100 flex flex-col gap-3 relative overflow-hidden text-left transition-all active:scale-95 group"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl " />
                <div className="w-10 h-10 bg-white/30 rounded-2xl flex items-center justify-center text-xl">⚡</div>
                <div>
                  <p className="text-white font-black text-sm leading-tight">Extra Class</p>
                  <p className="text-amber-100 text-[10px] font-bold mt-0.5">Manual • No timetable</p>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <span className="text-white/70 text-[9px] font-black uppercase tracking-widest">Tap to start</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white/60 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>

            {/* ── REGULAR ATTENDANCE FORM ── */}
            <div ref={regularFormRef} className="anim-fade-up bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-8" style={{ animationDelay: '0.15s' }}>
              <div className="flex items-center gap-3 pb-2 border-b border-gray-50">
                <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center text-base">🟢</div>
                <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Regular Attendance</span>
              </div>
              <section>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">Attendance Date 🗓️</label>
                <div className="relative">
                  <input
                    type="date"
                    className="w-full px-6 py-5 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 outline-none text-xl font-bold transition-all appearance-none cursor-pointer"
                    value={attendanceDate}
                    max={getIstDateString()}
                    onChange={(e) => setAttendanceDate(e.target.value)}
                  />
                  {attendanceDate === getIstDateString() && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest bg-green-50 text-green-600 border border-green-100 px-2.5 py-1 rounded-full pointer-events-none">Today</span>
                  )}
                </div>
              </section>

              <section>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">1. Select Class</label>
                <select
                  className="w-full px-6 py-5 rounded-3xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 outline-none text-xl font-bold transition-all appearance-none cursor-pointer"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="">Choose Class</option>
                  {(Array.isArray(classes) ? classes : []).map((cls) => (<option key={cls.id} value={cls.id}>{cls.name}</option>))}
                </select>
              </section>

              {selectedClass && (
              <section className="animate-fade-in">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">2. Select Period</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setMultiMode(!multiMode);
                        setSelectedPeriods([]);
                        setSelectedPeriod("");
                      }}
                      className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border transition-all ${multiMode ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100' : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'}`}
                    >
                      {multiMode ? '🔥 Multi ON' : 'Multi-Select'}
                    </button>
                    {Array.isArray(markedPeriods) && markedPeriods.length > 0 && (
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100 italic">
                        {attendanceDate === getIstDateString() ? 'Today' : attendanceDate}: {markedPeriods.map(p => String(p).replace('P', '')).join(', ')} marked
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {periods.map((p) => {
                    const safeMarkedPeriods = Array.isArray(markedPeriods) ? markedPeriods : [];
                    const safeMarkedDetails = Array.isArray(markedDetails) ? markedDetails : [];
                    const isMarked = safeMarkedPeriods.includes(p);
                    const markData = safeMarkedDetails.find(d => d.period === p);
                    const teacherName = markData?.teacher || "Marked";

                    const isSelected = multiMode ? selectedPeriods.includes(p) : selectedPeriod === p;
                    const isMyPeriod = !isMarked && !isSelected && myAssignedPeriods.includes(p);

                    const handleToggle = () => {
                      if (isMarked) return;
                      if (multiMode) {
                        setSelectedPeriods(prev =>
                          prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                        );
                      } else {
                        setSelectedPeriod(p);
                      }
                    };

                    return (
                      <button
                        key={p}
                        onClick={handleToggle}
                        disabled={isMarked}
                        className={`min-h-16 py-4 rounded-2xl text-lg font-black transition-all relative overflow-visible flex flex-col items-center justify-center gap-1 ${isSelected
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : isMarked
                            ? 'bg-red-50 text-red-500 border border-red-100 cursor-not-allowed opacity-90'
                            : isMyPeriod
                              ? 'bg-emerald-50 text-emerald-500 border border-emerald-200 animate-soft-blink'
                              : 'bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100'
                          }`}
                      >
                        <span className={isMarked
                          ? 'absolute left-3 top-2 z-30 text-sm font-black text-red-500'
                          : isMyPeriod
                            ? 'relative z-10 text-emerald-500 animate-soft-blink'
                            : 'relative z-10'
                        }>
                          {p.replace('P', '')}
                        </span>
                        {isMarked && (
                          <>
                            <div className="absolute -bottom-2 right-0 z-20 pointer-events-none">
                              <div className="relative h-[52px] w-[52px] -rotate-[11deg] rounded-full bg-transparent text-red-700 opacity-60 mix-blend-multiply">
                                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
                                  <defs>
                                    <path
                                      id={`seal-ring-${p}`}
                                      d="M 50,50 m -39,0 a 39,39 0 1,1 78,0 a 39,39 0 1,1 -78,0"
                                    />
                                    <mask id={`seal-wear-${p}`}>
                                      <rect width="100" height="100" fill="white" />
                                      <g fill="black">
                                        <rect x="8" y="29" width="13" height="2.8" rx="1.4" transform="rotate(-18 8 29)" />
                                        <rect x="18" y="12" width="8" height="2.2" rx="1.1" transform="rotate(24 18 12)" />
                                        <rect x="39" y="7" width="15" height="2.5" rx="1.2" transform="rotate(-4 39 7)" />
                                        <rect x="68" y="12" width="10" height="2.4" rx="1.2" transform="rotate(18 68 12)" />
                                        <rect x="83" y="29" width="9" height="3" rx="1.5" transform="rotate(55 83 29)" />
                                        <rect x="84" y="63" width="11" height="2.5" rx="1.2" transform="rotate(-58 84 63)" />
                                        <rect x="65" y="84" width="14" height="2.8" rx="1.4" transform="rotate(-20 65 84)" />
                                        <rect x="31" y="89" width="11" height="2.5" rx="1.2" transform="rotate(8 31 89)" />
                                        <rect x="9" y="68" width="12" height="3" rx="1.5" transform="rotate(48 9 68)" />
                                        <circle cx="26" cy="20" r="1.8" />
                                        <circle cx="58" cy="9" r="1.5" />
                                        <circle cx="89" cy="48" r="1.8" />
                                        <circle cx="50" cy="90" r="1.7" />
                                        <circle cx="12" cy="51" r="1.5" />
                                      </g>
                                    </mask>
                                  </defs>
                                  <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="4" mask={`url(#seal-wear-${p})`} />
                                  <circle cx="50" cy="50" r="42.5" fill="none" stroke="currentColor" strokeWidth="1.5" mask={`url(#seal-wear-${p})`} />
                                  <text fill="currentColor" fontSize="10" fontWeight="900" letterSpacing="1.5" mask={`url(#seal-wear-${p})`}>
                                    <textPath href={`#seal-ring-${p}`} startOffset="1%">
                                      MARKHINS HUB • MARKHINS HUB •
                                    </textPath>
                                  </text>
                                </svg>
                                <div className="absolute inset-[7px] flex items-center justify-center rounded-full border border-red-600/70 px-0.5">
                                  <span className="line-clamp-3 w-full break-words text-center text-[6.5px] font-black leading-[1.05] tracking-[-0.025em]">
                                    {teacherName}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                {periods.every(p => markedPeriods.includes(p)) && (
                  <div className="mt-4 p-3 bg-amber-50/50 rounded-2xl border border-amber-100 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                    <span className="text-lg">💡</span>
                    <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest leading-loose">
                      All periods marked for this class today. Use <span className="bg-amber-100 px-1.5 py-0.5 rounded-md">Extra Class</span> button above for manual marking.
                    </p>
                  </div>
                )}
              </section>
              )}

              {!multiMode && (
                <section className="pt-4 border-t border-gray-50">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">Detected Subject</label>
                  {(() => {
                    let cardStyle = 'bg-blue-50/50 border-blue-100 text-blue-900';
                    if (resolvedSubject?.error) {
                      cardStyle = 'bg-red-50 border-red-100 text-red-900';
                    } else if (resolvedSubject?.is_substitute) {
                      cardStyle = resolvedSubject.is_own_substitute
                        ? 'bg-blue-50 border-blue-300 text-blue-950 shadow-sm relative overflow-hidden ring-2 ring-blue-500/20'
                        : 'bg-amber-50 border-amber-300 text-amber-950 shadow-sm relative overflow-hidden ring-2 ring-amber-500/20';
                    }
                    return (
                      <div className={`w-full px-6 py-6 rounded-3xl border animate-in fade-in duration-500 ${cardStyle}`}>
                        {resolving ? (
                          <div className="flex items-center space-x-3 text-blue-400">
                            <div className="animate-pulse rounded-full h-4 w-4 bg-blue-400"></div>
                            <span className="text-sm font-bold uppercase tracking-widest">Resolving Timetable...</span>
                          </div>
                        ) : resolvedSubject ? (
                          resolvedSubject.error ? (
                            <div className="text-red-600">
                              <p className="text-lg font-bold">Class Not Scheduled</p>
                              <p className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-70">{resolvedSubject.error}</p>
                              <button
                                onClick={() => router.push("/extra")}
                                className="mt-3 flex items-center gap-2 bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-200 transition-all"
                              >
                                <span>⚡</span> Use Extra Class instead
                              </button>
                            </div>
                          ) : (
                            <div>
                              {resolvedSubject.is_substitute && (
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-2 ${resolvedSubject.is_own_substitute ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {resolvedSubject.is_own_substitute ? 'Own Substitute' : 'General Substitute'}
                                </span>
                              )}
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-50">Today&apos;s Schedule</p>
                              <p className="text-2xl font-black leading-tight">{resolvedSubject.subject}</p>
                              <p className="text-xs font-bold mt-1 uppercase tracking-widest opacity-80">Teacher: {resolvedSubject.teacher}</p>
                            </div>
                          )
                        ) : (
                          <p className="text-gray-300 text-sm font-bold uppercase tracking-widest italic">Wait for selection...</p>
                        )}
                      </div>
                    );
                  })()}
                </section>
              )}
            </div>

            <button
              onClick={handleLoadStudents}
              disabled={(!multiMode && (!resolvedSubject || resolvedSubject.error || resolving)) || (multiMode && selectedPeriods.length === 0)}
              className={`anim-fade-up w-full py-6 rounded-[2rem] text-xl font-black shadow-2xl transition-all active:scale-[0.97] ${((!multiMode && (!resolvedSubject || resolvedSubject.error || resolving)) || (multiMode && selectedPeriods.length === 0))
                ? 'bg-gray-200 text-gray-400 shadow-none cursor-not-allowed'
                : 'anim-shimmer-btn anim-cta-glow text-white'
                }`}
              style={{ animationDelay: '0.25s' }}
            >
              {multiMode ? "Start Marking" : resolvedSubject?.error ? "Unavailable" : "Start Marking"}
            </button>
          </div>
        )}

        {/* ── Feature 3: Last Attendance Edit Card ── */}
        {activeTab === "attendance" && lastAttendance && lastAttendance.editable && (
          <div
            className="mx-auto max-w-md mt-2"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.3s' }}
          >
            <div
              className="flex items-center justify-between p-5 rounded-[2rem] border"
              style={{
                background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                borderColor: '#fde68a',
                boxShadow: '0 2px 12px rgba(251,191,36,0.12)'
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: '#fef08a' }}
                >
                  ✏️
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#92400e' }}>Last Attendance — Editable</p>
                  <p className="font-black text-gray-800 text-sm mt-0.5">{lastAttendance.className}</p>
                  <p className="text-[10px] font-bold" style={{ color: '#b45309' }}>
                    {lastAttendance.period} • {lastAttendance.date}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  sessionStorage.setItem('attendance_params', JSON.stringify({
                    classId: lastAttendance.classId,
                    className: lastAttendance.className,
                    period: lastAttendance.period,
                    date: lastAttendance.date,
                    isEdit: true,
                    subjectName: lastAttendance.subjectName || ''
                  }));
                  router.push('/attendance?edit=1');
                }}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all active:scale-95"
                style={{
                  background: '#f59e0b',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(245,158,11,0.3)'
                }}
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {/* ── Feature: Health & Leave Management ── */}
        {activeTab === "attendance" && user && canManageHealthStatus(user) && (
          <div
            className="mx-auto max-w-md mt-6"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.4s' }}
          >
            <button
              onClick={() => router.push('/health')}
              className="w-full flex items-center justify-between p-6 rounded-[2.5rem] bg-white border border-gray-100 shadow-xl shadow-gray-100 hover:shadow-2xl transition-all active:opacity-80 group"
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-3xl bg-red-50 flex items-center justify-center text-2xl group-hover:bg-red-100 transition-colors">
                  🩺
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-black text-gray-800">Leave Status</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mt-1">Manage SICK / LEAVE / CURE</p>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-red-50 group-hover:text-red-400 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {/* ── Feature: Teachers List ── */}
        {activeTab === "attendance" && (
          <div
            className="mx-auto max-w-md mt-6"
            style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.5s' }}
          >
            <button
              onClick={() => router.push('/teachers')}
              className="w-full flex items-center justify-between p-6 rounded-[2.5rem] bg-white border border-gray-100 shadow-xl shadow-gray-100 hover:shadow-2xl transition-all active:opacity-80 group"
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-3xl bg-blue-50 flex items-center justify-center text-2xl group-hover:bg-blue-100 transition-colors">
                  👨‍🏫
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-black text-gray-800">Teachers List</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mt-1">View Faculty & Roles</p>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-blue-50 group-hover:text-blue-400 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {activeTab === "attendance"
          && (user?.role === 'admin' || subCoordinators.includes(String(user?.id)) || subCoordinators.includes(user?.username))
          && subWidget && (
            <div
              onClick={() => { setReportType('substitute'); setActiveTab('reports'); router.push('/?tab=reports&type=substitute', { scroll: false }); }}
              className="mx-auto mt-6 max-w-md cursor-pointer rounded-[2rem] border border-indigo-500/20 bg-gradient-to-br from-indigo-950 via-[#0a3a40] to-indigo-900 p-6 text-white shadow-xl transition-all hover:scale-[1.01] active:scale-95"
              style={{ animation: 'fadeUpIn 0.4s ease both', animationDelay: '0.6s' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="rounded-full bg-[#5eead4]/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#5eead4]">Substitute Planner</span>
                  <h3 className="mt-2 text-lg font-black">Tomorrow&apos;s Coverage</h3>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">{subWidget.date}</p>
                </div>
                <svg className="h-7 w-7 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14H3V6a2 2 0 012-2z" />
                </svg>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
                <div className="text-center">
                  <p className="text-xl font-black text-amber-300">{subWidget.totalSubstitutes}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-white/60">Affected Slots</p>
                </div>
                <div className="border-x border-white/10 text-center">
                  <p className="text-xl font-black text-emerald-400">{subWidget.assigned}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-white/60">Assigned</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-rose-400">{subWidget.pending}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-white/60">Pending</p>
                </div>
              </div>
            </div>
          )}



        {/* --- TIMETABLE TAB --- */}
        {activeTab === "timetable" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 max-w-md mx-auto">
              {days.map((day, idx) => (
                <button
                  key={idx}
                  onClick={() => { setSelectedDay(idx); setTimetableEditingCell(null); }}
                  className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${selectedDay === idx ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-400 border border-gray-100 hover:border-blue-200'}`}
                >
                  {day}
                </button>
              ))}
            </div>

            {canEditTimetable && (
              <button
                onClick={() => { setTimetableEditMode(p => !p); setTimetableEditingCell(null); setTimetableSubjectOptions([]); setTimetableManualSubject(false); setTimetableEditorData({ teacherId: "", subject: "" }); }}
                className={`mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-xs font-bold uppercase tracking-widest transition-all ${timetableEditMode ? 'bg-[#0d9488] text-white shadow-lg shadow-[#0d9488]/20' : 'bg-white text-gray-500 border border-gray-100 hover:border-[#0d9488]/30 hover:text-[#0d9488]'}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {timetableEditMode ? 'Exit Edit' : 'Edit Timetable'}
              </button>
            )}

            <button
              onClick={openTimetablePdf}
              disabled={!Array.isArray(fullTimetable) || fullTimetable.length === 0}
              className="group relative mx-auto flex w-full max-w-md items-center justify-between overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 px-5 py-4 text-left text-white shadow-[0_7px_0_#065f46,0_13px_24px_rgba(5,150,105,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_9px_0_#065f46,0_17px_30px_rgba(5,150,105,0.34)] active:translate-y-[5px] active:shadow-[0_2px_0_#065f46,0_7px_14px_rgba(5,150,105,0.24)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              title="Open full-screen timetable view"
            >
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-xl transition-transform duration-700 group-hover:scale-125" />
              <div className="relative flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/15 shadow-inner transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6M8 15h8M8 18h6" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-black tracking-tight">PDF View</p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-100">Full-screen timetable</p>
                </div>
              </div>
              <svg className="relative h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {loadingFeature ? (
              <div className="flex justify-center p-20">
                <div className="text-blue-600 font-bold uppercase tracking-widest text-xs animate-pulse">Loading Content...</div>
              </div>
            ) : Array.isArray(fullTimetable) && fullTimetable.length > 0 ? (
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                  {(() => {
                    const zoomScale = timetableZoom / 100;
                    const thPadding = `${1.25 * zoomScale}rem ${1.5 * zoomScale}rem`;
                    const tdPadding = `${1.25 * zoomScale}rem ${1.25 * zoomScale}rem`;
                    const minWidthClass = `${100 * zoomScale}px`;
                    const minWidthPeriod = `${180 * zoomScale}px`;
                    const fontSizeSubject = `${13 * zoomScale}px`;
                    const fontSizeTeacher = `${10 * zoomScale}px`;
                    const fontSizeClassLabel = `${14 * zoomScale}px`;

                    return (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-blue-50/30 border-b border-gray-100">
                            <th style={{ padding: thPadding, minWidth: minWidthClass }} className="text-[10px] font-black text-[#0d9488] uppercase tracking-[0.2em] sticky left-0 bg-white z-10 border-r border-gray-100">Class</th>
                            {periods.map(p => (
                              <th key={p} style={{ padding: thPadding, minWidth: minWidthPeriod }} className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-center">Period {p}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {fullTimetable.map((row, idx) => (
                            <tr key={idx} className="hover:bg-blue-50/20 transition-colors">
                              <td style={{ padding: tdPadding, minWidth: minWidthClass, fontSize: fontSizeClassLabel }} className="font-black text-gray-900 sticky left-0 bg-white z-10 border-r border-gray-100 text-center shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                                {row.class}
                              </td>
                              {periods.map(p => {
                                const item = row.periods[p];
                                const isSub = item && (item.isSubstitute || item.is_substitute);
                                const isOwnSub = isSub && (item.is_own_substitute || (item.originalTeacherId === item.substituteTeacherId));
                                const activeTeacherId = item ? (item.substituteTeacherId || item.teacherId) : null;
                                const isMyPeriod = activeTeacherId && user && String(activeTeacherId) === String(user.id);
                                const isMySubstitutionPeriod = isSub && user && String(item.substituteTeacherId) === String(user.id);

                                let cellBg = '';
                                if (isSub) {
                                  if (isMySubstitutionPeriod) {
                                    cellBg = 'bg-red-50/80 border-red-250 text-red-950 shadow-sm font-semibold ring-2 ring-red-500/20';
                                  } else {
                                    cellBg = 'bg-amber-50/80 border-amber-250 text-amber-900 shadow-sm';
                                  }
                                } else if (isMyPeriod) {
                                  cellBg = 'bg-emerald-50/80 border-emerald-250 text-emerald-950 shadow-sm font-extrabold ring-2 ring-emerald-500/20';
                                }
                                return (
                                  <td key={p} style={{ padding: tdPadding, minWidth: minWidthPeriod }} className={`text-center transition-all border ${cellBg ? cellBg : 'border-gray-50'} ${timetableEditMode && canEditTimetable ? 'cursor-pointer hover:ring-2 hover:ring-[#0d9488]/30' : ''}`}
                                    onClick={timetableEditMode && canEditTimetable ? () => openTimetableEditCell(row.class, p, item) : undefined}>
                                    {item ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-center gap-1">
                                          <p style={{ fontSize: fontSizeSubject }} className="font-bold text-gray-800 leading-tight break-words">{item.subject}</p>
                                          {isSub && (
                                            <span className={`px-1 rounded text-[7px] font-black border uppercase ${isMySubstitutionPeriod ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>SUB</span>
                                          )}
                                        </div>
                                        <p style={{ fontSize: fontSizeTeacher }} className="text-gray-400 font-semibold leading-tight uppercase tracking-wide">({item.teacher})</p>
                                      </div>
                                    ) : (
                                      <span style={{ fontSize: fontSizeSubject }} className="text-gray-200 font-black">—</span>
                                    )}
                                    {timetableEditingCell?.classId === row.class && timetableEditingCell?.period === p && (
                                      <div className="mt-2 space-y-2 rounded-xl border border-[#0d9488]/20 bg-white p-3 shadow-lg" onClick={e => e.stopPropagation()}>
                                        <select value={timetableEditorData.teacherId} onChange={(e) => handleTimetableEditorTeacherChange(e.target.value)}
                                          className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20">
                                          <option value="">Clear</option>
                                          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                        <div className="flex items-center justify-between">
                                          <label className="text-[10px] font-bold text-gray-400 uppercase">Subject</label>
                                          <button onClick={() => setTimetableManualSubject(m => !m)} disabled={!timetableEditorData.teacherId}
                                            className="text-[10px] font-bold text-[#0d9488] disabled:text-gray-300">{timetableManualSubject ? "List" : "Type"}</button>
                                        </div>
                                        {timetableManualSubject ? (
                                          <input value={timetableEditorData.subject} onChange={(e) => setTimetableEditorData(p => ({ ...p, subject: e.target.value }))} disabled={!timetableEditorData.teacherId}
                                            className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#0d9488]/20 disabled:bg-gray-100" />
                                        ) : (
                                          <select value={timetableEditorData.subject} onChange={(e) => setTimetableEditorData(p => ({ ...p, subject: e.target.value }))} disabled={!timetableEditorData.teacherId}
                                            className="w-full rounded-xl border border-gray-100 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#0d9488]/20 disabled:bg-gray-100">
                                            <option value="">Select</option>
                                            {timetableSubjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                          </select>
                                        )}
                                        <div className="flex gap-2">
                                          <button onClick={() => { setTimetableEditingCell(null); setTimetableSubjectOptions([]); setTimetableManualSubject(false); setTimetableEditorData({ teacherId: "", subject: "" }); }}
                                            className="flex-1 rounded-xl border border-gray-100 py-2 text-[10px] font-bold uppercase text-gray-500">Cancel</button>
                                          <button onClick={saveTimetableEditCell} disabled={timetableSaveBusy}
                                            className="flex-1 rounded-xl bg-[#0d9488] py-2 text-[10px] font-bold uppercase text-white hover:bg-[#0a7a70] disabled:opacity-50">
                                            {timetableSaveBusy ? "Saving..." : "Save"}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            ) : timetableError ? (
              <div className="bg-red-50 border border-red-100 p-6 rounded-3xl text-center max-w-md mx-auto">
                <p className="text-red-600 font-bold text-sm">{timetableError}</p>
                <p className="text-red-400 text-xs mt-1 font-medium">Make sure the backend server is running on port 8080.</p>
              </div>
            ) : (
              <div className="bg-white p-20 rounded-3xl border border-gray-100 text-center max-w-md mx-auto">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No data available</p>
              </div>
            )}
          </div>
        )}

        {/* --- REPORTS TAB --- */}
        {activeTab === "reports" && (
          <>
            {(() => {
              const isCoordinator = user?.role === 'admin' || subCoordinators.includes(String(user?.id)) || subCoordinators.includes(user?.username);
              const reportTabs = [
                { id: 'analysis', label: 'Analysis', emoji: '📈', desc: 'Perform searches and view aggregate stats.' },
                { id: 'overview', label: 'Monitor', emoji: '📊', desc: 'Real-time class attendance verification.' },
                { id: 'namaz', label: 'Namaz', emoji: '🕌', desc: 'Check daily and weekly prayer registers.' },
                { id: 'syllabus', label: 'Syllabus Tracker', emoji: '📖', desc: 'Track curriculum progress and goals.' },
                { id: 'events', label: 'Events History', emoji: '🏆', desc: 'Special events attendance records.' },
                { id: 'extra', label: 'Extra Classes', emoji: '⚡', desc: 'Logged manual attendance registers.' },
                { id: 'register', label: 'Register', emoji: '📒', desc: 'Detailed teaching session registers.' },
              ];
              if (isCoordinator) {
                reportTabs.push({ id: 'substitute', label: 'Substitute Planner', emoji: '📅', desc: 'Manage teacher leaves and coverage.' });
              }

              if (!reportType) {
                return (
                  <div className="space-y-6 animate-in fade-in">
                    <div className="rounded-3xl p-6 text-center" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
                      <h2 className="text-2xl font-black text-white">Management</h2>
                      <p className="text-xs text-white/50 font-medium mt-1">Reports, permissions and syllabus tools</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {canUsePermissionManager(user) && (
                        <button onClick={() => switchTab('permission_manager')}
                          className="rounded-2xl border border-teal-100 bg-teal-50 p-4 text-center text-teal-700 shadow-sm transition-all active:scale-[0.98] hover:shadow-md">
                          <span className="block text-2xl">🪪</span>
                          <span className="mt-2 block text-[10px] font-black uppercase tracking-widest">Permission Manager</span>
                        </button>
                      )}
                      <button disabled
                        className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 text-center text-gray-400 opacity-60 shadow-sm">
                        <span className="block text-2xl">⏳</span>
                        <span className="mt-2 block text-[9px] font-black uppercase tracking-wider">Coming Soon</span>
                      </button>
                      <button disabled
                        className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 text-center text-gray-400 opacity-60 shadow-sm">
                        <span className="block text-2xl">⏳</span>
                        <span className="mt-2 block text-[9px] font-black uppercase tracking-wider">Coming Soon</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-gray-100" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Reports</span>
                      <div className="h-px flex-1 bg-gray-100" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: 'overview', label: 'Monitor', emoji: '📊', color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                        { id: 'analysis', label: 'Analysis', emoji: '📈', color: 'bg-blue-50 border-blue-100 text-blue-700' },
                        { id: 'namaz', label: 'Namaz', emoji: '🕌', color: 'bg-amber-50 border-amber-100 text-amber-700' },
                        { id: 'syllabus', label: 'Syllabus', emoji: '📖', color: 'bg-violet-50 border-violet-100 text-violet-700' },
                        { id: 'events', label: 'Events', emoji: '🏆', color: 'bg-rose-50 border-rose-100 text-rose-700' },
                        { id: 'extra', label: 'Extra Class', emoji: '⚡', color: 'bg-orange-50 border-orange-100 text-orange-700' },
                        { id: 'register', label: 'Register', emoji: '📒', color: 'bg-slate-50 border-slate-200 text-slate-700' },
                        ...(isCoordinator ? [{ id: 'substitute', label: 'Substitute', emoji: '📅', color: 'bg-indigo-50 border-indigo-100 text-indigo-700' }] : [])
                      ].map((card) => (
                        <button
                          key={card.id}
                          onClick={() => { setReportType(card.id); router.push(`/?tab=reports&type=${card.id}`, { scroll: false }); setTimeout(() => trackEvent(`Opened ${card.label} report`), 0); }}
                          className={`flex flex-col items-center gap-2 p-5 rounded-2xl border ${card.color} transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm`}
                        >
                          <span className="text-2xl">{card.emoji}</span>
                          <span className="text-xs font-bold uppercase tracking-wider">{card.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-center shadow-sm">
                        <p className="text-xl font-black text-[#0d9488]">{classes.length || '—'}</p>
                        <p className="text-[9px] font-bold text-gray-400 uppercase">Classes</p>
                      </div>
                      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-center shadow-sm">
                        <p className="text-xl font-black text-[#0d9488]">{teachers.length || '—'}</p>
                        <p className="text-[9px] font-bold text-gray-400 uppercase">Teachers</p>
                      </div>
                      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-center shadow-sm">
                        <p className="text-xl font-black text-[#0d9488]">Active</p>
                        <p className="text-[9px] font-bold text-gray-400 uppercase">System</p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className={`relative flex items-center gap-3 mb-4 animate-fade-in ${reportDropdownOpen ? 'z-[70]' : 'z-20'}`}>
                  <button
                    onClick={() => { setReportType(null); router.push('/?tab=reports', { scroll: false }); }}
                    className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    ←
                  </button>
                  <div className="flex-1 flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2">
                    <span>{reportTabs.find(t => t.id === reportType)?.emoji}</span>
                    <span className="text-sm font-bold text-gray-800">{reportTabs.find(t => t.id === reportType)?.label}</span>
                  </div>
                  <div className="relative z-20">
                    <button onClick={() => setReportDropdownOpen(!reportDropdownOpen)}
                      className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 transition-all">
                      Switch
                    </button>
                    {reportDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setReportDropdownOpen(false)} />
                        <div className="absolute right-0 mt-2 z-[80] w-48 rounded-2xl bg-white border border-gray-100 shadow-xl p-2 space-y-1 animate-fade-in">
                          {reportTabs.map((tab) => (
                            <button key={tab.id}
                              onClick={() => { setReportType(tab.id); setReportDropdownOpen(false); router.push(`/?tab=reports&type=${tab.id}`, { scroll: false }); }}
                              className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold transition-all ${reportType === tab.id ? 'bg-[#0d9488]/10 text-[#0d9488]' : 'text-gray-600 hover:bg-gray-50'}`}>
                              <span>{tab.emoji}</span>
                              <span>{tab.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {reportType && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {reportError && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-bold flex items-center gap-3">
                    <span className="text-lg">⚠️</span>
                    <span>{reportError}</span>
                  </div>
                )}

                {reportType === "syllabus" && (
                  <div className="space-y-6">
                    {/* Actions and Filters Bar */}
                    <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h4 className="text-lg font-black text-gray-900">Syllabus Progress & Planning</h4>
                          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">Configure targets and track student academic syllabus progress</p>
                        </div>
                        {(user?.role === 'admin' || user?.role === 'Principal' || user?.role === 'Vice Principal') && (
                          <button
                            onClick={() => {
                              setSyllabusFormData({
                                id: null,
                                class: "",
                                subject: "",
                                teacher_id: "",
                                academic_year: new Date().getFullYear().toString(),
                                semester: "Semester 1",
                                book_name: "",
                                start_page: "",
                                end_page: "",
                              });
                              setSyllabusMonthTargets({
                                June: "", July: "", August: "", September: "", October: "", November: "", December: "",
                                January: "", February: "", March: "", April: "", May: ""
                              });
                              setSyllabusPopupOpen(true);
                            }}
                            className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-100"
                          >
                            ➕ Add Target Config
                          </button>
                        )}
                      </div>

                      {/* Filter fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Class</label>
                          <select
                            value={selectedSyllabusClassFilter}
                            onChange={(e) => setSelectedSyllabusClassFilter(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                          >
                            <option value="">All Classes</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Teacher</label>
                          <select
                            value={selectedSyllabusTeacherFilter}
                            onChange={(e) => setSelectedSyllabusTeacherFilter(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                          >
                            <option value="">All Teachers</option>
                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Principal Dashboard Overview widget */}
                    {(user?.role === 'Principal' || user?.role === 'Vice Principal' || user?.role === 'admin') && syllabusConfigs.length > 0 && (
                      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                        <div>
                          <h4 className="text-sm font-black text-gray-800 uppercase tracking-wider">Principal Syllabus Monitor Panel</h4>
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Instant health indicator of syllabus completions</p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {syllabusConfigs.map(config => {
                            const indicatorColors = {
                              Green: { bg: "bg-emerald-500", text: "text-white", label: "🟢 Ahead / On Time" },
                              Yellow: { bg: "bg-amber-400", text: "text-gray-900", label: "🟡 On Track" },
                              Red: { bg: "bg-red-500", text: "text-white", label: "🔴 Behind Schedule" }
                            }[config.statusColor] || { bg: "bg-gray-400", text: "text-white", label: "Gray" };

                            return (
                              <div key={config.id} className={`${indicatorColors.bg} ${indicatorColors.text} p-4 rounded-[1.75rem] flex flex-col justify-between h-28 shadow-sm transition-all hover:scale-[1.02]`}>
                                <div>
                                  <span className="text-[8px] font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">{config.class}</span>
                                  <h5 className="font-black text-xs mt-2 line-clamp-1">{config.subject}</h5>
                                </div>
                                <div>
                                  <p className="text-[9px] font-bold opacity-90 line-clamp-1">{config.statusMessage}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Main Grid View */}
                    {loadingSyllabus ? (
                      <div className="py-20 text-center animate-pulse text-xs font-bold text-gray-400">Loading configurations...</div>
                    ) : syllabusConfigs.length === 0 ? (
                      <div className="bg-white p-12 rounded-[2.5rem] border border-gray-100 text-center">
                        <p className="text-xs font-bold text-gray-400 italic">No syllabus configurations found.</p>
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2">
                        {syllabusConfigs.map(config => {
                          const pct = config.completionPercentage;
                          const progressValue = syllabusPageProgressData[config.id] || "";
                          const labels = getTrackingLabels(config.trackingType);
                          const statusColors = {
                            Green: { text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100", bar: "bg-emerald-500" },
                            Yellow: { text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", bar: "bg-amber-400" },
                            Red: { text: "text-red-500", bg: "bg-red-50", border: "border-red-100", bar: "bg-red-500" }
                          }[config.statusColor] || { text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100", bar: "bg-blue-500" };

                          return (
                            <div key={config.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6 flex flex-col justify-between">
                              <div className="space-y-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-black uppercase tracking-wider">{config.class}</span>
                                      <span className="px-3 py-1 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 text-[10px] font-black uppercase tracking-wider">{config.semester}</span>
                                    </div>
                                    <h4 className="font-black text-gray-900 text-base mt-3">{config.subject}</h4>
                                    <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">Teacher: {config.teacherName}</p>
                                  </div>

                                  <div className="relative flex items-center justify-center h-14 w-14 shrink-0">
                                    <svg className="absolute w-full h-full transform -rotate-90">
                                      <circle cx="28" cy="28" r="22" stroke="#f3f4f6" strokeWidth="5" fill="transparent" />
                                      <circle cx="28" cy="28" r="22" stroke={config.statusColor === "Green" ? "#10b981" : config.statusColor === "Red" ? "#ef4444" : "#fbbf24"} strokeWidth="5" fill="transparent"
                                        strokeDasharray={2 * Math.PI * 22}
                                        strokeDashoffset={2 * Math.PI * 22 * (1 - Math.min(100, pct) / 100)}
                                      />
                                    </svg>
                                    <span className="text-xs font-black text-gray-800 relative z-10">{Math.round(pct)}%</span>
                                  </div>
                                </div>

                                <div className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider border flex items-center gap-2 ${statusColors.bg} ${statusColors.text} ${statusColors.border}`}>
                                  <span>{config.statusColor === "Green" ? "✅" : config.statusColor === "Red" ? "⚠️" : "ℹ️"}</span>
                                  <span>{config.statusMessage}</span>
                                </div>

                                {(() => {
                                  const mTargetTotal = Math.max(1, Number(config.targetPage) - Number(config.startPage) + 1);
                                  const mCompleted = Math.max(0, (config.currentPage === "-" ? 0 : Number(config.currentPage)) - Number(config.startPage) + 1);
                                  const mPct = config.targetPage !== "-" && config.targetPage !== null
                                    ? Math.min(100, Math.round((mCompleted / mTargetTotal) * 100))
                                    : 0;
                                  const mBarColor = mPct >= 90 ? "bg-emerald-500" : mPct >= 70 ? "bg-amber-400" : "bg-red-500";

                                  return (
                                    <div className="space-y-3">
                                      {config.targetPage !== "-" && config.targetPage !== null && (
                                        <div className="space-y-1">
                                          <div className="flex items-center justify-between text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">
                                            <span>📅 Monthly Target Progress</span>
                                            <span className="font-bold text-gray-600">{mPct}% ({mCompleted}/{mTargetTotal} {labels.pages.toLowerCase()})</span>
                                          </div>
                                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                                            <div className={`h-1.5 rounded-full transition-all duration-500 ${mBarColor}`} style={{ width: `${mPct}%` }}></div>
                                          </div>
                                        </div>
                                      )}

                                      <div className="space-y-1">
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                          <div className={`h-2 rounded-full transition-all duration-500 ${statusColors.bar}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                          <span>{config.completedPages} of {config.totalPages} {labels.pages} Completed</span>
                                          <span>{config.remainingPages} left</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* Advanced Analytics Panel */}
                                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-50 text-left">
                                  <div className="bg-gray-50/50 p-3 rounded-2xl border border-gray-100/50">
                                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{labels.target}</p>
                                    <p className="mt-1 text-sm font-black text-gray-800">{config.targetPage}</p>
                                  </div>
                                  <div className="bg-gray-50/50 p-3 rounded-2xl border border-gray-100/50">
                                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{labels.current}</p>
                                    <p className="mt-1 text-sm font-black text-gray-800">{config.currentPage}</p>
                                  </div>
                                  <div className="bg-gray-50/50 p-3 rounded-2xl border border-gray-100/50 col-span-2">
                                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Est. Completion of {new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Kolkata' })} Target</p>
                                    <p className="mt-1 text-xs font-black text-indigo-950 truncate" title={config.estimatedMonthTargetCompletionDate}>{config.estimatedMonthTargetCompletionDate || "N/A"}</p>
                                  </div>
                                  <div className="bg-gray-50/50 p-3 rounded-2xl border border-gray-100/50 col-span-2">
                                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Est. Completion of {config.semester} Syllabus</p>
                                    <p className="mt-1 text-xs font-black text-indigo-950 truncate" title={config.estimatedCompletionDate}>{config.estimatedCompletionDate}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Config Modification Buttons or Teacher Update Box */}
                              <div className="pt-4 border-t border-gray-50 flex items-center justify-between gap-3 flex-wrap">
                                {/* Log Progress for current teacher config */}
                                {String(config.teacherId) === String(user?.id) ? (
                                  <div className="flex-1 flex gap-2">
                                    <input
                                      type="number"
                                      placeholder={labels.page}
                                      className="w-20 bg-gray-50 border border-gray-150 rounded-2xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 text-gray-800"
                                      value={progressValue}
                                      onChange={(e) => setSyllabusPageProgressData(prev => ({ ...prev, [config.id]: e.target.value }))}
                                    />
                                    <button
                                      onClick={() => handleUpdateSyllabusProgress(config.id, progressValue)}
                                      disabled={!progressValue}
                                      className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${progressValue ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-50 text-gray-300'}`}
                                    >
                                      {labels.update}
                                    </button>
                                  </div>
                                ) : <div />}

                                {/* Admin action modifiers */}
                                {(user?.role === 'admin' || user?.role === 'Principal' || user?.role === 'Vice Principal') && (
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => {
                                        setSyllabusFormData({
                                          id: config.id,
                                          class: config.class,
                                          subject: config.subject,
                                          teacher_id: config.teacherId,
                                          academic_year: config.academicYear || new Date().getFullYear().toString(),
                                          semester: config.semester || "Semester 1",
                                          book_name: config.bookName || "",
                                          start_page: config.startPage,
                                          end_page: config.endPage,
                                        });

                                        const targetsMap = {};
                                        config.targets.forEach(t => {
                                          targetsMap[t.month] = t.targetPage;
                                        });
                                        setSyllabusMonthTargets(prev => ({
                                          June: "", July: "", August: "", September: "", October: "", November: "", December: "",
                                          January: "", February: "", March: "", April: "", May: "",
                                          ...targetsMap
                                        }));

                                        setSyllabusPopupOpen(true);
                                      }}
                                      className="p-2.5 rounded-xl border border-gray-150 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all text-xs"
                                      title="Edit Config"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSyllabusConfig(config.id)}
                                      className="p-2.5 rounded-xl border border-gray-150 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all text-xs"
                                      title="Delete Config"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {reportType === "overview" && (
                  <>
                    {/* Campus Health Overview (Sick List & Leave List buttons) */}
                    <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-2">
                        Campus Health Overview
                      </label>
                      <div className="grid grid-cols-2 gap-4 px-1">
                        <button
                          onClick={() => handleViewHealthList('sick')}
                          className="relative p-6 bg-gradient-to-br from-orange-50 to-white border border-orange-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 overflow-hidden group text-left"
                        >
                          <div className="absolute -top-4 -right-4 opacity-[0.05] text-7xl group-hover:scale-110 transition-transform duration-300">💊</div>
                          <div className="relative flex flex-col items-start gap-1 z-10">
                            <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-500 flex items-center justify-center text-xl mb-2 shadow-sm">💊</div>
                            <span className="font-black text-sm text-gray-800">Sick List</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-orange-500">View Active</span>
                          </div>
                        </button>
                        <button
                          onClick={() => handleViewHealthList('leave')}
                          className="relative p-6 bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all active:scale-95 overflow-hidden group text-left"
                        >
                          <div className="absolute -top-4 -right-4 opacity-[0.05] text-7xl group-hover:scale-110 transition-transform duration-300">🏠</div>
                          <div className="relative flex flex-col items-start gap-1 z-10">
                            <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center text-xl mb-2 shadow-sm">🏠</div>
                            <span className="font-black text-sm text-gray-800">Leave List</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-purple-500">Planned Absence</span>
                          </div>
                        </button>
                      </div>
                    </div>

                    {user?.role === "admin" && (
                      <div className="space-y-4">
                        {/* Header Card */}
                        <div className="bg-white rounded-[2rem] border border-gray-100 p-5 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </div>
                              <div>
                                <h3 className="font-black text-gray-900 tracking-tight text-lg">Teacher Activity Monitor</h3>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-0.5">Live sessions &amp; actions for {selectedDate}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => fetchAdminLog(selectedDate)}
                              className="self-start rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-gray-500 transition-all hover:bg-gray-50 hover:border-gray-300 active:scale-95 flex items-center gap-2"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Refresh
                            </button>
                          </div>

                          {/* KPI Row */}
                          <div className="grid grid-cols-3 gap-3 mt-4">
                            <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-2xl p-3.5 text-center">
                              <div className="text-2xl font-black text-emerald-600 leading-none">{(adminActivityLog?.liveUsers || []).length}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mt-1.5">Online Now</div>
                            </div>
                            <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-3.5 text-center">
                              <div className="text-2xl font-black text-blue-600 leading-none">{(() => {
                                const acts = (adminActivityLog?.actions || []).filter(a => {
                                  const r = String(a.role || '').toLowerCase();
                                  const n = String(a.actor || '').trim().toLowerCase();
                                  return r !== 'admin' && n !== 'system administrator';
                                });
                                return acts.length;
                              })()}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-blue-500 mt-1.5">Total Actions</div>
                            </div>
                            <div className="bg-gradient-to-br from-violet-50 to-white border border-violet-100 rounded-2xl p-3.5 text-center">
                              <div className="text-2xl font-black text-violet-600 leading-none">{(() => {
                                const acts = (adminActivityLog?.actions || []).filter(a => {
                                  const r = String(a.role || '').toLowerCase();
                                  const n = String(a.actor || '').trim().toLowerCase();
                                  return r !== 'admin' && n !== 'system administrator';
                                });
                                const unique = new Set(acts.map(a => (a.actor || '').toLowerCase().trim()));
                                return unique.size;
                              })()}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-violet-500 mt-1.5">Active Teachers</div>
                            </div>
                          </div>
                        </div>

                        {/* Two-Column Layout */}
                        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">

                          {/* Teachers Online Panel */}
                          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-gray-50">
                              <div className="flex items-center gap-2.5">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Online Teachers</h4>
                              </div>
                              <span className="text-[10px] font-black text-emerald-600">{(adminActivityLog?.liveUsers || []).length}</span>
                            </div>
                            <div className="p-3 max-h-[32rem] overflow-auto">
                              {(() => {
                                const live = adminActivityLog?.liveUsers || [];
                                if (live.length === 0) {
                                  return (
                                    <div className="py-12 text-center">
                                      <div className="w-12 h-12 rounded-full bg-gray-50 mx-auto mb-3 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                      </div>
                                      <p className="text-xs font-bold text-gray-300">No teachers online</p>
                                      <p className="text-[10px] font-semibold text-gray-200 mt-0.5">Check back later</p>
                                    </div>
                                  );
                                }
                                return live.map((person, i) => {
                                  const lastSeen = person.lastSeen || person.lastLogin || "";
                                  const timePart = lastSeen.includes(" ") ? lastSeen.split(" ")[1] : lastSeen;
                                  let displayTime = timePart || "";
                                  if (displayTime) {
                                    const [h, m] = displayTime.split(":").map(Number);
                                    if (!isNaN(h)) {
                                      const ampm = h >= 12 ? "PM" : "AM";
                                      const h12 = h % 12 || 12;
                                      displayTime = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                                    }
                                  }
                                  const initials = (person.name || person.username || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                                  const roleColor = person.role === 'Principal' ? 'bg-red-100 text-red-600' : person.role === 'Class Teacher' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500';
                                  return (
                                    <div key={person.username || i} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 transition-all group">
                                      <div className="relative">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1e3a8a] to-blue-500 flex items-center justify-center text-[11px] font-black text-white shrink-0 shadow-sm">
                                          {initials}
                                        </div>
                                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white"></div>
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-900 truncate leading-tight">{person.name || person.username}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                          <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${roleColor}`}>{person.role || "Teacher"}</span>
                                          {displayTime && <span className="text-[10px] font-semibold text-gray-300">{displayTime}</span>}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>

                          {/* Activity Feed */}
                          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-gray-50">
                              <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Activity Feed</h4>
                              <span className="text-[10px] font-bold text-gray-300">{(() => {
                                const acts = (adminActivityLog?.actions || []).filter(a => {
                                  const r = String(a.role || '').toLowerCase();
                                  const n = String(a.actor || '').trim().toLowerCase();
                                  return r !== 'admin' && n !== 'system administrator';
                                });
                                return acts.length;
                              })()} entries</span>
                            </div>
                            <div className="p-3 max-h-[32rem] overflow-auto">
                              {(() => {
                                const actions = (adminActivityLog?.actions || []).filter(a => {
                                  const r = String(a.role || '').toLowerCase();
                                  const n = String(a.actor || '').trim().toLowerCase();
                                  return r !== 'admin' && n !== 'system administrator';
                                });
                                if (actions.length === 0) {
                                  return (
                                    <div className="py-12 text-center">
                                      <div className="w-12 h-12 rounded-full bg-gray-50 mx-auto mb-3 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </div>
                                      <p className="text-xs font-bold text-gray-300">No activity yet</p>
                                      <p className="text-[10px] font-semibold text-gray-200 mt-0.5">Actions will appear here</p>
                                    </div>
                                  );
                                }
                                const TYPE_COLORS = {
                                  Attendance: { bg: "bg-blue-500", dot: "bg-blue-100" },
                                  "Extra Class": { bg: "bg-purple-500", dot: "bg-purple-100" },
                                  Health: { bg: "bg-rose-500", dot: "bg-rose-100" },
                                  Reports: { bg: "bg-amber-500", dot: "bg-amber-100" },
                                  Timetable: { bg: "bg-teal-500", dot: "bg-teal-100" },
                                  Profile: { bg: "bg-indigo-500", dot: "bg-indigo-100" },
                                  Syllabus: { bg: "bg-cyan-500", dot: "bg-cyan-100" },
                                  Login: { bg: "bg-emerald-500", dot: "bg-emerald-100" },
                                  AttendanceEdit: { bg: "bg-orange-500", dot: "bg-orange-100" },
                                  Substitute: { bg: "bg-fuchsia-500", dot: "bg-fuchsia-100" },
                                  UI: { bg: "bg-sky-500", dot: "bg-sky-100" },
                                };
                                const TYPE_LABELS = {
                                  Attendance: "Attendance",
                                  "Extra Class": "Extra Class",
                                  Health: "Health",
                                  Reports: "Reports",
                                  Timetable: "Timetable",
                                  Profile: "Profile",
                                  Syllabus: "Syllabus",
                                  Login: "Login",
                                  AttendanceEdit: "Edit",
                                  Substitute: "Substitute",
                                  UI: "UI",
                                };

                                // Group actions by type
                                const grouped = {};
                                actions.forEach((row, idx) => {
                                  const key = row.type || "Other";
                                  if (!grouped[key]) grouped[key] = [];
                                  grouped[key].push({ ...row, _idx: idx });
                                });

                                const typeOrder = ["Attendance", "AttendanceEdit", "Substitute", "Login", "Timetable", "Syllabus", "Health", "Extra Class", "Reports", "Profile", "UI"];
                                const sortedTypes = Object.keys(grouped).sort((a, b) => {
                                  const ai = typeOrder.indexOf(a);
                                  const bi = typeOrder.indexOf(b);
                                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                                });

                                return (
                                  <div className="space-y-4">
                                    {sortedTypes.map(type => {
                                      const items = grouped[type];
                                      const colors = TYPE_COLORS[type] || { bg: "bg-gray-400", dot: "bg-gray-100" };
                                      const label = TYPE_LABELS[type] || type;
                                      return (
                                        <div key={type}>
                                          {/* Group Header */}
                                          <div className="flex items-center gap-2 mb-2 px-1">
                                            <div className={`w-2 h-2 rounded-full ${colors.bg}`}></div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
                                            <span className="text-[9px] font-bold text-gray-300">({items.length})</span>
                                            <div className="flex-1 h-px bg-gray-100 ml-1"></div>
                                          </div>
                                          {/* Group Items */}
                                          <div className="space-y-1.5 ml-1 pl-3 border-l-2 border-gray-100">
                                            {items.map((row) => {
                                              let displayTime = row.time || "";
                                              if (displayTime) {
                                                const [h, m] = displayTime.split(":").map(Number);
                                                if (!isNaN(h)) {
                                                  const ampm = h >= 12 ? "PM" : "AM";
                                                  const h12 = h % 12 || 12;
                                                  displayTime = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                                                }
                                              }
                                              const initials = (row.actor || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                                              return (
                                                <div key={`${row.type}-${row._idx}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-all group">
                                                  <div className={`w-8 h-8 rounded-full ${colors.dot} flex items-center justify-center text-[9px] font-black ${colors.bg.replace('bg-', 'text-').replace('-500', '-700')} shrink-0 mt-0.5`}>
                                                    {initials}
                                                  </div>
                                                  <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-[11px] font-bold text-gray-900 truncate">{row.actor}</span>
                                                      <span className="ml-auto text-[10px] font-semibold text-gray-300 shrink-0 whitespace-nowrap">{displayTime || ""}</span>
                                                    </div>
                                                    <p className="text-[11px] font-semibold text-gray-500 leading-snug mt-0.5">{row.summary}</p>
                                                    {row.meta && <p className="text-[9px] font-bold text-gray-300 mt-0.5">{row.meta}</p>}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </>
                )}

                {reportType === "namaz" && (
                  <div className="space-y-5">
                    {/* Header Card */}
                    <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white text-lg shadow-md shadow-teal-200">🕌</div>
                          <div>
                            <h3 className="font-black text-gray-900 text-lg leading-tight">Namaz Attendance</h3>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Prayer session analytics & records</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={exportNamazExcel} disabled={!namazAnalytics} className="rounded-xl bg-teal-50 border border-teal-100 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-teal-700 hover:bg-teal-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed">Excel</button>
                          <button onClick={exportNamazPdf} disabled={!namazAnalytics} className="rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed">PDF</button>
                        </div>
                      </div>
                      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">From</label>
                          <input type="date" value={namazFromDate} onChange={(e) => setNamazFromDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-200 transition-all" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">To</label>
                          <input type="date" value={namazToDate} onChange={(e) => setNamazToDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-200 transition-all" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Class</label>
                          <select value={selectedNamazClass} onChange={(e) => setSelectedNamazClass(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-200 transition-all">
                            <option value="">All Classes</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Student Roll</label>
                          <input value={selectedNamazStudent} onChange={(e) => setSelectedNamazStudent(e.target.value)} placeholder="e.g. 42" className="w-full rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-200 transition-all placeholder:text-gray-300" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Session</label>
                          <select value={selectedNamazSession} onChange={(e) => setSelectedNamazSession(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-200 transition-all">
                            <option value="">All Sessions</option>
                            {["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-transparent uppercase tracking-widest select-none">Action</label>
                          <button onClick={fetchNamazAnalytics} className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:from-teal-600 hover:to-emerald-600 transition-all shadow-md shadow-teal-100 active:scale-[0.97]">Apply</button>
                        </div>
                      </div>
                    </div>

                    {loadingNamaz ? (
                      <div className="flex justify-center p-16"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent" /></div>
                    ) : namazAnalytics ? (
                      <>
                        {/* KPI Summary Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center text-sm text-teal-600">📊</div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Overall</p>
                            </div>
                            <p className="text-2xl font-black text-teal-600">{namazAnalytics.cards?.overallAttendance ?? 0}%</p>
                            <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full" style={{ width: `${namazAnalytics.cards?.overallAttendance ?? 0}%` }} />
                            </div>
                          </div>

                          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-sm text-red-500">⚠</div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Below 80%</p>
                            </div>
                            <p className="text-2xl font-black text-red-500">{namazAnalytics.cards?.studentsBelow80 ?? 0}</p>
                            <p className="text-[9px] font-bold text-gray-400 mt-1">students need attention</p>
                          </div>

                          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-sm text-emerald-600">⭐</div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Above 90%</p>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">{namazAnalytics.cards?.studentsAbove90 ?? 0}</p>
                            <p className="text-[9px] font-bold text-gray-400 mt-1">top performers</p>
                          </div>

                          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-4 shadow-sm text-white hover:shadow-md transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-sm">🕌</div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Sessions</p>
                            </div>
                            <p className="text-2xl font-black">{namazAnalytics.cards?.totalSessions ?? 0}</p>
                            <p className="text-[9px] font-bold text-white/40 mt-1">total recorded</p>
                          </div>
                        </div>

                        {/* Prayer-wise Breakdown */}
                        <div>
                          <h4 className="text-xs font-black text-gray-900 mb-3 uppercase tracking-wider">Prayer Breakdown</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {[
                              { name: "Fajr", emoji: "🌅", color: "sky", percent: namazAnalytics.cards?.fajrPercent ?? 0 },
                              { name: "Dhuhr", emoji: "☀️", color: "amber", percent: namazAnalytics.cards?.dhuhrPercent ?? 0 },
                              { name: "Asr", emoji: "🌇", color: "orange", percent: namazAnalytics.cards?.asrPercent ?? 0 },
                              { name: "Maghrib", emoji: "🌆", color: "violet", percent: namazAnalytics.cards?.maghribPercent ?? 0 },
                              { name: "Isha", emoji: "🌙", color: "indigo", percent: namazAnalytics.cards?.ishaPercent ?? 0 },
                            ].map(p => (
                              <div key={p.name} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-[10px] font-black text-${p.color}-600 bg-${p.color}-50 px-2 py-0.5 rounded-lg uppercase tracking-wider`}>{p.emoji} {p.name}</span>
                                </div>
                                <p className="text-2xl font-black text-gray-800">{p.percent}%</p>
                                <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                  <div className={`h-full bg-${p.color}-500 rounded-full`} style={{ width: `${p.percent}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Today's Recorded Sessions */}
                        {(() => {
                          const todayStr = getIstDateString();
                          const todaySessions = (namazAnalytics.sessions || []).filter(s => s.date === todayStr);
                          if (todaySessions.length === 0) return null;

                          const grouped = {};
                          todaySessions.forEach(s => {
                            if (!grouped[s.sessionName]) grouped[s.sessionName] = [];
                            grouped[s.sessionName].push(s);
                          });

                          return (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                              <div className="p-4 border-b border-gray-50 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">Today&apos;s Sessions</h4>
                                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full ml-1">{todaySessions.length} Recorded</span>
                              </div>
                              <div className="divide-y divide-gray-50">
                                {Object.entries(grouped).map(([namazName, list]) => {
                                  const isNamazExpanded = expandedNamaz === namazName;
                                  const totalStudentCount = list.reduce((sum, s) => sum + (s.students ? s.students.length : 0), 0);

                                  return (
                                    <div key={namazName}>
                                      <button
                                        onClick={() => setExpandedNamaz(isNamazExpanded ? null : namazName)}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50/50 transition-all text-left"
                                      >
                                        <div className="flex items-center gap-3">
                                          <span className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center text-sm">
                                            {["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].includes(namazName) ? { Fajr: "🌅", Dhuhr: "☀️", Asr: "🌇", Maghrib: "🌆", Isha: "🌙" }[namazName] : "🕌"}
                                          </span>
                                          <div>
                                            <span className="text-sm font-black text-gray-800">{namazName}</span>
                                            <span className="text-[9px] font-bold text-gray-400 ml-2">{totalStudentCount} Students</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-black text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">{list.length} {list.length === 1 ? "class" : "classes"}</span>
                                          <span className="text-gray-400 text-xs">{isNamazExpanded ? "▼" : "▶"}</span>
                                        </div>
                                      </button>

                                      {isNamazExpanded && (
                                        <div className="px-4 pb-3 space-y-2 animate-in fade-in duration-150">
                                          {list.map(session => {
                                            const classKey = `${namazName}-${session.className}`;
                                            const isClassExpanded = !!expandedClasses[classKey];
                                            const sList = session.students || [];
                                            const presentList = sList.filter(st => st.status === "present");
                                            const absentList = sList.filter(st => st.status === "absent");

                                            return (
                                              <div key={session.sessionId} className="bg-gray-50/50 rounded-xl border border-gray-100 overflow-hidden">
                                                <button
                                                  onClick={() => setExpandedClasses(prev => ({ ...prev, [classKey]: !isClassExpanded }))}
                                                  className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-white transition-colors text-left"
                                                >
                                                  <span className="text-xs font-black text-gray-700">{session.className}</span>
                                                  <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold">
                                                      <span className="text-emerald-600">P: {presentList.length}</span>
                                                      <span className="text-red-400">A: {absentList.length}</span>
                                                    </div>
                                                    <span className="text-gray-400 text-[10px]">{isClassExpanded ? "▼" : "▶"}</span>
                                                  </div>
                                                </button>

                                                {isClassExpanded && (
                                                  <div className="px-3.5 pb-3 pt-1 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                                    <div>
                                                      <p className="font-black text-emerald-600 text-[10px] uppercase tracking-widest mb-1.5">Present ({presentList.length})</p>
                                                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                                        {presentList.length > 0 ? presentList.map(st => (
                                                          <div key={st.rollNo} className="flex items-center gap-1.5 text-gray-600 font-medium py-0.5">
                                                            <span className="text-emerald-500">✓</span>
                                                            <span className="truncate">{st.name}</span>
                                                            <span className="text-[9px] text-gray-400 shrink-0">({st.rollNo})</span>
                                                          </div>
                                                        )) : <p className="text-gray-400 italic text-[10px]">No students present</p>}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <p className="font-black text-red-400 text-[10px] uppercase tracking-widest mb-1.5">Absent ({absentList.length})</p>
                                                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                                        {absentList.length > 0 ? absentList.map(st => (
                                                          <div key={st.rollNo} className="flex items-center gap-1.5 text-gray-600 font-medium py-0.5">
                                                            <span className="text-red-400">✗</span>
                                                            <span className="truncate">{st.name}</span>
                                                            <span className="text-[9px] text-gray-400 shrink-0">({st.rollNo})</span>
                                                          </div>
                                                        )) : <p className="text-gray-400 italic text-[10px]">No students absent</p>}
                                                      </div>
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Class & Student Analytics Side by Side */}
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-3">Class Analytics</h4>
                            {namazAnalytics.classAnalytics ? (
                              <div className="grid grid-cols-2 gap-2.5">
                                <div className="rounded-xl bg-teal-50/80 border border-teal-100/50 p-3.5">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-teal-500">Class Average</p>
                                  <p className="text-xl font-black text-teal-700 mt-1">{namazAnalytics.classAnalytics.classAverage}%</p>
                                </div>
                                <div className="rounded-xl bg-gray-50 border border-gray-100/50 p-3.5">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Total Sessions</p>
                                  <p className="text-xl font-black text-gray-800 mt-1">{namazAnalytics.classAnalytics.totalSessions}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50/80 border border-emerald-100/50 p-3.5">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Best Student</p>
                                  <p className="text-sm font-black text-emerald-800 mt-1 truncate" title={namazAnalytics.classAnalytics.bestStudent?.name}>{namazAnalytics.classAnalytics.bestStudent?.name || "-"}</p>
                                </div>
                                <div className="rounded-xl bg-red-50/50 border border-red-100/50 p-3.5">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-red-400">Needs Support</p>
                                  <p className="text-sm font-black text-red-700 mt-1 truncate" title={namazAnalytics.classAnalytics.lowestStudent?.name}>{namazAnalytics.classAnalytics.lowestStudent?.name || "-"}</p>
                                </div>
                              </div>
                            ) : <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center py-6">Select a class to view analytics</p>}
                          </div>

                          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-3">Student Analytics</h4>
                            {namazAnalytics.studentAnalytics ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between rounded-xl bg-gray-50/80 border border-gray-100/50 p-3.5">
                                  <div>
                                    <p className="font-black text-gray-800 text-sm">{namazAnalytics.studentAnalytics.name}</p>
                                    <p className="text-[9px] font-bold text-gray-400">Roll {namazAnalytics.studentAnalytics.rollNo}</p>
                                  </div>
                                  <p className="text-2xl font-black text-teal-600">{namazAnalytics.studentAnalytics.overall}%</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="rounded-xl bg-emerald-50/80 border border-emerald-100/50 p-3 text-center">
                                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Present</p>
                                    <p className="text-lg font-black text-emerald-700">{namazAnalytics.studentAnalytics.presentCount}</p>
                                  </div>
                                  <div className="rounded-xl bg-red-50/50 border border-red-100/50 p-3 text-center">
                                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest">Absent</p>
                                    <p className="text-lg font-black text-red-600">{namazAnalytics.studentAnalytics.absentCount}</p>
                                  </div>
                                  {Object.entries(namazAnalytics.studentAnalytics.sessions || {}).map(([name, row]) => (
                                    <div key={name} className="rounded-xl bg-sky-50/80 border border-sky-100/50 p-3 text-center">
                                      <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest">{name}</p>
                                      <p className="text-lg font-black text-sky-700">{row.percent}%</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center py-6">Enter a student roll number</p>}
                          </div>
                        </div>

                        {/* Trends Row */}
                        <div className="grid gap-4 xl:grid-cols-3">
                          {[
                            ["Attendance Trends", namazAnalytics.trends],
                            ["Monthly Trends", namazAnalytics.monthlyTrends],
                            ["Session Comparison", namazAnalytics.sessionComparison],
                          ].map(([title, rows]) => (
                            <div key={title} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                              <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-3">{title}</h4>
                              <div className="space-y-2.5">
                                {(rows || []).slice(-8).map(row => (
                                  <div key={row.label} className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
                                      <span>{row.label}</span>
                                      <span>{row.percent}%</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-gray-100">
                                      <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500" style={{ width: `${Math.min(row.percent, 100)}%` }} />
                                    </div>
                                  </div>
                                ))}
                                {(!rows || rows.length === 0) && <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 text-center py-3">No session data</p>}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Student Performance Cards */}
                        {selectedNamazClass && namazAnalytics?.students && namazAnalytics.students.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">Student Performance</h4>
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Namaz attendance by student</p>
                              </div>
                              <span className="text-[9px] font-black text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 uppercase tracking-widest">
                                {namazAnalytics.students.length} Students
                              </span>
                            </div>
                            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {namazAnalytics.students.map((student) => {
                                const pct = student.percent;
                                const isGood = pct >= 90;
                                const isWarn = pct >= 80 && pct < 90;
                                const isBad = pct < 80;

                                const badgeClass = isGood
                                  ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                  : isWarn
                                    ? "bg-amber-50 border-amber-100 text-amber-700"
                                    : "bg-red-50 border-red-100 text-red-600";
                                const barColor = isGood ? "bg-emerald-500" : isWarn ? "bg-amber-500" : "bg-red-400";

                                return (
                                  <div key={student.rollNo} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md hover:border-gray-200 transition-all group">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Roll {student.rollNo}</p>
                                        <p className="font-black text-gray-800 text-sm truncate group-hover:text-teal-600 transition-colors" title={student.name}>{student.name}</p>
                                      </div>
                                      <span className={`shrink-0 text-sm font-black border rounded-xl px-3 py-1.5 ${badgeClass}`}>
                                        {pct}%
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1.5">
                                      <span>{student.present} of {student.total} sessions</span>
                                      <span>{pct >= 90 ? "Excellent" : pct >= 80 ? "Good" : "Needs work"}</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                      <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Recent Sessions Timeline */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                          <div className="p-4 border-b border-gray-50">
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">Recent Sessions</h4>
                          </div>
                          <div className="p-4">
                            {(() => {
                              const todayStr = getIstDateString();
                              const yesterdayStr = (() => {
                                const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
                                const d = new Date(); d.setDate(d.getDate() - 1);
                                const parts = formatter.formatToParts(d);
                                return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
                              })();

                              const sessions = namazAnalytics.sessions || [];
                              const todaySess = sessions.filter(s => s.date === todayStr);
                              const yesterdaySess = sessions.filter(s => s.date === yesterdayStr);
                              const olderSess = sessions.filter(s => s.date !== todayStr && s.date !== yesterdayStr);

                              if (sessions.length === 0) {
                                return <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center py-8">No sessions received for these filters</p>;
                              }

                              return (
                                <div className="space-y-4">
                                  {todaySess.length > 0 && (
                                    <div>
                                      <div className="flex items-center gap-2 mb-2 px-1">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Today</h5>
                                      </div>
                                      <div className="bg-emerald-50/30 rounded-xl border border-emerald-100/60 divide-y divide-emerald-50 overflow-hidden">
                                        {todaySess.map(s => (
                                          <NamazSessionRow key={s.sessionId} s={s} isExpanded={expandedRecentSessionId === s.sessionId} onToggle={() => setExpandedRecentSessionId(expandedRecentSessionId === s.sessionId ? null : s.sessionId)} />
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {yesterdaySess.length > 0 && (
                                    <div>
                                      <div className="flex items-center gap-2 mb-2 px-1">
                                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                                        <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Yesterday</h5>
                                      </div>
                                      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                                        {yesterdaySess.map(s => (
                                          <NamazSessionRow key={s.sessionId} s={s} isExpanded={expandedRecentSessionId === s.sessionId} onToggle={() => setExpandedRecentSessionId(expandedRecentSessionId === s.sessionId ? null : s.sessionId)} />
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {olderSess.length > 0 && (
                                    <div>
                                      <div className="flex items-center gap-2 mb-2 px-1">
                                        <span className="w-2 h-2 rounded-full bg-gray-300" />
                                        <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Older</h5>
                                      </div>
                                      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                                        {olderSess.map(s => (
                                          <NamazSessionRow key={s.sessionId} s={s} isExpanded={expandedRecentSessionId === s.sessionId} onToggle={() => setExpandedRecentSessionId(expandedRecentSessionId === s.sessionId ? null : s.sessionId)} />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-14 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl mx-auto mb-3">🕌</div>
                        <p className="text-xs font-black uppercase tracking-widest text-gray-400">Apply filters to view Namaz analytics</p>
                        <p className="text-[10px] font-bold text-gray-300 mt-1">Select a date range and click Apply</p>
                      </div>
                    )}
                  </div>
                )}

                {reportType === "events" && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-black text-gray-905 text-lg">Events History</h3>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">
                          Historical record of special program and event attendances
                        </p>
                      </div>
                      <button
                        onClick={fetchEventAttendance}
                        className="rounded-2xl bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-700 transition-all active:scale-95 shadow-md shadow-blue-100"
                      >
                        Refresh
                      </button>
                    </div>

                    {/* Dynamic Frontend Filters Bar */}
                    {eventAttendance && eventAttendance.length > 0 && (
                      <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-gray-50">
                          <span className="text-base">🔍</span>
                          <span className="text-xs font-black text-gray-550 uppercase tracking-widest">Filter Events</span>
                        </div>
                        {(() => {
                          const flatEventsForFilters = [];
                          eventAttendance.forEach((group) => {
                            if (Array.isArray(group.history)) {
                              group.history.forEach((session) => {
                                flatEventsForFilters.push({
                                  ...session,
                                  eventName: group.eventName
                                });
                              });
                            }
                          });

                          const classOrder = {'HS1':1,'HSU1':2,'HS2':3,'HSU2':4,'BS1':5,'BSU1':6,'BS2':7,'BS3':8,'BS4':9,'BS5':10};
                          const uniqueClasses = Array.from(new Set(flatEventsForFilters.map(e => e.className))).filter(Boolean).sort((a,b) => (classOrder[a]||99) - (classOrder[b]||99));
                          const uniqueEvents = Array.from(new Set(flatEventsForFilters.map(e => e.eventName))).filter(Boolean).sort();

                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <section>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2.5 block">Class / Batch</label>
                                <select
                                  className="w-full px-4 py-3 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-xs"
                                  value={selectedEventClassFilter}
                                  onChange={(e) => setSelectedEventClassFilter(e.target.value)}
                                >
                                  <option value="">All Classes/Batches</option>
                                  {uniqueClasses.map(cls => (
                                    <option key={cls} value={cls}>{cls}</option>
                                  ))}
                                </select>
                              </section>

                              <section>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2.5 block">Event / Program</label>
                                <select
                                  className="w-full px-4 py-3 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-xs"
                                  value={selectedEventNameFilter}
                                  onChange={(e) => setSelectedEventNameFilter(e.target.value)}
                                >
                                  <option value="">All Events</option>
                                  {uniqueEvents.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </section>

                              <section>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2.5 block">Date</label>
                                <div className="flex gap-2">
                                  <input
                                    type="date"
                                    className="flex-1 px-4 py-3 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-xs uppercase tracking-widest cursor-pointer"
                                    value={selectedEventDateFilter}
                                    onChange={(e) => setSelectedEventDateFilter(e.target.value)}
                                  />
                                  {selectedEventDateFilter && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedEventDateFilter("")}
                                      className="px-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-400 font-bold text-xs hover:bg-gray-100 active:scale-95"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </section>
                            </div>
                          );
                        })()}

                        {(selectedEventClassFilter || selectedEventNameFilter || selectedEventDateFilter) && (
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={() => {
                                setSelectedEventClassFilter("");
                                setSelectedEventNameFilter("");
                                setSelectedEventDateFilter("");
                              }}
                              className="text-[10px] font-black text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100/80 px-3.5 py-1.5 rounded-xl uppercase tracking-wider transition-all active:scale-95"
                            >
                              Clear Filters
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {loadingEvents ? (
                      <div className="flex justify-center p-12">
                        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
                      </div>
                    ) : eventAttendance && eventAttendance.length > 0 ? (
                      (() => {
                        const flatEvents = [];
                        eventAttendance.forEach((group, groupIndex) => {
                          if (Array.isArray(group.history)) {
                            group.history.forEach((session, sessionIndex) => {
                              flatEvents.push({
                                ...session,
                                eventName: group.eventName,
                                recordKey: [
                                  groupIndex,
                                  sessionIndex,
                                  session.sessionId || "no-session-id",
                                  session.date || "no-date",
                                  session.createdAt || "no-created-at",
                                ].join("::")
                              });
                            });
                          }
                        });

                        // Apply frontend filters
                        const filteredFlatEvents = flatEvents.filter(e => {
                          if (selectedEventClassFilter && e.className !== selectedEventClassFilter) return false;
                          if (selectedEventNameFilter && e.eventName !== selectedEventNameFilter) return false;
                          if (selectedEventDateFilter && e.date !== selectedEventDateFilter) return false;
                          return true;
                        });

                        filteredFlatEvents.sort((a, b) => {
                          const dateCompare = b.date.localeCompare(a.date);
                          if (dateCompare !== 0) return dateCompare;
                          return (b.createdAt || "").localeCompare(a.createdAt || "");
                        });

                        const groupedEvents = [];
                        let currentGroup = null;

                        filteredFlatEvents.forEach((event) => {
                          if (currentGroup && currentGroup.eventName === event.eventName) {
                            currentGroup.occurrences.push(event);
                          } else {
                            currentGroup = {
                              id: `event-group-${groupedEvents.length}-${event.recordKey}`,
                              eventName: event.eventName,
                              occurrences: [event]
                            };
                            groupedEvents.push(currentGroup);
                          }
                        });

                        if (groupedEvents.length === 0) {
                          return (
                            <div className="rounded-[2rem] border border-dashed border-gray-200 bg-gray-50/50 p-12 text-center">
                              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-lg font-black">🏆</div>
                              <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                                No matching events found for the selected filters.
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="grid gap-8 grid-cols-1 md:grid-cols-2">
                            {groupedEvents.map((group) => (
                              <EventGroupCard key={group.id} group={group} />
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="rounded-[2rem] border border-dashed border-gray-200 bg-gray-50/50 p-12 text-center">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-lg font-black">🏆</div>
                        <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                          No Event/Program attendance records found
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {reportType === "analysis" && (
                  <div className="space-y-6">

                    {/* 1. Student Search */}
                    <div className="rounded-[2rem] border border-blue-100 bg-gradient-to-b from-blue-50/50 to-white p-5 shadow-sm">
                      <label className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-[0.2em] block mb-3 px-1">Student Lookup</label>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="relative flex-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-blue-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                          <input
                            type="text"
                            placeholder="Enter student roll number"
                            className="w-full bg-white border border-blue-100 rounded-2xl pl-11 pr-6 py-4 text-sm font-semibold text-gray-800 placeholder:text-gray-300 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all min-w-0"
                            value={searchRollNo}
                            onChange={(e) => setSearchRollNo(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={handleStudentSearch}
                          className="bg-[#1e3a8a] hover:bg-[#162d6b] text-white px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all active:scale-[0.97] shadow-lg shadow-blue-200/50 sm:self-stretch"
                        >
                          Search
                        </button>
                      </div>
                    </div>

                    {/* Student History Card */}
                    {studentHistory && (
                      <div className="rounded-[2rem] bg-gradient-to-br from-[#1e3a8a] via-[#1e3a8a] to-[#2563eb] p-6 text-white shadow-xl shadow-blue-200/40 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -mr-20 -mt-20"></div>
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full -ml-16 -mb-16"></div>
                        <div className="relative z-10">
                          <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-5">
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <div className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-sm font-black border border-white/20">
                                  {(studentHistory.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <h3 className="text-xl font-black tracking-tight leading-tight">{studentHistory.name}</h3>
                                  <p className="text-blue-200 text-[11px] font-bold mt-0.5">Roll {studentHistory.rollNo} &middot; Class {studentHistory.class}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-baseline gap-1.5 sm:text-right">
                              <span className="text-4xl font-black tracking-tighter">{studentHistory.stats?.percent}</span>
                              <span className="text-lg font-black text-blue-200">%</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2.5">
                            <div className="bg-white/10 backdrop-blur-sm p-3.5 rounded-xl border border-white/10 text-center">
                              <p className="text-lg font-black">{studentHistory.stats?.total}</p>
                              <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Total</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-3.5 rounded-xl border border-white/10 text-center">
                              <p className="text-lg font-black">{studentHistory.stats?.attended}</p>
                              <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Present</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-3.5 rounded-xl border border-white/10 text-center">
                              <p className="text-lg font-black">{(studentHistory.stats?.total || 0) - (studentHistory.stats?.attended || 0)}</p>
                              <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Absent</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. Class Average Attendance — Admin only */}
                    {user?.role === 'admin' && (
                    <div className="space-y-4">
                      <div className="px-1">
                        <h3 className="font-black text-[#1e3a8a] tracking-tight text-lg">Class Averages</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Attendance percentage ranked by class</p>
                      </div>

                      {loadingClassAverages ? (
                        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-[#1e3a8a] border-t-transparent shadow-sm"></div></div>
                      ) : Array.isArray(classAverages) && classAverages.length > 0 ? (
                        <div className="space-y-4">
                          {(() => {
                            const withData = classAverages.filter(c => c.attendancePercentage !== null);
                            if (withData.length === 0) return null;
                            const sorted = [...withData].sort((a, b) => b.attendancePercentage - a.attendancePercentage);
                            const highest = sorted[0];
                            const lowest = sorted[sorted.length - 1];
                            const overallAvg = withData.reduce((sum, c) => sum + c.attendancePercentage, 0) / withData.length;
                            return (
                              <div className="grid grid-cols-3 gap-3">
                                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">Highest</p>
                                  <p className="text-sm font-black text-emerald-700">{highest.class}</p>
                                  <p className="text-xl font-black text-emerald-600 mt-0.5">{highest.attendancePercentage}%</p>
                                </div>
                                <div className="rounded-xl bg-[#1e3a8a]/5 border border-blue-100 p-4 text-center">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-[#1e3a8a]/60 mb-1">Overall</p>
                                  <p className="text-[10px] font-bold text-[#1e3a8a]/40 mt-0.5">{withData.length} classes</p>
                                  <p className="text-xl font-black text-[#1e3a8a] mt-0.5">{overallAvg.toFixed(1)}%</p>
                                </div>
                                <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-center">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-500 mb-1">Lowest</p>
                                  <p className="text-sm font-black text-amber-700">{lowest.class}</p>
                                  <p className="text-xl font-black text-amber-600 mt-0.5">{lowest.attendancePercentage}%</p>
                                </div>
                              </div>
                            );
                          })()}

                          <div className="rounded-[1.5rem] border border-gray-100 bg-white shadow-sm overflow-hidden">
                            {(() => {
                              const sorted = [...classAverages].sort((a, b) => {
                                if (a.attendancePercentage === null) return 1;
                                if (b.attendancePercentage === null) return -1;
                                return b.attendancePercentage - a.attendancePercentage;
                              });
                              return sorted.map((item, idx) => (
                                <div key={item.class} className={`flex items-center gap-3.5 px-5 py-3.5 ${idx !== sorted.length - 1 ? 'border-b border-gray-50' : ''} hover:bg-gray-50/60 transition-colors`}>
                                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                                    idx === 0 ? 'bg-emerald-100 text-emerald-700' :
                                    idx === 1 ? 'bg-blue-50 text-blue-500' :
                                    idx === 2 ? 'bg-amber-100 text-amber-600' :
                                    'bg-gray-50 text-gray-400'
                                  }`}>{idx + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <p className="font-bold text-gray-800 text-sm">{item.class}</p>
                                      <p className="font-black text-sm text-gray-800 flex items-center gap-1">
                                        {item.attendancePercentage !== null && item.attendancePercentage < 60 && <span className="text-xs" title="Warning: Low Attendance">⚠️</span>}
                                        {item.attendancePercentage !== null ? `${item.attendancePercentage}%` : '—'}
                                      </p>
                                    </div>
                                    {item.attendancePercentage !== null && (
                                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${
                                            item.attendancePercentage >= 80 ? 'bg-emerald-500' :
                                            item.attendancePercentage >= 75 ? 'bg-[#1e3a8a]' :
                                            item.attendancePercentage >= 70 ? 'bg-amber-500' :
                                            item.attendancePercentage >= 60 ? 'bg-red-500' : 'bg-red-800'
                                          }`}
                                          style={{ width: `${Math.min(item.attendancePercentage, 100)}%` }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[1.5rem] border border-dashed border-gray-200 bg-gray-50/40 py-12 text-center">
                          <p className="text-gray-300 font-bold uppercase tracking-widest text-[10px]">No attendance data available</p>
                        </div>
                      )}
                    </div>
                    )}

                    {/* 3. Batch-wise Report */}
                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center px-1">
                        <div>
                          <h3 className="font-black text-[#1e3a8a] tracking-tight text-lg">Batch-wise Breakdown</h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Individual student attendance for selected class</p>
                        </div>
                        <select
                          className="bg-white px-4 py-3 rounded-xl border border-blue-100 text-xs font-black text-[#1e3a8a] uppercase tracking-wider cursor-pointer focus:ring-2 focus:ring-blue-100 min-w-[160px]"
                          value={selectedClassForAnalysis}
                          onChange={(e) => setSelectedClassForAnalysis(e.target.value)}
                        >
                          <option value="">Select Class</option>
                          {(Array.isArray(classes) ? classes : []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>

                      {Array.isArray(batchReport) ? (
                        <div className="space-y-2">
                          {batchReport.map((student, idx) => (
                            <div key={idx} className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm transition-all hover:border-blue-100 hover:shadow-md">
                              <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-black text-xs shrink-0 ${
                                student.percent >= 80 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                student.percent >= 75 ? 'bg-blue-50 text-[#1e3a8a] border border-blue-100' :
                                student.percent >= 70 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                student.percent >= 60 ? 'bg-red-50 text-red-500 border border-red-100' :
                                'bg-red-100 text-red-900 border border-red-300'
                              }`}>
                                {student.percent < 60 && <span className="text-[9px] mb-0.5" title="Warning: Low Attendance">⚠️</span>}
                                <span>{Math.round(student.percent)}%</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-800 text-sm truncate">{student.name}</p>
                                <p className="text-[10px] font-semibold text-gray-400">Roll {student.rollNo}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-black text-gray-700">{student.attended}<span className="text-gray-300 font-medium">/{student.total}</span></p>
                                <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">Periods</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[1.5rem] border border-dashed border-gray-200 bg-gray-50/40 py-12 text-center">
                          <p className="text-gray-300 font-bold uppercase tracking-widest text-[10px]">Select a class to view breakdown</p>
                        </div>
                      )}
                    </div>

                    {/* 4. Full-Day Absentees */}
                    <div className="space-y-4 pt-6 border-t border-gray-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center px-1">
                        <div>
                          <h3 className="font-black text-[#1e3a8a] tracking-tight text-lg">Full-Day Absentees</h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Students absent for all periods today</p>
                        </div>
                        <select
                          className="bg-white px-4 py-3 rounded-xl border border-blue-100 text-xs font-black text-[#1e3a8a] uppercase tracking-wider cursor-pointer focus:ring-2 focus:ring-blue-100 min-w-[160px]"
                          value={selectedClassForAnalysis}
                          onChange={(e) => setSelectedClassForAnalysis(e.target.value)}
                        >
                          <option value="">Select Class</option>
                          {(Array.isArray(classes) ? classes : []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>

                      {selectedClassForAnalysis && (
                        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                          {[
                            { id: 'ALL', label: 'All', color: 'bg-[#1e3a8a] text-white shadow-lg shadow-blue-200/50', idle: 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50' },
                            { id: 'A', label: 'Absent', color: 'bg-red-500 text-white shadow-lg shadow-red-200/50', idle: 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50' },
                            { id: 'S', label: 'Sick', color: 'bg-amber-500 text-white shadow-lg shadow-amber-200/50', idle: 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50' },
                            { id: 'L', label: 'Leave', color: 'bg-purple-500 text-white shadow-lg shadow-purple-200/50', idle: 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50' },
                          ].map(f => (
                            <button
                              key={f.id}
                              onClick={() => setAbsenteeFilter(f.id)}
                              className={`px-4 py-2 rounded-xl whitespace-nowrap text-xs font-black uppercase tracking-widest transition-all ${absenteeFilter === f.id ? f.color : f.id === 'ALL' ? 'bg-[#1e3a8a]/5 text-[#1e3a8a] border border-blue-100' : f.id === 'A' ? 'bg-red-50 text-red-400 border border-red-100' : f.id === 'S' ? 'bg-amber-50 text-amber-400 border border-amber-100' : 'bg-purple-50 text-purple-400 border border-purple-100'}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {loadingAbsentees ? (
                        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-[#1e3a8a] border-t-transparent shadow-sm"></div></div>
                      ) : Array.isArray(absenteeReport) && absenteeReport.length > 0 ? (
                        <div className="rounded-[1.5rem] border border-gray-100 bg-white shadow-sm overflow-hidden">
                          <div className="px-5 py-3 bg-gray-50/70 border-b border-gray-100 flex justify-between items-center">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{absenteeReport.length} students</p>
                            <p className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest bg-blue-50 px-2.5 py-0.5 rounded-lg border border-blue-100">{selectedClassForAnalysis}</p>
                          </div>
                          {absenteeReport.map((student, idx) => (
                            <div key={idx} className={`flex items-center gap-3.5 px-5 py-3.5 ${idx !== absenteeReport.length - 1 ? 'border-b border-gray-50' : ''} hover:bg-gray-50/50 transition-colors`}>
                              <div className="w-9 h-9 rounded-lg bg-[#1e3a8a]/5 flex items-center justify-center font-black text-[11px] text-[#1e3a8a] shrink-0">
                                {student.rollNo}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-800 text-sm truncate">{student.name}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                    {student.status.split('(')[0].trim()}
                                  </span>
                                  {student.status.includes('(') && (
                                    <span className="bg-red-50 text-red-500 text-[9px] font-black px-1.5 py-0.5 rounded border border-red-100">
                                      {student.status.match(/\((\d+)/)?.[1]} periods
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setSearchRollNo(student.rollNo);
                                  handleStudentSearch();
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="w-8 h-8 rounded-lg bg-gray-50 text-gray-300 hover:bg-blue-50 hover:text-[#1e3a8a] transition-all flex items-center justify-center shrink-0"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : selectedClassForAnalysis ? (
                        <div className="rounded-[1.5rem] border border-dashed border-gray-200 bg-gray-50/40 py-10 text-center">
                          <p className="text-gray-300 font-bold uppercase tracking-widest text-[10px]">No absentees for this class today</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {reportType === "extra" && (
                  <>{/* 4.7 Extra Classes Report Section */}
                    <div className="space-y-4 pt-6 border-t border-gray-100">
                      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center px-1">
                        <div>
                          <h3 className="font-black text-gray-800 tracking-tight text-lg">Extra Classes Report</h3>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">Report of classes taken outside regular timetable</p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row w-full sm:w-auto">
                          <select
                            className="bg-gray-100 px-4 py-2.5 rounded-2xl border-none text-[10px] font-black text-blue-600 uppercase tracking-wider cursor-pointer focus:ring-2 focus:ring-blue-100 min-w-[140px]"
                            value={selectedClassForExtra}
                            onChange={(e) => setSelectedClassForExtra(e.target.value)}
                          >
                            <option value="">All Classes</option>
                            {(Array.isArray(classes) ? classes : []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <select
                            className="bg-gray-100 px-4 py-2.5 rounded-2xl border-none text-[10px] font-black text-blue-600 uppercase tracking-wider cursor-pointer focus:ring-2 focus:ring-blue-100 min-w-[140px]"
                            value={selectedTeacherForExtra}
                            onChange={(e) => setSelectedTeacherForExtra(e.target.value)}
                          >
                            <option value="">All Teachers</option>
                            {(Array.isArray(teachers) ? teachers : []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          <input
                            type="date"
                            className="bg-gray-50 px-4 py-2.5 rounded-2xl border border-gray-100 text-[10px] font-black text-blue-600 uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-blue-100"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                          />
                        </div>
                      </div>

                      {loadingExtra ? (
                        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-[3px] border-amber-400 border-t-transparent"></div></div>
                      ) : Array.isArray(extraClassesReport) && extraClassesReport.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {extraClassesReport.map((report, idx) => (
                            <div key={idx} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm transition-all hover:shadow-lg hover:border-amber-100 relative overflow-hidden group">
                              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-50 rounded-full -mr-12 -mt-12 opacity-50 group-hover:scale-110 transition-transform"></div>
                              <div className="flex justify-between items-start mb-4 relative z-10">
                                <span className="bg-amber-100 text-amber-700 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider">⚡ Extra Class</span>
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{report.time}</span>
                              </div>
                              <h4 className="font-black text-gray-800 text-base leading-tight pr-6">{report.subject}</h4>
                              <div className="mt-2 space-y-1">
                                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">Class: <span className="text-gray-900 font-black">{report.class}</span></p>
                                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">Teacher: <span className="text-gray-900 font-black">{report.teacherName}</span></p>
                              </div>
                              <div className="mt-5 grid grid-cols-2 gap-3 pt-4 border-t border-gray-50">
                                <div className="text-center bg-green-50/50 p-2 rounded-2xl border border-green-50">
                                  <p className="text-sm font-black text-green-600">{report.presentCount}</p>
                                  <p className="text-[8px] font-black text-green-600/60 uppercase tracking-widest mt-0.5">Present</p>
                                </div>
                                <div className="text-center bg-red-50/50 p-2 rounded-2xl border border-red-50">
                                  <p className="text-sm font-black text-red-600">{report.absentCount}</p>
                                  <p className="text-[8px] font-black text-red-600/60 uppercase tracking-widest mt-0.5">Absent</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-gray-50/50 p-12 rounded-[2.5rem] border border-dashed border-gray-200 text-center">
                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-xl">⚡</div>
                          <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">No extra classes records for this date</p>
                        </div>
                      )}
                    </div>

                  </>
                )}

                {reportType === "register" && (
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-xl shadow-gray-100/50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <section>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">Class</label>
                          <select
                            className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-sm"
                            value={selectedClassForAnalysis}
                            onChange={(e) => setSelectedClassForAnalysis(e.target.value)}
                          >
                            <option value="">Select Class</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </section>
                        <section>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">Teacher</label>
                          <select
                            className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-sm"
                            value={selectedTeacherForRegister}
                            onChange={(e) => setSelectedTeacherForRegister(e.target.value)}
                          >
                            <option value="">Select Teacher</option>
                            <option value="all">All Teachers</option>
                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </section>
                        <section>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">From Date</label>
                          <input
                            type="date"
                            className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-sm"
                            value={registerFromDate}
                            onChange={(e) => setRegisterFromDate(e.target.value)}
                          />
                        </section>
                        <section>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 block">To Date</label>
                          <input
                            type="date"
                            className="w-full px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 focus:ring-4 focus:ring-blue-100 transition-all outline-none font-bold text-sm"
                            value={registerToDate}
                            onChange={(e) => setRegisterToDate(e.target.value)}
                          />
                        </section>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                        <button
                          onClick={fetchDigitalRegister}
                          disabled={loadingRegister}
                          className="py-4 rounded-2xl bg-blue-600 text-white font-black uppercase tracking-widest text-xs shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
                        >
                          {loadingRegister ? 'Loading...' : '🔍 Generate Register'}
                        </button>
                        <button
                          onClick={exportToExcel}
                          disabled={digitalRegisterData.length === 0}
                          className="py-4 rounded-2xl bg-emerald-500 text-white font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50 disabled:bg-gray-200 disabled:shadow-none"
                        >
                          📥 Download Excel
                        </button>
                      </div>
                    </div>

                    {digitalRegisterData.length > 0 ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="bg-white p-5 rounded-[1.5rem] border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Classes Taken</p>
                            <p className="mt-3 text-2xl font-black text-blue-900">{digitalRegisterSummary.classesTaken || 0}</p>
                          </div>
                          <div className="bg-white p-5 rounded-[1.5rem] border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Assigned Periods</p>
                            <p className="mt-3 text-2xl font-black text-emerald-900">{digitalRegisterSummary.assignedPeriods || 0}</p>
                          </div>
                          <div className="bg-white p-5 rounded-[1.5rem] border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Teaching %</p>
                            <p className="mt-3 text-2xl font-black text-amber-900">{digitalRegisterSummary.teachingPercentage || 0}%</p>
                          </div>
                        </div>
                        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-xl shadow-gray-100/50 overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[600px]">
                              <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100">
                                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Roll</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Student Name</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Attendance Timeline</th>
                                  <th className="px-4 py-4 text-[10px] font-black text-emerald-600 uppercase tracking-widest text-right">%</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-green-600 uppercase tracking-widest text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {digitalRegisterData.map((row, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors group">
                                    <td className="px-6 py-4">
                                      <span className="w-8 h-8 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center text-[10px] font-black group-hover:bg-white group-hover:text-gray-600 transition-all">
                                        {row.rollNo}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4">
                                      <p className="font-bold text-gray-700 whitespace-nowrap">{row.name}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-[300px]">
                                        {row.attendanceLine.split(",").map((status, sIdx) => {
                                          const s = status.trim();
                                          const isAbsent = s === 'A' || s === 'S' || s === 'L';
                                          return (
                                            <span key={sIdx} className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-[9px] font-black ${isAbsent ? 'bg-red-50 text-red-500' : s === '-' ? 'text-gray-200' : s === 'SL' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                                              }`}>
                                              {s}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                      <span className={`font-black text-[10px] px-2 py-1 rounded-md ${row.percentage >= 75 ? 'bg-emerald-50 text-emerald-600' :
                                        row.percentage >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                                        }`}>
                                        {row.percentage}%
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <span className="font-black text-xs text-green-600 bg-green-50 px-3 py-1 rounded-lg">
                                        {row.total}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ) : (
                      !loadingRegister && (
                        <div className="bg-gray-50/50 p-12 rounded-[2.5rem] border border-dashed border-gray-200 text-center">
                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-xl text-blue-300">📒</div>
                          <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Select range to view historical register</p>
                        </div>
                      )
                    )}
                  </div>
                )}

                {reportType === "substitute" && (
                  <div className="space-y-6 animate-in fade-in">
                    {/* Sub-navigation */}
                    <div className="flex gap-2 border-b border-gray-100 pb-2">
                      <button onClick={() => setSubTab("planner")}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${subTab === "planner" ? "bg-[#0d9488] text-white shadow-md shadow-[#0d9488]/15" : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50"}`}>
                        Planner
                      </button>
                      <button onClick={() => { setSubTab("history"); fetchSubstituteReportData(); }}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all ${subTab === "history" ? "bg-[#0d9488] text-white shadow-md shadow-[#0d9488]/15" : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50"}`}>
                        History Report
                      </button>
                    </div>

                    {subTab === "planner" && (
                      <div className="space-y-6">
                        {/* Step 1: Date & Leaves Selection */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-4">
                          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Step 1: Set Date & Leaves</h3>
                          
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Select Date</label>
                            <input type="date" value={plannerDate} onChange={(e) => { setPlannerDate(e.target.value); }}
                              className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20 w-full sm:max-w-xs" />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Teachers on Leave</label>
                            <input type="text" placeholder="Search teacher to mark leave..." value={leaveSearch} onChange={(e) => setLeaveSearch(e.target.value)}
                              className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-[#0d9488]/20 w-full mb-3" />
                            
                            {/* Selected Leaves Badges */}
                            {selectedLeaveTeachers.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {selectedLeaveTeachers.map(t => (
                                  <span key={t.id} className="inline-flex items-center gap-1 bg-red-50 text-red-700 px-3 py-1 rounded-xl text-xs font-bold border border-red-100">
                                    {t.name}
                                    <button onClick={() => {
                                      const updated = selectedLeaveTeachers.filter(x => x.id !== t.id);
                                      setSelectedLeaveTeachers(updated);
                                    }} className="text-red-400 hover:text-red-700 font-bold ml-1">✕</button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Searchable dropdown */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-1 border border-gray-100 rounded-xl bg-gray-50/50 mb-4">
                              {teachers.filter(t => t.name.toLowerCase().includes(leaveSearch.toLowerCase())).map(t => {
                                const isSelected = selectedLeaveTeachers.some(x => x.id === t.id);
                                return (
                                  <button key={t.id}
                                    onClick={() => {
                                      let updated;
                                      if (isSelected) {
                                        updated = selectedLeaveTeachers.filter(x => x.id !== t.id);
                                      } else {
                                        updated = [...selectedLeaveTeachers, t];
                                      }
                                      setSelectedLeaveTeachers(updated);
                                    }}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-left truncate ${isSelected ? 'bg-red-50 border-red-200 text-red-700 font-extrabold' : 'bg-white border-gray-100 text-gray-600 hover:bg-gray-50'}`}>
                                    {isSelected ? '🔴 ' : ''}{t.name}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Explicit CTA Confirm & Load Planner Button */}
                            <div className="flex justify-end pt-2">
                              <button onClick={() => fetchPlannerData(plannerDate, selectedLeaveTeachers.map(t => t.id))}
                                disabled={selectedLeaveTeachers.length === 0}
                                className="w-full sm:w-auto rounded-xl bg-[#0d9488] hover:bg-[#0a7a70] text-white px-6 py-3 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-md shadow-[#0d9488]/15">
                                Confirm Leaves & Load Planner
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Step 2: Coverage Grid */}
                        {plannerData && selectedLeaveTeachers.length > 0 && (
                          <div className="bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                              <div>
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Step 2: Assign Coverage</h3>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">Click any red period to assign a substitute</p>
                              </div>
                              <span className="text-xs font-bold text-gray-400 uppercase">{plannerData.affected_periods.length} affected slots</span>
                            </div>

                            {plannerData.affected_periods.length === 0 ? (
                              <p className="py-12 text-center text-xs font-bold text-gray-400 uppercase">No scheduled periods found for on-leave teachers on this day.</p>
                            ) : (
                              <div className="space-y-6">
                                {(() => {
                                  const groupedPeriods = {};
                                  plannerData.affected_periods.forEach(p => {
                                    if (!groupedPeriods[p.class]) {
                                      groupedPeriods[p.class] = [];
                                    }
                                    groupedPeriods[p.class].push(p);
                                  });

                                  return Object.entries(groupedPeriods).map(([className, classPeriods]) => (
                                    <div key={className} className="rounded-2xl border border-gray-100 bg-gray-50/20 p-4 space-y-3">
                                      <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0d9488]/10 text-xs font-black text-[#0d9488]">
                                          {className}
                                        </span>
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{classPeriods.length} Covered / Pending Slots</span>
                                      </div>
                                      
                                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        {classPeriods.map((p, idx) => {
                                          const key = `${p.class}-${p.period}-${p.original_teacher_id}`;
                                          const temp = temporaryAssignments[key];
                                          const isAssigned = !!temp;
                                          
                                          let subName = p.assigned_substitute_name;
                                          let subSubject = p.assigned_subject;
                                          if (temp) {
                                            const teacherObj = teachers.find(t => t.id === temp.substitute_teacher_id);
                                            subName = teacherObj ? teacherObj.name : `Teacher #${temp.substitute_teacher_id}`;
                                            subSubject = temp.subject;
                                          }

                                          return (
                                            <div key={idx} onClick={() => setAssigningPeriod({ ...p, key })}
                                              className={`rounded-xl border p-4 transition-all cursor-pointer relative overflow-hidden group hover:scale-[1.01] active:scale-[0.99] ${isAssigned ? 'bg-emerald-50/60 border-emerald-250 text-emerald-950' : 'bg-red-50/60 border-red-200 text-red-950'}`}>
                                              <div className="flex justify-between items-start">
                                                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${isAssigned ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                  Period {p.period}
                                                </span>
                                                <span className="text-xs font-black">{p.subject}</span>
                                              </div>
                                              
                                              <div className="mt-2.5">
                                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Scheduled Teacher</p>
                                                <p className="text-xs font-bold text-gray-800 truncate">{p.original_teacher_name}</p>
                                              </div>

                                              <div className="mt-2.5 pt-2.5 border-t border-gray-155">
                                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Substitute Assigned</p>
                                                {isAssigned ? (
                                                  <div>
                                                    <p className="text-xs font-black text-emerald-700 truncate">{subName}</p>
                                                    <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mt-0.5">{subSubject}</p>
                                                  </div>
                                                ) : (
                                                  <p className="text-xs font-bold text-red-500 uppercase tracking-wider italic">Tap to Assign ➕</p>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ));
                                })()}
                              </div>
                            )}

                            {plannerData.affected_periods.length > 0 && (
                              <div className="pt-6 border-t border-gray-155 flex justify-end gap-3">
                                <button onClick={() => setTemporaryAssignments({})}
                                  className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 transition-all">
                                  Reset Draft
                                </button>
                                <button onClick={saveAssignments}
                                  className="rounded-2xl bg-[#0d9488] text-white px-6 py-3 text-xs font-black uppercase tracking-wider hover:bg-[#0a7a70] transition-all shadow-md shadow-[#0d9488]/15">
                                  Save & Deploy Assignments
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {subTab === "history" && (
                      <div className="bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Substitute History</h3>
                        </div>

                        {/* Filters */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">From Date</label>
                            <input type="date" value={subReportFilter.fromDate} onChange={(e) => setSubReportFilter(p => ({ ...p, fromDate: e.target.value }))}
                              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium outline-none" />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">To Date</label>
                            <input type="date" value={subReportFilter.toDate} onChange={(e) => setSubReportFilter(p => ({ ...p, toDate: e.target.value }))}
                              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium outline-none" />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Class</label>
                            <select value={subReportFilter.classId} onChange={(e) => setSubReportFilter(p => ({ ...p, classId: e.target.value }))}
                              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium outline-none">
                              <option value="">All</option>
                              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Teacher</label>
                            <select value={subReportFilter.teacherId} onChange={(e) => setSubReportFilter(p => ({ ...p, teacherId: e.target.value }))}
                              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium outline-none">
                              <option value="">All</option>
                              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <button onClick={fetchSubstituteReportData}
                            className="rounded-xl bg-gray-900 hover:bg-black text-white px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all">
                            Filter Report
                          </button>
                        </div>

                        {/* List */}
                        <div className="overflow-x-auto border border-gray-50 rounded-2xl">
                          <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead className="bg-gray-50/50 border-b border-gray-100">
                              <tr>
                                {["Date", "Class", "Period", "Original Teacher", "Substitute Teacher", "Subject", "Assigned By", "Timestamp"].map(h => (
                                  <th key={h} className="px-5 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-xs">
                              {subReportData.map((row, rIdx) => (
                                <tr key={row.id || rIdx} className="hover:bg-gray-50/50 transition-colors">
                                  <td className="px-5 py-3 font-bold text-gray-700">{row.date}</td>
                                  <td className="px-5 py-3 font-mono font-bold text-[#0d9488]">{row.class}</td>
                                  <td className="px-5 py-3">{row.period}</td>
                                  <td className="px-5 py-3 text-gray-600">{row.original_teacher}</td>
                                  <td className="px-5 py-3 font-bold text-emerald-700">{row.substitute_teacher}</td>
                                  <td className="px-5 py-3 font-semibold">{row.subject}</td>
                                  <td className="px-5 py-3 text-gray-400">{row.assigned_by}</td>
                                  <td className="px-5 py-3 text-gray-300 font-mono text-[10px]">{row.created_at}</td>
                                </tr>
                              ))}
                              {subReportData.length === 0 && (
                                <tr>
                                  <td colSpan={8} className="py-12 text-center text-xs font-bold text-gray-400 uppercase">No substitute logs found.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {substituteTimetablePreview && (
                      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
                        onClick={(e) => { if (e.target === e.currentTarget) setSubstituteTimetablePreview(null); }}>
                        <div className="w-full max-w-5xl rounded-[2rem] border border-gray-100 bg-white p-5 shadow-2xl">
                          <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="text-sm font-black uppercase tracking-wider text-gray-900">Substitute Timetable Preview</h3>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Ready to share on WhatsApp</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {substituteTimetablePreview.imageUrl && (
                                <button onClick={shareSubstituteTimetableImage}
                                  className="rounded-xl bg-[#0d9488] px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white shadow-md shadow-[#0d9488]/15 transition-all hover:bg-[#0a7a70]">
                                  Share to WhatsApp
                                </button>
                              )}
                              {substituteTimetablePreview.imageUrl && (
                                <button onClick={downloadSubstituteTimetableImage}
                                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 transition-all hover:bg-gray-50">
                                  Download PNG
                                </button>
                              )}
                              <button onClick={() => setSubstituteTimetablePreview(null)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 transition-all hover:bg-gray-50">
                                Close
                              </button>
                            </div>
                          </div>

                          <div className="mt-5 max-h-[72vh] overflow-auto rounded-2xl border border-gray-100 bg-gray-50 p-3">
                            {substituteTimetablePreview.imageUrl ? (
                              <img src={substituteTimetablePreview.imageUrl} alt="Substitute timetable" className="mx-auto h-auto w-full max-w-[900px] bg-white shadow-sm" />
                            ) : (
                              <div className="flex min-h-80 flex-col items-center justify-center text-center">
                                <p className="max-w-md text-sm font-bold text-red-500">{substituteTimetableError || "The timetable image could not be generated."}</p>
                                <button onClick={retrySubstituteTimetableImage}
                                  className="mt-4 rounded-xl bg-[#0d9488] px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-[#0a7a70]">
                                  Retry Image Generation
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Popover Assigning Modal */}
                    {assigningPeriod && (
                      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
                        onClick={(e) => { if (e.target === e.currentTarget) { setAssigningPeriod(null); setAssigningTeacher(null); } }}>
                        <div className="w-full max-w-md rounded-[2rem] border border-gray-100 bg-white p-6 shadow-2xl space-y-4">
                          <div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black uppercase tracking-widest text-[#0d9488] bg-[#0d9488]/10 px-3 py-1 rounded-xl">
                                {assigningTeacher ? "Select Subject" : "Assign Substitute"}
                              </span>
                              <button onClick={() => { setAssigningPeriod(null); setAssigningTeacher(null); }} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
                            </div>
                            <h3 className="text-lg font-black text-gray-900 mt-3">{assigningPeriod.class} • {assigningPeriod.period}</h3>
                            <p className="text-xs text-gray-500 mt-1">Scheduled for <strong>{assigningPeriod.original_teacher_name}</strong> ({assigningPeriod.subject})</p>
                          </div>

                          {/* Step indicator */}
                          <div className="flex items-center gap-2">
                            <div className={`flex-1 h-1.5 rounded-full transition-colors ${!assigningTeacher ? 'bg-[#0d9488]' : 'bg-[#0d9488]/20'}`}></div>
                            <div className={`flex-1 h-1.5 rounded-full transition-colors ${assigningTeacher ? 'bg-[#0d9488]' : 'bg-gray-100'}`}></div>
                          </div>

                          {/* Step 1: Teacher Selection */}
                          {!assigningTeacher && (
                            <div className="border-t border-gray-100 pt-3">
                              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Step 1 — Select Teacher</p>
                              {assigningPeriod.available_teachers.length === 0 ? (
                                <p className="py-6 text-center text-xs font-bold text-red-400 uppercase">No teachers available without conflicts.</p>
                              ) : (
                                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                                  {[...assigningPeriod.available_teachers].sort((a, b) => {
                                    const aSubjects = a.matched_subjects || (a.matched_subject ? [a.matched_subject] : []);
                                    const bSubjects = b.matched_subjects || (b.matched_subject ? [b.matched_subject] : []);
                                    return bSubjects.length - aSubjects.length;
                                  }).map(teacher => {
                                    const subjects = teacher.matched_subjects || (teacher.matched_subject ? [teacher.matched_subject] : []);

                                    return (
                                      <button key={teacher.id}
                                        onClick={() => {
                                          if (subjects.length === 1) {
                                            // Only one subject — assign directly
                                            setTemporaryAssignments(prev => ({
                                              ...prev,
                                              [assigningPeriod.key]: {
                                                substitute_teacher_id: teacher.id,
                                                subject: subjects[0]
                                              }
                                            }));
                                            setAssigningPeriod(null);
                                            setAssigningTeacher(null);
                                          } else {
                                            // Multiple subjects — show subject picker
                                            setAssigningTeacher({ ...teacher, subjects });
                                          }
                                        }}
                                        className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-white hover:bg-emerald-50/50 hover:border-emerald-200 transition-all text-left group">
                                        <div className="min-w-0">
                                          <p className="text-sm font-bold text-gray-700 group-hover:text-emerald-800">{teacher.name}</p>
                                          <p className="text-[9px] font-semibold text-gray-300 mt-0.5">{(teacher.matched_subjects || []).length} subject{(teacher.matched_subjects || []).length !== 1 ? 's' : ''} available</p>
                                        </div>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-300 group-hover:text-emerald-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Step 2: Subject Selection */}
                          {assigningTeacher && (
                            <div className="border-t border-gray-100 pt-3">
                              <button onClick={() => setAssigningTeacher(null)} className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 hover:text-gray-600 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                                </svg>
                                Back to Teachers
                              </button>
                              <div className="flex items-center gap-3 mb-3 p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
                                <div className="w-8 h-8 rounded-full bg-[#1e3a8a] to-blue-500 flex items-center justify-center text-[10px] font-black text-white shrink-0">
                                  {(assigningTeacher.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                                </div>
                                <p className="text-sm font-bold text-emerald-800">{assigningTeacher.name}</p>
                              </div>
                              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Step 2 — Select Subject</p>
                              <div className="space-y-1.5">
                                {assigningTeacher.subjects.map((subj, idx) => (
                                  <button key={idx}
                                    onClick={() => {
                                      setTemporaryAssignments(prev => ({
                                        ...prev,
                                        [assigningPeriod.key]: {
                                          substitute_teacher_id: assigningTeacher.id,
                                          subject: subj
                                        }
                                      }));
                                      setAssigningPeriod(null);
                                      setAssigningTeacher(null);
                                    }}
                                    className="w-full p-3 rounded-xl border border-gray-100 bg-white hover:bg-emerald-50/50 hover:border-emerald-200 transition-all text-left group flex items-center justify-between">
                                    <span className="text-sm font-bold text-gray-700 group-hover:text-emerald-800">{subj}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-300 group-hover:text-emerald-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {temporaryAssignments[assigningPeriod.key] && (
                            <button onClick={() => {
                              setTemporaryAssignments(prev => {
                                const copy = { ...prev };
                                delete copy[assigningPeriod.key];
                                return copy;
                              });
                              setAssigningPeriod(null);
                              setAssigningTeacher(null);
                            }}
                              className="w-full rounded-xl border border-red-200 hover:bg-red-50 text-red-500 py-3 text-xs font-black uppercase tracking-wider transition-all">
                              Clear Assignment
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {reportType === "overview" && (
                  <>{/* 5. Live Daily Monitoring */}
                    <div className="space-y-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center px-1 pt-6 border-t border-gray-100">
                        <div>
                          <h3 className="font-black text-gray-800 tracking-tight text-lg">Live Daily Monitoring</h3>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">Tap any period for details</p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <button
                            onClick={() => setDailyRefreshTs(Date.now())}
                            className="h-11 px-4 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition-all border border-blue-100 shadow-sm font-black text-sm"
                            title="Refresh"
                          >
                            Refresh
                          </button>
                          <input
                            type="date"
                            className="h-11 text-sm font-black text-blue-600 bg-gray-50 px-4 rounded-2xl border border-gray-100 uppercase tracking-widest cursor-pointer focus:ring-2 focus:ring-blue-100"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                          />
                        </div>
                      </div>

                      {loadingFeature && !dailyReportData ? (
                        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-blue-600 border-t-transparent shadow-sm"></div></div>
                      ) : Array.isArray(dailyReportData) && dailyReportData.length > 0 ? (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                          {dailyReportData.map((item, idx) => (
                            <div key={idx} className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm transition-all hover:shadow-lg hover:border-blue-100 group min-w-0">
                              <div className="flex items-center justify-between gap-3 mb-4 border-b border-gray-50 pb-3">
                                <span className="font-black text-sm text-gray-800 bg-gray-50 px-3 py-1 rounded-full group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{item.class}</span>
                                <span className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] self-center">Daily Status</span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                                {(Array.isArray(item.periods) ? item.periods : []).map((p, pIdx) => {
                                  const isClickable = p.scheduled || p.taken;
                                  return (
                                    <button
                                      key={pIdx}
                                      onClick={() => isClickable && openPeriodModal(item.class, p.period, selectedDate)}
                                      className={`min-h-16 rounded-2xl flex flex-col items-center justify-center border transition-all ${isClickable
                                        ? 'cursor-pointer hover:shadow-md'
                                        : 'cursor-default opacity-50 bg-gray-100 border-gray-100 pointer-events-none'
                                        } group/cell ${p.taken
                                          ? 'bg-green-50 border-green-200'
                                          : p.scheduled
                                            ? 'bg-red-50 border-red-100'
                                            : ''
                                        }`}
                                    >
                                      <span className={`text-[10px] font-black uppercase tracking-widest ${p.taken ? 'text-green-700' : p.scheduled ? 'text-red-400' : 'text-gray-400'}`}>{p.period}</span>
                                      <span className="text-xl mt-1 select-none text-gray-300">
                                        {p.taken ? '✅' : p.scheduled ? '⏳' : '—'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-20 bg-gray-50/30 rounded-[2.5rem] border border-dashed border-gray-200">
                          <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">No records found for this date</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "permission_manager" && canUsePermissionManager(user) && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="rounded-3xl p-6" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white">Permission Manager</h2>
                  <p className="text-xs text-white/50 font-medium mt-1">Create and track outpass and leave card requests</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["new", "New Permission"],
                    ...(canApprovePermissions(user) ? [["pending", "Pending Approvals"]] : []),
                    ["active", "Active Leave Cards"],
                    ["history", "Permission History"],
                  ].map(([id, label]) => (
                    <button key={id} onClick={() => handlePermissionViewChange(id)}
                      className={`w-full sm:w-auto text-center rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${permissionView === id ? "bg-white text-[#0a505c] shadow-md" : "bg-white/10 text-white/70 hover:bg-white/15"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {permissionMessage && (
              <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm font-bold text-teal-800">
                {permissionMessage}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 bg-gray-50/50 p-2.5 rounded-2xl border border-gray-100">
              {[
                ["Pending", permissionSummary.pendingApprovals || 0, "⏳"],
                ["Outpasses", permissionSummary.todaysOutpasses || 0, "🎒"],
                ["Leaves", permissionSummary.activeLeaveCards || 0, "🏠"],
                ["Today's", permissionSummary.todaysPermissions || 0, "📋"],
              ].map(([label, value, icon]) => (
                <div key={label} className="bg-white rounded-xl p-2 text-center shadow-sm border border-gray-50">
                  <p className="text-sm font-black text-[#0a505c] flex items-center justify-center gap-1">
                    <span className="text-xs">{icon}</span>
                    {value}
                  </p>
                  <p className="text-[7px] font-black uppercase tracking-wider text-gray-400 mt-0.5 truncate">{label}</p>
                </div>
              ))}
            </div>

            {permissionView === "new" ? (
              <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm space-y-6">
                {/* Step Indicators */}
                <div className="flex items-center justify-center gap-4 border-b border-gray-50 pb-4">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${!permissionForm.student_id ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"}`}>1</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-800">Select Student</span>
                  </div>
                  <div className="h-0.5 w-12 bg-gray-100" />
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${permissionForm.student_id ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-400"}`}>2</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${permissionForm.student_id ? "text-gray-800" : "text-gray-400"}`}>Details & Save</span>
                  </div>
                </div>

                {/* STEP 1: SELECT STUDENT */}
                <div className="space-y-4">
                  {!permissionForm.student_id ? (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Step 1: Search Student</label>
                      <div className="relative mt-2">
                        <input value={permissionSearch} onChange={(e) => setPermissionSearch(e.target.value)}
                          placeholder="Type student name, roll or class to search..."
                          className={`w-full rounded-2xl border bg-gray-50 pl-11 pr-4 py-3.5 text-sm font-bold outline-none transition-all ${permissionErrors.student_id ? "border-red-500 bg-red-50/50 ring-2 ring-red-100" : "border-gray-100 focus:border-teal-200 focus:ring-2 focus:ring-teal-100"}`} />
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                      </div>
                      {permissionSearch.trim() !== "" && (
                        <div className="mt-2 max-h-60 overflow-y-auto rounded-2xl border border-gray-100 divide-y divide-gray-50 bg-white shadow-inner">
                          {filteredPermissionStudents.map((student) => (
                            <button type="button" key={student.id}
                              onClick={() => {
                                setPermissionForm(prev => ({ ...prev, student_id: String(student.id) }));
                                setPermissionSearch("");
                                setPermissionErrors(prev => ({ ...prev, student_id: false }));
                              }}
                              className="w-full flex items-center gap-3 p-3 text-left transition-all hover:bg-teal-50/50">
                              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-900 text-[10px] font-black text-white">{student.rollNo}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-black text-gray-800">{student.name}</span>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Class {student.class}</span>
                              </span>
                            </button>
                          ))}
                          {filteredPermissionStudents.length === 0 && (
                            <div className="p-6 text-center text-xs font-bold text-gray-400">No students found matching your search.</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-teal-100 bg-teal-50/30 p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-600 text-[12px] font-black text-white">
                          {selectedPermissionStudent?.rollNo}
                        </span>
                        <div>
                          <p className="text-sm font-black text-gray-800 flex items-center gap-1.5">
                            {selectedPermissionStudent?.name}
                            <span className="text-teal-600">✓</span>
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Class {selectedPermissionStudent?.class} • Roll {selectedPermissionStudent?.rollNo}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setPermissionForm(prev => ({ ...prev, student_id: "" }))}
                        className="rounded-xl bg-white border border-gray-150 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-red-500 transition-colors">
                        Change Student
                      </button>
                    </div>
                  )}
                </div>

                {/* STEP 2: DETAILS & SAVE */}
                {permissionForm.student_id && (
                  <div className="space-y-4 pt-4 border-t border-gray-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Step 2: Permission Details</label>
                      <div className="flex rounded-full bg-gray-100 p-0.5">
                        {["Outpass", "Leave Card"].map((type) => (
                          <button key={type} type="button"
                            onClick={() => setPermissionForm(prev => ({ ...prev, permission_type: type }))}
                            className={`rounded-full px-4 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${permissionForm.permission_type === type ? "bg-teal-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
                            {type.replace(" Card", "")}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Date/Time Row */}
                    {permissionForm.permission_type === "Outpass" ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Leaving Time</label>
                          <div className="flex gap-1.5 mt-1.5">
                            {(() => {
                              const { hour, minute, period } = parseTimeTo12HrParts(permissionForm.leaving_time);
                              return (
                                <>
                                  <select value={hour} 
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(e.target.value, minute, period);
                                      setPermissionForm(prev => ({ ...prev, leaving_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, leaving_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.leaving_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(h => (
                                      <option key={h} value={h}>{h}</option>
                                    ))}
                                  </select>
                                  <select value={minute}
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(hour, e.target.value, period);
                                      setPermissionForm(prev => ({ ...prev, leaving_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, leaving_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.leaving_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                  <select value={period}
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(hour, minute, e.target.value);
                                      setPermissionForm(prev => ({ ...prev, leaving_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, leaving_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.leaving_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                  </select>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Returning Time</label>
                          <div className="flex gap-1.5 mt-1.5">
                            {(() => {
                              const { hour, minute, period } = parseTimeTo12HrParts(permissionForm.expected_return_time);
                              return (
                                <>
                                  <select value={hour} 
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(e.target.value, minute, period);
                                      setPermissionForm(prev => ({ ...prev, expected_return_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, expected_return_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.expected_return_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(h => (
                                      <option key={h} value={h}>{h}</option>
                                    ))}
                                  </select>
                                  <select value={minute}
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(hour, e.target.value, period);
                                      setPermissionForm(prev => ({ ...prev, expected_return_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, expected_return_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.expected_return_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                  <select value={period}
                                    onChange={(e) => {
                                      const newTime = formatPartsTo24Hr(hour, minute, e.target.value);
                                      setPermissionForm(prev => ({ ...prev, expected_return_time: newTime }));
                                      setPermissionErrors(prev => ({ ...prev, expected_return_time: false }));
                                    }}
                                    className={`flex-1 rounded-xl border bg-gray-50 px-2 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.expected_return_time ? "border-red-500 bg-red-50" : "border-gray-100 focus:border-teal-200"}`}>
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                  </select>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Leaving Date</label>
                        <input type="date" value={permissionForm.leaving_date} 
                          onChange={(e) => {
                            setPermissionForm(prev => ({ ...prev, leaving_date: e.target.value }));
                            setPermissionErrors(prev => ({ ...prev, leaving_date: false }));
                          }}
                          className={`mt-1.5 w-full rounded-xl border px-3.5 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.leaving_date ? "border-red-500 bg-red-50/50 ring-2 ring-red-100" : "border-gray-100 bg-gray-50 focus:border-teal-200 focus:bg-white"}`} />
                      </div>
                    )}

                    {/* Reason Picker presets */}
                    <div className={`p-4 rounded-2xl border transition-all ${permissionErrors.reason ? "border-red-500 bg-red-50/10 ring-2 ring-red-100" : "border-gray-100 bg-white"}`}>
                      <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Reason</label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {["Hospital", "Purchase", "Native Place", "Passport Office", "Emergency", "Other"].map((reason) => (
                          <button type="button" key={reason} 
                            onClick={() => {
                              setPermissionForm(prev => ({ ...prev, reason }));
                              setPermissionErrors(prev => ({ ...prev, reason: false }));
                            }}
                            className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${permissionForm.reason === reason ? "border-teal-300 bg-teal-50 text-teal-700 font-black shadow-sm" : "border-gray-100 bg-white text-gray-400 hover:text-gray-600"}`}>
                            {reason}
                          </button>
                        ))}
                      </div>

                      {permissionForm.reason === "Other" && (
                        <input value={permissionForm.custom_reason} 
                          onChange={(e) => {
                            setPermissionForm(prev => ({ ...prev, custom_reason: e.target.value }));
                            setPermissionErrors(prev => ({ ...prev, reason: false }));
                          }}
                          placeholder="Type the specific reason here..."
                          className={`mt-3 w-full rounded-xl border px-3.5 py-3 text-sm font-bold outline-none transition-all ${permissionErrors.reason ? "border-red-500 bg-red-50" : "border-gray-100 bg-gray-50 focus:border-teal-200 focus:bg-white"}`} />
                      )}
                    </div>

                    {/* More Options (Shown Directly - Highlighted) */}
                    <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-amber-50/40 border border-amber-200/50">
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-amber-800 flex items-center gap-1">Attendance Status ⚠️</label>
                        <select value={permissionForm.attendance_status} onChange={(e) => setPermissionForm(prev => ({ ...prev, attendance_status: e.target.value }))}
                          className="mt-1.5 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-teal-200">
                          <option>Absent</option>
                          <option>Special Leave</option>
                        </select>
                        <p className="text-[8px] text-amber-600 font-bold mt-1 leading-tight">Marks student absent during this entire duration</p>
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Remarks (Optional)</label>
                        <input placeholder="Any extra note..." value={permissionForm.remarks} onChange={(e) => setPermissionForm(prev => ({ ...prev, remarks: e.target.value }))}
                          className="mt-1.5 w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-teal-200" />
                      </div>
                    </div>

                    <button type="button" onClick={handleCreatePermission}
                      className="mt-4 w-full rounded-2xl bg-[#0d9488] px-5 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-teal-100 transition-all hover:bg-[#0b7a70] active:scale-[0.98]">
                      Save & Approve Request
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {permissionView === "history" && (
                  <div className="space-y-4">
                    {/* Step 1: Select Type */}
                    {!historyType && (
                      <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm text-center space-y-4 animate-in fade-in duration-200">
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Select History Type</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <button type="button" onClick={() => setHistoryType("Outpass")}
                            className="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 hover:bg-teal-50/30 hover:border-teal-200 transition-all flex flex-col items-center gap-2 group">
                            <span className="text-3xl group-hover:scale-110 transition-transform">🎒</span>
                            <span className="text-sm font-black text-gray-800">Outpass History</span>
                          </button>
                          <button type="button" onClick={() => setHistoryType("Leave Card")}
                            className="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 hover:bg-teal-50/30 hover:border-teal-200 transition-all flex flex-col items-center gap-2 group">
                            <span className="text-3xl group-hover:scale-110 transition-transform">🏠</span>
                            <span className="text-sm font-black text-gray-800">Leave Card History</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Select Student */}
                    {historyType && !historyStudentId && (
                      <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center justify-between">
                          <button type="button" onClick={() => { setHistoryType(""); setHistorySearch(""); }} className="text-xs font-black text-gray-400 hover:text-gray-600 flex items-center gap-1">
                            ← Back
                          </button>
                          <span className="text-[10px] font-black uppercase tracking-widest text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full">{historyType} History</span>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Search Student</label>
                          <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                            placeholder="Type student name or roll number..."
                            className="mt-2 w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-sm font-bold outline-none focus:border-teal-200 focus:ring-2 focus:ring-teal-100" />
                        </div>
                        {historySearch.trim() !== "" && (
                          <div className="rounded-2xl border border-gray-50 divide-y divide-gray-50 bg-white overflow-hidden shadow-inner">
                            {historyStudents
                              .filter(s => `${s.name} ${s.rollNo} ${s.class}`.toLowerCase().includes(historySearch.toLowerCase()))
                              .slice(0, 3)
                              .map((student) => (
                                <button type="button" key={student.id}
                                  onClick={() => {
                                    setHistoryStudentId(String(student.id));
                                    const customFilters = {
                                      permission_type: historyType,
                                      student: student.name,
                                      class: "",
                                      from_date: "",
                                      to_date: "",
                                      permission_number: "",
                                      attendance_status: "",
                                      created_by: "",
                                      approved_by: "",
                                      reason: ""
                                    };
                                    fetchPermissionRecords("history", customFilters);
                                  }}
                                  className="w-full flex items-center justify-between p-4 text-left transition-all hover:bg-teal-50/40">
                                  <div className="flex items-center gap-3">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-900 text-[10px] font-black text-white">{student.rollNo}</span>
                                    <div>
                                      <span className="block text-sm font-black text-gray-800">{student.name}</span>
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Class {student.class}</span>
                                    </div>
                                  </div>
                                  <span className="text-xs text-teal-600 font-bold">Select →</span>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Step 3: Show Document List */}
                    {historyType && historyStudentId && (
                      <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-150 p-4 shadow-sm">
                          <button type="button" onClick={() => { setHistoryStudentId(""); setHistorySearch(""); }} className="text-xs font-black text-gray-400 hover:text-gray-600 flex items-center gap-1">
                            ← Change Student
                          </button>
                          {(() => {
                            const student = permissionStudents.find(s => String(s.id) === String(historyStudentId));
                            return student ? (
                              <span className="text-[10px] font-black text-teal-700 bg-teal-50 px-3 py-1 rounded-full uppercase tracking-wider">
                                {student.name} (Class {student.class})
                              </span>
                            ) : null;
                          })()}
                        </div>

                        {/* Tabular List (Excel style but highly professional) */}
                        <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-sm max-h-[380px] overflow-y-auto">
                          <table className="w-full border-collapse text-left text-xs font-bold text-gray-700 table-fixed">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-500 sticky top-0 bg-white z-10">
                                <th className="px-4 py-3 border-r border-gray-200 w-1/4">Date</th>
                                <th className="px-4 py-3 border-r border-gray-200 w-[40%]">Reason</th>
                                <th className="px-4 py-3 border-r border-gray-200 w-1/4">Approved by</th>
                                <th className="px-4 py-3 text-center w-[10%]">status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loadingPermissions ? (
                                <tr>
                                  <td colSpan={4} className="p-12 text-center">
                                    <div className="h-8 w-8 mx-auto animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent" />
                                  </td>
                                </tr>
                              ) : (() => {
                                const rows = [...permissionRecords];
                                while (rows.length < 10) {
                                  rows.push({ id: `empty-${rows.length}`, isEmptyPlaceholder: true });
                                }
                                return rows.map((record) => {
                                  if (record.isEmptyPlaceholder) {
                                    return (
                                      <tr key={record.id} className="border-b border-gray-200 h-[38px] select-none pointer-events-none">
                                        <td className="px-4 py-2 border-r border-gray-200">&nbsp;</td>
                                        <td className="px-4 py-2 border-r border-gray-200">&nbsp;</td>
                                        <td className="px-4 py-2 border-r border-gray-200">&nbsp;</td>
                                        <td className="px-4 py-2">&nbsp;</td>
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={record.id} 
                                      onClick={() => setHistorySelectedRecord(record)}
                                      className="border-b border-gray-200 hover:bg-teal-50/20 active:bg-teal-50/40 transition-colors cursor-pointer h-[38px]">
                                      <td className="px-4 py-2 border-r border-gray-200 font-bold text-gray-800 truncate">
                                        {record.permissionType === "Outpass" ? (record.createdDate || "-") : (record.leavingDate || "-")}
                                      </td>
                                      <td className="px-4 py-2 border-r border-gray-200 truncate text-gray-600">
                                        {record.reason || "-"}
                                      </td>
                                      <td className="px-4 py-2 border-r border-gray-200 truncate text-gray-600">
                                        {record.approvedByName || record.approvedRole || "Pending"}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <span className={`inline-block rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                          record.status === "Approved" || record.status === "Closed" ? "bg-emerald-50 text-emerald-700" :
                                          record.status.includes("Pending") ? "bg-amber-50 text-amber-700" :
                                          "bg-red-50 text-red-700"
                                        }`}>{record.status}</span>
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Detailed Card Modal / Overlay */}
                    {historySelectedRecord && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setHistorySelectedRecord(null)}>
                        <div className="w-full max-w-md rounded-[2.5rem] bg-white p-6 shadow-2xl space-y-4 border border-gray-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                            <span className="rounded-lg bg-gray-900 px-2 py-1 text-[9px] font-black text-white uppercase tracking-wider">{historySelectedRecord.permissionNumber}</span>
                            <button type="button" onClick={() => setHistorySelectedRecord(null)} className="text-xl font-black text-gray-400 hover:text-gray-650">×</button>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Student</p>
                              <p className="text-sm font-black text-gray-800 mt-0.5">{historySelectedRecord.studentName} (Class {historySelectedRecord.class})</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-xs font-bold text-gray-700">
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Type</p>
                                <p className="mt-0.5 text-gray-800">{historySelectedRecord.permissionType}</p>
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Attendance Status</p>
                                <p className="mt-0.5 text-gray-800">{historySelectedRecord.attendanceStatus}</p>
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Reason</p>
                                <p className="mt-0.5 text-gray-800">{historySelectedRecord.reason || "-"}</p>
                              </div>
                              {historySelectedRecord.permissionType === "Outpass" ? (
                                <>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Leaving Time</p>
                                    <p className="mt-0.5 text-gray-800">{historySelectedRecord.leavingTime ? formatTo12Hr(historySelectedRecord.leavingTime) : "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Expected Return</p>
                                    <p className="mt-0.5 text-gray-800">{historySelectedRecord.expectedReturnTime ? formatTo12Hr(historySelectedRecord.expectedReturnTime) : "-"}</p>
                                  </div>
                                </>
                              ) : (
                                <div>
                                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Leaving Date</p>
                                  <p className="mt-0.5 text-gray-800">{historySelectedRecord.leavingDate ? formatDate(historySelectedRecord.leavingDate) : "-"}</p>
                                </div>
                              )}
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Created By</p>
                                <p className="mt-0.5 text-gray-800 truncate">{historySelectedRecord.createdByName || historySelectedRecord.createdByRole || "-"}</p>
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Approved By</p>
                                <p className="mt-0.5 text-gray-800 truncate">{historySelectedRecord.approvedByName || historySelectedRecord.approvedRole || "-"}</p>
                              </div>
                              {(historySelectedRecord.returnedTeacherTime || historySelectedRecord.returnedPrincipalTime) && (
                                <>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Teacher Return</p>
                                    <p className="mt-0.5 text-gray-800">{historySelectedRecord.returnedTeacherTime ? formatTo12Hr(historySelectedRecord.returnedTeacherTime) : "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Final Return</p>
                                    <p className="mt-0.5 text-gray-800">{historySelectedRecord.returnedPrincipalTime ? formatTo12Hr(historySelectedRecord.returnedPrincipalTime) : "-"}</p>
                                  </div>
                                </>
                              )}
                            </div>

                            {historySelectedRecord.remarks && (
                              <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Remarks</p>
                                <p className="mt-1 text-xs italic font-bold text-gray-600">"{historySelectedRecord.remarks}"</p>
                              </div>
                            )}

                            {/* Verification Seals */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3 text-center">Verification Seals</p>
                              <div className="grid grid-cols-2 gap-4 text-center">
                                <div className="flex flex-col items-center gap-2">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Class Teacher</span>
                                  <StampSeal 
                                    name={historySelectedRecord.createdByName || historySelectedRecord.createdBy} 
                                    date={historySelectedRecord.createdDate} 
                                    color="text-blue-800" 
                                  />
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Principal</span>
                                  <StampSeal 
                                    name={historySelectedRecord.approvedByName || historySelectedRecord.approvedBy} 
                                    date={historySelectedRecord.approvedTime ? historySelectedRecord.approvedTime.split(" ")[0] : null} 
                                    color="text-emerald-800" 
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          <button type="button" onClick={() => setHistorySelectedRecord(null)}
                            className="w-full py-4 rounded-2xl bg-gray-900 hover:bg-black text-white text-xs font-black uppercase tracking-widest transition-colors active:scale-95">
                            Close Details
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {permissionView !== "history" && (
                  <div className="space-y-4">
                    <div className="rounded-[2rem] border border-gray-100 bg-white shadow-sm overflow-hidden">
                      {loadingPermissions ? (
                        <div className="flex justify-center p-12"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent" /></div>
                      ) : permissionRecords.length === 0 ? (
                        <div className="p-12 text-center text-xs font-black uppercase tracking-widest text-gray-400">No active records found.</div>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {permissionRecords.map((record) => (
                            <div key={record.id} className="p-4 sm:p-5 flex flex-col gap-4 bg-white rounded-3xl border border-gray-100 hover:border-teal-100 hover:shadow-md transition-all">
                              {/* Card Header */}
                              <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="rounded-lg bg-gray-900 px-2 py-1 text-[9px] font-black text-white uppercase tracking-wider">{record.permissionNumber}</span>
                                    <span className="rounded-lg bg-teal-50 px-2 py-1 text-[9px] font-black text-teal-700 uppercase tracking-wider">{record.permissionType}</span>
                                    <span className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                                      record.status === "Approved" || record.status === "Closed" ? "bg-emerald-50 text-emerald-700" :
                                      record.status.includes("Pending") ? "bg-amber-50 text-amber-700" :
                                      "bg-red-50 text-red-700"
                                    }`}>{record.status}</span>
                                  </div>
                                  <p className="mt-2 text-sm font-black text-gray-900">{record.studentName} <span className="text-gray-400 font-bold">/ Class {record.class}</span></p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Attendance Status</p>
                                  <span className="mt-1 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-black text-amber-800 border border-amber-200/50">{record.attendanceStatus}</span>
                                </div>
                              </div>

                              {/* Info Grid */}
                              <div className="grid grid-cols-2 gap-4 text-xs font-bold text-gray-700 sm:grid-cols-3 md:grid-cols-4">
                                <div>
                                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Reason</p>
                                  <p className="mt-1 text-gray-800">{record.reason || "-"}</p>
                                </div>
                                {record.permissionType === "Outpass" ? (
                                  <>
                                    <div>
                                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Leaving Time</p>
                                      <p className="mt-1 text-gray-800">{record.leavingTime ? formatTo12Hr(record.leavingTime) : "-"}</p>
                                    </div>
                                    <div>
                                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Expected Return</p>
                                      <p className="mt-1 text-gray-800">{record.expectedReturnTime ? formatTo12Hr(record.expectedReturnTime) : "-"}</p>
                                    </div>
                                  </>
                                ) : (
                                  <div>
                                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Leaving Date</p>
                                    <p className="mt-1 text-gray-800">{record.leavingDate ? formatDate(record.leavingDate) : "-"}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Created Date</p>
                                  <p className="mt-1 text-gray-800">{record.createdDate ? formatDate(record.createdDate) : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Created By</p>
                                  <p className="mt-1 text-gray-800 truncate">{record.createdByName || record.createdByRole || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Approved By</p>
                                  <p className="mt-1 text-gray-800 truncate">{record.approvedByName || record.approvedRole || "-"}</p>
                                </div>
                                {(record.returnedTeacherTime || record.returnedPrincipalTime) && (
                                  <>
                                    <div>
                                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Teacher Return</p>
                                      <p className="mt-1 text-gray-800">{record.returnedTeacherTime ? formatTo12Hr(record.returnedTeacherTime) : "-"}</p>
                                    </div>
                                    <div>
                                      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Final Return</p>
                                      <p className="mt-1 text-gray-800">{record.returnedPrincipalTime ? formatTo12Hr(record.returnedPrincipalTime) : "-"}</p>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Remarks Block */}
                              {record.remarks && (
                                <div className="rounded-xl bg-gray-50 p-3 border border-gray-150">
                                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Remarks</p>
                                  <p className="mt-1 text-xs italic font-bold text-gray-600">"{record.remarks}"</p>
                                </div>
                              )}

                              {/* Action Controls */}
                              {permissionView === "pending" && canApprovePermissions(user) && (
                                <div className="flex gap-2 border-t border-gray-50 pt-3">
                                  <button disabled={permissionActionBusyId === record.id} onClick={() => handleApprovePermission(record.id)} className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-emerald-700 active:scale-95 transition-all">Approve</button>
                                  <button disabled={permissionActionBusyId === record.id} onClick={() => handleRejectPermission(record.id)} className="flex-1 rounded-2xl bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-red-600 disabled:opacity-50 hover:bg-red-100 active:scale-95 transition-all">Reject</button>
                                </div>
                              )}

                              {permissionView === "active" && record.permissionType === "Leave Card" && (
                                <div className="border-t border-gray-50 pt-3 space-y-2">
                                  {user?.role === "Class Teacher" && record.status === "Approved" && !record.returnedTeacherTime && (
                                    <button disabled={permissionActionBusyId === record.id} onClick={() => handleTeacherReturnApproval(record.id)} className="w-full rounded-2xl bg-[#0d9488] px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-[#0b7a70] transition-all">Approve Return</button>
                                  )}
                                  {canApprovePermissions(user) && record.status === "Pending Return Approval" && (
                                    <div className="flex gap-2">
                                      <button disabled={permissionActionBusyId === record.id} onClick={() => handlePrincipalReturnApproval(record.id)} className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-emerald-700 transition-all">Approve Return</button>
                                      <button disabled={permissionActionBusyId === record.id} onClick={() => handlePrincipalReturnReject(record.id)} className="flex-1 rounded-2xl bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-red-600 disabled:opacity-50 hover:bg-red-100 transition-all">Reject Return</button>
                                    </div>
                                  )}
                                  {canApprovePermissions(user) && record.status === "Approved" && (
                                    <button disabled={permissionActionBusyId === record.id} onClick={() => handlePrincipalReturnApproval(record.id)} className="w-full rounded-2xl bg-teal-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-teal-700 transition-all">Mark Return & Close</button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SYLLABUS MANAGEMENT TAB (ADMIN ONLY) ── */}
        {activeTab === "syllabus_management" && user?.role === 'admin' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-lg font-black text-gray-900">📚 Syllabus Management</h4>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">Configure academic year syllabus ranges and targets</p>
                </div>
                <button
                  onClick={() => {
                    setSyllabusFormData({
                      id: null,
                      class: "",
                      subject: "",
                      teacher_id: "",
                      academic_year: new Date().getFullYear().toString(),
                      semester: "Semester 1",
                      book_name: "",
                      start_page: "",
                      end_page: "",
                    });
                    setSyllabusMonthTargets({
                      June: "", July: "", August: "", September: "", October: "", November: "", December: "",
                      January: "", February: "", March: "", April: "", May: ""
                    });
                    setSyllabusPopupOpen(true);
                  }}
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-100"
                >
                  ➕ Add Target Config
                </button>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Class</label>
                  <select
                    value={selectedSyllabusClassFilter}
                    onChange={(e) => setSelectedSyllabusClassFilter(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                  >
                    <option value="">All Classes</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Teacher</label>
                  <select
                    value={selectedSyllabusTeacherFilter}
                    onChange={(e) => setSelectedSyllabusTeacherFilter(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                  >
                    <option value="">All Teachers</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Config List */}
            {loadingSyllabus ? (
              <div className="py-20 text-center animate-pulse text-xs font-bold text-gray-400">Loading configurations...</div>
            ) : syllabusConfigs.length === 0 ? (
              <div className="bg-white p-12 rounded-[2.5rem] border border-gray-100 text-center">
                <p className="text-xs font-bold text-gray-400 italic">No syllabus configurations found.</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {syllabusConfigs.map(config => {
                  const labels = getTrackingLabels(config.trackingType);
                  return (
                  <div key={config.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-black uppercase tracking-wider">{config.class}</span>
                        <span className="px-3 py-1 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 text-[10px] font-black uppercase tracking-wider">{config.semester}</span>
                        <span className="px-3 py-1 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-black uppercase tracking-wider">{config.academicYear}</span>
                      </div>
                      <h4 className="font-black text-gray-900 text-base mt-3">{config.subject}</h4>
                      {config.bookName && (
                        <p className="text-xs font-bold text-indigo-500 mt-1 italic">📖 {config.bookName}</p>
                      )}
                      <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">Teacher: {config.teacherName}</p>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-gray-600 bg-gray-50 p-3 rounded-2xl">
                        <div>{labels.start}: <span className="font-black text-gray-800">{config.startPage}</span></div>
                        <div>{labels.end}: <span className="font-black text-gray-800">{config.endPage}</span></div>
                        <div>{labels.total}: <span className="font-black text-gray-800">{config.totalPages}</span></div>
                        <div>{labels.current}: <span className="font-black text-indigo-650">{config.currentPage && config.currentPage !== "-" ? config.currentPage : "No Progress"}</span></div>
                      </div>

                      <div className="mt-3">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{labels.targetPages}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(() => {
                            const monthOrder = ["june", "july", "august", "september", "october", "november", "december", "january", "february", "march", "april", "may"];
                            const currentMonthName = new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Kolkata' }).toLowerCase();

                            return [...(config.targets || [])]
                              .sort((a, b) => monthOrder.indexOf(a.month.toLowerCase()) - monthOrder.indexOf(b.month.toLowerCase()))
                              .map(t => {
                                const isCurrentMonth = t.month.toLowerCase() === currentMonthName;
                                const badgeClass = isCurrentMonth
                                  ? "text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-800 font-extrabold"
                                  : "text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-150 text-gray-600";

                                return (
                                  <span key={t.month} className={badgeClass}>
                                    {t.month}: {t.targetPage}
                                  </span>
                                );
                              });
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-2 border-t border-gray-50">
                      <button
                        onClick={() => {
                          setSyllabusFormData({
                            id: config.id,
                            class: config.class,
                            subject: config.subject,
                            teacher_id: config.teacherId,
                            academic_year: config.academicYear || new Date().getFullYear().toString(),
                            semester: config.semester || "Semester 1",
                            book_name: config.bookName || "",
                            start_page: config.startPage,
                            end_page: config.endPage,
                          });

                          const targetsMap = {};
                          config.targets.forEach(t => {
                            targetsMap[t.month] = t.targetPage;
                          });
                          setSyllabusMonthTargets(prev => ({
                            June: "", July: "", August: "", September: "", October: "", November: "", December: "",
                            January: "", February: "", March: "", April: "", May: "",
                            ...targetsMap
                          }));

                          setSyllabusPopupOpen(true);
                        }}
                        className="p-2.5 rounded-xl border border-gray-150 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all text-xs"
                        title="Edit Config"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteSyllabusConfig(config.id)}
                        className="p-2.5 rounded-xl border border-gray-150 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all text-xs"
                        title="Delete Config"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SYLLABUS OVERVIEW TAB (ADMIN/PRINCIPAL/VP ONLY) ── */}
        {activeTab === "syllabus_overview" && (user?.role === 'admin' || user?.role === 'Principal' || user?.role === 'Vice Principal') && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Toggle Principal/VP Access Button */}
            <div className="bg-white p-4 rounded-[2.2rem] border border-gray-150 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">🔑</span>
                <div>
                  <h5 className="text-xs font-black text-gray-800 uppercase tracking-wider">Principal Admin Controls</h5>
                  <p className="text-[9px] font-bold text-gray-400">Toggle between personal classroom tracking and institution overview</p>
                </div>
              </div>
              <button
                onClick={() => setPrincipalAccessMode(!principalAccessMode)}
                className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all active:scale-95 ${principalAccessMode ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {principalAccessMode ? "🔒 Switch to Teaching View" : "🔓 Enable Principal View"}
              </button>
            </div>

            {principalAccessMode ? (
              <>
                {/* Heatmap summary cards */}
                <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                  <div>
                    <h4 className="text-lg font-black text-gray-900">📊 Syllabus Overview Heatmap</h4>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">Instant status tracking and syllabus performance health</p>
                  </div>

                  {/* Counts */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-4 rounded-3xl">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">🟢 Ahead</p>
                      <p className="text-2xl font-black mt-1">
                        {syllabusConfigs.filter(c => c.statusColor === "Green").length}
                      </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 text-amber-700 p-4 rounded-3xl">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">🟡 On Track</p>
                      <p className="text-2xl font-black mt-1">
                        {syllabusConfigs.filter(c => c.statusColor === "Yellow").length}
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-3xl">
                      <p className="text-[9px] font-black uppercase tracking-widest text-red-500">🔴 Behind</p>
                      <p className="text-2xl font-black mt-1">
                        {syllabusConfigs.filter(c => c.statusColor === "Red").length}
                      </p>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Class</label>
                      <select
                        value={selectedSyllabusClassFilter}
                        onChange={(e) => setSelectedSyllabusClassFilter(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                      >
                        <option value="">All Classes</option>
                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Filter Teacher (By Selected Class)</label>
                      <select
                        value={selectedSyllabusTeacherFilter}
                        onChange={(e) => setSelectedSyllabusTeacherFilter(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none"
                      >
                        <option value="">All Teachers</option>
                        {teachers
                          .filter(t => {
                            if (!selectedSyllabusClassFilter) return true;
                            // Filter teachers who are configured for the selected class
                            const teachersInClass = syllabusConfigs
                              .filter(c => c.class === selectedSyllabusClassFilter)
                              .map(c => c.teacherId);
                            return teachersInClass.includes(t.id);
                          })
                          .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Heatmap Grid monitor */}
                {syllabusConfigs.length > 0 && (
                  <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">Quick Visual Heath Grid</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {syllabusConfigs.map(config => {
                        const indicatorColors = {
                          Green: { bg: "bg-emerald-500", text: "text-white" },
                          Yellow: { bg: "bg-amber-400", text: "text-gray-900" },
                          Red: { bg: "bg-red-500", text: "text-white" }
                        }[config.statusColor] || { bg: "bg-gray-400", text: "text-white" };

                        return (
                          <div key={config.id} className={`${indicatorColors.bg} ${indicatorColors.text} p-4 rounded-[1.75rem] flex flex-col justify-between h-28 shadow-sm transition-all hover:scale-[1.02]`}>
                            <div>
                              <span className="text-[8px] font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">{config.class}</span>
                              <h5 className="font-black text-xs mt-2 line-clamp-1">{config.subject}</h5>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold opacity-90 line-clamp-1">{config.statusMessage}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* List with Detail Analytics */}
                {loadingSyllabus ? (
                  <div className="py-20 text-center animate-pulse text-xs font-bold text-gray-400">Loading configs...</div>
                ) : syllabusConfigs.length === 0 ? (
                  <div className="bg-white p-12 rounded-[2.5rem] border border-gray-100 text-center">
                    <p className="text-xs font-bold text-gray-400 italic">No configurations found.</p>
                  </div>
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    {syllabusConfigs.map(config => {
                      const pct = config.completionPercentage;
                      const labels = getTrackingLabels(config.trackingType);
                      const statusColors = {
                        Green: { text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100", bar: "bg-emerald-500" },
                        Yellow: { text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", bar: "bg-amber-400" },
                        Red: { text: "text-red-500", bg: "bg-red-50", border: "border-red-100", bar: "bg-red-500" }
                      }[config.statusColor] || { text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100", bar: "bg-blue-500" };

                      return (
                        <div key={config.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4 flex flex-col justify-between">
                          <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-black uppercase tracking-wider">{config.class}</span>
                                  <span className="px-3 py-1 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 text-[10px] font-black uppercase tracking-wider">{config.semester}</span>
                                </div>
                                <h4 className="font-black text-gray-900 text-base mt-3">{config.subject}</h4>
                                {config.bookName && (
                                  <p className="text-xs font-bold text-indigo-500 mt-1 italic">📖 {config.bookName}</p>
                                )}
                                <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">Teacher: {config.teacherName}</p>
                              </div>

                              <div className="relative flex items-center justify-center h-14 w-14 shrink-0">
                                <svg className="absolute w-full h-full transform -rotate-90">
                                  <circle cx="28" cy="28" r="22" stroke="#f3f4f6" strokeWidth="5" fill="transparent" />
                                  <circle cx="28" cy="28" r="22" stroke={config.statusColor === "Green" ? "#10b981" : config.statusColor === "Red" ? "#ef4444" : "#fbbf24"} strokeWidth="5" fill="transparent"
                                    strokeDasharray={2 * Math.PI * 22}
                                    strokeDashoffset={2 * Math.PI * 22 * (1 - Math.min(100, pct) / 100)}
                                  />
                                </svg>
                                <span className="text-xs font-black text-gray-800 relative z-10">{Math.round(pct)}%</span>
                              </div>
                            </div>

                            <div className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider border flex items-center gap-2 ${statusColors.bg} ${statusColors.text} ${statusColors.border}`}>
                              <span>{config.statusColor === "Green" ? "✅" : config.statusColor === "Red" ? "⚠️" : "ℹ️"}</span>
                              <span>{config.statusMessage}</span>
                            </div>

                            {(() => {
                              const mTargetTotal = Math.max(1, Number(config.targetPage) - Number(config.startPage) + 1);
                              const mCompleted = Math.max(0, (config.currentPage === "-" ? 0 : Number(config.currentPage)) - Number(config.startPage) + 1);
                              const mPct = config.targetPage !== "-" && config.targetPage !== null
                                ? Math.min(100, Math.round((mCompleted / mTargetTotal) * 100))
                                : 0;
                              const mBarColor = mPct >= 90 ? "bg-emerald-500" : mPct >= 70 ? "bg-amber-400" : "bg-red-500";

                              return (
                                <div className="space-y-3">
                                  {config.targetPage !== "-" && config.targetPage !== null && (
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">
                                        <span>📅 Monthly Target Progress</span>
                                        <span className="font-bold text-gray-600">{mPct}% ({mCompleted}/{mTargetTotal} pgs)</span>
                                      </div>
                                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                                        <div className={`h-1.5 rounded-full transition-all duration-500 ${mBarColor}`} style={{ width: `${mPct}%` }}></div>
                                      </div>
                                    </div>
                                  )}

                                  <div className="space-y-1">
                                    <div className="w-full bg-gray-100 rounded-full h-2">
                                      <div className={`h-2 rounded-full transition-all duration-500 ${statusColors.bar}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                      <span>{config.completedPages} of {config.totalPages} {labels.pages} Completed</span>
                                      <span>{config.remainingPages} left</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Detailed analytics */}
                            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-50 text-left">
                              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100/50">
                                <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Current Month Target</p>
                                <p className="mt-1 text-sm font-black text-gray-800">{config.targetPage}</p>
                              </div>
                              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100/50">
                                <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{labels.pages} needed for Target</p>
                                <p className="mt-1 text-sm font-black text-gray-800">
                                  {config.targetPage !== "-" && config.currentPage !== "-" ? Math.max(0, config.targetPage - config.currentPage) : "N/A"}
                                </p>
                              </div>
                              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100/50 col-span-2">
                                <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Est. Completion of {new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Kolkata' })} Target</p>
                                <p className="mt-1 text-sm font-black text-indigo-600">{config.estimatedMonthTargetCompletionDate || "N/A"}</p>
                              </div>
                              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100/50 col-span-2">
                                <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Estimated Completion of {config.semester} Syllabus</p>
                                <p className="mt-1 text-sm font-black text-indigo-600">{config.estimatedCompletionDate || "N/A"}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Teaching View for Principal/VP */
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-900 to-indigo-900 p-6 rounded-[2.5rem] text-white shadow-xl shadow-blue-100/20">
                  <h4 className="text-lg font-black tracking-tight">📚 My Teaching Syllabus</h4>
                  <p className="text-[10px] font-bold text-blue-200 mt-1 uppercase tracking-widest">Logged in as: {user?.name}</p>
                </div>

                {loadingSyllabus ? (
                  <div className="py-20 text-center animate-pulse text-xs font-bold text-gray-400">Loading configurations...</div>
                ) : syllabusConfigs.filter(c => c.teacherId === user?.id).length === 0 ? (
                  <div className="bg-white p-12 rounded-[2.5rem] border border-gray-100 text-center">
                    <p className="text-xs font-bold text-gray-400 italic">No syllabus configurations assigned to you as a teacher.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {syllabusConfigs.filter(c => c.teacherId === user?.id).map(config => {
                      const pct = config.completionPercentage;
                      const progressValue = syllabusPageProgressData[config.id] || "";
                      const labels = getTrackingLabels(config.trackingType);
                      const statusColors = {
                        Green: { text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100", bar: "bg-emerald-500" },
                        Yellow: { text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", bar: "bg-amber-400" },
                        Red: { text: "text-red-500", bg: "bg-red-50", border: "border-red-100", bar: "bg-red-500" }
                      }[config.statusColor] || { text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100", bar: "bg-blue-500" };

                      return (
                        <div key={config.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                          <div className="flex items-start justify-between gap-3 border-b border-gray-50 pb-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-black uppercase tracking-wider">{config.class}</span>
                                <span className="px-3 py-1 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 text-[10px] font-black uppercase tracking-wider">{config.semester}</span>
                                <span className="px-3 py-1 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-black uppercase tracking-wider">{config.academicYear}</span>
                              </div>
                              <h4 className="font-black text-gray-900 text-lg mt-3">{config.subject}</h4>
                              {config.bookName && (
                                <p className="text-xs font-bold text-indigo-500 mt-1 italic">📖 Book: {config.bookName}</p>
                              )}
                              <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">{labels.bookRange}: {labels.page} {config.startPage} to {config.endPage} (Total {config.totalPages} {labels.pages}) | {labels.current}: {config.currentPage}</p>
                            </div>

                            <div className="relative flex items-center justify-center h-16 w-16 shrink-0">
                              <svg className="absolute w-full h-full transform -rotate-90">
                                <circle cx="32" cy="32" r="26" stroke="#f3f4f6" strokeWidth="6" fill="transparent" />
                                <circle cx="32" cy="32" r="26" stroke={config.statusColor === "Green" ? "#10b981" : config.statusColor === "Red" ? "#ef4444" : "#fbbf24"} strokeWidth="6" fill="transparent"
                                  strokeDasharray={2 * Math.PI * 26}
                                  strokeDashoffset={2 * Math.PI * 26 * (1 - Math.min(100, pct) / 100)}
                                />
                              </svg>
                              <span className="text-sm font-black text-gray-800 relative z-10">{Math.round(pct)}%</span>
                            </div>
                          </div>

                          {/* Status Message */}
                          <div className={`px-4 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider border flex items-center gap-2.5 ${statusColors.bg} ${statusColors.text} ${statusColors.border}`}>
                            <span className="text-base">{config.statusColor === "Green" ? "✅" : config.statusColor === "Red" ? "⚠️" : "ℹ️"}</span>
                            <span>{config.statusMessage}</span>
                          </div>

                          {/* Large Modern Progress Bar */}
                          {(() => {
                            const mTargetTotal = Math.max(1, Number(config.targetPage) - Number(config.startPage) + 1);
                            const mCompleted = Math.max(0, (config.currentPage === "-" ? 0 : Number(config.currentPage)) - Number(config.startPage) + 1);
                            const mPct = config.targetPage !== "-" && config.targetPage !== null
                              ? Math.min(100, Math.round((mCompleted / mTargetTotal) * 100))
                              : 0;
                            const pagesNeeded = config.targetPage !== "-" && config.targetPage !== null && config.currentPage !== "-"
                              ? Math.max(0, Number(config.targetPage) - Number(config.currentPage))
                              : 999;
                            const mBarColor = mPct >= 90 ? "bg-emerald-500" : (mPct >= 70 || pagesNeeded <= 5 ? "bg-amber-400" : "bg-red-500");

                            return (
                              <div className="space-y-4">
                                {config.targetPage !== "-" && config.targetPage !== null && (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                      <span>📅 Monthly Target Progress</span>
                                      <span className="font-bold text-gray-600">{mPct}% ({mCompleted} of {mTargetTotal} {labels.pages})</span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-lg h-3">
                                      <div className={`h-3 rounded-lg transition-all duration-500 ${mBarColor}`} style={{ width: `${mPct}%` }}></div>
                                    </div>
                                  </div>
                                )}

                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                    <span>📚 Semester Syllabus Progress</span>
                                    <span className="font-bold text-gray-650">{Math.round(pct)}% ({config.completedPages} of {config.totalPages} {labels.pages})</span>
                                  </div>
                                  <div className="w-full bg-gray-100 rounded-lg h-5">
                                    <div className={`h-5 rounded-lg transition-all duration-500 ${statusColors.bar}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                                    <span>{config.remainingPages} {labels.remaining}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Advanced Analytics Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-gray-50/50 p-4 rounded-3xl border border-gray-100/50 text-left">
                            <div>
                              <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{labels.current}</p>
                              <p className="mt-1 text-sm font-black text-gray-800">{config.currentPage}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Current Month Target</p>
                              <p className="mt-1 text-sm font-black text-gray-800">{config.targetPage}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{labels.pages} needed for Target</p>
                              <p className="mt-1 text-sm font-black text-gray-800">
                                {config.targetPage !== "-" && config.currentPage !== "-" ? Math.max(0, config.targetPage - config.currentPage) : "N/A"}
                              </p>
                            </div>
                            <div className="col-span-2 sm:col-span-3">
                              <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Est. Completion of {new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Kolkata' })} Target</p>
                              <p className="mt-1 text-sm font-black text-indigo-600">{config.estimatedMonthTargetCompletionDate || "N/A"}</p>
                            </div>
                            <div className="col-span-2 sm:col-span-3">
                              <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Estimated Completion of {config.semester} Syllabus</p>
                              <p className="mt-1 text-sm font-black text-indigo-600">{config.estimatedCompletionDate || "N/A"}</p>
                            </div>
                          </div>

                          {/* Current Page Update Input */}
                          <div className="pt-4 border-t border-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block">{labels.updateNum}</label>
                              <p className="text-[9px] font-bold text-gray-400">Log your active classroom book progress</p>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min={config.startPage}
                                max={config.endPage}
                                placeholder="e.g. 187"
                                value={progressValue}
                                onChange={(e) => setSyllabusPageProgressData(prev => ({ ...prev, [config.id]: e.target.value }))}
                                className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-xs font-black w-24 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <button
                                onClick={() => handleUpdateSyllabusProgress(config.id, progressValue)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all"
                              >
                                Update
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MY SYLLABUS TAB (TEACHERS ONLY) ── */}
        {activeTab === "my_syllabus" && user?.role && user?.role !== 'admin' && (
          <div className="space-y-5 animate-in fade-in">
            <div className="rounded-3xl p-6" style={{ background: 'linear-gradient(135deg, #082231 0%, #0a505c 100%)' }}>
              <h4 className="text-lg font-black text-white">📚 My Syllabus</h4>
              <p className="text-xs text-white/50 font-medium mt-1">Track your teaching progress</p>
            </div>

            {(() => {
              const myConfigs = syllabusConfigs.filter(c => c.teacherId === user?.id);
              const myClasses = [...new Set(myConfigs.map(c => c.class))].filter(Boolean);
              const filteredConfigs = mySyllabusClassFilter ? myConfigs.filter(c => c.class === mySyllabusClassFilter) : myConfigs;

              return (
                <>
                  {myClasses.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      <button onClick={() => setMySyllabusClassFilter("")}
                        className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition-all ${!mySyllabusClassFilter ? 'bg-[#0d9488] text-white shadow-lg shadow-[#0d9488]/20' : 'bg-white border border-gray-100 text-gray-500 hover:bg-gray-50'}`}>
                        All Classes
                      </button>
                      {myClasses.map(cls => (
                        <button key={cls} onClick={() => setMySyllabusClassFilter(cls)}
                          className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition-all ${mySyllabusClassFilter === cls ? 'bg-[#0d9488] text-white shadow-lg shadow-[#0d9488]/20' : 'bg-white border border-gray-100 text-gray-500 hover:bg-gray-50'}`}>
                          {cls}
                        </button>
                      ))}
                    </div>
                  )}

                  {loadingSyllabus ? (
                    <div className="py-20 text-center"><div className="h-10 w-10 mx-auto animate-spin rounded-full border-2 border-[#0d9488] border-t-transparent" /></div>
                  ) : filteredConfigs.length === 0 ? (
                    <div className="rounded-3xl border border-gray-100 bg-white p-12 text-center">
                      <p className="text-sm font-bold text-gray-400">{myConfigs.length === 0 ? "No syllabus assigned to you." : "No syllabus for this class."}</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {filteredConfigs.map(config => {
                        const pct = config.completionPercentage;
                        const progressValue = syllabusPageProgressData[config.id] || "";
                        const labels = getTrackingLabels(config.trackingType);
                        const statusColor = config.statusColor === "Green" ? "#10b981" : config.statusColor === "Red" ? "#ef4444" : "#f59e0b";
                        const statusBg = config.statusColor === "Green" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : config.statusColor === "Red" ? "bg-red-50 border-red-200 text-red-600" : "bg-amber-50 border-amber-200 text-amber-700";
                        const mTargetTotal = Math.max(1, Number(config.targetPage) - Number(config.startPage) + 1);
                        const mCompleted = Math.max(0, (config.currentPage === "-" ? 0 : Number(config.currentPage)) - Number(config.startPage) + 1);
                        const mPct = config.targetPage !== "-" && config.targetPage !== null ? Math.min(100, Math.round((mCompleted / mTargetTotal) * 100)) : 0;
                        const pagesLeft = config.targetPage !== "-" && config.currentPage !== "-" ? Math.max(0, config.targetPage - config.currentPage) : null;

                        return (
                          <div key={config.id} className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                            {/* Top bar with subject and percentage */}
                            <div className="px-6 py-5 flex items-center justify-between" style={{ background: `linear-gradient(135deg, ${statusColor}08, ${statusColor}03)` }}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="rounded-lg bg-[#0d9488]/10 px-2.5 py-1 text-[10px] font-black text-[#0d9488] uppercase">{config.class}</span>
                                  <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-[10px] font-bold text-gray-500 uppercase">{config.semester}</span>
                                </div>
                                <h4 className="font-black text-gray-900 text-lg mt-2">{config.subject}</h4>
                                {config.bookName && <p className="text-xs font-bold text-gray-400 mt-1">📖 {config.bookName}</p>}
                              </div>
                              {/* Circular progress */}
                              <div className="relative h-16 w-16 shrink-0">
                                <svg className="h-full w-full -rotate-90">
                                  <circle cx="32" cy="32" r="28" stroke="#f3f4f6" strokeWidth="5" fill="none" />
                                  <circle cx="32" cy="32" r="28" stroke={statusColor} strokeWidth="5" fill="none" strokeLinecap="round"
                                    strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - Math.min(100, pct) / 100)}
                                    className="transition-all duration-700" />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                  <span className="text-sm font-black text-gray-800">{Math.round(pct)}%</span>
                                  <span className="text-[7px] font-bold text-gray-400 uppercase">done</span>
                                </div>
                              </div>
                            </div>

                            {/* Status badge */}
                            <div className="px-6 pt-4">
                              <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${statusBg}`}>
                                <span className="text-sm">{config.statusColor === "Green" ? "✅" : config.statusColor === "Red" ? "⚠️" : "ℹ️"}</span>
                                <span className="text-[10px] font-bold uppercase tracking-wider">{config.statusMessage}</span>
                              </div>
                            </div>

                            {/* Futuristic Progress Bars */}
                            <div className="px-6 pt-5 space-y-4">
                              {/* Monthly Target */}
                              {config.targetPage !== "-" && config.targetPage !== null && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Monthly Target</span>
                                    <span className="text-[10px] font-black text-gray-600">{mCompleted}/{mTargetTotal} {labels.pages.toLowerCase()}</span>
                                  </div>
                                  <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="absolute inset-0 h-full rounded-full transition-all duration-700" style={{ width: `${mPct}%`, background: `linear-gradient(90deg, ${statusColor}, ${statusColor}cc)` }} />
                                    <div className="absolute inset-0 h-full rounded-full opacity-30" style={{ width: `${mPct}%`, background: `linear-gradient(90deg, transparent, white, transparent)`, animation: 'shimmer 2s infinite' }} />
                                  </div>
                                  <p className="text-[9px] font-bold text-gray-400 mt-1.5 text-right">{mPct}% complete{pagesLeft !== null && pagesLeft > 0 ? ` • ${pagesLeft} ${labels.page.toLowerCase()}s left` : ''}</p>
                                </div>
                              )}

                              {/* Semester Progress */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Semester Progress</span>
                                  <span className="text-[10px] font-black text-gray-600">{config.completedPages}/{config.totalPages} {labels.pages.toLowerCase()}</span>
                                </div>
                                <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="absolute inset-0 h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, #0d9488, #14b8a6)` }} />
                                  <div className="absolute inset-0 h-full rounded-full opacity-30" style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, transparent, white, transparent)`, animation: 'shimmer 2s infinite' }} />
                                </div>
                                <p className="text-[9px] font-bold text-gray-400 mt-1.5 text-right">{config.remainingPages} {labels.page.toLowerCase()}s remaining</p>
                              </div>
                            </div>

                            {/* Quick Stats */}
                            <div className="px-6 pt-5 grid grid-cols-3 gap-3">
                              {[
                                { label: "Current", value: config.currentPage, color: "text-gray-800" },
                                { label: "Target", value: config.targetPage, color: "text-gray-800" },
                                { label: labels.pagesLeft, value: pagesLeft ?? "N/A", color: pagesLeft !== null && pagesLeft <= 5 ? "text-amber-600" : "text-gray-800" },
                              ].map(s => (
                                <div key={s.label} className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-center">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase">{s.label}</p>
                                  <p className={`mt-1 text-sm font-black ${s.color}`}>{s.value}</p>
                                </div>
                              ))}
                            </div>

                            {/* Estimation Dates */}
                            <div className="px-6 pt-4 grid grid-cols-2 gap-3">
                              <div className="rounded-xl bg-[#0d9488]/5 border border-[#0d9488]/10 p-3">
                                <p className="text-[9px] font-bold text-[#0d9488]/60 uppercase">{new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Kolkata' })} Est.</p>
                                <p className="mt-1 text-xs font-black text-[#0d9488]">{config.estimatedMonthTargetCompletionDate || "N/A"}</p>
                              </div>
                              <div className="rounded-xl bg-indigo-50/50 border border-indigo-100 p-3">
                                <p className="text-[9px] font-bold text-indigo-400 uppercase">{config.semester} Est.</p>
                                <p className="mt-1 text-xs font-black text-indigo-600">{config.estimatedCompletionDate || "N/A"}</p>
                              </div>
                            </div>

                            {/* Update Section */}
                            <div className="px-6 py-5 mt-4 border-t border-gray-50 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{labels.update}</p>
                                <p className="text-[9px] text-gray-400">Log your book progress</p>
                              </div>
                              <div className="flex gap-2">
                                <input type="number" min={config.startPage} max={config.endPage} placeholder={labels.placeholder}
                                  value={progressValue} onChange={(e) => setSyllabusPageProgressData(prev => ({ ...prev, [config.id]: e.target.value }))}
                                  className="w-20 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold outline-none focus:ring-2 focus:ring-[#0d9488]/20" />
                                <button onClick={() => handleUpdateSyllabusProgress(config.id, progressValue)} disabled={!progressValue}
                                  className="rounded-xl bg-[#0d9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0a7a70] disabled:opacity-40 transition-all">
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════
          PERIOD DETAIL MODAL
      ══════════════════════════════════════════════ */}
      {timetablePdfOpen && Array.isArray(fullTimetable) && (
        <div className="fixed inset-0 z-[100] flex h-dvh w-screen flex-col overflow-hidden bg-slate-100">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-[#073b4c] px-3 py-2 text-white sm:px-5">
            <button
              onClick={closeTimetablePdf}
              className="flex h-9 items-center gap-2 rounded-xl bg-white/10 px-3 text-xs font-black transition-colors hover:bg-white/20"
              aria-label="Back to timetable"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
            <div className="text-center">
              <p className="text-[8px] font-black uppercase tracking-[0.2em] text-teal-200">Timetable PDF View</p>
              <h2 className="text-sm font-black">{days[selectedDay]}</h2>
            </div>
            <p className="hidden text-[8px] font-bold uppercase tracking-wider text-white/60 sm:block">Rotate phone for best view</p>
            <div className="w-[68px] sm:hidden" aria-hidden="true" />
          </div>
          <div
            className="flex-1 overflow-auto p-2 sm:p-3"
            style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
          >
              <div className="mx-auto min-w-[720px] bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <h1 className="text-base font-black text-[#073b4c]">Class Timetable</h1>
                    <p className="text-[8px] font-black uppercase tracking-[0.18em] text-teal-600">{days[selectedDay]}</p>
                  </div>
                  <p className="text-[8px] font-black uppercase tracking-[0.15em] text-slate-400">MARKHINS HUB</p>
                </div>
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr>
                      <th className="w-[8%] border border-slate-300 bg-[#073b4c] px-1 py-2 text-[7px] font-black tracking-wider text-white">CLASS</th>
                      {periods.map((period) => (
                        <th key={period} className="border border-slate-300 bg-[#073b4c] px-1 py-2 text-[7px] font-black tracking-wider text-white">
                          PERIOD {period.replace("P", "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fullTimetable.map((row) => (
                      <tr key={row.class}>
                        <th className="border border-slate-300 bg-cyan-50 px-1 py-2 text-[8px] font-black text-slate-900">{row.class}</th>
                        {periods.map((period) => {
                          const item = row.periods?.[period];
                          const isSubstitute = item && (item.isSubstitute || item.is_substitute);
                          const isOwnSubstitute = isSubstitute && (item.is_own_substitute || item.originalTeacherId === item.substituteTeacherId);
                          const activeTeacherId = item ? (item.substituteTeacherId || item.teacherId) : null;
                          const isMyPeriod = activeTeacherId && user && String(activeTeacherId) === String(user.id);
                          const isMySubstitution = isSubstitute && user && String(item.substituteTeacherId) === String(user.id);
                          const cellColor = isSubstitute
                            ? (isMySubstitution || isOwnSubstitute ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50")
                            : (isMyPeriod ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white");
                          return (
                            <td key={period} className={`border px-1 py-2 text-center ${cellColor}`}>
                              {item ? (
                                <>
                                  <p className="text-[8px] font-black leading-tight text-slate-800">{item.subject}</p>
                                  <p className="mt-0.5 text-[6px] font-bold uppercase leading-tight text-slate-500">{item.teacher}</p>
                                  {isSubstitute && <p className={`mt-0.5 text-[5px] font-black uppercase ${isMySubstitution || isOwnSubstitute ? "text-red-700" : "text-amber-700"}`}>Substitute</p>}
                                </>
                              ) : (
                                <span className="text-slate-200">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          </div>
        </div>
      )}

      {periodModal && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white w-full sm:max-w-2xl rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl flex max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100dvh-3rem)] min-h-0 flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            {/* Modal Header */}
            <div className="flex justify-between items-start p-6 pb-4 border-b border-gray-50 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">{periodModal.class}</span>
                  <span className="bg-gray-100 text-gray-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">{periodModal.period}</span>
                  {periodModal.data?.isSubstitute && (
                    <span className="bg-orange-100 text-orange-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">🔄 Substitute</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 font-bold">{periodModal.date}</p>
              </div>
              <button
                onClick={() => closeModal()}
                className="w-9 h-9 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-all active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div
              className="overflow-y-auto overscroll-contain flex-1 min-h-0 px-5 sm:px-6 pt-5 space-y-6"
              style={{
                paddingBottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 1.5rem)"
              }}
            >
              {periodModal.loading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-blue-600 border-t-transparent" />
                </div>
              ) : periodModal.error ? (
                <div className="p-5 bg-red-50 rounded-2xl text-red-600 font-bold text-sm">{periodModal.error}</div>
              ) : periodModal.data ? (
                <>
                  {/* Subject & Teacher Info */}
                  <div className="bg-blue-50/60 rounded-3xl p-5 space-y-4 border border-blue-100">
                    {periodModal.data.subject && (
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Subject</span>
                        <span className="font-black text-blue-900 text-sm">{periodModal.data.subject}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Scheduled By</span>
                      <span className="font-black text-gray-700 text-sm">{periodModal.data.scheduledTeacher || '—'}</span>
                    </div>
                    {periodModal.data.isSubstitute ? (
                      <div className="mt-2 pt-3 border-t border-blue-100 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">🔄 Substitute Took</span>
                          <span className="font-black text-orange-700 text-sm bg-orange-50 px-3 py-1 rounded-xl">
                            {periodModal.data.substituteInfo?.substitute || periodModal.data.actualTeacher || '—'}
                          </span>
                        </div>
                        {periodModal.data.substituteInfo?.scheduled && (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Was Assigned To</span>
                            <span className="font-bold text-gray-500 text-sm line-through">{periodModal.data.substituteInfo.scheduled}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      periodModal.data.actualTeacher && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Took Class</span>
                          <span className="font-black text-green-700 text-sm bg-green-50 px-3 py-1 rounded-xl">{periodModal.data.actualTeacher}</span>
                        </div>
                      )
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Status</span>
                      <span className={`font-black text-sm px-3 py-1 rounded-xl ${periodModal.data.isTaken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {periodModal.data.isTaken ? '✅ Taken' : '⏳ Not Taken'}
                      </span>
                    </div>
                  </div>

                  {/* Count Summary */}
                  {periodModal.data.counts && (
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { label: 'Present', count: periodModal.data.counts.present, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100' },
                        { label: 'Absent', count: periodModal.data.counts.absent, bg: 'bg-red-50', text: 'text-red-500', border: 'border-red-100' },
                        { label: 'Special Leave', count: periodModal.data.counts.special_leave, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
                        { label: 'Sick', count: periodModal.data.counts.sick, bg: 'bg-orange-50', text: 'text-orange-500', border: 'border-orange-100' },
                        { label: 'Leave', count: periodModal.data.counts.leave, bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
                      ].map(({ label, count, bg, text, border }) => (
                        <div key={label} className={`${bg} ${border} border rounded-3xl p-3 text-center`}>
                          <p className={`text-xl font-black ${text}`}>{count || 0}</p>
                          <p className={`text-[8px] font-black uppercase tracking-widest mt-0.5 ${text} opacity-70`}>{label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Student Roster */}
                  {Array.isArray(periodModal.data.records) && periodModal.data.records.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Student Roster</p>
                      <div className="bg-white border border-gray-100 rounded-[2rem] overflow-hidden divide-y divide-gray-50">
                        {periodModal.data.records.map((s, i) => {
                          const statusMap = {
                            present: { label: 'Present', bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
                            absent: { label: 'Absent', bg: 'bg-red-50', text: 'text-red-500', dot: 'bg-red-500' },
                            special_leave: { label: 'Special Leave', bg: 'bg-blue-50', text: 'text-blue-600', dot: 'bg-blue-500' },
                            sick: { label: 'Sick 💊', bg: 'bg-orange-50', text: 'text-orange-500', dot: 'bg-orange-400' },
                            leave: { label: 'Leave 🏠', bg: 'bg-purple-50', text: 'text-purple-600', dot: 'bg-purple-400' },
                            not_marked: { label: 'N/A', bg: 'bg-gray-50', text: 'text-gray-400', dot: 'bg-gray-300' },
                          };
                          const cfg = statusMap[s.status] || statusMap.not_marked;
                          return (
                            <div key={i} className={`flex items-center justify-between px-5 py-4 ${s.status === 'absent' ? 'bg-red-50/30' : ''}`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-2xl flex items-center justify-center text-[10px] font-black ${cfg.bg} ${cfg.text}`}>
                                  {s.rollNo}
                                </div>
                                <p className="font-bold text-gray-800 text-sm">{s.name}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                                <span className={`text-[10px] font-black uppercase tracking-wider ${cfg.text}`}>{cfg.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!periodModal.data.isTaken && (
                    <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 text-center">
                      <p className="text-amber-700 font-black text-sm">⏳ Attendance not marked yet for this period</p>
                      <p className="text-amber-500 text-[10px] font-bold mt-1 uppercase tracking-wider">No records found in database</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {syllabusPopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col my-8 max-h-[90vh]">
            {/* Header */}
            <div className="p-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900">
                  {syllabusFormData.id ? "✏️ Edit Syllabus Configuration" : "➕ New Syllabus Configuration"}
                </h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mt-1">
                  Define boundaries and monthly target milestones
                </p>
              </div>
              <button
                onClick={() => setSyllabusPopupOpen(false)}
                className="w-10 h-10 rounded-2xl bg-white border border-gray-100 flex items-center justify-center font-bold text-gray-400 hover:text-gray-600 hover:shadow-sm transition-all"
              >
                ✕
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSaveSyllabusConfig} className="flex-1 overflow-y-auto p-6 space-y-6">
              {(() => {
                const formTrackingType = syllabusFormData.subject && syllabusFormData.subject.includes('مِشْكَاةُ') ? 'hadith' : 'page';
                const fl = getTrackingLabels(formTrackingType);
                return (<>
              {/* Core Config Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Class</label>
                  <select
                    required
                    value={syllabusFormData.class}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, class: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select Class</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Subject</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Fiqh"
                    value={syllabusFormData.subject}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, subject: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Teacher</label>
                  <select
                    required
                    value={syllabusFormData.teacher_id}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, teacher_id: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select Teacher</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Book Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Fiqh Al-Sunnah"
                    value={syllabusFormData.book_name}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, book_name: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Academic Year</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. 2026"
                    value={syllabusFormData.academic_year}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, academic_year: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Semester</label>
                  <select
                    required
                    value={syllabusFormData.semester}
                    onChange={(e) => setSyllabusFormData(prev => ({ ...prev, semester: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Semester 1">Semester 1</option>
                    <option value="Semester 2">Semester 2</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{fl.start}</label>
                    <input
                      required
                      type="number"
                      min="1"
                      placeholder="1"
                      value={syllabusFormData.start_page}
                      onChange={(e) => setSyllabusFormData(prev => ({ ...prev, start_page: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{fl.end}</label>
                    <input
                      required
                      type="number"
                      min="1"
                      placeholder="200"
                      value={syllabusFormData.end_page}
                      onChange={(e) => setSyllabusFormData(prev => ({ ...prev, end_page: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-3 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Monthly Target End Pages */}
              <div className="border-t border-gray-100 pt-6">
                <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider mb-1">{fl.targetPages}</h4>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-4">{fl.targetSubtitle}</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {Object.keys(syllabusMonthTargets).map((month) => (
                    <div key={month}>
                      <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest block mb-1">{month}</label>
                      <input
                        type="number"
                        min="1"
                        placeholder={fl.targetPlaceholder}
                        value={syllabusMonthTargets[month]}
                        onChange={(e) => setSyllabusMonthTargets(prev => ({ ...prev, [month]: e.target.value }))}
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-2.5 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="border-t border-gray-100 pt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSyllabusPopupOpen(false)}
                  className="px-5 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-500 font-black text-xs uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-100"
                >
                  {syllabusFormData.id ? "Save Changes" : "Create Configuration"}
                </button>
              </div>
              </>)})()}
            </form>
          </div>
        </div>
      )}

      {/* HEALTH LIST MODAL */}
      {viewingHealthList && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-2xl font-black text-gray-800">
                  {viewingHealthList === 'sick' ? 'Sick Students' : 'Students on Leave'}
                </h3>
                {healthListData && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-500 mt-1">
                    Total Active: {healthListData.total_count}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setViewingHealthList(null); setHealthListData(null); }}
                className="p-2 hover:bg-gray-50 rounded-full transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
              {healthListLoading ? (
                <div className="flex justify-center p-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-blue-600 border-t-transparent shadow-sm"></div>
                </div>
              ) : healthListData?.health_list?.length > 0 ? (
                healthListData.health_list.map(group => (
                  <div key={group.class} className="space-y-3">
                    <div className="flex items-center gap-3 px-2">
                      <div className="h-[2px] flex-1 bg-gray-50" />
                      <span className="text-sm font-black text-gray-800">{group.class}</span>
                      <div className="h-[2px] flex-1 bg-gray-50" />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {group.students.map(student => (
                        <div key={student.roll_no} className="flex items-center gap-3 p-4 bg-gray-50/50 rounded-2xl border border-gray-50">
                          <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center text-[10px] font-black text-gray-500 border border-gray-100">
                            {student.roll_no}
                          </div>
                          <span className="text-sm font-bold text-gray-800">{student.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center space-y-4">
                  <div className="text-5xl opacity-20">🍃</div>
                  <p className="text-sm font-bold text-gray-400">
                    No active {viewingHealthList} students found.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-8">
              <button
                onClick={() => { setViewingHealthList(null); setHealthListData(null); }}
                className="w-full py-5 rounded-[2rem] bg-gray-900 text-white font-black hover:bg-black transition-all shadow-xl active:scale-95"
              >
                Close Overview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM NAV BAR */}
      {!isInputFocused && (
        <nav
          className="anim-tab-bar fixed bottom-0 inset-x-0 z-50 rounded-t-3xl"
          style={{
            background: 'linear-gradient(135deg, #0c3242 0%, #0a505c 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 -4px 32px rgba(8,34,49,0.25)',
            paddingBottom: 'env(safe-area-inset-bottom, 8px)',
            minHeight: 'var(--bottom-nav-height)'
          }}
        >
        <div className="mx-auto flex max-w-lg items-center justify-around px-2 pt-2 pb-1">
          {(() => {
            const tabs = user?.role === 'Majlis' ? [
              {
                id: 'reports', label: 'Management',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
              }
            ] : [
              {
                id: 'attendance', label: 'Attendance',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>)
              },
              {
                id: 'timetable', label: 'Timetable',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>)
              },
              {
                id: 'reports', label: 'Management',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
              }
            ];

            const role = user?.role;
            if (role === 'admin') {
              tabs.push({
                id: 'syllabus_management', label: 'Syllabus Config',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>)
              });
              tabs.push({
                id: 'syllabus_overview', label: 'Overview',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
              });
            } else if (role === 'Principal' || role === 'Vice Principal') {
              tabs.push({
                id: 'syllabus_overview', label: 'Syllabus',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
              });
            } else if (role && role !== 'admin') {
              tabs.push({
                id: 'my_syllabus', label: 'My Syllabus',
                icon: (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>)
              });
            }

            return tabs.map(({ id, label, icon }) => {
              const selected = activeTab === id || (id === 'reports' && activeTab === 'permission_manager');
              return (
              <button
                key={id}
                onClick={() => switchTab(id)}
                className="flex flex-col items-center gap-1 px-2.5 py-1 rounded-2xl transition-all active:scale-90"
                style={{ color: selected ? '#ffffff' : 'rgba(255,255,255,0.45)' }}
              >
                <div className={`transition-all duration-200 ${selected ? 'scale-110' : 'scale-100'}`}>
                  {icon}
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-center">{label}</span>
                {selected && (
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#5eead4' }} />
                )}
              </button>
              );
            });
          })()}
        </div>
      </nav>
      )}

    </div>
  );
}
