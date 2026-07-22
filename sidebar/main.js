const vscode = acquireVsCodeApi();

// Replace this with real CV/project data from the extension (e.g. via
// webview.onDidReceiveMessage / postMessage from the extension host).
const cvs = ["CV 1", "CV 2", "CV 3"];
let selectedCv = cvs[0];

const listEl = document.getElementById("cv-list");

function render() {
    listEl.innerHTML = "";
    cvs.forEach((name) => {
        const li = document.createElement("li");
        li.className = "cv-item" + (name === selectedCv ? " selected" : "");
        li.textContent = name;
        li.addEventListener("click", () => {
            selectedCv = name;
            render();
            vscode.postMessage({ command: "selectCV", cv: name });
        });
        listEl.appendChild(li);
    });
}

render();

document.getElementById("create-cv-button").addEventListener("click", () => {
    vscode.postMessage({ command: "createNewCV" });
});

document.getElementById("feedback-link").addEventListener("click", (e) => {
    e.preventDefault();
    vscode.postMessage({ command: "feedbackClicked" });
});

// CVs section actions
document.getElementById("cvs-reload-button").addEventListener("click", () => {
    vscode.postMessage({ command: "reloadCvs" });
});

document.getElementById("cvs-search-button").addEventListener("click", () => {
    vscode.postMessage({ command: "searchCvs" });
});

document.getElementById("cvs-filter-button").addEventListener("click", () => {
    vscode.postMessage({ command: "filterCvs" });
});

document.getElementById("cvs-help-button").addEventListener("click", () => {
    vscode.postMessage({ command: "cvsHelp" });
});
