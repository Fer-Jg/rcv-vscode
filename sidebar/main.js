const vscode = acquireVsCodeApi();

// Replace this with real CV/project data from the extension (e.g. via
// webview.onDidReceiveMessage / postMessage from the extension host).
const cvs = ["Cv 1", "Cv 2", "Cv 3"];
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

document.getElementsByClassName("cv-item").forEach((item) => {
    item.addEventListener("click", () => {
        const cvName = item.textContent;
        vscode.postMessage({ command: "selectCV", cv: cvName });
    });
});