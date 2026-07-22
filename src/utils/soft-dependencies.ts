import * as vscode from 'vscode';
import logger from './logging';
import { NONAME } from 'dns/promises';

/*
Soft Dependencies:

Any yaml:
- redhat.vscode-yaml

Any PDF:
- tomoki1207.pdf
- mathematic.vscode-pdf
- analytic-signal.preview-pdf

*/

export function detectSoftDependencies() {
    const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");

    logger.info("Checking for soft dependencies...");

    if (yamlExtension) {
        logger.info("YAML extension is installed - Good :)");
    } else {
        logger.warn("YAML extension is not installed - Bad :(");

        vscode.window.showWarningMessage("YAML preview extension is not installed, it is recommended to have it for a better experience.", "View in Marketplace", "Dismiss").then(selection => {
            if (selection === "View in Marketplace") {
                // Lead the user to the extension marketplace to let them install the YAML extension by themselves
                vscode.commands.executeCommand("extension.open", "redhat.vscode-yaml");
            }
            if (selection === "Dismiss") {
                vscode.window.showInformationMessage("You can install the YAML extension later from the Extensions view.");
            }
        });
    }

    const pdfExtensions = [
        "tomoki1207.pdf",
        "mathematic.vscode-pdf",
        "analytic-signal.preview-pdf"
    ];

    let pdfExtensionFound = undefined;

    for (const ext of pdfExtensions) {
        const pdfExtension = vscode.extensions.getExtension(ext);
        if (pdfExtension) {
            pdfExtensionFound = pdfExtension;
            break;
        }
    }

    logger.info("Checking for soft dependencies...");

    if (pdfExtensionFound !== undefined) {
        logger.info(`PDF extension (${pdfExtensionFound.id}) is installed - Good :)`);
    } else {
        logger.warn("PDF extension is not installed - Bad :(");

        vscode.window.showWarningMessage("PDF preview extension is not installed, it is recommended to have it for a better experience.", "View in Marketplace", "Dismiss").then(selection => {
            if (selection === "View in Marketplace") {
                vscode.commands.executeCommand("extension.open", "tomoki1207.pdf");
            }
            if (selection === "Dismiss") {
                vscode.window.showInformationMessage("You can install the PDF extension later from the Extensions view.");
            }
        });
    }
}