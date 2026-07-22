import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

export default {
    detectRenderCVCliPath
};

const execFileAsync = promisify(execFile);
const RENDERCV_EXECUTABLE = process.platform === "win32" ? "rendercv.exe" : "rendercv";

export async function detectRenderCVCliPath(): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("rendercv-vscode");
	const currentPath = config.get<string>("renderCVCliPath");
	let configuredValidPath = false;

	if (currentPath) {
		// Try to use the user-defined path first to make sure it works.
		configuredValidPath = await checkRenderCVCliPath(currentPath);
	}

	// If the user-defined path is valid, we don't need to do anything else.
	if (configuredValidPath) { return true; }

	// Check for a globally installed RenderCV CLI in the system PATH.
	const fromSystemPath = await findOnSystemPath();
	if (fromSystemPath) {
		await confirmRenderCVCliPathUpdate(currentPath || "", fromSystemPath, "global");
		return false;
	}
	
	// Check for a RenderCV CLI in a virtual environment (venv).
	const fromVenv = await findInVenv();
	if (fromVenv) {
		await confirmRenderCVCliPathUpdate(currentPath || "", fromVenv, "venv");
		return false;
	}

	// Check for a RenderCV CLI in a UV environment.
	const fromUv = await findInUvEnv();
	if (fromUv) {
		await confirmRenderCVCliPathUpdate(currentPath || "", fromUv, "uv");
		return false;
	}

	// If none of the above methods find a valid RenderCV CLI path, prompt the user.
	const selection = await vscode.window.showWarningMessage(
		"Couldn't find the RenderCV CLI automatically. Please set its path manually.",
		"Open Settings"
	);
	if (selection === "Open Settings") {
		vscode.commands.executeCommand(
			"workbench.action.openSettings",
			"rendercv-vscode.renderCVCliPath"
		);
	}
	return false;
}

async function checkRenderCVCliPath(cliPath: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync(cliPath, ["--version"], { timeout: 5000 });
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

async function findOnSystemPath(): Promise<string | undefined> {
	const finder = process.platform === "win32" ? "where" : "which";
	try {
		const { stdout } = await execFileAsync(finder, [RENDERCV_EXECUTABLE]);
		const firstMatch = stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean);
		if (firstMatch && await checkRenderCVCliPath(firstMatch)) {
			return firstMatch;
		}
	} catch {
		// not found on PATH
	}
	return undefined;
}

async function findInVenv(): Promise<string | undefined> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return undefined; }

	const venvNames = [".venv", "venv"];
	const binSubdir = process.platform === "win32" ? "Scripts" : "bin";

	for (const folder of folders) {
		for (const venvName of venvNames) {
			const candidate = path.join(folder.uri.fsPath, venvName, binSubdir, RENDERCV_EXECUTABLE);
			if (fs.existsSync(candidate) && await checkRenderCVCliPath(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

async function findInUvEnv(): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("uv", ["tool", "dir"]);
		const toolDir = stdout.trim();
		const candidate = path.join(
			toolDir,
			"rendercv",
			process.platform === "win32" ? "Scripts" : "bin",
			RENDERCV_EXECUTABLE
		);
		if (fs.existsSync(candidate) && await checkRenderCVCliPath(candidate)) {
			return candidate;
		}
	} catch {
		// uv not installed or command failed
	}
	return undefined;
}

async function confirmRenderCVCliPathUpdate(origPath: string, newPath: string, source: string): Promise<void> {

	const errorMessage: string = origPath !== "" ? `You configured the RenderCV CLI path to: ${origPath}, but that did not work and we found a different path: ${newPath} from a ${source} environment. Would you like to update the path?` : `There was no RenderCV CLI path configured, but we found a possible path: ${newPath} from a ${source} environment. Would you like to update the path?`;

	vscode.window.showErrorMessage(errorMessage, "Allow update", "I will change it manually").then(async selection => {
		if (selection === "Allow update") {
			const config = vscode.workspace.getConfiguration("rendercv-vscode");
			await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Workspace);
			await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.WorkspaceFolder);
			if (source === "global") {
				await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Global);
			}
		}
		if (selection === "I will change it manually") {
			vscode.window.showErrorMessage("The extension WILL NOT work until you set the correct path to the RenderCV CLI in the settings.", "Allow update", "Dismiss").then(async selection => {
				if (selection === "Allow update") {
					const config = vscode.workspace.getConfiguration("rendercv-vscode");
					await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Workspace);
					await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.WorkspaceFolder);
					if (source === "global") {
						await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Global);
					}
				}
				if (selection === "Dismiss") {
					// Do nothing
				}
			});
		}
	});
}