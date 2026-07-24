import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as rcv from "../utils/rcv";
import { logger } from "../utils/logging";
import {
    predictRenderCvSourceFileName,
    preflightYamlSplitFiles,
    splitRootKeysToFiles,
    type SplitRootDestination,
} from "../utils/yamlDocuments";
import {
    getCvFolderLayout,
    getGlobalConfigFiles,
    getWorkspaceLayout,
    pathExists,
} from "../utils/workspaceLayout";

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
    personName: string;
    cvName: string;
    theme?: string;
    locale?: string;
    useLocalDesign: boolean;
    useLocalLocale: boolean;
    useLocalSettings: boolean;
    saveDesignAsGlobal: boolean;
    saveLocaleAsGlobal: boolean;
    saveSettingsAsGlobal: boolean;
    createTypstTemplates: boolean;
    createMarkdownTemplates: boolean;
    deleteExistingOutputFolder: boolean;
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
    const layout = workspaceFolder ? getWorkspaceLayout(workspaceFolder) : undefined;
    const globals = layout ? getGlobalConfigFiles(layout) : undefined;
    const targetFolder = layout ? layout.yamlRoot : "";
    const assetRoot = vscode.Uri.joinPath(extensionUri, "cv-creation");
    const globalState = globals
        ? {
            design: fs.existsSync(globals.design),
            locale: fs.existsSync(globals.locale),
            settings: fs.existsSync(globals.settings),
        }
        : { design: false, locale: false, settings: false };

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
        globals: globalState,
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
            if (message.command === "checkOutputFolder") {
                await postOutputFolderStatus(message.cvName, workspaceFolder);
            }
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
    const personName = options.personName.trim();
    if (!personName) {
        throw new Error("Person is required.");
    }

    const cvLayout = getCvFolderLayout(workspaceFolder, options.cvName);
    const globals = getGlobalConfigFiles(cvLayout);
    const globalExists = {
        design: await pathExists(globals.design),
        locale: await pathExists(globals.locale),
        settings: await pathExists(globals.settings),
    };
    const normalizedOptions: CvCreationOptions = {
        ...options,
        personName,
        cvName: cvLayout.cvName,
        useLocalDesign: options.useLocalDesign || !globalExists.design,
        useLocalLocale: options.useLocalLocale || !globalExists.locale,
        useLocalSettings: options.useLocalSettings || !globalExists.settings,
        saveDesignAsGlobal: options.saveDesignAsGlobal && !globalExists.design,
        saveLocaleAsGlobal: options.saveLocaleAsGlobal && !globalExists.locale,
        saveSettingsAsGlobal: options.saveSettingsAsGlobal && !globalExists.settings,
    };
    if (!normalizedOptions.useLocalDesign || !normalizedOptions.useLocalLocale || !normalizedOptions.useLocalSettings) {
        // This is intentionally allowed only when the corresponding global exists.
        if (!normalizedOptions.useLocalDesign && !globalExists.design) {
            throw new Error("Design must be overridden because globals/design.yaml does not exist.");
        }
        if (!normalizedOptions.useLocalLocale && !globalExists.locale) {
            throw new Error("Locale must be overridden because globals/locale.yaml does not exist.");
        }
        if (!normalizedOptions.useLocalSettings && !globalExists.settings) {
            throw new Error("Settings must be overridden because globals/settings.yaml does not exist.");
        }
    }
    const args = buildNewCvArgs(normalizedOptions);
    const sourceFilePath = path.join(cvLayout.cvYamlFolder, predictRenderCvSourceFileName(personName));
    const splitDestinations = buildSplitDestinations(normalizedOptions, cvLayout, globals);

    postCvCreationStatus("busy", "Checking output files...");
    if (await pathExists(cvLayout.cvYamlFolder)) {
        throw new Error(`Cannot create CV because this folder already exists: ${cvLayout.cvYamlFolder}. Choose a different CV name.`);
    }
    if (await pathExists(cvLayout.outputFolder)) {
        if (!normalizedOptions.deleteExistingOutputFolder) {
            throw new Error(`Cannot create CV because this output folder already exists: ${cvLayout.outputFolder}. Choose a different CV name or acknowledge deleting it.`);
        }

        await deleteExistingCvOutputFolder(cvLayout.outputFolder, cvLayout.outputsRoot);
    }
    const preflight = await preflightYamlSplitFiles(sourceFilePath, splitDestinations);
    if (preflight.conflicts.length > 0) {
        throw new Error(`Cannot create CV because these files already exist: ${preflight.conflicts.join(", ")}`);
    }

    postCvCreationStatus("busy", "Checking RenderCV CLI...");
    const cliIsReady = await rcv.detectRenderCVCliPath(false);
    if (!cliIsReady) {
        throw new Error("RenderCV CLI path is not configured.");
    }

    postCvCreationStatus("busy", "Creating CV file...");
    await fs.promises.mkdir(cvLayout.cvYamlFolder, { recursive: true });
    await fs.promises.mkdir(cvLayout.globalsFolder, { recursive: true });
    await fs.promises.mkdir(cvLayout.outputsRoot, { recursive: true });
    const output = await rcv.executeRCVCommand(args, cvLayout.cvYamlFolder);
    logger.info(`RenderCV CLI output: ${output}`);

    const createdFile = sourceFilePath;
    if (!fs.existsSync(createdFile)) {
        throw new Error(`RenderCV finished, but the expected YAML file was not created: ${createdFile}`);
    }

    postCvCreationStatus("busy", "Splitting YAML sections...");
    const splitResult = await splitRootKeysToFiles(createdFile, splitDestinations);

    return {
        splitFileCount: splitResult.createdFiles.length,
        skippedSplitReason: splitResult.skippedReason,
    };
}

