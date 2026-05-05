import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    allowedDevOrigins: ["*"],
  },
};

export default config;
