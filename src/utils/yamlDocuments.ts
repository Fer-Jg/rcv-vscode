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

export type RootPairMutator = (rootPair: Pair, document: Document) => void;

export interface RootKeySourceDestination extends SplitRootDestination {
    sourceFile: string;
    mutate?: RootPairMutator;
}

export interface PreflightResult {
    sourceFilePath: string;
    splitFilePaths: string[];
    conflicts: string[];
}

export async function parseYamlFile(filePath: string): Promise<Document> {
    const source = await fs.promises.readFile(filePath, "utf8");
    return parseYamlSource(source, filePath);
}

export function getRootKeyScalarValue(document: Document, rootKey: string, path: string[]): string | undefined {
    const root = document.contents;
    if (!isMap(root)) {
        return undefined;
    }

    const pair = findRootPair(root, rootKey);
    if (!pair) {
        return undefined;
    }

    return getNestedScalarValue(pair.value, path);
}

export function setRootKeyScalarValue(document: Document, rootKey: string, path: string[], value: string): void {
    const root = document.contents;
    if (!isMap(root)) {
        throw new Error("Expected a root YAML map.");
    }

    const pair = findRootPair(root, rootKey);
    if (!pair) {
        throw new Error(`Expected root key "${rootKey}".`);
    }

    setNestedScalarValue(pair.value, path, value, document);
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
    const source = await fs.promises.readFile(filePath, "utf8");
    const document = parseYamlSource(source, filePath);
    const fileHeaderComments = extractLeadingComments(source);
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
            const splitDocument = createSplitDocument(document, schemaPair, pair, fileHeaderComments);
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

export async function writeRootKeysFromFiles(
    destinations: RootKeySourceDestination[]
): Promise<SplitYamlResult> {
    const outputPaths = destinations.flatMap(destination => [
        destination.localFile,
        destination.globalFile,
    ]).filter((outputPath): outputPath is string => Boolean(outputPath));
    const collisions = await findExistingFiles(outputPaths);
    if (collisions.length > 0) {
        throw new Error(`Cannot write YAML because these files already exist: ${collisions.join(", ")}`);
    }

    const createdFiles: string[] = [];
    const removedKeys: string[] = [];

    for (const destination of destinations) {
        const filesToWrite = [destination.localFile, destination.globalFile]
            .filter((outputPath): outputPath is string => Boolean(outputPath));
        if (filesToWrite.length === 0) {
            continue;
        }

        const source = await fs.promises.readFile(destination.sourceFile, "utf8");
        const document = parseYamlSource(source, destination.sourceFile);
        const fileHeaderComments = extractLeadingComments(source);
        const root = document.contents;
        if (!isMap(root)) {
            return {
                createdFiles,
                removedKeys,
                deletedSourceFile: false,
                skippedReason: `Expected a root YAML map in ${destination.sourceFile}.`,
            };
        }

        const schemaPair = findRootPair(root, SCHEMA_ROOT_KEY);
        const pair = findRootPair(root, destination.rootKey);
        if (!pair) {
            continue;
        }

        for (const outputPath of filesToWrite) {
            const splitDocument = createSplitDocument(document, schemaPair, pair, fileHeaderComments, destination.mutate);
            await fs.promises.writeFile(outputPath, splitDocument.toString(), { encoding: "utf8", flag: "wx" });
            createdFiles.push(outputPath);
        }

        if (!removedKeys.includes(destination.rootKey)) {
            removedKeys.push(destination.rootKey);
        }
    }

    return { createdFiles, removedKeys, deletedSourceFile: false };
}

export function predictRenderCvSourceFileName(cvName: string): string {
    const sourceStem = `${cvName.trim().replace(/\s+/g, "_")}_CV`;
    if (!sourceStem || /[<>:"/\\|?*]/.test(sourceStem)) {
        throw new Error("CV name would create an invalid file name.");
    }
    return `${sourceStem}.yaml`;
}

function parseYamlSource(source: string, filePath: string): Document {
    const document = parseDocument(source, { keepSourceTokens: true });
    throwIfYamlHasErrors(document, filePath);
    return document;
}

function findRootPair(root: YAMLMap, key: string): Pair | undefined {
    return root.items.find(pair => getPairKey(pair) === key);
}

function createSplitDocument(
    sourceDocument: Document,
    schemaPair: Pair | undefined,
    rootPair: Pair,
    fileHeaderComments?: string,
    mutateRootPair?: RootPairMutator
): Document {
    const splitDocument = new Document();
    if (sourceDocument.directives) {
        splitDocument.directives = sourceDocument.directives.clone();
    }

    const splitRoot = new YAMLMap(splitDocument.schema);
    const headerComments = copyDocumentHeaderComments(sourceDocument, splitRoot, fileHeaderComments);
    if (schemaPair) {
        const clonedSchemaPair = schemaPair.clone(splitDocument.schema);
        removeDuplicateHeaderComment(clonedSchemaPair, headerComments);
        splitRoot.items.push(clonedSchemaPair);
    }
    const clonedRootPair = rootPair.clone(splitDocument.schema);
    removeDuplicateHeaderComment(clonedRootPair, headerComments);
    splitRoot.items.push(clonedRootPair);
    splitDocument.contents = splitRoot;
    mutateRootPair?.(clonedRootPair, splitDocument);

    return splitDocument;
}

function getNestedScalarValue(node: unknown, path: string[]): string | undefined {
    let current = node;

    for (const key of path) {
        if (!isMap(current)) {
            return undefined;
        }

        const pair = findRootPair(current, key);
        if (!pair) {
            return undefined;
        }
        current = pair.value;
    }

    if (!isScalar(current) || current.value === null || current.value === undefined) {
        return undefined;
    }

    return String(current.value);
}

function setNestedScalarValue(node: unknown, path: string[], value: string, document: Document): void {
    if (path.length === 0) {
        throw new Error("Expected a non-empty YAML path.");
    }

    let current = node;
    for (const key of path.slice(0, -1)) {
        if (!isMap(current)) {
            throw new Error(`Expected YAML map before "${key}".`);
        }

        let pair = findRootPair(current, key);
        if (!pair) {
            pair = document.createPair(key, new YAMLMap(document.schema)) as Pair;
            current.items.push(pair);
        }
        current = pair.value;
    }

    if (!isMap(current)) {
        throw new Error(`Expected YAML map before "${path.at(-1)}".`);
    }

    const leafKey = path[path.length - 1];
    const pair = findRootPair(current, leafKey);
    if (pair) {
        pair.value = document.createNode(value);
        return;
    }

    current.items.push(document.createPair(leafKey, value) as Pair);
}

function copyDocumentHeaderComments(
    sourceDocument: Document,
    splitRoot: YAMLMap,
    fileHeaderComments?: string
): string | undefined {
    const sourceRoot = sourceDocument.contents;
    const comments = mergeUniqueCommentBlocks(
        fileHeaderComments,
        getCommentBefore(sourceDocument),
        getCommentBefore(sourceRoot),
        isMap(sourceRoot) ? getCommentBefore(sourceRoot.items[0]?.key) : undefined
    );

    if (comments) {
        splitRoot.commentBefore = comments;
    }

    return comments;
}

function removeDuplicateHeaderComment(pair: Pair, headerComments: string | undefined): void {
    if (!headerComments || !isScalar(pair.key) || !commentsEqual(pair.key.commentBefore, headerComments)) {
        return;
    }

    pair.key.commentBefore = undefined;
}

function extractLeadingComments(source: string): string | undefined {
    const comments: string[] = [];

    for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        if (!line.trim()) {
            if (comments.length === 0) {
                continue;
            }
            break;
        }

        const commentMatch = line.match(/^\s*#(.*)$/);
        if (!commentMatch) {
            break;
        }

        comments.push(commentMatch[1]);
    }

    return comments.length > 0 ? comments.join("\n") : undefined;
}

function mergeUniqueCommentBlocks(...blocks: Array<string | null | undefined>): string | undefined {
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const block of blocks) {
        for (const line of block?.split(/\r?\n/) ?? []) {
            const normalized = line.trim();
            if (!line || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            lines.push(line);
        }
    }

    return lines.length > 0 ? lines.join("\n") : undefined;
}

function getCommentBefore(node: unknown): string | null | undefined {
    return (node as { commentBefore?: string | null } | null | undefined)?.commentBefore;
}

function commentsEqual(left: string | null | undefined, right: string | null | undefined): boolean {
    return normalizeCommentBlock(left) === normalizeCommentBlock(right);
}

function normalizeCommentBlock(value: string | null | undefined): string {
    return value?.split(/\r?\n/).map(line => line.trim()).join("\n") ?? "";
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
