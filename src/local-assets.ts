import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import type { ServerOptions } from "./repository.js";

export function localAssetReader(directory: string): NonNullable<ServerOptions["readAsset"]> {
  return async asset => {
    const key = asset.storageKey;
    if (!key || !/^assets\/[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error("Invalid local asset key");
    const root = await realpath(directory), file = await realpath(path.join(root, key));
    if (!file.startsWith(root + path.sep)) throw new Error("Asset path escapes the configured corpus directory");
    if ((await stat(file)).size > 8_388_608) throw new Error("Asset exceeds local size limit");
    return { bytes: await readFile(file), mediaType: asset.mediaType };
  };
}
