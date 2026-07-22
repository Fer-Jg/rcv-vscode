import * as vscode from "vscode";

export function newGlobal() {
    vscode.window.showInformationMessage("Create new global item — implement me!");
}

export function openGlobalSettings() {
    vscode.commands.executeCommand("workbench.action.openSettings", "rendercv-vscode");
}

export function reloadCvs() {
    vscode.window.showInformationMessage("Reloading CVs — implement me!");
}

export function searchCvs() {
    vscode.window.showInformationMessage("Search CVs — implement me!");
}

export function filterCvs() {
    vscode.window.showInformationMessage("Filter CVs — implement me!");
}

export function openCvsHelp() {
    vscode.env.openExternal(vscode.Uri.parse("https://your-docs-url.example.com"));
}