const { ipcRenderer } = require('electron');

// DOM Elements
const closeBtn = document.getElementById('close-btn');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');
const devToolsBtn = document.getElementById('dev-tools-btn'); // 开发者工具按钮

// Setting elements
const alwaysOnTopCheck = document.getElementById('alwaysOnTop');
const autoHideCheck = document.getElementById('autoHide');
const edgeDetectionCheck = document.getElementById('edgeDetection');
const showCompletionAnimationCheck = document.getElementById('showCompletionAnimation');
const playCompletionSoundCheck = document.getElementById('playCompletionSound');

// LLM设置元素
const enableLlmCheck = document.getElementById('enableLlm');
const llmApiKeyInput = document.getElementById('llmApiKey');
const llmApiUrlInput = document.getElementById('llmApiUrl');
const llmModelSelect = document.getElementById('llmModel');
const customModelContainer = document.getElementById('customModelContainer');
const customModelNameInput = document.getElementById('customModelName');

// Load settings on startup
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();

    // 为LLM模型选择添加事件监听器
    llmModelSelect.addEventListener('change', () => {
        if (llmModelSelect.value === 'custom') {
            customModelContainer.style.display = 'flex';
        } else {
            customModelContainer.style.display = 'none';
        }
    });
});

// Close button event listener
closeBtn.addEventListener('click', () => {
    window.close();
});

// 开发者工具按钮点击事件
devToolsBtn.addEventListener('click', () => {
    ipcRenderer.send('open-devtools');
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

    // 设置LLM相关选项
    enableLlmCheck.checked = settings.enableLlm || false;
    llmApiKeyInput.value = settings.llmApiKey || '';
    llmApiUrlInput.value = settings.llmApiUrl || '';

    // 设置模型选择
    if (settings.llmModel) {
        if (['qwen-plus', 'qwen-max', 'qwen-turbo'].includes(settings.llmModel)) {
            llmModelSelect.value = settings.llmModel;
            customModelContainer.style.display = 'none';
        } else {
            llmModelSelect.value = 'custom';
            customModelNameInput.value = settings.llmModel;
            customModelContainer.style.display = 'flex';
        }
    }

    // 如果没有设置API URL，默认使用百炼API
    if (!llmApiUrlInput.value) {
        llmApiUrlInput.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    }
}

// Function to save settings
async function saveSettings() {
    // 确定使用的模型名称
    let modelName = llmModelSelect.value;
    if (modelName === 'custom') {
        modelName = customModelNameInput.value.trim();
    }

    // 获取API URL，如果为空则使用默认值
    let apiUrl = llmApiUrlInput.value.trim();
    if (!apiUrl) {
        apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    }

    const settings = {
        alwaysOnTop: alwaysOnTopCheck.checked,
        autoHide: autoHideCheck.checked,
        edgeDetection: edgeDetectionCheck.checked,
        showCompletionAnimation: showCompletionAnimationCheck.checked,
        playCompletionSound: playCompletionSoundCheck.checked,

        // 添加LLM相关设置
        enableLlm: enableLlmCheck.checked,
        llmApiKey: llmApiKeyInput.value.trim(),
        llmApiUrl: apiUrl,
        llmModel: modelName
    };

    await ipcRenderer.invoke('update-settings', settings);
} 