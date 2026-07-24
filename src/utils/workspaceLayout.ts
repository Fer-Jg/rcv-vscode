import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface CvWorkspaceLayout {
    workspaceRoot: string;
    globalsFolder: string;
    yamlRoot: string;
    outputsRoot: string;
}

export interface CvFolderLayout extends CvWorkspaceLayout {
    cvName: string;
    cvYamlFolder: string;
    outputFolder: string;
    cvFile: string;
    designFile: string;
    localeFile: string;
    settingsFile: string;
}

export interface GlobalConfigFiles {
    design: string;
    locale: string;
    settings: string;
}

export function getWorkspaceLayout(workspaceFolder: vscode.WorkspaceFolder): CvWorkspaceLayout {
    const config = vscode.workspace.getConfiguration("rendercv-vscode");
    const yamlFilesFolder = config.get<string>("CVYamlFilesFolder", "yamls");
    const defaultOutputPath = config.get<string>("defaultOutputPath", "");
    const workspaceRoot = workspaceFolder.uri.fsPath;

    return {
        workspaceRoot,
        globalsFolder: path.join(workspaceRoot, "globals"),
        yamlRoot: path.isAbsolute(yamlFilesFolder)
            ? yamlFilesFolder
            : path.join(workspaceRoot, yamlFilesFolder),
        outputsRoot: defaultOutputPath.trim()
            ? path.isAbsolute(defaultOutputPath)
                ? defaultOutputPath
                : path.join(workspaceRoot, defaultOutputPath)
            : path.join(workspaceRoot, "outputs"),
    };
}

export function getCvFolderLayout(workspaceFolder: vscode.WorkspaceFolder, cvName: string): CvFolderLayout {
    const layout = getWorkspaceLayout(workspaceFolder);
    const safeCvName = sanitizeCvFolderName(cvName);
    const cvYamlFolder = path.join(layout.yamlRoot, safeCvName);

    return {
        ...layout,
        cvName: safeCvName,
        cvYamlFolder,
        outputFolder: path.join(layout.outputsRoot, safeCvName),
        cvFile: path.join(cvYamlFolder, "cv.yaml"),
        designFile: path.join(cvYamlFolder, "design.yaml"),
        localeFile: path.join(cvYamlFolder, "locale.yaml"),
        settingsFile: path.join(cvYamlFolder, "settings.yaml"),
    };
}

export function getGlobalConfigFiles(layout: CvWorkspaceLayout): GlobalConfigFiles {
    return {
        design: path.join(layout.globalsFolder, "design.yaml"),
        locale: path.join(layout.globalsFolder, "locale.yaml"),
        settings: path.join(layout.globalsFolder, "settings.yaml"),
    };
}

export function getCvFolderLayoutForCvFile(cvFile: string): CvFolderLayout | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cvFile));
    if (!workspaceFolder || path.basename(cvFile).toLowerCase() !== "cv.yaml") {
        return undefined;
    }

    return getCvFolderLayout(workspaceFolder, path.basename(path.dirname(cvFile)));
}

export function sanitizeCvFolderName(value: string): string {
    const sanitized = value
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!sanitized) {
        throw new Error("CV name is required.");
    }

    if (sanitized === "." || sanitized === "..") {
        throw new Error("CV name cannot be . or ..");
    }

    return sanitized;
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export async function findFirstExistingPath(paths: string[]): Promise<string | undefined> {
    for (const filePath of paths) {
        if (await pathExists(filePath)) {
            return filePath;
        }
    }

    return undefined;
}
