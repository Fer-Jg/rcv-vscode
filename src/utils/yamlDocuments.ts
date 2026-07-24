import * as fs from "fs";
import { Document, isMap, isScalar, parseDocument, YAMLMap } from "yaml";
import type { Pair } from "yaml";

export const DEFAULT_SPLIT_ROOT_KEYS = ["cv", "design", "locale", "settings"] as const;
export const SCHEMA_ROOT_KEY = "$schema";

export interface SplitRootDestination {
    rootKey: string;
    localFile?: string;
    globalFile?: string;
}

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

export async function preflightYamlSplitFiles(sourceFilePath: string, destinations: SplitRootDestination[]): Promise<PreflightResult> {
    const splitFilePaths = destinations.flatMap(destination => [
        destination.localFile,
        destination.globalFile,
    ]).filter((filePath): filePath is string => Boolean(filePath));
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

export async function splitRootKeysToFiles(
    filePath: string,
    destinations: SplitRootDestination[]
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

    const schemaPair = findRootPair(root, SCHEMA_ROOT_KEY);
    const outputPaths = destinations.flatMap(destination => [
        destination.localFile,
        destination.globalFile,
    ]).filter((outputPath): outputPath is string => Boolean(outputPath));
    const collisions = await findExistingFiles(outputPaths);
    if (collisions.length > 0) {
        throw new Error(`Cannot split YAML because these files already exist: ${collisions.join(", ")}`);
    }

    const createdFiles: string[] = [];
    const removedKeys: string[] = [];

    for (const destination of destinations) {
        const pair = findRootPair(root, destination.rootKey);
        if (!pair) {
            continue;
        }

        const filesToWrite = [destination.localFile, destination.globalFile]
            .filter((outputPath): outputPath is string => Boolean(outputPath));

        for (const outputPath of filesToWrite) {
            const splitDocument = createSplitDocument(document, schemaPair, pair);
            await fs.promises.writeFile(outputPath, splitDocument.toString(), { encoding: "utf8", flag: "wx" });
            createdFiles.push(outputPath);
        }

        if (!removedKeys.includes(destination.rootKey)) {
            removedKeys.push(destination.rootKey);
        }
    }

    if (removedKeys.length > 0) {
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

function findRootPair(root: YAMLMap, key: string): Pair | undefined {
    return root.items.find(pair => getPairKey(pair) === key);
}

function createSplitDocument(sourceDocument: Document, schemaPair: Pair | undefined, rootPair: Pair): Document {
    const splitDocument = new Document();
    if (sourceDocument.directives) {
        splitDocument.directives = sourceDocument.directives.clone();
    }

    const splitRoot = new YAMLMap(splitDocument.schema);
    if (schemaPair) {
        splitRoot.items.push(schemaPair.clone(splitDocument.schema));
    }
    splitRoot.items.push(rootPair.clone(splitDocument.schema));
    splitDocument.contents = splitRoot;

    return splitDocument;
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

function normalizeFilePathForComparison(filePath: string): string {
    const normalized = filePath;
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function throwIfYamlHasErrors(document: Document, filePath: string) {
    if (document.errors.length === 0) {
        return;
    }

    const details = document.errors.map(error => error.message).join("; ");
    throw new Error(`Failed to parse YAML file ${filePath}: ${details}`);
}
