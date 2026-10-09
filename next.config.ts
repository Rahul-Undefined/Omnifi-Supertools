import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // pg is a Node-only driver; browser engines (pdf.js, ffmpeg, tesseract) are only ever imported on the client.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
