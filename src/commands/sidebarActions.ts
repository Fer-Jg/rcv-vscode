import * as vscode from "vscode";
import * as rcv from "../utils/rcv";
import { logger } from "../utils/logging";

let contextCV = "";

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

export function setContextCV(cv: string) {
    contextCV = cv;
}

export function newGlobal() {
    runPlaceholderWorkflow(
        "Creating a new global item...",
        "New global item creation cancelled.",
        "New global item created successfully! (WIP)"
    );
}

export function openGlobalSettings() {
    vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", "rendercv-vscode");
}

export function extensionLogs() {
    logger.show();
}

export function reloadCvs() {
    runPlaceholderWorkflow(
        "Reloading CVs...",
        "CV reload cancelled.",
        "CVs reloaded successfully! (WIP)"
    );
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

export function newCV() {
    runPlaceholderWorkflow(
        "Creating a new CV...",
        "New CV creation cancelled.",
        "New CV created successfully! (WIP)"
    );
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
