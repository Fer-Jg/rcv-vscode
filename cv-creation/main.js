const vscode = acquireVsCodeApi();
const state = window.rendercvCreateCvState;

const form = document.getElementById("cv-form");
const targetFolder = document.getElementById("target-folder");
const workspaceWarning = document.getElementById("workspace-warning");
const personName = document.getElementById("person-name");
const cvName = document.getElementById("cv-name");
const themeEnabled = document.getElementById("theme-enabled");
const themeWrap = document.getElementById("theme-wrap");
const theme = document.getElementById("theme");
const designHelp = document.getElementById("design-help");
const designGlobalRow = document.getElementById("design-global-row");
const designGlobal = document.getElementById("design-global");
const localeEnabled = document.getElementById("locale-enabled");
const localeWrap = document.getElementById("locale-wrap");
const locale = document.getElementById("locale");
const localeHelp = document.getElementById("locale-help");
const localeGlobalRow = document.getElementById("locale-global-row");
const localeGlobal = document.getElementById("locale-global");
const settingsEnabled = document.getElementById("settings-enabled");
const settingsHelp = document.getElementById("settings-help");
const settingsGlobalRow = document.getElementById("settings-global-row");
const settingsGlobal = document.getElementById("settings-global");
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

function initConfigControl(input, help, globalRow, globalInput, hasGlobal, missingMessage, existingMessage) {
  input.checked = !hasGlobal;
  input.disabled = !hasGlobal;
  help.textContent = hasGlobal ? existingMessage : missingMessage;
  globalRow.hidden = hasGlobal;
  globalInput.checked = !hasGlobal;
}

initConfigControl(
  themeEnabled,
  designHelp,
  designGlobalRow,
  designGlobal,
  state.globals.design,
  "No globals/design.yaml exists, so this CV must create local design.",
  "Use globals/design.yaml unless enabled."
);
initConfigControl(
  localeEnabled,
  localeHelp,
  localeGlobalRow,
  localeGlobal,
  state.globals.locale,
  "No globals/locale.yaml exists, so this CV must create local locale.",
  "Use globals/locale.yaml unless enabled."
);
initConfigControl(
  settingsEnabled,
  settingsHelp,
  settingsGlobalRow,
  settingsGlobal,
  state.globals.settings,
  "No globals/settings.yaml exists, so this CV must create local settings.",
  "Use globals/settings.yaml unless enabled."
);

function quoteArg(value) {
  if (!value.trim()) {
    return "{full_name}";
  }

  return `"${value.trim().replaceAll('"', '\\"')}"`;
}

function sanitizeFolderName(value) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildOptions() {
  return {
    personName: personName.value.trim(),
    cvName: sanitizeFolderName(cvName.value),
    theme: themeEnabled.checked ? theme.value : undefined,
    locale: localeEnabled.checked ? locale.value : undefined,
    useLocalDesign: themeEnabled.checked,
    useLocalLocale: localeEnabled.checked,
    useLocalSettings: settingsEnabled.checked,
    saveDesignAsGlobal: designGlobal.checked && !state.globals.design,
    saveLocaleAsGlobal: localeGlobal.checked && !state.globals.locale,
    saveSettingsAsGlobal: settingsGlobal.checked && !state.globals.settings,
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
  args.push(quoteArg(options.personName));
  commandPreview.textContent = `${args.join(" ")}\nfolder: ${options.cvName || "{cv_name}"}`;
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
  if (!options.personName) {
    personName.focus();
    setStatus("error", "Enter the person name before creating the CV.");
    return;
  }
  if (!options.cvName) {
    cvName.focus();
    setStatus("error", "Enter a CV name before creating the folder.");
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
personName.focus();
