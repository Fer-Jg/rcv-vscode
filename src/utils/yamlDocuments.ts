import * as fs from "fs";
import * as path from "path";
import { Document, isMap, isScalar, parseDocument, YAMLMap } from "yaml";
import type { Node, Pair } from "yaml";

export const DEFAULT_SPLIT_ROOT_KEYS = ["cv", "design", "locale", "settings"] as const;
export const SCHEMA_ROOT_KEY = "$schema";

export interface SplitYamlResult {
    createdFiles: string[];
    removedKeys: string[];
    deletedSourceFile: boolean;
    skippedReason?: string;
}

export interface PreflightResult {
    sourceFilePath: string;
    splitFilePaths: string[];
    conflicts: string[];
}

export async function parseYamlFile(filePath: string): Promise<Document> {
    const source = await fs.promises.readFile(filePath, "utf8");
    const document = parseDocument(source, { keepSourceTokens: true });
    throwIfYamlHasErrors(document, filePath);
    return document;
}

export async function removeRootKeys(filePath: string, keys: string[]): Promise<void> {
    const document = await parseYamlFile(filePath);
    const root = document.contents;

    if (!isMap(root)) {
        throw new Error(`Expected a root YAML map in ${filePath}.`);
    }

    const keysToRemove = new Set(keys);
    root.items = root.items.filter(pair => {
        const key = getPairKey(pair);
        return key === undefined || !keysToRemove.has(key);
    });

    await fs.promises.writeFile(filePath, document.toString(), "utf8");
}

export async function createYamlFileWithKey(
    filePath: string,
    key: string,
    value: unknown,
    commentBefore?: string
): Promise<void> {
    const document = new Document();
    const root = new YAMLMap(document.schema);
    const pair = document.createPair(key, value);

    if (commentBefore && isScalar(pair.key)) {
        pair.key.commentBefore = commentBefore;
    }

    root.items.push(pair as Pair);
    document.contents = root;
    await fs.promises.writeFile(filePath, document.toString(), "utf8");
}

export async function preflightNewCvSplitFiles(targetFolder: string, cvName: string): Promise<PreflightResult> {
    const sourceFilePath = path.join(targetFolder, predictRenderCvSourceFileName(cvName));
    const sourceStem = getSplitBaseStem(sourceFilePath);
    const splitFilePaths = DEFAULT_SPLIT_ROOT_KEYS.map(key => path.join(targetFolder, `${sourceStem}_${key}.yaml`));
    const expectedFiles = uniqueFilePaths([sourceFilePath, ...splitFilePaths]);
    const existingChecks = await Promise.all(expectedFiles.map(async filePath => {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return filePath;
        } catch {
            return undefined;
        }
    }));

    return {
        sourceFilePath,
        splitFilePaths,
        conflicts: existingChecks.filter((filePath): filePath is string => Boolean(filePath)),
    };
}

