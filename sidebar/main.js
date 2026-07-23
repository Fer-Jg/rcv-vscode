const vscode = acquireVsCodeApi();

let cvs = [];
let selectedCv = "";

const listEl = document.getElementById("cv-list");

function getFileName(filePath) {
    return filePath.split(/[\\/]/).pop() || filePath;
}

function render() {
    listEl.innerHTML = "";
    if (cvs.length === 0) {
        const li = document.createElement("li");
        li.className = "cv-item";
        li.textContent = "No YAML files found";
        listEl.appendChild(li);
        return;
    }

    cvs.forEach((name) => {
        const li = document.createElement("li");
        li.className = "cv-item" + (name === selectedCv ? " selected" : "");
        li.textContent = getFileName(name);
        li.title = name;
        li.dataset.vscodeContext = JSON.stringify({
            webviewSection: "cvItem"
        });
        li.addEventListener("click", () => {
            selectedCv = name;
            render();
            vscode.postMessage({ command: "selectCV", cv: name });
        });
        li.addEventListener("contextmenu", () => {
            vscode.postMessage({ command: "setContextCV", cv: name });
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

window.addEventListener("message", (event) => {
    if (event.data.command === "init" && event.data.showIntro) {
        document.getElementById("intro-view").style.display = "block";
        document.getElementById("main-view").style.display = "none";
    }
    if (event.data.command === "init") {
        if(!event.data.hasDetectedCliPath){
            document.getElementById("intro-need-setup").style.display = "block";
            document.getElementById("intro-done-setup").style.display = "none";
        } else {
            document.getElementById("intro-done-setup").style.display = "block";
            document.getElementById("intro-need-setup").style.display = "none";
        }
    }
    if (event.data.command === "cvList") {
        cvs = event.data.cvs || [];
        selectedCv = cvs.includes(selectedCv) ? selectedCv : cvs[0] || "";
        render();
    }
});

document.getElementById("intro-setup-button").addEventListener("click", () => {
    vscode.postMessage({ command: "introSetup" });
});

document.getElementById("intro-dismiss-button").addEventListener("click", () => {
    vscode.postMessage({ command: "introDismissed" });
    document.getElementById("intro-view").style.display = "none";
    document.getElementById("intro-need-setup").style.display = "none";
    document.getElementById("intro-done-setup").style.display = "none";
    document.getElementById("main-view").style.display = "block";
});

vscode.postMessage({ command: "ready" });
