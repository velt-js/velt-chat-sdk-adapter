/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the workspace adapter package (shipped as ESM source/dist).
  transpilePackages: ["@velt-js/chat-sdk-adapter"],
};

export default nextConfig;
