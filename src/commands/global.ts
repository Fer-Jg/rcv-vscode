import * as vscode from 'vscode';
import { previewFileAsCV } from '../utils/rcv';
import { runPlaceholderWorkflow } from '../utils/devTools';

const TUTORIAL_URL = "https://rcv-vscode.ferj.dev/tutorial";

export function installRequirements() {
    runPlaceholderWorkflow('🚨 WIP Installing requirements WIP 🚨', 
        '🚨 WIP Installation cancelled WIP 🚨', 
        '🚨 WIP Installation is not implemented yet 🚨');
};

export async function openWalkthroughTutorial() {
    await vscode.env.openExternal(vscode.Uri.parse(TUTORIAL_URL));
}

export async function installRequirementsFromWalkthrough() {
    const selection = await vscode.window.showInformationMessage(
        "This will execute Python commands to install the RenderCV dependency. Review the tutorial if you want to understand what will happen before installing.",
        "Tutorial",
        "Install"
    );

    if (selection === "Tutorial") {
        await openWalkthroughTutorial();
        return;
    }

    if (selection === "Install") {
        installRequirements();
    }
}

export async function previewCvFile(uri: vscode.Uri | string) {
    if (typeof uri !== 'string') {
        uri = uri.fsPath;
    }
    vscode.window.showInformationMessage(`Previewing CV... (WIP) ${uri}`);
    previewFileAsCV(uri);
}
