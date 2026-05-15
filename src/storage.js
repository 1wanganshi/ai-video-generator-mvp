import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageRoot = path.join(rootDir, "storage");
const publicStorageRoot = path.join(rootDir, "public", "storage");

export function getRootDir() {
  return rootDir;
}

export function getStorageRoot() {
  return storageRoot;
}

export function getPublicStorageRoot() {
  return publicStorageRoot;
}

export async function ensureStorage() {
  await mkdir(storageRoot, { recursive: true });
  await mkdir(publicStorageRoot, { recursive: true });
}

export async function createJobDirectory(jobId) {
  const { jobDir, publicJobDir } = getJobStoragePaths(jobId);
  await mkdir(jobDir, { recursive: true });
  await mkdir(publicJobDir, { recursive: true });

  return { jobDir, publicJobDir };
}

export function getJobStoragePaths(jobId) {
  return {
    jobDir: path.join(storageRoot, jobId),
    publicJobDir: path.join(publicStorageRoot, jobId)
  };
}

export async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function toPublicUrl(filePath) {
  const relativePath = path.relative(publicStorageRoot, filePath).replaceAll(path.sep, "/");
  return `/storage/${relativePath}`;
}
