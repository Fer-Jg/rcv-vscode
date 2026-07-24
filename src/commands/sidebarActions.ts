import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as rcv from "../utils/rcv";
import { logger } from "../utils/logging";
import {
    preflightNewCvSplitFiles,
    splitRootKeysToSiblingFiles,
} from "../utils/yamlDocuments";

let contextCV = "";
let reloadCvsHandler: (() => void) | undefined;
let extensionUri: vscode.Uri | undefined;
let cvCreationPanel: vscode.WebviewPanel | undefined;

const themes = [
    "classic",
    "ember",
    "engineeringclassic",
    "engineeringresumes",
    "harvard",
    "ink",
    "moderncv",
    "opal",
    "sb2nov",
];

const locales = [
    "english",
    "arabic",
    "danish",
    "dutch",
    "french",
    "german",
    "hebrew",
    "hindi",
    "hungarian",
    "indonesian",
    "italian",
    "japanese",
    "korean",
    "mandarin_chinese",
    "norwegian_bokmål",
    "norwegian_nynorsk",
    "persian",
    "portuguese",
    "russian",
    "spanish",
    "turkish",
    "vietnamese",
];

interface CvCreationOptions {
    cvName: string;
    theme?: string;
    locale?: string;
    createTypstTemplates: boolean;
    createMarkdownTemplates: boolean;
}

interface CvCreationResult {
    splitFileCount: number;
    skippedSplitReason?: string;
}

function temporaryNotification(message: string, duration: number = 3000) {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: true,
        },
        async () => {
            await new Promise(resolve => setTimeout(resolve, duration));
        }
    );
}

function runPlaceholderWorkflow(startMessage: string, cancelledMessage: string, completedMessage: string) {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: startMessage,
            cancellable: true,
        },
        async (_progress, token) => {
            logger.info(startMessage);
            logger.info("Starting simulated workflow execution...");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("1 second delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("2 seconds delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("3 seconds delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("Workflow simulation completed.");

            if (token.isCancellationRequested) {
                temporaryNotification(cancelledMessage);
                return;
            }

            temporaryNotification(completedMessage, 3000);
        }
    );
}

export function setExtensionUri(uri: vscode.Uri) {
    extensionUri = uri;
}

export function setContextCV(cv: string) {
    contextCV = cv;
}

export function setReloadCvsHandler(handler: () => void) {
    reloadCvsHandler = handler;
}

export function openGlobalSettings() {
    vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", "rendercv-vscode");
}

export function extensionLogs() {
    logger.show();
}

export function reloadCvs() {
    if (!reloadCvsHandler) {
        logger.warn("Cannot reload CVs because the sidebar is not ready.");
        return;
    }

    reloadCvsHandler();
}

export function searchCvs() {
    runPlaceholderWorkflow(
        "Searching CVs...",
        "CV search cancelled.",
        "CV search completed! (WIP)"
    );
}

export function filterCvs() {
    runPlaceholderWorkflow(
        "Filtering CVs...",
        "CV filter cancelled.",
        "CV filter applied! (WIP)"
    );
}

export function openCvsHelp() {
    vscode.env.openExternal(vscode.Uri.parse("https://your-docs-url.example.com"));
}

export function newCvFromGlobal() {
    startCvCreationWizard();
}

export function newCv() {
    startCvCreationWizard();
}

async function startCvCreationWizard() {
    if (!extensionUri) {
        vscode.window.showErrorMessage("RenderCV extension assets are not ready yet.");
        return;
    }

    if (cvCreationPanel) {
        cvCreationPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const targetFolder = workspaceFolder ? getCvTargetFolder(workspaceFolder) : "";
    const assetRoot = vscode.Uri.joinPath(extensionUri, "cv-creation");

    cvCreationPanel = vscode.window.createWebviewPanel(
        "rendercvCreateCv",
        "Create CV",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [assetRoot],
        }
    );
    cvCreationPanel.webview.html = getCvCreationHtml(cvCreationPanel.webview, assetRoot, {
        themes,
        locales,
        targetFolder,
        hasWorkspace: Boolean(workspaceFolder),
    });
    cvCreationPanel.onDidDispose(() => {
        cvCreationPanel = undefined;
    });
    cvCreationPanel.webview.onDidReceiveMessage(async message => {
        if (message.command === "cancel") {
            cvCreationPanel?.dispose();
            return;
        }

        if (message.command !== "createCv") {
            return;
        }

        if (!workspaceFolder) {
            postCvCreationStatus("error", "Open a workspace folder before creating a CV.");
            return;
        }

        try {
            const result = await createCvFromOptions(message.options, workspaceFolder);
            if (result.skippedSplitReason) {
                postCvCreationStatus("success", `New CV created. Split skipped: ${result.skippedSplitReason}`);
                vscode.window.showWarningMessage(`New CV created, but splitting was skipped: ${result.skippedSplitReason}`);
            } else {
                postCvCreationStatus("success", `New CV created and split into ${result.splitFileCount} files.`);
                vscode.window.showInformationMessage(`New CV created and split into ${result.splitFileCount} files.`);
            }
            reloadCvs();
        } catch (error) {
            logger.error(`Failed to create CV: ${error}`);
            postCvCreationStatus("error", `Failed to create CV: ${error}`);
            vscode.window.showErrorMessage(`Failed to create CV: ${error}`);
        }
    });
}