export async function splitRootKeysToSiblingFiles(
    filePath: string,
    rootKeys: readonly string[] = DEFAULT_SPLIT_ROOT_KEYS
): Promise<SplitYamlResult> {
    const document = await parseYamlFile(filePath);
    const root = document.contents;

    if (!isMap(root)) {
        return {
            createdFiles: [],
            removedKeys: [],
            deletedSourceFile: false,
            skippedReason: `Expected a root YAML map in ${filePath}.`,
        };
    }

    const rootKeySet = new Set(rootKeys);
    const schemaPair = findRootPair(root, SCHEMA_ROOT_KEY);
    const pairsToSplit = root.items.filter(pair => {
        const key = getPairKey(pair);
        return key !== undefined && rootKeySet.has(key);
    });

    const outputPaths = pairsToSplit.map(pair => {
        const key = getPairKey(pair);
        if (!key) {
            throw new Error(`Could not determine root key for a YAML pair in ${filePath}.`);
        }
        return getSplitFilePath(filePath, key);
    });
    const collisions = await findExistingFiles(outputPaths.filter(outputPath => !sameFilePath(outputPath, filePath)));
    if (collisions.length > 0) {
        throw new Error(`Cannot split YAML because these files already exist: ${collisions.join(", ")}`);
    }

    const createdFiles: string[] = [];
    const removedKeys: string[] = [];
    let sourceReplacement: { tempPath: string; finalPath: string } | undefined;

    for (const pair of pairsToSplit) {
        const key = getPairKey(pair);
        if (!key) {
            continue;
        }

        const splitDocument = new Document();
        if (document.directives) {
            splitDocument.directives = document.directives.clone();
        }

        const splitRoot = new YAMLMap(splitDocument.schema);
        if (schemaPair) {
            splitRoot.items.push(schemaPair.clone(splitDocument.schema));
        }
        splitRoot.items.push(pair.clone(splitDocument.schema));
        splitDocument.contents = splitRoot;

        const splitFilePath = getSplitFilePath(filePath, key);
        if (sameFilePath(splitFilePath, filePath)) {
            const tempPath = `${filePath}.${process.pid}.${Date.now()}.split.tmp`;
            await fs.promises.writeFile(tempPath, splitDocument.toString(), { encoding: "utf8", flag: "wx" });
            sourceReplacement = { tempPath, finalPath: splitFilePath };
        } else {
            await fs.promises.writeFile(splitFilePath, splitDocument.toString(), { encoding: "utf8", flag: "wx" });
        }
        createdFiles.push(splitFilePath);
        removedKeys.push(key);
    }

    if (sourceReplacement) {
        await fs.promises.unlink(filePath);
        await fs.promises.rename(sourceReplacement.tempPath, sourceReplacement.finalPath);
    } else if (removedKeys.length > 0) {
        const removedKeySet = new Set(removedKeys);
        root.items = root.items.filter(pair => {
            const key = getPairKey(pair);
            return key === undefined || !removedKeySet.has(key);
        });
        await fs.promises.writeFile(filePath, document.toString(), "utf8");
        await fs.promises.unlink(filePath);
    }

    return { createdFiles, removedKeys, deletedSourceFile: removedKeys.length > 0 };
}

export function predictRenderCvSourceFileName(cvName: string): string {
    const sourceStem = `${cvName.trim().replace(/\s+/g, "_")}_CV`;
    if (!sourceStem || /[<>:"/\\|?*]/.test(sourceStem)) {
        throw new Error("CV name would create an invalid file name.");
    }
    return `${sourceStem}.yaml`;
}

function getSplitFilePath(sourceFilePath: string, rootKey: string): string {
    const sourceDirectory = path.dirname(sourceFilePath);
    const sourceStem = getSplitBaseStem(sourceFilePath);
    return path.join(sourceDirectory, `${sourceStem}_${sanitizeFileNamePart(rootKey)}.yaml`);
}

function getSplitBaseStem(sourceFilePath: string): string {
    const sourceStem = path.parse(sourceFilePath).name;
    return sourceStem.endsWith("_CV") ? sourceStem.slice(0, -3) : sourceStem;
}

function sanitizeFileNamePart(value: string): string {
    const sanitized = value
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    return sanitized || "section";
}

function findRootPair(root: YAMLMap, key: string): Pair | undefined {
    return root.items.find(pair => getPairKey(pair) === key);
}

function getPairKey(pair: Pair): string | undefined {
    if (isScalar(pair.key)) {
        return pair.key.value === null || pair.key.value === undefined
            ? undefined
            : String(pair.key.value);
    }

    if (typeof pair.key === "string") {
        return pair.key;
    }

    return undefined;
}

async function findExistingFiles(filePaths: string[]): Promise<string[]> {
    const checks = await Promise.all(filePaths.map(async filePath => {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return filePath;
        } catch {
            return undefined;
        }
    }));

    return checks.filter((filePath): filePath is string => Boolean(filePath));
}

function uniqueFilePaths(filePaths: string[]): string[] {
    const seen = new Set<string>();
    return filePaths.filter(filePath => {
        const normalized = normalizeFilePathForComparison(filePath);
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}

function sameFilePath(left: string, right: string): boolean {
    return normalizeFilePathForComparison(left) === normalizeFilePathForComparison(right);
}

function normalizeFilePathForComparison(filePath: string): string {
    const normalized = path.resolve(filePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function throwIfYamlHasErrors(document: Document, filePath: string) {
    if (document.errors.length === 0) {
        return;
    }

    const details = document.errors.map(error => error.message).join("; ");
    throw new Error(`Failed to parse YAML file ${filePath}: ${details}`);
}
