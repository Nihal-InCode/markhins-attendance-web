const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

if (!BASE_URL) {
    console.error("API base URL is not defined (NEXT_PUBLIC_API_URL is missing)");
}

import { playSound } from '@/lib/sound';

/**
 * Generic API request handler with error handling and debug logging.
 */
export async function apiRequest(endpoint, options = {}) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Debug Logging
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[API Request] ${options.method || 'GET'} ${BASE_URL}${endpoint}`);
    }

    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers,
        });

        // Handle 401 Unauthorized (Expired or Invalid Token)
        if (response.status === 401) {
            if (typeof window !== 'undefined') {
                localStorage.removeItem('token');
                if (window.location.pathname !== '/login') {
                    window.location.href = '/login?error=Session expired. Please login again.';
                }
            }
            throw new Error('Unauthorized. Please login again.');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.message || errorData.error || `Error ${response.status}: ${response.statusText}`;
            console.error(`[API Error Response]`, { status: response.status, endpoint, errorData });
            throw new Error(errorMsg);
        }

        const data = await response.json();

        // If response contains a token, return the whole object (important for login)
        if (data.token) return data;

        // Otherwise return .data if available, fallback to whole object
        return data.data !== undefined ? data.data : data;
    } catch (error) {
        // Handle Network Errors
        playSound('error');
        if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
            console.error(`[API Network Error] ${endpoint}: Could not connect to ${BASE_URL}`);
            throw new Error(`Network error. Ensure you are on the same WiFi as the server (${BASE_URL}) or the server is running.`);
        }
        throw error;
    }
}

/**
 * Auth Endpoints
 */
export const login = (username, password) =>
    apiRequest('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });

/**
 * Validate Token Endpoint (Check if still valid on app load)
 */
export const validateToken = () => apiRequest('/validate-token');

export const resolvePeriod = (classId, period, date) =>
    apiRequest(`/resolve-period?class=${classId}&period=${period}&date=${date || ''}`);

/**
 * Dashboard & Students Endpoints
 */
export const getClasses = () => apiRequest('/classes');

export const getSubjects = () => apiRequest('/subjects');

export const getStudents = (classId, subjectId, date) =>
    apiRequest(`/students?classId=${classId}&subjectId=${subjectId}&date=${date}`);

/**
 * Advanced Features
 */
export const getTimetable = (classId) => apiRequest(`/timetable/${classId}`);

export const getFullTimetable = (weekday) => apiRequest(`/full-timetable/${weekday}`);

export const getStudentHistory = (rollNo) => apiRequest(`/student-history/${rollNo}`);

export const getDailyReport = (date) => apiRequest(`/daily-report?date=${date}`);

export const getBatchReport = (classId) => apiRequest(`/batch-report/${classId}`);

export const getWeeklyReport = () => apiRequest('/weekly-report');

export const getSickLeaveOverview = () => apiRequest('/sick-leave-overview');

export const getPeriodSummary = (classId, period, date) =>
    apiRequest(`/period-summary?class=${classId}&period=${period}&date=${date}`);

/**
 * Attendance Submission
 */
export const markAttendance = (data) =>
    apiRequest('/mark-attendance', {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const getLastAttendance = () =>
    apiRequest('/attendance/last');

export const getMarkedPeriods = (className, date) =>
    apiRequest(`/attendance/marked-periods?class=${className}&date=${date || ''}`);

export const editLastAttendance = (records, { classId, period, date } = {}) =>
    apiRequest('/attendance/edit-last', {
        method: 'PUT',
        body: JSON.stringify({ records, classId, period, date }),
    });


/**
 * Extra Class Attendance
 */
export const getExtraSubjects = () => apiRequest('/extra-subjects');

export const getExtraClassesReport = (params = {}) => {
    const { date, teacherId, classId } = params;
    let url = '/extra-classes-report?';
    if (date) url += `date=${date}&`;
    if (teacherId) url += `teacherId=${teacherId}&`;
    if (classId) url += `classId=${classId}&`;
    return apiRequest(url);
};

export const markExtraAttendance = (data) =>
    apiRequest('/attendance/extra', {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const markHealthStatus = (type, rollNos, classId) =>
    apiRequest(`/health/${type}`, {
        method: 'POST',
        body: JSON.stringify({ rollNos, classId }),
    });

export const getSickList = () => apiRequest('/health/sick-list');
export const getLeaveList = () => apiRequest('/health/leave-list');

export const getMyProfile = () => apiRequest('/profile/me');
export const updateCredentials = (data) => apiRequest('/profile/update-credentials', {
    method: 'POST',
    body: JSON.stringify(data)
});
export const getTeachersList = () => apiRequest('/teachers');

export const getAdminTeachers = () => apiRequest('/admin/teachers');
export const createAdminTeacher = (data) => apiRequest('/admin/teachers', {
    method: 'POST',
    body: JSON.stringify(data),
});
export const updateAdminTeacher = (teacherId, data) => apiRequest(`/admin/teachers/${teacherId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
});
export const deleteAdminTeacher = (teacherId) => apiRequest(`/admin/teachers/${teacherId}`, {
    method: 'DELETE',
});
export async function uploadTeacherPhoto(teacherId, file, token) {
    const formData = new FormData();
    formData.append('file', file);
    const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

    const response = await fetch(`${BASE_URL}/admin/teachers/${teacherId}/photo`, {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data.message || `Error ${response.status}: ${response.statusText}`);
    }
    return data;
}

export const deleteTeacherPhoto = (teacherId) => apiRequest(`/admin/teachers/${teacherId}/photo`, {
    method: 'DELETE',
});
export const getAdminTimetable = (weekday) => apiRequest(`/admin/timetable/${weekday}`);
export const getTeacherSubjectOptions = (teacherId) => apiRequest(`/admin/teacher-subjects/${teacherId}`);
export const updateTimetablePeriod = (data) => apiRequest('/admin/timetable/period', {
    method: 'PUT',
    body: JSON.stringify(data),
});
export const getAdminActivityLog = (date) => apiRequest(`/admin/activity-log?date=${date}`);
