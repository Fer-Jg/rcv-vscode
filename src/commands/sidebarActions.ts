import * as vscode from "vscode";

export function newGlobal() {
    vscode.window.showInformationMessage("Create new global item — implement me!");
}

export function openGlobalSettings() {
    vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", "rendercv-vscode");
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

export function newCV() {
    vscode.window.showInformationMessage('Creating a new CV... (WIP)');
}

export async function previewCvSidebar(str: string) {
    vscode.window.showInformationMessage(`Previewing CV sidebar... (WIP) ${str}`);
}

export async function sendFeedback() {
    vscode.window.showInformationMessage(`Sending feedback... (WIP)`);
}