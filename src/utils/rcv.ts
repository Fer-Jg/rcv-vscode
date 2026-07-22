import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import logger from "./logging";

export default {
	detectRenderCVCliPath,
	executeRCVCommand
};

const execFileAsync = promisify(execFile);
const RENDERCV_EXECUTABLE = process.platform === "win32" ? "rendercv.exe" : "rendercv";
const YAML_EXTENSION_ID = "redhat.vscode-yaml";
const PDF_EXTENSION_ID = "tomoki1207.pdf";
const PDF_VIEW_TYPE = "pdf.preview";

export async function detectRenderCVCliPath(justCheck: boolean = false): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("rendercv-vscode");
	const currentPath = config.get<string>("renderCVCliPath");
	let configuredValidPath = false;

	if (currentPath) {
		// Try to use the user-defined path first to make sure it works.
		configuredValidPath = await checkRenderCVCliPath(currentPath);
	}

	// If the user-defined path is valid, we don't need to do anything else.
	if (configuredValidPath) { return true; }
	else if (justCheck) { return false; }

	// Check for a globally installed RenderCV CLI in the system PATH.
	const fromSystemPath = await findOnSystemPath();
	if (fromSystemPath) {
		return await confirmRenderCVCliPathUpdate(currentPath || "", fromSystemPath, "global");
	}
	
	// Check for a RenderCV CLI in a virtual environment (venv).
	const fromVenv = await findInVenv();
	if (fromVenv) {
		return await confirmRenderCVCliPathUpdate(currentPath || "", fromVenv, "venv");
	}

	// Check for a RenderCV CLI in a UV environment.
	const fromUv = await findInUvEnv();
	if (fromUv) {
		return await confirmRenderCVCliPathUpdate(currentPath || "", fromUv, "uv");
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

async function confirmRenderCVCliPathUpdate(origPath: string, newPath: string, source: string): Promise<boolean> {
	const errorMessage: string = origPath !== "" ? `You configured the RenderCV CLI path to: ${origPath}, but that did not work and we found a different path: ${newPath} from a ${source} environment. Would you like to update the path?` : `There was no RenderCV CLI path configured, but we found a possible path: ${newPath} from a ${source} environment. Would you like to update the path?`;

	const selection = await vscode.window.showErrorMessage(errorMessage, "Allow update", "I will change it manually");

	if (selection === "Allow update") {
		await updateRenderCVCliPath(newPath, source);
		return true;
	}

	if (selection === "I will change it manually") {
		const confirmation = await vscode.window.showErrorMessage(
			"The extension WILL NOT work until you set the correct path to the RenderCV CLI in the settings.",
			"Allow path update",
			"Dismiss"
		);

		if (confirmation === "Allow path update") {
			await updateRenderCVCliPath(newPath, source);
			return true;
		}
	}

	return false;
}

async function updateRenderCVCliPath(newPath: string, source: string): Promise<void> {
	const config = vscode.workspace.getConfiguration("rendercv-vscode");
	
	await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Workspace);
	if (source === "global") {
		await config.update("renderCVCliPath", newPath, vscode.ConfigurationTarget.Global);
	}
}

export async function executeRCVCommand(args: string[]): Promise<string> {
	const config = vscode.workspace.getConfiguration("rendercv-vscode");
	const cliPath = config.get<string>("renderCVCliPath");

	if (!cliPath) {
		throw new Error("RenderCV CLI path is not configured.");
	}

	try {
		const { stdout } = await execFileAsync(cliPath, args, {
			timeout: 5000,
			encoding: "utf-8",
			env: {
				...process.env,
				PYTHONUTF8: "1",
				PYTHONIOENCODING: "utf-8",
			},
		});
		return stdout;
	} catch (error) {
		logger.error(`Error executing RCV command: ${error}`);
		throw error;
	}
}

export async function previewFileAsCV(filePath: string): Promise<void> {
	try {
		await openYamlPreview(filePath);

		const editor = vscode.window.activeTextEditor;
		const rootPath = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath : "";

		if (rootPath === undefined || rootPath === null) {
			vscode.window.showErrorMessage("Could not determine the root path of the workspace. Please open a folder in VS Code.");
			return;
		}

		const OUTPUT_DIR = path.join(path.dirname(filePath), "outputs", path.parse(filePath).name);
		const GLOBALS_DIR = path.join(rootPath, "globals");
		const GLOBAL_DESIGN_FILE = path.join(GLOBALS_DIR, "design.yaml");
		const GLOBAL_LOCALE_FILE = path.join(GLOBALS_DIR, "locale.yaml");
		const GLOBAL_SETTINGS_FILE = path.join(GLOBALS_DIR, "settings.yaml");
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });

		const output = await executeRCVCommand([
			"render", filePath,
			"--output-folder", OUTPUT_DIR,
			"--design", GLOBAL_DESIGN_FILE,
			"--locale-catalog", GLOBAL_LOCALE_FILE,
			"--settings", GLOBAL_SETTINGS_FILE,
		]);
		logger.info(`RenderCV CLI output: ${output}`);

		const pdfPath = await findGeneratedPdf(filePath);
		logger.info(`Generated PDF path: ${pdfPath}`);
		if (!pdfPath) {
			vscode.window.showWarningMessage("RenderCV finished, but no generated PDF was found.");
			return;
		}

		await openPdfPreview(pdfPath);
	} catch (error) {
		logger.error(`RenderCV CLI output: ${error}`);
		vscode.window.showErrorMessage(`Failed to preview CV: ${error}`);
	}
}

async function openYamlPreview(filePath: string): Promise<void> {
	const yamlExtension = vscode.extensions.getExtension(YAML_EXTENSION_ID);
	if (!yamlExtension) {
		vscode.window.showWarningMessage("Install redhat.vscode-yaml to get the YAML editing experience.");
	} else if (!yamlExtension.isActive) {
		await yamlExtension.activate();
	}

	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
	await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.One,
		preview: false,
		preserveFocus: false
	});
}

async function openPdfPreview(pdfPath: string): Promise<void> {
	const pdfExtension = vscode.extensions.getExtension(PDF_EXTENSION_ID);
	if (!pdfExtension) {
		vscode.window.showWarningMessage("Install tomoki1207.pdf to preview the generated PDF in VS Code.");
		return;
	}

	if (!pdfExtension.isActive) {
		await pdfExtension.activate();
	}

	await vscode.commands.executeCommand(
		"vscode.openWith",
		vscode.Uri.file(pdfPath),
		PDF_VIEW_TYPE,
		{
			viewColumn: vscode.ViewColumn.Two,
			preview: false,
			preserveFocus: true
		}
	);
}

async function findGeneratedPdf(originPath: string): Promise<string | undefined> {
	const outputDirectory = path.join(
		path.dirname(originPath),
		"outputs",
		path.parse(originPath).name
	);

	if (fs.existsSync(outputDirectory)) {
		const pdf = fs
			.readdirSync(outputDirectory)
			.find(file => path.extname(file).toLowerCase() === ".pdf");

		if (pdf) {
			return path.join(outputDirectory, pdf);
		}
	}

	try {
		const entries = await fs.promises.readdir(outputDirectory, { withFileTypes: true });
		const pdfStats = await Promise.all(
			entries
				.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
				.map(async entry => {
					const pdfPath = path.join(outputDirectory, entry.name);
					const stat = await fs.promises.stat(pdfPath);
					return { pdfPath, mtimeMs: stat.mtimeMs };
				})
		);

		return pdfStats
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.at(0)?.pdfPath;
	} catch {
		return undefined;
	}
}
