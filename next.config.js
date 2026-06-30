/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Portable, self-contained build for internal hosting (App Service / container).
  output: "standalone",
};

module.exports = nextConfig;