async function postOutputFolderStatus(cvName: string | undefined, workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<void> {
    if (!workspaceFolder || !cvName) {
        cvCreationPanel?.webview.postMessage({
            command: "outputFolderStatus",
            cvName,
            exists: false,
            outputFolder: "",
        });
        return;
    }

    try {
        const cvLayout = getCvFolderLayout(workspaceFolder, cvName);
        cvCreationPanel?.webview.postMessage({
            command: "outputFolderStatus",
            cvName: cvLayout.cvName,
            exists: await pathExists(cvLayout.outputFolder),
            outputFolder: cvLayout.outputFolder,
        });
    } catch {
        cvCreationPanel?.webview.postMessage({
            command: "outputFolderStatus",
            cvName,
            exists: false,
            outputFolder: "",
        });
    }
}

async function deleteExistingCvOutputFolder(outputFolder: string, outputsRoot: string): Promise<void> {
    const resolvedOutputFolder = path.resolve(outputFolder);
    const resolvedOutputsRoot = path.resolve(outputsRoot);
    const relativePath = path.relative(resolvedOutputsRoot, resolvedOutputFolder);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to delete output folder outside outputs root: ${outputFolder}`);
    }

    postCvCreationStatus("busy", "Deleting existing output folder...");
    await fs.promises.rm(resolvedOutputFolder, { recursive: true, force: true });
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
    args.push(options.personName.trim());
    return args;
}

function buildSplitDestinations(
    options: CvCreationOptions,
    cvLayout: ReturnType<typeof getCvFolderLayout>,
    globals: ReturnType<typeof getGlobalConfigFiles>
): SplitRootDestination[] {
    return [
        { rootKey: "cv", localFile: cvLayout.cvFile },
        {
            rootKey: "design",
            localFile: options.useLocalDesign ? cvLayout.designFile : undefined,
            globalFile: options.saveDesignAsGlobal ? globals.design : undefined,
        },
        {
            rootKey: "locale",
            localFile: options.useLocalLocale ? cvLayout.localeFile : undefined,
            globalFile: options.saveLocaleAsGlobal ? globals.locale : undefined,
        },
        {
            rootKey: "settings",
            localFile: options.useLocalSettings ? cvLayout.settingsFile : undefined,
            globalFile: options.saveSettingsAsGlobal ? globals.settings : undefined,
        },
    ];
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
    state: {
        themes: string[];
        locales: string[];
        targetFolder: string;
        hasWorkspace: boolean;
        globals: { design: boolean; locale: boolean; settings: boolean };
    }
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

export async function revealOutputPdf(uri?: vscode.Uri | string) {
    const cvFile = getCvFileFromCommandArg(uri);
    if (!cvFile) {
        vscode.window.showWarningMessage("No CV selected.");
        return;
    }

    const outputFolder = await rcv.getStructuredCvOutputFolder(cvFile);
    if (!outputFolder) {
        vscode.window.showWarningMessage("Could not resolve a structured CV output folder for this file.");
        return;
    }

    let pdfPath = await rcv.findNewestPdf(outputFolder);
    if (!pdfPath) {
        const selection = await vscode.window.showWarningMessage(
            "No PDF output found.",
            "Render and reveal",
            "Cancel"
        );

        if (selection !== "Render and reveal") {
            return;
        }

        pdfPath = await rcv.renderFileAsCV(cvFile);
    }

    if (!pdfPath) {
        vscode.window.showWarningMessage("RenderCV finished, but no generated PDF was found.");
        return;
    }

    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(pdfPath));
}

function getCvFileFromCommandArg(uri?: vscode.Uri | string): string | undefined {
    if (typeof uri === "string") {
        return uri;
    }

    if (uri instanceof vscode.Uri) {
        return uri.fsPath;
    }

    return contextCV || undefined;
}

export async function sendFeedback() {
    runPlaceholderWorkflow(
        "Sending feedback...",
        "Feedback cancelled.",
        "Feedback sent successfully! (WIP)"
    );
}
