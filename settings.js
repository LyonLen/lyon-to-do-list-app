const { ipcRenderer } = require('electron');

// DOM Elements
const closeBtn = document.getElementById('close-btn');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');

// Setting elements
const alwaysOnTopCheck = document.getElementById('alwaysOnTop');
const autoHideCheck = document.getElementById('autoHide');
const edgeDetectionCheck = document.getElementById('edgeDetection');
const showCompletionAnimationCheck = document.getElementById('showCompletionAnimation');
const playCompletionSoundCheck = document.getElementById('playCompletionSound');

// Load settings on startup
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
});

// Close button event listener
closeBtn.addEventListener('click', () => {
    window.close();
});

// Cancel button event listener
cancelBtn.addEventListener('click', () => {
    window.close();
});

// Save button event listener
saveBtn.addEventListener('click', async () => {
    await saveSettings();
    window.close();
});

// Function to load settings from main process
async function loadSettings() {
    const settings = await ipcRenderer.invoke('get-settings');

    // Set checkbox values based on settings
    alwaysOnTopCheck.checked = settings.alwaysOnTop;
    autoHideCheck.checked = settings.autoHide;
    edgeDetectionCheck.checked = settings.edgeDetection;
    showCompletionAnimationCheck.checked = settings.showCompletionAnimation;
    playCompletionSoundCheck.checked = settings.playCompletionSound;
}

// Function to save settings
async function saveSettings() {
    const settings = {
        alwaysOnTop: alwaysOnTopCheck.checked,
        autoHide: autoHideCheck.checked,
        edgeDetection: edgeDetectionCheck.checked,
        showCompletionAnimation: showCompletionAnimationCheck.checked,
        playCompletionSound: playCompletionSoundCheck.checked
    };

    await ipcRenderer.invoke('update-settings', settings);
} 