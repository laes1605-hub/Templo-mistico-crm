/** @type {import('next').NextConfig} */
const nextConfig = {
  // Para APK: export estático. Para web normal, puedes comentar output.
  // Si usas Vercel, NO uses export. Para Capacitor local, activa export.
  // output: 'export',
  // trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Permitir que la app cargue en WebView
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
