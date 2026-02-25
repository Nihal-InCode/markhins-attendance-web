export default function robots() {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: '/login',
        },
        sitemap: 'https://attendance.example.com/sitemap.xml',
    }
}
