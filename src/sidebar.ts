import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as commands from "./commands/global";
import { logger } from "./utils/logging";

class SuperCoolSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "rendercv-vscode.mySidebar";

    constructor(private readonly extensionUri: vscode.Uri) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
            enableScripts: true
        };

        const webview = webviewView.webview;

        const htmlPath = path.join(
            this.extensionUri.fsPath,
            "sidebar",
            "index.html"
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    this.extensionUri.fsPath,
                    "sidebar",
                    "style.css"
                )
            )
        );

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    this.extensionUri.fsPath,
                    "sidebar",
                    "main.js"
                )
            )
        );

        let html = fs.readFileSync(htmlPath, "utf8");

        html = html
            .replace("{{styleUri}}", styleUri.toString())
            .replace("{{scriptUri}}", scriptUri.toString());

        webview.html = html;

        webview.onDidReceiveMessage((message) => {
            logger.info("Received message from webview:", message);
            if (message.command === "createNewCV") {
                commands.newCV();
            }
            else if (message.command === "feedbackClicked") {
                commands.sendFeedback();
            }
            else if (message.command === "selectCV") {
                commands.previewCvSidebar(message.cv);
            }
        });
    }
}

export default SuperCoolSidebarProvider;
