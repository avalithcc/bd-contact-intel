/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Connections.csv is uploaded straight through a server action. The
      // default 1 MB body limit rejects exports from BDs with large networks.
      // 4 MB stays under Vercel's own ~4.5 MB request cap; anything larger
      // has to go through Supabase Storage like messages.csv does (see
      // src/lib/storage.ts).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
