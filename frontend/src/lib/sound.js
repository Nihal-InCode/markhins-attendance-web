let isMuted = false;

// Load from localStorage
if (typeof window !== 'undefined') {
    isMuted = localStorage.getItem('muted') === 'true';
}

// Pre-load sounds to avoid lag
const sounds = typeof window !== 'undefined' ? {
    loginSuccess: new Audio('/sounds/login-success.mp3'),
    loginError: new Audio('/sounds/login-error.mp3'),
    attendanceSuccess: new Audio('/sounds/attendance-success.mp3'),
    attendanceError: new Audio('/sounds/attendance-error.mp3'),
    error: new Audio('/sounds/error.mp3'),
    uploadSuccess: new Audio('/sounds/upload-success.mp3'),
    downloadSuccess: new Audio('/sounds/download-success.mp3'),
} : {};

export function playSound(type) {
    try {
        if (isMuted) return;

        const sound = sounds[type];
        if (!sound) return;

        // Stop current if playing to allow spamming sounds (feedback)
        sound.pause();
        sound.currentTime = 0;

        sound.play().catch((err) => {
            // Browser usually blocks auto-play until interaction
            console.warn('Playback blocked or failed:', err);
        });

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            if (type.toLowerCase().includes('success')) {
                navigator.vibrate([100, 50, 100]); // Noticeable double pulse
            } else if (type.toLowerCase().includes('error')) {
                navigator.vibrate([300]); // Single sharp heavy pulse
            } else {
                navigator.vibrate(100); // Standard pulse
            }
        }

    } catch (err) {
        console.warn('Sound error:', err);
    }
}

export function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('muted', isMuted);
    return isMuted;
}

export function getMuteState() {
    return isMuted;
}
