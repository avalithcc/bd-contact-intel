/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // LinkedIn connection exports can be large
    },
  },
};

export default nextConfig;
