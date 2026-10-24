import fs from "fs";
import path from "path";

export const DATA_ROOT = path.join(process.cwd(), "examtopics-data");
export const SCRAPES_ROOT = path.join(process.cwd(), "scrapes");
export const DEFAULT_CONCURRENCY = 2;

if (!fs.existsSync(SCRAPES_ROOT)) {
  fs.mkdirSync(SCRAPES_ROOT, { recursive: true });
}

export function getChromiumExecutablePath(): string | undefined {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  if (fs.existsSync("/usr/bin/chromium")) {
    return "/usr/bin/chromium";
  }
  return undefined;
}

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  bgCyan: "\x1b[46m\x1b[30m\x1b[1m",
  bgGreen: "\x1b[42m\x1b[30m\x1b[1m",
  bgBlue: "\x1b[44m\x1b[37m\x1b[1m",
  bgRed: "\x1b[41m\x1b[37m\x1b[1m",
};
