import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as commands from "./commands/global";
import { logger } from "./utils/logging";
import * as sidebar from "./commands/sidebarActions";
import rcv from "./utils/rcv";

class SuperCoolSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rendercv-vscode.mySidebar";
    extensionUri: vscode.Uri;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
        this.context = context;
    }


    public resolveWebviewView(webviewView: vscode.WebviewView) {
        const hasSeenIntro = this.context.workspaceState.get<boolean>("rendercv.hasSeenIntro", false);
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

        webview.html = html;

        webviewView.webview.postMessage({
            command: "init", showIntro: !hasSeenIntro,
            hasDetectedCliPath: this.context.workspaceState.get<boolean>("rendercv.hasDetectedCliPath", false)
        });

        const yamlList = this.getYamlFiles();
        
        webviewView.webview.postMessage({
            command: "cvList", cvs: yamlList
        });

        webview.onDidReceiveMessage((message) => {
            logger.info("Received message from webview:", message);
            if (message.command === "createNewCV") {
                sidebar.newCV();
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
            } else if (message.command === "introDismissed") {
                this.context.workspaceState.update("rendercv.hasSeenIntro", true);
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
    }

    private getYamlFiles(): string[] {
        const config = vscode.workspace.getConfiguration("rendercv-vscode");
        const yamlFilesFolder = config.get<string>("CVYamlFilesFolder", "yamls");

        const yamlsFolderPath = path.isAbsolute(yamlFilesFolder) ? yamlFilesFolder : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", yamlFilesFolder);

        if (!yamlsFolderPath.trim()) {
            // TODO: Add info in wiki
            logger.warn("No workspace folder found. Cannot determine root path.");
            return [];
        }

        if (!fs.existsSync(yamlsFolderPath)) {
            // TODO: Add info in wiki
            logger.warn(`Workspace folder does not exist: ${yamlsFolderPath}`);
            return [];
        }

        try {
            const yamlList = fs
                .readdirSync(yamlsFolderPath, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .filter(entry => [".yaml", ".yml"].includes(path.extname(entry.name).toLowerCase()))
                .map(entry => path.join(yamlsFolderPath, entry.name));

            logger.info(`YAML files found in the ${yamlsFolderPath} directory:`, yamlList);
            return yamlList;
        } catch (error) {
            logger.error(`Failed to read YAML files from workspace (${yamlsFolderPath}), error: ${error}`);
            return [];
        }
    }
}

export default SuperCoolSidebarProvider;
