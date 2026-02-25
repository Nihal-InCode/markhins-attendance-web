export default function manifest() {
    return {
        name: 'MARKHINS HUB',
        short_name: 'MARKHINS',
        description: 'MARKHINS HUB — Teacher Attendance System',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        icons: [
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
            },
        ],
    }
}
