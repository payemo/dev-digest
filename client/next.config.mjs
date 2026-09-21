import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // src/vendor/shared is synced verbatim from the server package, which
  // writes NodeNext-style relative imports (`./contracts/foo.js`) even
  // though the file on disk is `foo.ts`. `tsc` (moduleResolution: Bundler)
  // resolves that fine, but webpack's default resolver treats an explicit
  // `.js` specifier as literal and won't fall back to `.ts` — every page
  // that reaches `@devdigest/shared` 404s in `next dev` (no --turbo) without
  // this. Fixing it here, not in vendor/shared, per the "vendored, fixes go
  // on the consumer side" rule in the root CLAUDE.md.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