async function createCvFromOptions(options: CvCreationOptions, workspaceFolder: vscode.WorkspaceFolder): Promise<CvCreationResult> {
    const cvName = options.cvName.trim();
    if (!cvName) {
        throw new Error("CV name is required.");
    }

    const targetFolder = getCvTargetFolder(workspaceFolder);
    const args = buildNewCvArgs({ ...options, cvName });

    postCvCreationStatus("busy", "Checking output files...");
    const preflight = await preflightNewCvSplitFiles(targetFolder, cvName);
    if (preflight.conflicts.length > 0) {
        throw new Error(`Cannot create CV because these files already exist: ${preflight.conflicts.join(", ")}`);
    }

    postCvCreationStatus("busy", "Checking RenderCV CLI...");
    const cliIsReady = await rcv.detectRenderCVCliPath(false);
    if (!cliIsReady) {
        throw new Error("RenderCV CLI path is not configured.");
    }

    postCvCreationStatus("busy", "Creating CV file...");
    await fs.promises.mkdir(targetFolder, { recursive: true });
    const output = await rcv.executeRCVCommand(args, targetFolder);
    logger.info(`RenderCV CLI output: ${output}`);

    const createdFile = preflight.sourceFilePath;
    if (!fs.existsSync(createdFile)) {
        throw new Error(`RenderCV finished, but the expected YAML file was not created: ${createdFile}`);
    }

    postCvCreationStatus("busy", "Splitting YAML sections...");
    const splitResult = await splitRootKeysToSiblingFiles(createdFile);

    return {
        splitFileCount: splitResult.createdFiles.length,
        skippedSplitReason: splitResult.skippedReason,
    };
}

function buildNewCvArgs(options: CvCreationOptions): string[] {
    const args = ["new"];
    if (options.theme) {
        args.push("--theme", options.theme);
    }
    if (options.locale) {
        args.push("--locale", options.locale);
    }
    if (options.createTypstTemplates) {
        args.push("--create-typst-templates");
    }
    if (options.createMarkdownTemplates) {
        args.push("--create-markdown-templates");
    }
    args.push(options.cvName.trim());
    return args;
}

function getCvTargetFolder(workspaceFolder: vscode.WorkspaceFolder): string {
    const config = vscode.workspace.getConfiguration("rendercv-vscode");
    const yamlFilesFolder = config.get<string>("CVYamlFilesFolder", "yamls");
    return path.isAbsolute(yamlFilesFolder)
        ? yamlFilesFolder
        : path.join(workspaceFolder.uri.fsPath, yamlFilesFolder);
}

function postCvCreationStatus(status: "idle" | "busy" | "success" | "error", message: string) {
    cvCreationPanel?.webview.postMessage({
        command: "status",
        status,
        message,
    });
}

function getCvCreationHtml(
    webview: vscode.Webview,
    assetRoot: vscode.Uri,
    state: { themes: string[]; locales: string[]; targetFolder: string; hasWorkspace: boolean }
): string {
    const nonce = getNonce();
    const htmlPath = path.join(assetRoot.fsPath, "index.html");
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, "style.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, "main.js"));

    return fs.readFileSync(htmlPath, "utf8")
        .replaceAll("{{nonce}}", nonce)
        .replace("{{cspSource}}", webview.cspSource)
        .replace("{{styleUri}}", styleUri.toString())
        .replace("{{scriptUri}}", scriptUri.toString())
        .replace("{{state}}", JSON.stringify(state));
}

function getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export async function previewCvSidebar(str: string) {
    temporaryNotification(`Previewing ${str}...`, 3000);
    rcv.previewFileAsCV(str);
}

export function duplicateCV() {
    runPlaceholderWorkflow(
        `Duplicating CV ${contextCV}...`,
        "CV duplication cancelled.",
        `CV duplicated successfully! (WIP) ${contextCV}`
    );
}

export async function sendFeedback() {
    runPlaceholderWorkflow(
        "Sending feedback...",
        "Feedback cancelled.",
        "Feedback sent successfully! (WIP)"
    );
}
