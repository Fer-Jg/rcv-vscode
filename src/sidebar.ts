import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as commands from "./commands/global";
import { logger } from "./utils/logging";
import * as sidebar from "./commands/sidebarActions";
import rcv from "./utils/rcv";
import { formatWorkspaceRelativePath, getWorkspaceLayout } from "./utils/workspaceLayout";

class SuperCoolSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rendercv-vscode.mainSidebar";
    extensionUri: vscode.Uri;
    private webviewView?: vscode.WebviewView;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
        this.context = context;
    }


    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
        sidebar.setReloadCvsHandler(() => this.reloadCvs());

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, "sidebar"),
                vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist")
            ]
        };

        const webview = webviewView.webview;

        const htmlPath = path.join(this.extensionUri.fsPath, "sidebar", "index.html");

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "sidebar", "style.css")
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "sidebar", "main.js")
        );
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
        );

        let html = fs.readFileSync(htmlPath, "utf8");
        html = html
            .replace("{{styleUri}}", styleUri.toString())
            .replace("{{scriptUri}}", scriptUri.toString())
            .replace("{{codiconUri}}", codiconUri.toString());

        webview.onDidReceiveMessage(async (message) => {
            logger.info("Received message from webview:", message);
            if (message.command === "ready") {
                this.postSidebarState();
            } else if (message.command === "createNewCV") {
                sidebar.newCv();
            } else if (message.command === "feedbackClicked") {
                sidebar.sendFeedback();
            } else if (message.command === "selectCV") {
                sidebar.previewCvSidebar(message.cv);
            } else if (message.command === "reloadCvs") {
                sidebar.reloadCvs();
            } else if (message.command === "searchCvs") {
                sidebar.searchCvs();
            } else if (message.command === "filterCvs") {
                sidebar.filterCvs();
            } else if (message.command === "cvsHelp") {
                sidebar.openCvsHelp();
            } else if (message.command === "setContextCV") {
                sidebar.setContextCV(message.cv);
            } else if (message.command === "cloneCV") {
                sidebar.cloneCV(message.cv);
            } else if (message.command === "revealOutputPdf") {
                sidebar.revealOutputPdf(message.cv);
            } else if (message.command === "openWalkthrough") {
                this.openWalkthrough();
            } else if (message.command === "introDismissed") {
                await this.context.workspaceState.update("rendercv.hasSeenIntro", true);
                this.postSidebarState();
            } else if (message.command === "introSetup") {
                rcv.detectRenderCVCliPath(false).then((detected) => {
                    logger.info("RenderCV CLI path detection result:", detected);
                    this.context.workspaceState.update("rendercv.hasDetectedCliPath", detected);
                    webviewView.webview.postMessage({
                        command: "init", showIntro: true,
                        hasDetectedCliPath: detected
                    });
                });
            }
        });

        webview.html = html;
    }

    private async openWalkthrough(): Promise<void> {
        const walkthroughId = `${this.context.extension.id}#rendercv-vscode.getStarted`;
        logger.info(`Opening walkthrough: ${walkthroughId}`);
        await vscode.commands.executeCommand("workbench.action.openWalkthrough", walkthroughId, false);
    }

    private reloadCvs() {
        this.postCvList();
        logger.info("Reloaded CVs in the sidebar.");
    }

    private postSidebarState() {
        const hasSeenIntro = this.context.workspaceState.get<boolean>("rendercv.hasSeenIntro", false);
        this.webviewView?.webview.postMessage({
            command: "init",
            showIntro: !hasSeenIntro,
            hasDetectedCliPath: this.context.workspaceState.get<boolean>("rendercv.hasDetectedCliPath", false)
        });
        this.postCvList();
    }

    private postCvList() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const yamlList = this.getYamlFiles().map(filePath => ({
            filePath,
            label: path.basename(path.dirname(filePath)),
            displayPath: formatWorkspaceRelativePath(filePath, workspaceFolder),
        }));
        this.webviewView?.webview.postMessage({
            command: "cvList", cvs: yamlList
        });
    }

    private getYamlFiles(): string[] {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            // TODO: Add info in wiki
            logger.warn("No workspace folder found. Cannot determine root path.");
            return [];
        }

        const yamlsFolderPath = getWorkspaceLayout(workspaceFolder).yamlRoot;

        if (!fs.existsSync(yamlsFolderPath)) {
            // TODO: Add info in wiki
            logger.warn(`Workspace folder does not exist: ${yamlsFolderPath}`);
            return [];
        }

        try {
            const yamlList = fs
                .readdirSync(yamlsFolderPath, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => path.join(yamlsFolderPath, entry.name, "cv.yaml"))
                .filter(cvFile => fs.existsSync(cvFile));

            logger.info(`CV folders found in the ${yamlsFolderPath} directory:`, yamlList);
            return yamlList;
        } catch (error) {
            logger.error(`Failed to read CV folders from workspace (${yamlsFolderPath}), error: ${error}`);
            return [];
        }
    }
}

export default SuperCoolSidebarProvider;
