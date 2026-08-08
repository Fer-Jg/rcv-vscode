import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as rcv from "../utils/rcv";
import { logger } from "../utils/logging";
import {
    getRootKeyScalarValue,
    parseYamlFile,
    predictRenderCvSourceFileName,
    preflightYamlSplitFiles,
    setRootKeyScalarValue,
    splitRootKeysToFiles,
    writeRootKeysFromFiles,
    type RootKeySourceDestination,
    type SplitRootDestination,
} from "../utils/yamlDocuments";
import {
    getCvFolderLayout,
    getCvFolderLayoutForCvFile,
    getGlobalConfigFiles,
    getWorkspaceLayout,
    formatWorkspaceRelativePath,
    pathExists,
} from "../utils/workspaceLayout";
import { temporaryNotification, runPlaceholderWorkflow } from "../utils/devTools";

let contextCV = "";
let reloadCvsHandler: (() => void) | undefined;
let extensionUri: vscode.Uri | undefined;
let cvCreationPanel: vscode.WebviewPanel | undefined;

type CvWizardMode = "create" | "clone";
type ConfigSourceChoice = "local" | "global" | "missing";

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

interface CvCreationWizardState {
    mode: CvWizardMode;
    themes: string[];
    locales: string[];
    targetFolder: string;
    targetFolderDisplay: string;
    hasWorkspace: boolean;
    globals: { design: boolean; locale: boolean; settings: boolean };
    initial: {
        personName: string;
        cvName: string;
        theme?: string;
        locale?: string;
        useLocalDesign?: boolean;
        useLocalLocale?: boolean;
        useLocalSettings?: boolean;
    };
    clone?: {
        sourceCvFile: string;
        sourceCvName: string;
        sourceChoices: {
            design: ConfigSourceChoice;
            locale: ConfigSourceChoice;
            settings: ConfigSourceChoice;
        };
    };
}

interface CloneSourceConfig {
    sourceFile?: string;
    choice: ConfigSourceChoice;
}

interface CloneSourceState {
    sourceLayout: NonNullable<ReturnType<typeof getCvFolderLayoutForCvFile>>;
    personName: string;
    defaultCvName: string;
    theme?: string;
    locale?: string;
    configs: {
        design: CloneSourceConfig;
        locale: CloneSourceConfig;
        settings: CloneSourceConfig;
    };
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
        "🚨 WIP Searching CVs WIP 🚨",
        "🚨 WIP CV search cancelled WIP 🚨",
        "🚨 WIP CV search could not be completed WIP 🚨"
    );
}

export function filterCvs() {
    runPlaceholderWorkflow(
        "🚨 WIP Filtering CVs WIP 🚨",
        "🚨 WIP CV filter cancelled WIP 🚨",
        "🚨 WIP CV filter could not be completed WIP 🚨"
    );
}

export function openCvsHelp() {
    vscode.env.openExternal(vscode.Uri.parse("https://rcv-vscode.ferj.dev"));
}

export function newCvFromGlobal() {
    startCvCreationWizard({ mode: "create" });
}

export function newCv() {
    startCvCreationWizard({ mode: "create" });
}

