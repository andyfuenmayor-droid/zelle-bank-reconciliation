import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['imapflow', 'mailparser', 'pg'],
};

export default nextConfig;
