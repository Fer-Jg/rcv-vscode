const vscode = acquireVsCodeApi();
const state = window.rendercvCreateCvState;

const form = document.getElementById("cv-form");
const targetFolder = document.getElementById("target-folder");
const workspaceWarning = document.getElementById("workspace-warning");
const cvName = document.getElementById("cv-name");
const themeEnabled = document.getElementById("theme-enabled");
const themeWrap = document.getElementById("theme-wrap");
const theme = document.getElementById("theme");
const localeEnabled = document.getElementById("locale-enabled");
const localeWrap = document.getElementById("locale-wrap");
const locale = document.getElementById("locale");
const typstTemplates = document.getElementById("typst-templates");
const markdownTemplates = document.getElementById("markdown-templates");
const commandPreview = document.getElementById("command-preview");
const status = document.getElementById("status");
const createButton = document.getElementById("create-button");

targetFolder.textContent = state.targetFolder || "No workspace open";
targetFolder.title = state.targetFolder || "No workspace open";
workspaceWarning.hidden = state.hasWorkspace;
createButton.disabled = !state.hasWorkspace;

for (const option of state.themes) {
  theme.appendChild(new Option(option, option, option === "classic", option === "classic"));
}

for (const option of state.locales) {
  locale.appendChild(new Option(option, option, option === "english", option === "english"));
}

function quoteArg(value) {
  if (!value.trim()) {
    return "{full_name}";
  }

  return `"${value.trim().replaceAll('"', '\\"')}"`;
}

function buildOptions() {
  return {
    cvName: cvName.value.trim(),
    theme: themeEnabled.checked ? theme.value : undefined,
    locale: localeEnabled.checked ? locale.value : undefined,
    createTypstTemplates: typstTemplates.checked,
    createMarkdownTemplates: markdownTemplates.checked,
  };
}

function updatePreview() {
  themeWrap.hidden = !themeEnabled.checked;
  localeWrap.hidden = !localeEnabled.checked;

  const options = buildOptions();
  const args = ["rendercv", "new"];
  if (options.theme) {
    args.push("--theme", options.theme);
  }
  if (options.locale) {
    args.push("--locale", options.locale);
  }
  if (options.createTypstTemplates) {
    args.push("--create-typst-templates");
  }
  if (options.createMarkdownTemplates) {
    args.push("--create-markdown-templates");
  }
  args.push(quoteArg(options.cvName));
  commandPreview.textContent = args.join(" ");
}

function setStatus(kind, message) {
  status.className = "status" + (kind === "error" || kind === "success" ? ` ${kind}` : "");
  status.textContent = message || "";
  createButton.disabled = !state.hasWorkspace || kind === "busy";
}

form.addEventListener("input", updatePreview);
form.addEventListener("change", updatePreview);

document.getElementById("cancel-button").addEventListener("click", () => {
  vscode.postMessage({ command: "cancel" });
});

form.addEventListener("submit", event => {
  event.preventDefault();
  const options = buildOptions();
  if (!options.cvName) {
    cvName.focus();
    setStatus("error", "Enter a CV name before creating the file.");
    return;
  }

  setStatus("busy", "Creating CV...");
  vscode.postMessage({ command: "createCv", options });
});

window.addEventListener("message", event => {
  if (event.data.command === "status") {
    setStatus(event.data.status, event.data.message);
  }
});

updatePreview();
cvName.focus();