async function startCvCreationWizard(request: { mode: "create" } | { mode: "clone"; sourceCvFile: string }) {
    if (!extensionUri) {
        vscode.window.showErrorMessage("RenderCV extension assets are not ready yet.");
        return;
    }

    if (request.mode === "create") {
        await vscode.commands.executeCommand("setContext", "rendercv-vscode.walkthrough.createCvStarted", true);
    }

    if (cvCreationPanel) {
        cvCreationPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const layout = workspaceFolder ? getWorkspaceLayout(workspaceFolder) : undefined;
    const globals = layout ? getGlobalConfigFiles(layout) : undefined;
    const targetFolder = layout ? layout.yamlRoot : "";
    const targetFolderDisplay = layout && workspaceFolder
        ? formatWorkspaceRelativePath(layout.yamlRoot, workspaceFolder)
        : targetFolder;
    const assetRoot = vscode.Uri.joinPath(extensionUri, "cv-creation");
    const globalState = globals
        ? {
            design: fs.existsSync(globals.design),
            locale: fs.existsSync(globals.locale),
            settings: fs.existsSync(globals.settings),
        }
        : { design: false, locale: false, settings: false };
    let cloneState: CloneSourceState | undefined;

    if (request.mode === "clone") {
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("Open a workspace folder before cloning a CV.");
            return;
        }

        try {
            cloneState = await getCloneSourceState(request.sourceCvFile, workspaceFolder);
        } catch (error) {
            logger.error(`Failed to prepare clone wizard: ${error}`);
            vscode.window.showErrorMessage(`Failed to prepare clone wizard: ${error}`);
            return;
        }
    }

    const wizardState: CvCreationWizardState = {
        mode: request.mode,
        themes,
        locales,
        targetFolder,
        targetFolderDisplay,
        hasWorkspace: Boolean(workspaceFolder),
        globals: globalState,
        initial: cloneState
            ? {
                personName: cloneState.personName,
                cvName: cloneState.defaultCvName,
                theme: cloneState.theme,
                locale: cloneState.locale,
                useLocalDesign: cloneState.configs.design.choice !== "global",
                useLocalLocale: cloneState.configs.locale.choice !== "global",
                useLocalSettings: cloneState.configs.settings.choice !== "global",
            }
            : {
                personName: "",
                cvName: "",
                theme: "classic",
                locale: "english",
            },
        clone: cloneState && request.mode === "clone"
            ? {
                sourceCvFile: request.sourceCvFile,
                sourceCvName: cloneState.sourceLayout.cvName,
                sourceChoices: {
                    design: cloneState.configs.design.choice,
                    locale: cloneState.configs.locale.choice,
                    settings: cloneState.configs.settings.choice,
                },
            }
            : undefined,
    };

    cvCreationPanel = vscode.window.createWebviewPanel(
        request.mode === "clone" ? "rendercvCloneCv" : "rendercvCreateCv",
        request.mode === "clone" ? "Clone CV" : "Create CV",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [assetRoot],
        }
    );
    cvCreationPanel.webview.html = getCvCreationHtml(cvCreationPanel.webview, assetRoot, wizardState);
    cvCreationPanel.onDidDispose(() => {
        cvCreationPanel = undefined;
    });
    cvCreationPanel.webview.onDidReceiveMessage(async message => {
        if (message.command === "cancel") {
            cvCreationPanel?.dispose();
            return;
        }

        if (message.command !== "createCv" && message.command !== "cloneCv") {
            if (message.command === "checkOutputFolder") {
                await postOutputFolderStatus(message.cvName, workspaceFolder);
            }
            return;
        }

        if (!workspaceFolder) {
            postCvCreationStatus("error", `Open a workspace folder before ${request.mode === "clone" ? "cloning" : "creating"} a CV.`);
            return;
        }

        try {
            const result = request.mode === "clone"
                ? await cloneCvFromOptions(message.options, request.sourceCvFile, workspaceFolder)
                : await createCvFromOptions(message.options, workspaceFolder);
            if (result.skippedSplitReason) {
                postCvCreationStatus("success", `CV ${request.mode === "clone" ? "cloned" : "created"}. Split skipped: ${result.skippedSplitReason}`);
                vscode.window.showWarningMessage(`CV ${request.mode === "clone" ? "cloned" : "created"}, but splitting was skipped: ${result.skippedSplitReason}`);
            } else {
                postCvCreationStatus("success", `CV ${request.mode === "clone" ? "cloned" : "created"} into ${result.splitFileCount} files.`);
                vscode.window.showInformationMessage(`CV ${request.mode === "clone" ? "cloned" : "created"} into ${result.splitFileCount} files.`);
            }
            reloadCvs();
        } catch (error) {
            logger.error(`Failed to ${request.mode} CV: ${error}`);
            postCvCreationStatus("error", `Failed to ${request.mode} CV: ${error}`);
            vscode.window.showErrorMessage(`Failed to ${request.mode} CV: ${error}`);
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
        throw new Error(`Cannot create CV because this folder already exists: ${displayPath(cvLayout.cvYamlFolder, workspaceFolder)}. Choose a different CV name.`);
    }
    if (await pathExists(cvLayout.outputFolder)) {
        if (!normalizedOptions.deleteExistingOutputFolder) {
            throw new Error(`Cannot create CV because this output folder already exists: ${displayPath(cvLayout.outputFolder, workspaceFolder)}. Choose a different CV name or acknowledge deleting it.`);
        }

        await deleteExistingCvOutputFolder(cvLayout.outputFolder, cvLayout.outputsRoot);
    }
    const preflight = await preflightYamlSplitFiles(sourceFilePath, splitDestinations);
    if (preflight.conflicts.length > 0) {
        throw new Error(`Cannot create CV because these files already exist: ${displayPaths(preflight.conflicts, workspaceFolder)}`);
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

async function cloneCvFromOptions(options: CvCreationOptions, sourceCvFile: string, workspaceFolder: vscode.WorkspaceFolder): Promise<CvCreationResult> {
    const cloneState = await getCloneSourceState(sourceCvFile, workspaceFolder);
    const personName = options.personName.trim();
    if (!personName) {
        throw new Error("Person is required.");
    }

    const cvLayout = getCvFolderLayout(workspaceFolder, options.cvName);
    if (cvLayout.cvName === cloneState.sourceLayout.cvName) {
        throw new Error("Choose a different CV name before cloning.");
    }

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

    postCvCreationStatus("busy", "Checking output files...");
    if (await pathExists(cvLayout.cvYamlFolder)) {
        throw new Error(`Cannot clone CV because this folder already exists: ${displayPath(cvLayout.cvYamlFolder, workspaceFolder)}. Choose a different CV name.`);
    }
    if (await pathExists(cvLayout.outputFolder)) {
        if (!normalizedOptions.deleteExistingOutputFolder) {
            throw new Error(`Cannot clone CV because this output folder already exists: ${displayPath(cvLayout.outputFolder, workspaceFolder)}. Choose a different CV name or acknowledge deleting it.`);
        }

        await deleteExistingCvOutputFolder(cvLayout.outputFolder, cvLayout.outputsRoot);
    }

    const destinations = buildCloneDestinations(normalizedOptions, cvLayout, globals, cloneState);
    assertCloneRequiredConfigsExist(normalizedOptions, cloneState);
    const outputPaths = destinations.flatMap(destination => [
        destination.localFile,
        destination.globalFile,
    ]).filter((filePath): filePath is string => Boolean(filePath));
    const existingOutputs = await Promise.all(outputPaths.map(async filePath => await pathExists(filePath) ? filePath : undefined));
    const conflicts = existingOutputs.filter((filePath): filePath is string => Boolean(filePath));
    if (conflicts.length > 0) {
        throw new Error(`Cannot clone CV because these files already exist: ${displayPaths(conflicts, workspaceFolder)}`);
    }

    postCvCreationStatus("busy", "Cloning CV files...");
    await fs.promises.mkdir(cvLayout.cvYamlFolder, { recursive: true });
    await fs.promises.mkdir(cvLayout.globalsFolder, { recursive: true });
    await fs.promises.mkdir(cvLayout.outputsRoot, { recursive: true });
    const result = await writeRootKeysFromFiles(destinations);

    return {
        splitFileCount: result.createdFiles.length,
        skippedSplitReason: result.skippedReason,
    };
}

async function postOutputFolderStatus(cvName: string | undefined, workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<void> {
    if (!workspaceFolder || !cvName) {
        cvCreationPanel?.webview.postMessage({
            command: "outputFolderStatus",
            cvName,
            exists: false,
            outputFolder: "",
            outputFolderDisplay: "",
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
            outputFolderDisplay: formatWorkspaceRelativePath(cvLayout.outputFolder, workspaceFolder),
        });
    } catch {
        cvCreationPanel?.webview.postMessage({
            command: "outputFolderStatus",
            cvName,
            exists: false,
            outputFolder: "",
            outputFolderDisplay: "",
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

function buildCloneDestinations(
    options: CvCreationOptions,
    cvLayout: ReturnType<typeof getCvFolderLayout>,
    globals: ReturnType<typeof getGlobalConfigFiles>,
    cloneState: CloneSourceState
): RootKeySourceDestination[] {
    const destinations: RootKeySourceDestination[] = [
        {
            rootKey: "cv",
            sourceFile: cloneState.sourceLayout.cvFile,
            localFile: cvLayout.cvFile,
            mutate: (_rootPair, document) => setRootKeyScalarValue(document, "cv", ["name"], options.personName.trim()),
        },
    ];

    const designFiles = getCloneOutputFiles(options.useLocalDesign, options.saveDesignAsGlobal, cvLayout.designFile, globals.design);
    if (cloneState.configs.design.sourceFile && cloneOutputHasFiles(designFiles)) {
        destinations.push({
            rootKey: "design",
            sourceFile: cloneState.configs.design.sourceFile,
            localFile: designFiles.localFile,
            globalFile: designFiles.globalFile,
            mutate: options.theme
                ? (_rootPair, document) => setRootKeyScalarValue(document, "design", ["theme"], options.theme!)
                : undefined,
        });
    }

    const localeFiles = getCloneOutputFiles(options.useLocalLocale, options.saveLocaleAsGlobal, cvLayout.localeFile, globals.locale);
    if (cloneState.configs.locale.sourceFile && cloneOutputHasFiles(localeFiles)) {
        destinations.push({
            rootKey: "locale",
            sourceFile: cloneState.configs.locale.sourceFile,
            localFile: localeFiles.localFile,
            globalFile: localeFiles.globalFile,
            mutate: options.locale
                ? (_rootPair, document) => setRootKeyScalarValue(document, "locale", ["language"], options.locale!)
                : undefined,
        });
    }

    const settingsFiles = getCloneOutputFiles(options.useLocalSettings, options.saveSettingsAsGlobal, cvLayout.settingsFile, globals.settings);
    if (cloneState.configs.settings.sourceFile && cloneOutputHasFiles(settingsFiles)) {
        destinations.push({
            rootKey: "settings",
            sourceFile: cloneState.configs.settings.sourceFile,
            localFile: settingsFiles.localFile,
            globalFile: settingsFiles.globalFile,
        });
    }

    return destinations;
}

function assertCloneRequiredConfigsExist(options: CvCreationOptions, cloneState: CloneSourceState): void {
    const requiredConfigs = [
        { label: "design", required: options.useLocalDesign || options.saveDesignAsGlobal, config: cloneState.configs.design },
        { label: "locale", required: options.useLocalLocale || options.saveLocaleAsGlobal, config: cloneState.configs.locale },
        { label: "settings", required: options.useLocalSettings || options.saveSettingsAsGlobal, config: cloneState.configs.settings },
    ];

    const missing = requiredConfigs
        .filter(item => item.required && !item.config.sourceFile)
        .map(item => item.label);

    if (missing.length > 0) {
        throw new Error(`Cannot clone missing source configuration: ${missing.join(", ")}.`);
    }
}

function getCloneOutputFiles(useLocal: boolean, saveAsGlobal: boolean, localFile: string, globalFile: string): { localFile?: string; globalFile?: string } {
    return {
        localFile: useLocal ? localFile : undefined,
        globalFile: saveAsGlobal ? globalFile : undefined,
    };
}

function cloneOutputHasFiles(files: { localFile?: string; globalFile?: string }): boolean {
    return Boolean(files.localFile || files.globalFile);
}

async function getCloneSourceState(sourceCvFile: string, workspaceFolder: vscode.WorkspaceFolder): Promise<CloneSourceState> {
    const sourceLayout = getCvFolderLayoutForCvFile(sourceCvFile);
    if (!sourceLayout) {
        throw new Error("Select a structured cv.yaml file to clone.");
    }

    const owningWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sourceCvFile));
    if (!owningWorkspace || owningWorkspace.uri.fsPath !== workspaceFolder.uri.fsPath) {
        throw new Error("The CV to clone must belong to the current workspace.");
    }

    if (!await pathExists(sourceLayout.cvFile)) {
        throw new Error(`Cannot clone missing CV file: ${displayPath(sourceLayout.cvFile, workspaceFolder)}`);
    }

    const sourceDocument = await parseYamlFile(sourceLayout.cvFile);
    const personName = getRootKeyScalarValue(sourceDocument, "cv", ["name"]) || "";
    const globals = getGlobalConfigFiles(sourceLayout);
    const design = await resolveCloneSourceConfig(sourceLayout.designFile, globals.design);
    const locale = await resolveCloneSourceConfig(sourceLayout.localeFile, globals.locale);
    const settings = await resolveCloneSourceConfig(sourceLayout.settingsFile, globals.settings);

    return {
        sourceLayout,
        personName,
        defaultCvName: await buildDefaultCloneCvName(workspaceFolder, sourceLayout.cvName),
        theme: design.sourceFile ? getRootKeyScalarValue(await parseYamlFile(design.sourceFile), "design", ["theme"]) : undefined,
        locale: locale.sourceFile ? getRootKeyScalarValue(await parseYamlFile(locale.sourceFile), "locale", ["language"]) : undefined,
        configs: { design, locale, settings },
    };
}

async function resolveCloneSourceConfig(localFile: string, globalFile: string): Promise<CloneSourceConfig> {
    if (await pathExists(localFile)) {
        return { sourceFile: localFile, choice: "local" };
    }

    if (await pathExists(globalFile)) {
        return { sourceFile: globalFile, choice: "global" };
    }

    return { choice: "missing" };
}

async function buildDefaultCloneCvName(workspaceFolder: vscode.WorkspaceFolder, sourceCvName: string): Promise<string> {
    let candidate = `${sourceCvName}_copy`;
    let suffix = 2;
    while (await pathExists(getCvFolderLayout(workspaceFolder, candidate).cvYamlFolder)) {
        candidate = `${sourceCvName}_copy_${suffix}`;
        suffix += 1;
    }

    return candidate;
}

function postCvCreationStatus(status: "idle" | "busy" | "success" | "error", message: string) {
    cvCreationPanel?.webview.postMessage({
        command: "status",
        status,
        message,
    });
}

function displayPath(filePath: string, workspaceFolder: vscode.WorkspaceFolder): string {
    return formatWorkspaceRelativePath(filePath, workspaceFolder);
}

function displayPaths(filePaths: string[], workspaceFolder: vscode.WorkspaceFolder): string {
    return filePaths.map(filePath => displayPath(filePath, workspaceFolder)).join(", ");
}

function getCvCreationHtml(
    webview: vscode.Webview,
    assetRoot: vscode.Uri,
    state: CvCreationWizardState
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
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(str));
    temporaryNotification(`Previewing ${formatWorkspaceRelativePath(str, workspaceFolder)}...`, 3000);
    rcv.previewFileAsCV(str);
}

export function cloneCV(uri?: vscode.Uri | string) {
    const cvFile = getCvFileFromCommandArg(uri);
    if (!cvFile) {
        vscode.window.showWarningMessage("No CV selected.");
        return;
    }

    startCvCreationWizard({ mode: "clone", sourceCvFile: cvFile });
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
