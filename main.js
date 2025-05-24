const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const iconHelper = require('./assets/app-icon');

// 创建Store实例
const store = new Store({
    name: 'lyon-reminder-data',
    defaults: {
        tasks: [],
        settings: {
            autoHide: true,
            alwaysOnTop: true,
            showCompletionAnimation: true,
            playCompletionSound: true,
            edgeDetection: true,
            // LLM相关设置
            enableLlm: false,
            llmApiKey: '',
            llmApiUrl: 'https://api.openai.com/v1/chat/completions',
            llmModel: 'gpt-3.5-turbo'
        }
    }
});

let mainWindow;
let settingsWindow;
let ganttWindow;
let tray;
let isQuitting = false;
let isHidden = false;
let hideTimeout;

// 检查是否已经有实例在运行
const gotTheLock = app.requestSingleInstanceLock();

// 如果获取锁失败，说明已经有另一个实例在运行
if (!gotTheLock) {
    console.log('应用已经在运行中，退出当前实例');
    app.quit();
} else {
    // 当第二个实例启动时，聚焦到第一个实例的窗口
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('检测到第二个实例启动，聚焦到主窗口');
        // 如果存在主窗口，则显示并聚焦
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Create the main window
    function createWindow() {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        // iPhone 14 Pro Max尺寸：宽77.6mm x 高160.7mm (2796x1290像素)
        // 考虑到分辨率和实际视觉效果，适当调整宽高比例
        const appWidth = 390;
        const appHeight = 800;

        // 计算居中位置
        const centerX = Math.floor(width / 2 - appWidth / 2);
        const centerY = Math.floor(height / 2 - appHeight / 2);

        mainWindow = new BrowserWindow({
            width: appWidth,
            height: appHeight,
            x: centerX,
            y: centerY,
            frame: false,
            transparent: true,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            hasShadow: true,
            roundedCorners: true
        });

        mainWindow.loadFile('index.html');
        mainWindow.setTitle('Lyon 提醒');

        // Hide window on blur if autoHide is enabled
        mainWindow.on('blur', () => {
            const { autoHide } = store.get('settings');
            if (autoHide && !mainWindow.isDestroyed()) {
                mainWindow.hide();
            }
        });

        mainWindow.on('close', (event) => {
            if (!isQuitting) {
                event.preventDefault();
                mainWindow.hide();
                return false;
            }
            return true;
        });

        // Hide menu bar
        mainWindow.setMenuBarVisibility(false);

        // Setup edge detection
        setupEdgeDetection();
    }

    // Create settings window
    function createSettingsWindow() {
        if (settingsWindow) {
            settingsWindow.focus();
            return;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        settingsWindow = new BrowserWindow({
            width: 400,
            height: 500,
            x: Math.floor(width / 2 - 200),
            y: Math.floor(height / 2 - 250),
            frame: false,
            transparent: true,
            resizable: false,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true,
                devTools: true
            },
            hasShadow: true,
            roundedCorners: true
        });

        settingsWindow.loadFile('settings.html');
        settingsWindow.setTitle('设置');

        // Hide menu bar
        settingsWindow.setMenuBarVisibility(false);

        settingsWindow.on('closed', () => {
            settingsWindow = null;

            // Apply settings to main window if it exists
            if (mainWindow && !mainWindow.isDestroyed()) {
                const { alwaysOnTop } = store.get('settings');
                mainWindow.setAlwaysOnTop(alwaysOnTop);
            }
        });
    }

    // Create tray icon
    function createTray() {
        try {
            // 使用专门的图标辅助模块
            const icon = iconHelper.createBasicIcon();
            console.log('图标创建成功');

            // 创建托盘
            tray = new Tray(icon);
            console.log('托盘实例创建成功');

            // 设置菜单
            const contextMenu = Menu.buildFromTemplate([
                {
                    label: '显示/隐藏窗口',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            if (mainWindow.isVisible()) {
                                mainWindow.hide();
                            } else {
                                mainWindow.show();
                                mainWindow.focus();
                            }
                        }
                    }
                },
                {
                    label: '设置',
                    click: () => {
                        createSettingsWindow();
                    }
                },
                { type: 'separator' },
                {
                    label: '退出程序',
                    click: () => {
                        isQuitting = true;
                        app.quit();
                    }
                }
            ]);

            tray.setToolTip('Lyon Task List');
            tray.setContextMenu(contextMenu);

            tray.on('click', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            });

            console.log('托盘创建完成');
        } catch (error) {
            console.error('创建系统托盘失败:', error);
        }
    }

    // Register global shortcut Ctrl+Alt+T
    function registerShortcuts() {
        globalShortcut.register('CommandOrControl+Alt+T', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        });

        // 添加F12打开开发者工具的快捷键
        globalShortcut.register('F12', () => {
            // 获取当前聚焦的窗口
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
                // 如果开发者工具已打开，则关闭；否则打开
                if (focusedWindow.webContents.isDevToolsOpened()) {
                    focusedWindow.webContents.closeDevTools();
                } else {
                    focusedWindow.webContents.openDevTools();
                }
            } else if (mainWindow && !mainWindow.isDestroyed()) {
                // 如果没有聚焦的窗口，则默认对主窗口操作
                if (mainWindow.webContents.isDevToolsOpened()) {
                    mainWindow.webContents.closeDevTools();
                } else {
                    mainWindow.webContents.openDevTools();
                }
            }
        });

        // 添加备用快捷键 Ctrl+Shift+I 打开开发者工具
        globalShortcut.register('CommandOrControl+Shift+I', () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
                focusedWindow.webContents.openDevTools();
            } else if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.openDevTools();
            }
        });
    }

    // Setup edge detection for auto-hiding
    function setupEdgeDetection() {
        // Track mouse position
        const pollInterval = 300; // ms

        function pollMousePosition() {
            if (!mainWindow || mainWindow.isDestroyed()) return;

            const { edgeDetection } = store.get('settings');
            if (!edgeDetection) return;

            const mousePos = screen.getCursorScreenPoint();
            const winBounds = mainWindow.getBounds();
            const { width } = screen.getPrimaryDisplay().workAreaSize;

            // Check if window is at edge and mouse is far away
            const isAtRightEdge = winBounds.x + winBounds.width >= width - 5;

            if (isAtRightEdge && !isHidden && mousePos.x < winBounds.x - 50) {
                // Hide most of the window if mouse is away
                clearTimeout(hideTimeout);
                hideTimeout = setTimeout(() => {
                    mainWindow.setBounds({
                        x: width - 20,
                        y: winBounds.y,
                        width: winBounds.width,
                        height: winBounds.height
                    });
                    isHidden = true;
                }, 500);
            }

            // Show window when mouse approaches
            if (isHidden && mousePos.x > width - 50) {
                clearTimeout(hideTimeout);
                mainWindow.setBounds({
                    x: width - 350,
                    y: winBounds.y,
                    width: winBounds.width,
                    height: winBounds.height
                });
                isHidden = false;
            }
        }

        const mouseTracker = setInterval(pollMousePosition, pollInterval);

        // Clear interval on app quit
        app.on('before-quit', () => {
            clearInterval(mouseTracker);
        });
    }

    // 创建甘特图窗口
    function createGanttWindow() {
        if (ganttWindow) {
            ganttWindow.focus();
            return;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        ganttWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            x: Math.floor(width / 2 - 600),
            y: Math.floor(height / 2 - 400),
            frame: false,
            transparent: true,
            resizable: true,
            alwaysOnTop: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true,
                devTools: true
            },
            hasShadow: true,
            roundedCorners: true
        });

        ganttWindow.loadFile('gantt.html');
        ganttWindow.setTitle('任务甘特图');

        // // 打开开发者工具
        // ganttWindow.webContents.openDevTools();

        // 启用控制台输出
        ganttWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
            console.log('[甘特图窗口]', message);
        });

        // 隐藏菜单栏
        ganttWindow.setMenuBarVisibility(false);

        ganttWindow.on('closed', () => {
            ganttWindow = null;
        });
    }

    // IPC Events
    function setupIPCEvents() {
        // Get tasks from store
        ipcMain.handle('get-tasks', () => {
            return store.get('tasks');
        });

        // Save new task
        ipcMain.handle('add-task', async (event, task) => {
            const tasks = store.get('tasks') || [];
            tasks.push(task);
            store.set('tasks', tasks);

            // 同时将任务添加到历史记录
            try {
                const historyDir = path.join(app.getPath('userData'), 'history');
                if (!fs.existsSync(historyDir)) {
                    fs.mkdirSync(historyDir, { recursive: true });
                }

                const historyFile = path.join(historyDir, 'historical-tasks.json');

                // 读取现有历史数据
                let historicalTasks = [];
                if (fs.existsSync(historyFile)) {
                    const data = fs.readFileSync(historyFile, 'utf8');
                    historicalTasks = JSON.parse(data);
                }

                // 添加新任务到历史记录
                historicalTasks.push(task);

                // 限制历史记录数量，保留最近的100条
                if (historicalTasks.length > 100) {
                    historicalTasks = historicalTasks.slice(-100);
                }

                // 保存更新后的历史记录
                fs.writeFileSync(historyFile, JSON.stringify(historicalTasks, null, 2), 'utf8');
            } catch (error) {
                console.error('保存历史任务数据失败:', error);
            }

            return tasks;
        });

        // Update task
        ipcMain.handle('update-task', (event, updatedTask) => {
            const tasks = store.get('tasks');
            const index = tasks.findIndex(t => t.id === updatedTask.id);
            if (index !== -1) {
                tasks[index] = updatedTask;
                store.set('tasks', tasks);
            }
            return tasks;
        });

        // Delete task
        ipcMain.handle('delete-task', async (event, taskId) => {
            // 从当前任务中删除
            const tasks = store.get('tasks');
            const newTasks = tasks.filter(t => t.id !== taskId);
            store.set('tasks', newTasks);

            // 同时从历史记录中删除该任务
            try {
                const historyDir = path.join(app.getPath('userData'), 'history');
                const historyFile = path.join(historyDir, 'historical-tasks.json');

                if (fs.existsSync(historyFile)) {
                    // 读取历史任务
                    const data = fs.readFileSync(historyFile, 'utf8');
                    let historicalTasks = JSON.parse(data);

                    // 从历史记录中过滤掉要删除的任务
                    const filteredHistoricalTasks = historicalTasks.filter(t => t.id !== taskId);

                    // 保存更新后的历史记录
                    fs.writeFileSync(historyFile, JSON.stringify(filteredHistoricalTasks, null, 2), 'utf8');
                    console.log(`已从历史记录中删除任务 ID: ${taskId}`);
                }
            } catch (error) {
                console.error('从历史记录中删除任务失败:', error);
            }

            return newTasks;
        });

        // Complete task
        ipcMain.handle('complete-task', (event, taskId) => {
            const tasks = store.get('tasks');
            const index = tasks.findIndex(t => t.id === taskId);
            if (index !== -1) {
                tasks[index].completed = true;
                tasks[index].completedAt = new Date().toISOString();
                store.set('tasks', tasks);
            }
            return tasks;
        });

        // Get settings
        ipcMain.handle('get-settings', () => {
            return store.get('settings');
        });

        // Update settings
        ipcMain.handle('update-settings', (event, newSettings) => {
            // 保存旧设置以便检查更改
            const oldSettings = store.get('settings');

            // 合并新设置，确保保留任何未提供的设置值
            const mergedSettings = { ...oldSettings, ...newSettings };

            // 保存新设置
            store.set('settings', mergedSettings);

            // 如果总是置顶设置发生变化，更新窗口
            if (oldSettings.alwaysOnTop !== mergedSettings.alwaysOnTop && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(mergedSettings.alwaysOnTop);
            }

            return true;
        });

        // Minimize window
        ipcMain.on('minimize-window', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.minimize();
            }
        });

        // 处理应用程序退出请求
        ipcMain.on('quit-app', () => {
            isQuitting = true;
            app.quit();
        });

        // 处理窗口聚焦请求
        ipcMain.on('focus-window', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('window-focused');
            }
        });

        // Open settings window
        ipcMain.on('open-settings', () => {
            createSettingsWindow();
        });

        // 处理窗口大小调整请求
        ipcMain.on('resize-window', (event, data) => {
            const height = data.height || 600;
            if (mainWindow && !mainWindow.isDestroyed()) {
                const bounds = mainWindow.getBounds();
                mainWindow.setBounds({ ...bounds, height });
            }
        });

        // 添加获取历史任务数据的IPC处理程序
        ipcMain.handle('get-historical-tasks', async () => {
            try {
                // 确保历史任务数据目录存在
                const historyDir = path.join(app.getPath('userData'), 'history');
                if (!fs.existsSync(historyDir)) {
                    fs.mkdirSync(historyDir, { recursive: true });
                }

                // 获取历史任务数据文件
                const historyFile = path.join(historyDir, 'historical-tasks.json');

                // 如果文件存在，读取并返回数据
                if (fs.existsSync(historyFile)) {
                    const data = fs.readFileSync(historyFile, 'utf8');
                    return JSON.parse(data);
                }

                // 如果没有历史数据文件，返回当前任务作为初始历史数据
                return store.get('tasks') || [];
            } catch (error) {
                console.error('获取历史任务数据失败:', error);
                return [];
            }
        });

        // 打开甘特图窗口
        ipcMain.on('open-gantt', () => {
            createGanttWindow();
        });

        // 打开开发者工具
        ipcMain.on('open-devtools', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        });

        // 甘特图窗口的开发者工具
        ipcMain.on('open-gantt-devtools', () => {
            if (ganttWindow && !ganttWindow.isDestroyed()) {
                ganttWindow.webContents.openDevTools({ mode: 'detach' });
            }
        });

        // 获取所有任务数据（包括历史和当前）用于甘特图
        ipcMain.handle('get-all-tasks-for-gantt', async () => {
            try {
                console.log('开始获取甘特图任务数据');

                // 获取当前任务
                const currentTasks = store.get('tasks') || [];
                console.log(`获取到当前任务: ${currentTasks.length}个`);

                // 确保数据格式一致
                if (currentTasks.length > 0) {
                    console.log('当前任务第一条:', JSON.stringify(currentTasks[0]));
                }

                // 获取历史任务
                const historyDir = path.join(app.getPath('userData'), 'history');
                const historyFile = path.join(historyDir, 'historical-tasks.json');
                console.log(`历史任务文件路径: ${historyFile}`);

                let historicalTasks = [];
                if (fs.existsSync(historyFile)) {
                    try {
                        const data = fs.readFileSync(historyFile, 'utf8');
                        historicalTasks = JSON.parse(data);
                        console.log(`读取到历史任务: ${historicalTasks.length}个`);
                        if (historicalTasks.length > 0) {
                            console.log('历史任务第一条:', JSON.stringify(historicalTasks[0]));
                        }
                    } catch (err) {
                        console.error('解析历史任务数据失败:', err);
                    }
                } else {
                    console.log('历史任务文件不存在');
                }

                // 合并并去重（根据id）
                const allTasks = [...currentTasks];

                // 只添加历史任务中不在当前任务中的那些
                historicalTasks.forEach(histTask => {
                    if (!allTasks.some(currTask => currTask.id === histTask.id)) {
                        allTasks.push(histTask);
                    }
                });

                console.log(`甘特图数据准备完成: 当前任务 ${currentTasks.length}个, 历史任务 ${historicalTasks.length}个, 总计 ${allTasks.length}个`);

                // 测试是否有空任务
                const emptyTasks = allTasks.filter(task => !task || !task.id);
                if (emptyTasks.length > 0) {
                    console.error(`发现 ${emptyTasks.length} 条无效任务数据`);
                }

                return allTasks;
            } catch (error) {
                console.error('获取甘特图任务数据失败:', error);
                return [];
            }
        });

        // 接收刷新应用的消息
        ipcMain.on('reload-app', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('刷新主窗口');
                mainWindow.reload();
            }
        });
    }

    // App ready
    app.whenReady().then(() => {
        try {
            // 先设置IPC事件处理程序
            setupIPCEvents();
            // 然后创建窗口
            createWindow();

            // 延迟创建托盘，确保应用程序完全初始化
            setTimeout(() => {
                try {
                    createTray();
                    console.log('托盘创建完成');
                } catch (e) {
                    console.error('托盘创建出错:', e);
                }
            }, 500);

            registerShortcuts();

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    createWindow();
                }
            });
        } catch (error) {
            console.error('启动错误:', error);
        }
    });

    // Quit when all windows are closed, except on macOS
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // Before app quits
    app.on('before-quit', () => {
        isQuitting = true;
    });

    // Unregister shortcuts
    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });
} 