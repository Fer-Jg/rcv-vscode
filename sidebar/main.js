const vscode = acquireVsCodeApi();

let cvs = [];
let selectedCv = "";
let openMenuCv = "";

const listEl = document.getElementById("cv-list");
const cvActionMenu = createCvActionMenu();
document.body.appendChild(cvActionMenu);

function getFileName(filePath) {
    const parts = filePath.split(/[\\/]/);
    const fileName = parts.pop() || filePath;
    if (fileName.toLowerCase() === "cv.yaml" && parts.length > 0) {
        return parts.pop() || fileName;
    }
    return fileName;
}

function render() {
    listEl.innerHTML = "";
    closeCvActionMenu();
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
        li.title = name;
        li.dataset.cv = name;
        li.dataset.vscodeContext = JSON.stringify({
            webviewSection: "cvItem"
        });

        const label = document.createElement("span");
        label.className = "cv-item-label";
        label.textContent = getFileName(name);

        const menuButton = document.createElement("button");
        menuButton.className = "cv-item-menu icon-button";
        menuButton.type = "button";
        menuButton.title = "CV actions";
        menuButton.setAttribute("aria-label", `Actions for ${getFileName(name)}`);
        menuButton.innerHTML = '<i class="codicon codicon-kebab-vertical"></i>';

        li.addEventListener("click", () => {
            selectedCv = name;
            updateSelectedCv();
            vscode.postMessage({ command: "selectCV", cv: name });
        });
        li.addEventListener("contextmenu", () => {
            selectedCv = name;
            updateSelectedCv();
            vscode.postMessage({ command: "setContextCV", cv: name });
        });
        menuButton.addEventListener("click", event => {
            event.stopPropagation();
            selectedCv = name;
            updateSelectedCv();
            showCvActionMenu(name, menuButton);
        });
        li.appendChild(label);
        li.appendChild(menuButton);
        listEl.appendChild(li);
    });
}

function updateSelectedCv() {
    for (const item of listEl.querySelectorAll(".cv-item")) {
        item.classList.toggle("selected", item.dataset.cv === selectedCv);
    }
}

function createCvActionMenu() {
    const menu = document.createElement("div");
    menu.className = "cv-context-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
        <button type="button" role="menuitem" data-action="clone">
            <i class="codicon codicon-copy"></i>
            <span>Clone CV</span>
        </button>
        <button type="button" role="menuitem" data-action="reveal-output">
            <i class="codicon codicon-file-pdf"></i>
            <span>Reveal Output PDF</span>
        </button>
    `;
    menu.addEventListener("click", event => {
        const button = event.target.closest("button[data-action]");
        if (!button || !openMenuCv) {
            return;
        }

        const cv = openMenuCv;
        closeCvActionMenu();
        if (button.dataset.action === "clone") {
            vscode.postMessage({ command: "cloneCV", cv });
            return;
        }

        vscode.postMessage({ command: "revealOutputPdf", cv });
    });
    return menu;
}

function showCvActionMenu(cv, anchor) {
    openMenuCv = cv;
    vscode.postMessage({ command: "setContextCV", cv });

    const anchorRect = anchor.getBoundingClientRect();
    cvActionMenu.hidden = false;
    const menuRect = cvActionMenu.getBoundingClientRect();
    const left = Math.max(4, Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 4));
    const top = Math.max(4, Math.min(anchorRect.bottom, window.innerHeight - menuRect.height - 4));
    cvActionMenu.style.left = `${left}px`;
    cvActionMenu.style.top = `${top}px`;
    cvActionMenu.querySelector("button")?.focus();
}

function closeCvActionMenu() {
    openMenuCv = "";
    cvActionMenu.hidden = true;
}

document.addEventListener("click", event => {
    if (!cvActionMenu.hidden && !cvActionMenu.contains(event.target)) {
        closeCvActionMenu();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeCvActionMenu();
    }
});

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

document.getElementById("intro-walkthrough-button").addEventListener("click", () => {
    vscode.postMessage({ command: "openWalkthrough" });
});

document.getElementById("intro-dismiss-button").addEventListener("click", () => {
    vscode.postMessage({ command: "introDismissed" });
    document.getElementById("intro-view").style.display = "none";
    document.getElementById("intro-need-setup").style.display = "none";
    document.getElementById("intro-done-setup").style.display = "none";
    document.getElementById("main-view").style.display = "block";
});

vscode.postMessage({ command: "ready" });
