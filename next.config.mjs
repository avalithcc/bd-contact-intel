/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/unsubscribe is a route handler (it cannot sit inside the root layout), so it inlines the design system
  // stylesheets by reading them at runtime. Vercel only ships files it can trace to an import: name them here.
  outputFileTracingIncludes: {
    "/api/unsubscribe": ["./src/app/design-system.css", "./src/app/globals.css"],
  },
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
