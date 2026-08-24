/** @type {import('next').NextConfig} */
const nextConfig = {
  // Para APK con server.url no necesitas export.
  // Si quieres APK offline 100%, descomenta las 2 líneas siguientes:
  // output: 'export',
  // trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
