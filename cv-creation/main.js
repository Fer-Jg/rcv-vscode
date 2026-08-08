const vscode = acquireVsCodeApi();
const state = window.rendercvCreateCvState;
const isClone = state.mode === "clone";

const form = document.getElementById("cv-form");
const wizardTitle = document.getElementById("wizard-title");
const wizardSubtitle = document.getElementById("wizard-subtitle");
const targetFolder = document.getElementById("target-folder");
const workspaceWarning = document.getElementById("workspace-warning");
const personName = document.getElementById("person-name");
const cvName = document.getElementById("cv-name");
const outputFolderWarning = document.getElementById("output-folder-warning");
const outputFolderPath = document.getElementById("output-folder-path");
const deleteOutputFolder = document.getElementById("delete-output-folder");
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
const previewLabel = document.getElementById("preview-label");
const commandPreview = document.getElementById("command-preview");
const status = document.getElementById("status");
const createButton = document.getElementById("create-button");
let outputFolderExists = false;
let outputFolderCheckTimer;

targetFolder.textContent = state.targetFolderDisplay || state.targetFolder || "No workspace open";
targetFolder.title = state.targetFolderDisplay || state.targetFolder || "No workspace open";
workspaceWarning.hidden = state.hasWorkspace;
createButton.disabled = !state.hasWorkspace;
wizardTitle.textContent = isClone ? "Clone CV" : "Create CV";
wizardSubtitle.textContent = isClone
  ? "Clone the selected CV data and choose how its configuration should be carried over."
  : "Configure the starter file, folder, and local/global config files.";
previewLabel.textContent = isClone ? "Clone preview" : "Command preview";
createButton.textContent = isClone ? "Clone CV" : "Create CV";
personName.value = state.initial?.personName || "";
cvName.value = state.initial?.cvName || "";

for (const option of state.themes) {
  const selectedTheme = state.initial?.theme || "classic";
  theme.appendChild(new Option(option, option, option === selectedTheme, option === selectedTheme));
}

for (const option of state.locales) {
  const selectedLocale = state.initial?.locale || "english";
  locale.appendChild(new Option(option, option, option === selectedLocale, option === selectedLocale));
}

function initConfigControl(input, help, globalRow, globalInput, hasGlobal, preferredLocal, missingMessage, existingMessage) {
  input.checked = hasGlobal ? Boolean(preferredLocal) : true;
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
  state.initial?.useLocalDesign,
  "No globals/design.yaml exists, so this CV must create local design.",
  "Use globals/design.yaml unless enabled."
);
initConfigControl(
  localeEnabled,
  localeHelp,
  localeGlobalRow,
  localeGlobal,
  state.globals.locale,
  state.initial?.useLocalLocale,
  "No globals/locale.yaml exists, so this CV must create local locale.",
  "Use globals/locale.yaml unless enabled."
);
initConfigControl(
  settingsEnabled,
  settingsHelp,
  settingsGlobalRow,
  settingsGlobal,
  state.globals.settings,
  state.initial?.useLocalSettings,
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
    deleteExistingOutputFolder: deleteOutputFolder.checked,
  };
}

function updatePreview() {
  themeWrap.hidden = !themeEnabled.checked;
  localeWrap.hidden = !localeEnabled.checked;

  const options = buildOptions();
  if (isClone) {
    commandPreview.textContent = [
      `clone: ${state.clone?.sourceCvName || "{source_cv}"}`,
      `person: ${quoteArg(options.personName)}`,
      `folder: ${options.cvName || "{cv_name}"}`,
      `design: ${options.useLocalDesign ? "local" : "global"}${options.theme ? ` (${options.theme})` : ""}`,
      `locale: ${options.useLocalLocale ? "local" : "global"}${options.locale ? ` (${options.locale})` : ""}`,
      `settings: ${options.useLocalSettings ? "local" : "global"}`,
    ].join("\n");
  } else {
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
  scheduleOutputFolderCheck(options.cvName);
}

function setStatus(kind, message) {
  status.className = "status" + (kind === "error" || kind === "success" ? ` ${kind}` : "");
  status.textContent = message || "";
  createButton.disabled = !state.hasWorkspace || kind === "busy";
}

function scheduleOutputFolderCheck(sanitizedCvName) {
  window.clearTimeout(outputFolderCheckTimer);
  if (!state.hasWorkspace || !sanitizedCvName) {
    setOutputFolderWarning(false, "");
    return;
  }

  outputFolderCheckTimer = window.setTimeout(() => {
    vscode.postMessage({ command: "checkOutputFolder", cvName: sanitizedCvName });
  }, 150);
}

function setOutputFolderWarning(exists, folderPath, displayPath) {
  outputFolderExists = exists;
  outputFolderWarning.hidden = !exists;
  outputFolderPath.textContent = displayPath || folderPath;
  outputFolderPath.title = displayPath || folderPath;
  if (!exists) {
    deleteOutputFolder.checked = false;
  }
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
  if (isClone && options.cvName === state.clone?.sourceCvName) {
    cvName.focus();
    setStatus("error", "Choose a different CV name before cloning.");
    return;
  }
  if (outputFolderExists && !options.deleteExistingOutputFolder) {
    deleteOutputFolder.focus();
    setStatus("error", "A matching output folder already exists. Acknowledge deleting it before continuing.");
    return;
  }

  setStatus("busy", isClone ? "Cloning CV..." : "Creating CV...");
  vscode.postMessage({ command: isClone ? "cloneCv" : "createCv", options });
});

window.addEventListener("message", event => {
  if (event.data.command === "status") {
    setStatus(event.data.status, event.data.message);
  }
  if (event.data.command === "outputFolderStatus") {
    if (event.data.cvName !== buildOptions().cvName) {
      return;
    }
    setOutputFolderWarning(event.data.exists, event.data.outputFolder, event.data.outputFolderDisplay);
  }
});

updatePreview();
personName.focus();
