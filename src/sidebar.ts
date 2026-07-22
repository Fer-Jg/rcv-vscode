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

        webview.onDidReceiveMessage((message) => {
            logger.info("Received message from webview:", message);
            if (message.command === "createNewCV") {
                commands.newCV();
            } else if (message.command === "feedbackClicked") {
                commands.sendFeedback();
            } else if (message.command === "selectCV") {
                commands.previewCvSidebar(message.cv);
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
}

export default SuperCoolSidebarProvider;
