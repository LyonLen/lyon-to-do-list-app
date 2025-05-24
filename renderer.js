const { ipcRenderer } = require('electron');
const { v4: uuidv4 } = require('uuid');
// 添加axios用于API请求
const axios = require('axios');

// DOM Elements
const taskList = document.getElementById('taskList');
const emptyState = document.getElementById('emptyState');
// const addTaskBtn = document.getElementById('addTaskBtn'); // 注释掉，不再需要
const taskInputContainer = document.getElementById('taskInputContainer');
const taskInput = document.getElementById('taskInput');
const closeBtn = document.getElementById('close-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const settingsBtn = document.getElementById('settings-btn');
const contentArea = document.querySelector('.content'); // 获取内容区域元素
const autocompleteContainer = document.getElementById('autocompleteContainer');
const ganttBtn = document.getElementById('gantt-btn'); // 添加甘特图按钮引用
const devToolsBtn = document.getElementById('dev-tools-btn'); // 开发者工具按钮引用

// 自动补全相关变量
let autocompleteItems = [];
let selectedAutocompleteIndex = -1;
let historicalTasks = [];
let isAutocompleteVisible = false;
// LLM推荐相关变量
let llmSuggestions = [];
let isLlmLoading = false;
let llmRequestTimeout;
const LLM_REQUEST_DELAY = 500; // 等待输入停止后的延迟时间(毫秒)

// 修改音效实现方式
// 使用Web Audio API生成完成音效
let audioContext;
let completionSound = {
    play: function () {
        try {
            // 创建音频上下文
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 创建振荡器
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            // 配置振荡器
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
            oscillator.frequency.exponentialRampToValueAtTime(1760, audioContext.currentTime + 0.1); // A6

            // 配置音量
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            // 连接节点
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // 播放声音
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.3);

            console.log('播放完成音效');
        } catch (e) {
            console.error('音效播放失败:', e);
        }
    }
};

// Load tasks on startup
document.addEventListener('DOMContentLoaded', async () => {
    await loadTasks();
    await loadHistoricalTasks(); // 加载历史任务数据用于自动补全

    // 添加标题栏点击事件，确保点击时收起自动补全
    const titleBar = document.querySelector('.title-bar');
    if (titleBar) {
        titleBar.addEventListener('click', (event) => {
            // 如果点击的不是控制按钮，则收起自动补全
            if (!event.target.closest('#settings-btn') &&
                !event.target.closest('#minimize-btn') &&
                !event.target.closest('#close-btn')) {
                console.log('点击了标题栏，收起自动补全');
                hideAutocomplete();
            }
        });
    }

    // 添加优先级图例及其子元素的点击事件
    const priorityLegend = document.querySelector('.priority-legend');
    if (priorityLegend) {
        // 为整个图例添加点击事件
        priorityLegend.addEventListener('click', () => {
            console.log('点击了优先级图例，收起自动补全');
            hideAutocomplete();
        });

        // 为图例中的每个项和子元素单独添加点击事件，确保能捕获所有点击
        const priorityItems = priorityLegend.querySelectorAll('.priority-item, .priority-item *, .priority-color, span');
        priorityItems.forEach(item => {
            item.addEventListener('click', (event) => {
                console.log('点击了优先级图例项:', event.target.className || event.target.tagName);
                event.stopPropagation(); // 阻止冒泡，确保事件被处理
                hideAutocomplete();
            });
        });
    }
});

// IPC Event listeners
ipcRenderer.on('open-settings', () => {
    openSettings();
});

// Window control event listeners
closeBtn.addEventListener('click', () => {
    // 发送退出应用的消息，而不是缩小到托盘
    ipcRenderer.send('quit-app');
});

minimizeBtn.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

settingsBtn.addEventListener('click', () => {
    openSettings();
});

// 甘特图按钮点击事件
ganttBtn.addEventListener('click', () => {
    // 调用electron的IPC方法打开甘特图窗口
    ipcRenderer.send('open-gantt');
});

// 开发者工具按钮点击事件
devToolsBtn.addEventListener('click', () => {
    // 发送打开开发者工具的消息
    ipcRenderer.send('open-devtools');
});

// 移除添加按钮相关代码
// addTaskBtn.addEventListener('click', () => {
//     toggleTaskInput(true);
// });

// 保留输入框的回车和Esc键监听
taskInput.addEventListener('keydown', async (e) => {
    // 如果自动补全可见
    if (isAutocompleteVisible) {
        if (e.key === 'ArrowDown') {
            // 向下选择
            e.preventDefault();
            selectNextAutocompleteItem();
            return;
        } else if (e.key === 'ArrowUp') {
            // 向上选择
            e.preventDefault();
            selectPrevAutocompleteItem();
            return;
        } else if (e.key === 'Tab') {
            // 只有Tab键可以补全
            e.preventDefault();
            applySelectedAutocompletion();
            return;
        } else if (e.key === 'Escape') {
            // Esc键隐藏自动补全
            e.preventDefault();
            hideAutocomplete();
            return;
        }
    }

    // 原有的键盘事件处理
    if (e.key === 'Escape') {
        taskInput.value = ''; // 清空输入框
        hideAutocomplete();
    } else if (e.key === 'Enter') {
        // 回车键总是提交用户当前输入
        await createTask();
    }
});

// 监听输入事件，触发自动补全
taskInput.addEventListener('input', () => {
    const inputValue = taskInput.value.trim();

    if (inputValue.length >= 1) {
        // 最少输入1个字符才开始补全
        showAutocomplete(inputValue);
    } else {
        hideAutocomplete();
    }
});

// 显示自动补全
function showAutocomplete(inputValue) {
    // 清除之前的延迟请求
    if (llmRequestTimeout) {
        clearTimeout(llmRequestTimeout);
    }

    // 查找匹配的历史任务
    const historyMatches = findMatches(inputValue);

    // 判断是否应该使用LLM
    ipcRenderer.invoke('get-settings').then(settings => {
        const shouldUseLlm = settings.enableLlm && inputValue.length >= 3;

        if (shouldUseLlm) {
            // 设置加载状态
            isLlmLoading = true;

            // 先显示历史匹配结果
            const combinedMatches = [...historyMatches];
            if (isLlmLoading) {
                combinedMatches.push({ title: '正在加载LLM推荐...', isLoading: true });
            }
            renderAutocompleteItems(combinedMatches);

            // 延迟发送LLM请求，避免频繁请求
            llmRequestTimeout = setTimeout(async () => {
                try {
                    const suggestions = await getLlmSuggestions(inputValue);
                    // 更新LLM建议并重新渲染
                    llmSuggestions = Array.isArray(suggestions) ? suggestions.map(suggestion => ({
                        title: String(suggestion || ''), // 确保建议是字符串
                        isLlmSuggestion: true
                    })) : [];

                    // 过滤掉空建议
                    llmSuggestions = llmSuggestions.filter(item => item.title && item.title.trim().length > 0);

                    isLlmLoading = false;

                    // 合并历史匹配和LLM建议
                    const allMatches = [...historyMatches, ...llmSuggestions];
                    if (allMatches.length === 0) {
                        hideAutocomplete();
                        return;
                    }

                    renderAutocompleteItems(allMatches);

                    // 确保添加此行来强制重新定位容器
                    positionAutocompleteContainer();
                } catch (error) {
                    console.error('获取LLM建议失败:', error);
                    isLlmLoading = false;

                    // 即使LLM失败，仍然显示历史匹配
                    if (historyMatches.length > 0) {
                        renderAutocompleteItems(historyMatches);
                    } else {
                        hideAutocomplete();
                    }
                }
            }, LLM_REQUEST_DELAY);
        } else {
            // 如果未启用LLM或输入较短，只显示历史匹配
            if (historyMatches.length === 0) {
                hideAutocomplete();
                return;
            }
            renderAutocompleteItems(historyMatches);
        }

        // 确保DOM更新后再添加显示类
        setTimeout(() => {
            // 恢复显示和点击事件
            autocompleteContainer.style.display = '';
            autocompleteContainer.style.pointerEvents = 'auto';

            // 添加显示类
            autocompleteContainer.classList.add('visible');
            isAutocompleteVisible = true;

            // 定位自动补全容器
            positionAutocompleteContainer();

            // 确保自动补全容器添加到body
            if (autocompleteContainer.parentElement !== document.body) {
                document.body.appendChild(autocompleteContainer);
            }
        }, 0);
    }).catch(error => {
        console.error('获取设置失败:', error);

        // 出错时退回到只显示历史匹配
        if (historyMatches.length === 0) {
            hideAutocomplete();
            return;
        }
        renderAutocompleteItems(historyMatches);
    });
}

// 高亮当前选中的项目
function highlightSelectedItem() {
    // 先清除所有选中状态
    clearAutocompleteSelection();

    // 如果有有效选中项，添加选中状态
    if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < autocompleteItems.length) {
        const selectedItem = autocompleteContainer.querySelector(`.autocomplete-item[data-index="${selectedAutocompleteIndex}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
            selectedItem.scrollIntoView({ block: 'nearest' });
        }
    }
}

// 选择下一个自动补全项
function selectNextAutocompleteItem() {
    if (autocompleteItems.length === 0) return;

    // 选择下一项
    selectedAutocompleteIndex = (selectedAutocompleteIndex + 1) % autocompleteItems.length;

    // 高亮选中项
    highlightSelectedItem();
}

// 选择上一个自动补全项
function selectPrevAutocompleteItem() {
    if (autocompleteItems.length === 0) return;

    // 选择上一项
    selectedAutocompleteIndex = selectedAutocompleteIndex <= 0 ?
        autocompleteItems.length - 1 : selectedAutocompleteIndex - 1;

    // 高亮选中项
    highlightSelectedItem();
}

// 清除自动补全选中状态
function clearAutocompleteSelection() {
    const selectedItems = autocompleteContainer.querySelectorAll('.autocomplete-item.selected');
    selectedItems.forEach(item => item.classList.remove('selected'));
}

// 应用选中的自动补全
function applySelectedAutocompletion() {
    if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < autocompleteItems.length) {
        const selectedTask = autocompleteItems[selectedAutocompleteIndex];

        // 构建完整的任务输入，包括优先级、标题、标签等
        let inputValue = '';

        // 添加优先级
        const priorityMap = {
            'Urgent': '紧急',
            'High': '高',
            'Medium': '中',
            'Low': '低'
        };

        if (selectedTask.priority) {
            inputValue += `[${priorityMap[selectedTask.priority] || '中'}] `;
        }

        // 添加标题
        inputValue += selectedTask.title;

        // 添加预估时间
        if (selectedTask.estimatedTime) {
            inputValue += ` @${selectedTask.estimatedTime}`;
        }

        // 添加标签
        if (selectedTask.tags && selectedTask.tags.length > 0) {
            inputValue += ' ' + selectedTask.tags.map(tag => `#${tag}`).join(' ');
        }

        // 设置输入框的值
        taskInput.value = inputValue;
        taskInput.focus();

        // 隐藏自动补全
        hideAutocomplete();
    }
}

// Function to load tasks from main process
async function loadTasks() {
    const tasks = await ipcRenderer.invoke('get-tasks');
    const settings = await ipcRenderer.invoke('get-settings');

    // 分离未完成和已完成的任务
    const uncompletedTasks = tasks.filter(t => !t.completed);
    const completedTasks = tasks.filter(t => t.completed);

    // 对未完成的任务进行智能排序
    const sortedUncompletedTasks = sortTasksByPriority(uncompletedTasks);

    // 对已完成的任务按完成时间逆序排序（最新完成的排在前面）
    const sortedCompletedTasks = completedTasks.sort((a, b) => {
        return new Date(b.completedAt || b.created) - new Date(a.completedAt || a.created);
    });

    // 渲染所有任务，先显示未完成的，再显示已完成的
    renderTasks([...sortedUncompletedTasks, ...sortedCompletedTasks]);
}

// Render tasks to the DOM
function renderTasks(tasks) {
    taskList.innerHTML = '';

    if (tasks.length === 0) {
        emptyState.style.display = 'block';
        // 任务为空时，调整窗口高度为基础高度
        requestWindowResize(420);
        return;
    }

    emptyState.style.display = 'none';

    let hasSeparator = false; // 用于标记是否已添加分隔符

    tasks.forEach(task => {
        // 如果当前任务是已完成，且还没有添加分隔符，则添加一个分隔符
        if (task.completed && !hasSeparator) {
            const separator = document.createElement('div');
            separator.className = 'task-separator';
            separator.textContent = '已完成任务';
            taskList.appendChild(separator);
            hasSeparator = true;
        }

        const li = document.createElement('li');
        li.className = `task-item priority-${task.priority.toLowerCase()}`;
        if (task.completed) {
            li.classList.add('task-completed');
        }
        li.dataset.id = task.id;

        const title = document.createElement('div');
        title.className = 'task-title';
        title.textContent = task.title;

        const meta = document.createElement('div');
        meta.className = 'task-meta';

        // 创建左侧部分：时间和标签放在一起
        const metaLeft = document.createElement('div');
        metaLeft.className = 'meta-left';
        meta.appendChild(metaLeft);

        // Add estimated time if available
        if (task.estimatedTime) {
            const time = document.createElement('span');
            time.className = 'task-time';
            time.textContent = `⏱ ${task.estimatedTime}`;
            metaLeft.appendChild(time);
        }

        // 创建时间信息容器
        const timeInfoContainer = document.createElement('div');
        timeInfoContainer.className = 'time-info';
        metaLeft.appendChild(timeInfoContainer);

        // 显示创建时间（所有任务都显示）
        if (task.created) {
            const createdDate = new Date(task.created);
            const formattedCreatedDate = `${createdDate.getMonth() + 1}月${createdDate.getDate()}日 ${createdDate.getHours()}:${String(createdDate.getMinutes()).padStart(2, '0')}`;

            const createdTime = document.createElement('span');
            createdTime.className = 'task-created-time';
            createdTime.textContent = `📅 ${formattedCreatedDate}`;
            timeInfoContainer.appendChild(createdTime);
        }

        // 显示完成时间和花费时间（仅已完成任务）
        if (task.completed && task.completedAt) {
            // 显示完成时间
            const completedDate = new Date(task.completedAt);
            const formattedCompletedDate = `${completedDate.getMonth() + 1}月${completedDate.getDate()}日 ${completedDate.getHours()}:${String(completedDate.getMinutes()).padStart(2, '0')}`;

            const completedTime = document.createElement('span');
            completedTime.className = 'task-completed-time';
            completedTime.textContent = `✓ ${formattedCompletedDate}`;
            timeInfoContainer.appendChild(completedTime);

            // 计算并显示花费时间
            if (task.created) {
                const createdDate = new Date(task.created);
                const completedDate = new Date(task.completedAt);
                const durationMs = completedDate - createdDate;

                // 格式化时间
                let durationText = '';
                const seconds = Math.floor(durationMs / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                if (days > 0) {
                    durationText = `${days}天`;
                    if (hours % 24 > 0) durationText += `${hours % 24}小时`;
                } else if (hours > 0) {
                    durationText = `${hours}小时`;
                    if (minutes % 60 > 0) durationText += `${minutes % 60}分钟`;
                } else if (minutes > 0) {
                    durationText = `${minutes}分钟`;
                } else {
                    durationText = `${seconds}秒`;
                }

                // 创建花费时间元素
                const durationEl = document.createElement('span');
                durationEl.className = 'task-duration';
                durationEl.textContent = `⏳ ${durationText}`;
                timeInfoContainer.appendChild(durationEl);
            }
        }

        // Add tags if available - 放在时间旁边
        if (task.tags && task.tags.length > 0) {
            task.tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'task-tag';
                tagEl.textContent = `${tag}`;
                metaLeft.appendChild(tagEl);
            });
        }

        // Add controls
        const controls = document.createElement('div');
        controls.className = 'task-controls';

        // 针对未完成的任务，添加完成按钮
        if (!task.completed) {
            const completeBtn = document.createElement('button');
            completeBtn.className = 'control-btn';
            completeBtn.textContent = '✓';
            completeBtn.title = '标记为已完成';

            // 添加单独的事件处理程序，防止事件冒泡
            completeBtn.addEventListener('click', (event) => {
                event.stopPropagation(); // 阻止事件冒泡
                event.preventDefault(); // 阻止默认行为
                completeTask(task.id);
            });

            controls.appendChild(completeBtn);
        }

        // 添加删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'control-btn delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = '删除任务';

        // 添加删除事件处理程序
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation(); // 阻止事件冒泡
            event.preventDefault(); // 阻止默认行为
            deleteTask(task.id);
        });

        controls.appendChild(deleteBtn);

        // 为整个任务项添加点击事件阻止冒泡
        li.addEventListener('mousedown', (event) => {
            // 防止点击任务项时触发自动补全
            event.stopPropagation();
        });

        // 添加点击事件以确保点击任务项时能够隐藏自动补全
        li.addEventListener('click', (event) => {
            if (isAutocompleteVisible) {
                hideAutocomplete();
            }
        });

        // Assemble the task item
        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(controls);

        taskList.appendChild(li);
    });

    // 任务渲染完成后，计算所需的窗口高度并请求调整
    // 延迟执行以确保DOM已更新
    setTimeout(() => {
        const taskListHeight = taskList.scrollHeight;
        const titleBarHeight = 40; // 标题栏高度
        const priorityLegendHeight = 30; // 优先级图例高度
        const inputContainerHeight = 60; // 输入框容器高度
        const padding = 40; // 额外的内边距

        // 基础高度加上任务列表高度
        const totalHeight = titleBarHeight + taskListHeight + priorityLegendHeight + inputContainerHeight + padding;

        // 限制最小和最大高度
        const minHeight = 420;
        const maxHeight = 800;
        const newHeight = Math.max(minHeight, Math.min(maxHeight, totalHeight));

        // 发送调整窗口大小的请求
        requestWindowResize(newHeight);
    }, 50);
}

// 请求调整窗口大小
function requestWindowResize(height) {
    ipcRenderer.send('resize-window', { height });
}

// Toggle task input visibility
function toggleTaskInput(show) {
    // 不再显示/隐藏输入框容器
    // taskInputContainer.style.display = show ? 'block' : 'none';

    // 不再控制添加按钮的显示
    // addTaskBtn.style.opacity = show ? '0' : '1';
    // addTaskBtn.style.pointerEvents = show ? 'none' : 'auto';

    if (show) {
        taskInput.focus();
    } else {
        taskInput.value = '';
    }
}

// Parse task input using markdown-like syntax
function parseTaskInput(input) {
    const task = {
        id: uuidv4(),
        title: input,
        priority: 'Medium',
        tags: [],
        created: new Date().toISOString(),
        completed: false,
        estimatedTime: null
    };

    // Extract priority
    const priorityMatch = input.match(/\[(紧急|高|中|低)\]/);
    if (priorityMatch) {
        const priorityMap = {
            '紧急': 'Urgent',
            '高': 'High',
            '中': 'Medium',
            '低': 'Low'
        };

        task.priority = priorityMap[priorityMatch[1]];
        task.title = task.title.replace(priorityMatch[0], '').trim();
    }

    // Extract estimated time
    const timeMatch = input.match(/@(\d+[hm](?:\d+[hm])?)/);
    if (timeMatch) {
        task.estimatedTime = timeMatch[1];
        task.title = task.title.replace(timeMatch[0], '').trim();
    }

    // Extract tags - 支持中文和更多特殊字符
    const tagMatches = input.match(/#([^\s#]+)/g);
    if (tagMatches) {
        console.log('找到标签:', tagMatches);
        task.tags = tagMatches.map(tag => tag.substring(1));
        // 从标题中移除标签
        tagMatches.forEach(tag => {
            task.title = task.title.replace(tag, '');
        });
        task.title = task.title.trim();
        console.log('处理后的标签:', task.tags);
        console.log('处理后的标题:', task.title);
    }

    return task;
}

// Create a new task
async function createTask() {
    const input = taskInput.value.trim();
    if (!input) return;

    const task = parseTaskInput(input);

    await ipcRenderer.invoke('add-task', task);
    await loadTasks();

    // 只清空输入框，不再隐藏
    taskInput.value = '';
    taskInput.focus();
}

// Complete a task
async function completeTask(taskId) {
    const settings = await ipcRenderer.invoke('get-settings');
    const taskElement = document.querySelector(`.task-item[data-id="${taskId}"]`);

    if (settings.showCompletionAnimation && taskElement) {
        taskElement.classList.add('completed-animation');

        if (settings.playCompletionSound) {
            completionSound.play();
        }

        // Wait for animation to complete
        setTimeout(async () => {
            await ipcRenderer.invoke('complete-task', taskId);
            await loadTasks();
        }, 300);
    } else {
        await ipcRenderer.invoke('complete-task', taskId);
        await loadTasks();
    }
}

// Delete a task
async function deleteTask(taskId) {
    try {
        // 先记住当前输入框的值，以便恢复
        const currentInputValue = taskInput.value;

        // 增强版确认对话框
        if (confirm('确定要删除这个任务吗？')) {
            console.log('用户确认删除任务:', taskId);

            // 1. 强制恢复输入框状态，确保能正常交互
            resetInputState();

            // 2. 请求主窗口重新获取焦点 (这会触发窗口的模拟失焦再聚焦过程)
            ipcRenderer.send('focus-window');

            // 3. 删除任务
            await ipcRenderer.invoke('delete-task', taskId);

            // 4. 重新加载数据
            await Promise.all([
                loadTasks(),
                loadHistoricalTasks()
            ]);

            console.log("任务已删除，数据已重新加载");

            // 5. 恢复原始输入，避免用户输入丢失
            setTimeout(() => {
                // 先确保输入框可用
                resetInputState();

                // 恢复输入值
                taskInput.value = currentInputValue;

                // 强制获取焦点 - 延迟执行，确保DOM已更新
                setTimeout(() => {
                    forceInputFocus();
                }, 50);
            }, 100);
        } else {
            console.log('用户取消删除任务');

            // 取消删除的情况下，也要确保窗口恢复正常
            // 1. 请求主窗口重新获取焦点
            ipcRenderer.send('focus-window');

            // 2. 延迟执行，确保对话框完全关闭
            setTimeout(() => {
                // 重置状态
                resetInputState();

                // 恢复原输入
                taskInput.value = currentInputValue;

                // 强制聚焦
                forceInputFocus();
            }, 100);
        }
    } catch (error) {
        console.error("删除任务出错:", error);

        // 出错情况下进行更彻底的恢复
        setTimeout(() => {
            // 重置状态
            resetInputState();

            // 强制窗口获得焦点
            ipcRenderer.send('focus-window');

            // 强制输入框获得焦点
            setTimeout(forceInputFocus, 200);
        }, 100);
    }
}

// 重置输入框状态的辅助函数
function resetInputState() {
    try {
        console.log('重置输入框状态');

        // 确保输入框和相关容器可以交互
        taskInput.disabled = false;
        taskInput.style.pointerEvents = 'auto';
        taskInputContainer.style.pointerEvents = 'auto';

        // 重置所有样式属性
        taskInput.style.opacity = '1';
        taskInput.style.visibility = 'visible';
        taskInput.style.display = '';

        // 确保输入框处于编辑状态
        taskInput.readOnly = false;

        // 清除可能的错误类
        taskInput.classList.remove('error');

        // 重置自动补全容器
        hideAutocomplete();

        // 尝试重置文档结构
        document.body.style.pointerEvents = 'auto';

        // 调整z-index确保输入框在最上层
        taskInputContainer.style.zIndex = '1000';
    } catch (error) {
        console.error('重置输入框状态出错:', error);
    }
}

// 强制输入框获得焦点的辅助函数
function forceInputFocus() {
    try {
        console.log('强制输入框获得焦点');

        // 先确保输入框状态正常
        resetInputState();

        // 方法1: 直接聚焦
        taskInput.focus();

        // 方法2: 模拟点击事件
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        taskInput.dispatchEvent(clickEvent);

        // 方法3: 使用Selection API设置光标位置
        taskInput.select();

        // 方法4: 短暂聚焦其他元素再聚焦回来
        setTimeout(() => {
            document.body.focus();
            setTimeout(() => {
                taskInput.focus();
                taskInput.select();
            }, 10);
        }, 10);

        // 方法5: 延迟再尝试，确保DOM完全更新
        setTimeout(() => {
            taskInput.focus();
            // 再次模拟点击
            taskInput.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
            taskInput.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
            taskInput.dispatchEvent(clickEvent);

            // 确保光标可见
            taskInput.setSelectionRange(taskInput.value.length, taskInput.value.length);
        }, 100);

        // 方法6: 再延迟尝试一次
        setTimeout(() => {
            taskInput.blur(); // 先失焦
            setTimeout(() => {
                taskInput.focus(); // 再聚焦
                taskInput.click();
            }, 10);
        }, 200);
    } catch (error) {
        console.error('强制输入框获得焦点出错:', error);
    }
}

// Sort tasks by priority
function sortTasksByPriority(tasks) {
    return tasks.sort((a, b) => {
        // Create a scoring system based on multiple factors
        const getScore = (task) => {
            let score = 0;

            // Priority weight (40%)
            const priorityScore = {
                'Urgent': 40,
                'High': 30,
                'Medium': 20,
                'Low': 10
            };
            score += priorityScore[task.priority] || 0;

            // Due date urgency (30%)
            if (task.dueDate) {
                const now = new Date();
                const due = new Date(task.dueDate);
                const timeLeft = due - now;
                const dayLeft = timeLeft / (1000 * 60 * 60 * 24);

                // Score higher if deadline is closer
                if (dayLeft < 0) score += 30; // Overdue
                else if (dayLeft < 1) score += 25; // Due today
                else if (dayLeft < 2) score += 20; // Due tomorrow
                else if (dayLeft < 7) score += 15; // Due this week
                else score += 5; // Due later
            }

            // Blocking others (20%)
            if (task.isBlockingOthers) score += 20;

            // Estimated time (10%)
            // Prefer quick tasks (less than 1 hour)
            if (task.estimatedTime && task.estimatedTime.includes('h')) {
                const hours = parseInt(task.estimatedTime);
                if (hours < 1) score += 10;
            }

            return score;
        };

        return getScore(b) - getScore(a);
    });
}

// Open settings dialog
function openSettings() {
    // 发送消息到主进程打开设置窗口
    ipcRenderer.send('open-settings');
}

// 实现滚动条显示/隐藏功能
let scrollTimer = null;
if (contentArea) {
    // 监听滚动事件
    contentArea.addEventListener('scroll', () => {
        // 添加一个类来显示滚动条
        contentArea.classList.add('scrolling');

        // 清除之前的定时器
        if (scrollTimer) {
            clearTimeout(scrollTimer);
        }

        // 设置新的定时器，滚动停止一段时间后隐藏滚动条
        scrollTimer = setTimeout(() => {
            contentArea.classList.remove('scrolling');
        }, 1000); // 1秒后隐藏
    });
}

// 隐藏自动补全
function hideAutocomplete() {
    if (!isAutocompleteVisible && autocompleteContainer.style.display === 'none') return; // 如果已经完全隐藏，不执行后续操作

    autocompleteContainer.classList.remove('visible');
    // 设置为不接收鼠标事件
    autocompleteContainer.style.pointerEvents = 'none';
    // 设置display为none，彻底移除元素占位
    autocompleteContainer.style.display = 'none';

    isAutocompleteVisible = false;
    selectedAutocompleteIndex = -1;

    // 将自动补全容器放回原位
    const inputWrapper = document.querySelector('.input-wrapper');
    if (inputWrapper && autocompleteContainer.parentElement === document.body) {
        inputWrapper.appendChild(autocompleteContainer);
    }

    // 确保输入框可以正常交互
    taskInput.style.pointerEvents = 'auto';
    taskInputContainer.style.pointerEvents = 'auto';

    console.log('彻底隐藏自动补全容器，并恢复输入框交互');
}

// 调整自动补全容器位置
function positionAutocompleteContainer() {
    if (!isAutocompleteVisible) return;

    const inputRect = taskInput.getBoundingClientRect();

    // 设置自动补全容器的位置和尺寸
    autocompleteContainer.style.position = 'fixed';
    autocompleteContainer.style.width = inputRect.width + 'px';
    autocompleteContainer.style.left = inputRect.left + 'px';
    autocompleteContainer.style.zIndex = '9999'; // 确保最高层级

    // 修改这里：使用top而不是bottom，并向下偏移一点避开输入框
    autocompleteContainer.style.top = (inputRect.bottom + 5) + 'px';
    // 移除之前的bottom设置
    autocompleteContainer.style.bottom = '';

    // 根据项目数量调整最大高度
    const itemCount = autocompleteItems.length;
    if (itemCount > 0) {
        // 每项高度大约38px，加上提示信息高度30px，再加一些额外空间
        const estimatedHeight = (itemCount * 38) + 30 + 10;
        autocompleteContainer.style.maxHeight = estimatedHeight + 'px';
    }

    console.log('自动补全容器位置已调整，项目数量:', autocompleteItems.length);
}

// 渲染自动补全选项
function renderAutocompleteItems(items) {
    // 清空容器
    autocompleteContainer.innerHTML = '';
    autocompleteItems = items;
    selectedAutocompleteIndex = -1;

    // 设置数据属性，方便调试
    autocompleteContainer.dataset.itemCount = items.length;

    // 创建并添加项目
    items.forEach((item, index) => {
        const element = document.createElement('div');
        element.className = 'autocomplete-item';
        element.dataset.index = index;

        if (item.isLoading) {
            // 加载中状态
            element.classList.add('loading-item');
            element.innerHTML = `<span>${item.title}</span><div class="loading-spinner"></div>`;
        } else if (item.isLlmSuggestion) {
            // LLM推荐项目
            element.classList.add('llm-suggestion');
            element.innerHTML = `
                <span class="llm-icon">🤖</span>
                <span class="suggestion-text">${item.title}</span>
            `;
        } else {
            // 普通历史项目
            element.innerHTML = `<span>${item.title}</span>`;
        }

        // 添加点击事件
        element.addEventListener('click', () => {
            taskInput.value = item.title;
            hideAutocomplete();
            forceInputFocus();
        });

        // 添加鼠标移入事件
        element.addEventListener('mouseenter', () => {
            selectedAutocompleteIndex = index;
            highlightSelectedItem();
        });

        autocompleteContainer.appendChild(element);
    });

    // 如果自动补全容器现在有内容，则显示它
    if (items.length > 0) {
        autocompleteContainer.style.display = '';
        autocompleteContainer.style.pointerEvents = 'auto';
        isAutocompleteVisible = true;
    } else {
        autocompleteContainer.style.display = 'none';
        autocompleteContainer.style.pointerEvents = 'none';
        isAutocompleteVisible = false;
    }

    // 添加调试信息
    console.log('渲染了', items.length, '个自动补全项目:',
        '容器状态:', autocompleteContainer.style.display,
        '可见状态:', isAutocompleteVisible);
}

// 加载历史任务数据用于自动补全
async function loadHistoricalTasks() {
    try {
        // 从主进程获取历史任务数据
        historicalTasks = await ipcRenderer.invoke('get-historical-tasks') || [];
        console.log('已加载历史任务数据:', historicalTasks.length);
    } catch (error) {
        console.error('加载历史任务数据失败:', error);
        historicalTasks = [];
    }
}

// 查找匹配的任务建议
function findMatches(inputText) {
    if (!inputText || inputText.length < 1) return [];

    const matches = [];

    // 检查输入是否包含优先级信息
    const priorityMatch = inputText.match(/\[(紧急|高|中|低)\]/);
    let userPriority = null;
    let cleanInput = inputText;

    if (priorityMatch) {
        const priorityMap = {
            '紧急': 'Urgent',
            '高': 'High',
            '中': 'Medium',
            '低': 'Low'
        };
        userPriority = priorityMap[priorityMatch[1]];
        cleanInput = inputText.replace(priorityMatch[0], '').trim();
        console.log('搜索时检测到优先级:', userPriority, '，清理后的输入:', cleanInput);
    }

    const lowerInput = cleanInput.toLowerCase();

    // 始终添加AI智能建议，确保它们不会消失
    const aiSuggestions = generateSuggestions(inputText);

    // 从历史任务中查找匹配
    if (historicalTasks && historicalTasks.length > 0) {
        // 按照相关性排序匹配项
        const scoredMatches = historicalTasks
            .filter(task => !task.completed) // 过滤掉已完成的任务
            .map(task => {
                // 计算匹配分数
                let score = 0;

                // 如果用户指定了优先级，匹配相同优先级的任务得分更高
                if (userPriority && task.priority === userPriority) {
                    score += 15; // 优先级匹配得分最高
                    console.log('优先级匹配:', task.title, task.priority);
                }

                // 标题匹配得分
                if (task.title.toLowerCase().includes(lowerInput)) {
                    score += 10;
                    // 标题开头匹配得分更高
                    if (task.title.toLowerCase().startsWith(lowerInput)) {
                        score += 5;
                    }
                }

                // 标签匹配得分
                if (task.tags && task.tags.some(tag => tag.toLowerCase().includes(lowerInput))) {
                    score += 3;
                }

                // 最近创建的任务得分更高
                const daysSinceCreated = (new Date() - new Date(task.created)) / (1000 * 60 * 60 * 24);
                if (daysSinceCreated < 7) {
                    score += Math.max(0, 7 - daysSinceCreated);
                }

                return { task, score };
            })
            .filter(item => item.score > 0) // 只保留有分数的匹配项
            .sort((a, b) => b.score - a.score); // 按分数从高到低排序

        // 取前3个最佳匹配，留出空间给AI建议
        matches.push(...scoredMatches.slice(0, 3).map(item => item.task));
    }

    // 合并历史匹配和AI建议，确保AI建议不会被历史记录完全覆盖
    matches.push(...aiSuggestions);

    console.log('匹配结果:', matches.length, '其中AI建议:', aiSuggestions.length);

    return matches.slice(0, 5); // 最多返回5个结果
}

// 生成智能建议
function generateSuggestions(inputText) {
    const suggestions = [];

    // 避免空输入
    if (!inputText || inputText.trim() === '') {
        inputText = '任务';
    }

    console.log('为输入生成AI建议:', inputText);

    // 检查输入是否包含优先级信息
    let priority = 'Medium'; // 默认中等优先级
    const priorityMatch = inputText.match(/\[(紧急|高|中|低)\]/);
    if (priorityMatch) {
        const priorityMap = {
            '紧急': 'Urgent',
            '高': 'High',
            '中': 'Medium',
            '低': 'Low'
        };
        priority = priorityMap[priorityMatch[1]];
        console.log('从输入中检测到优先级:', priority);
    }

    // 提取纯文本内容（移除优先级标记）
    let pureText = inputText;
    if (priorityMatch) {
        pureText = inputText.replace(priorityMatch[0], '').trim();
    }
    if (pureText === '') {
        pureText = '任务';
    }

    // 根据输入的文本生成智能建议
    // 示例：如果用户输入"会议"，可以建议"准备会议材料"、"安排会议室"等

    // 常见任务建议模板 - 确保AI推荐始终存在，并使用用户指定的优先级
    const taskTemplates = [
        { title: '完成' + pureText, priority: priority, estimatedTime: '1h', tags: ['工作'], isAISuggestion: true },
        { title: '检查' + pureText, priority: priority, estimatedTime: '30m', tags: ['日常'], isAISuggestion: true },
    ];

    // 添加带有AI标记的建议
    suggestions.push(...taskTemplates.map(template => ({
        id: uuidv4(),
        title: template.title,
        priority: template.priority,
        estimatedTime: template.estimatedTime,
        tags: template.tags,
        created: new Date().toISOString(),
        completed: false,
        isAISuggestion: true
    })));

    console.log('生成了AI建议:', suggestions.length, '个');

    return suggestions;
}

// 添加窗口大小变化监听，调整自动补全容器位置
window.addEventListener('resize', () => {
    if (isAutocompleteVisible) {
        positionAutocompleteContainer();
    }
});

// 添加全局点击事件，点击其他区域时隐藏自动补全
document.addEventListener('click', (event) => {
    console.log('点击目标:', event.target.className || event.target.tagName);

    // 检查是否点击了优先级图例区域
    if (isAutocompleteVisible && (
        event.target.closest('.priority-legend') ||
        event.target.classList.contains('priority-item') ||
        event.target.classList.contains('priority-color')
    )) {
        // 对优先级图例的点击立即处理，不延迟
        console.log('检测到优先级图例区域点击，立即隐藏自动补全');
        hideAutocomplete();
        return; // 已处理，不再继续
    }

    // 对所有点击强制处理，只有以下情况不触发隐藏:
    // 1. 自动补全未显示
    // 2. 点击的是输入框本身
    // 3. 点击的是自动补全容器内部元素(已在项目点击事件中处理了隐藏)
    if (isAutocompleteVisible && event.target !== taskInput) {
        // 使用延迟执行，确保先触发其他事件处理器
        setTimeout(() => {
            console.log('全局点击处理：隐藏自动补全');
            hideAutocomplete();
        }, 10);
    }

    // 每次点击都尝试恢复输入框交互能力
    resetInputState();
});

// 确保自动补全容器能够正确接收事件
autocompleteContainer.addEventListener('mousedown', (event) => {
    // 阻止事件传播，确保点击自动补全容器内部时不会触发其他点击事件
    event.stopPropagation();
});

// 监听来自主进程的窗口焦点恢复消息
ipcRenderer.on('window-focused', () => {
    console.log('收到窗口已获得焦点的消息');
    // 强制重置输入框状态
    resetInputState();
    // 强制输入框获得焦点
    forceInputFocus();
});

// 在确认对话框关闭后，监听window的焦点恢复事件
window.addEventListener('focus', () => {
    console.log('窗口获得焦点');
    // 强制重置输入框状态
    setTimeout(() => {
        resetInputState();
        forceInputFocus();
    }, 50);
});

/**
 * 从LLM获取任务建议
 * @param {string} inputText 用户输入的文本
 * @returns {Promise<string[]>} 建议列表
 */
async function getLlmSuggestions(inputText) {
    try {
        // 从设置中获取API密钥和URL
        const settings = await ipcRenderer.invoke('get-settings');

        // 检查是否启用了LLM
        if (!settings.enableLlm) {
            return [];
        }

        const apiKey = settings.llmApiKey;
        const apiUrl = settings.llmApiUrl || 'https://api.openai.com/v1/chat/completions';

        if (!apiKey) {
            console.warn('未配置LLM API密钥，无法获取建议');
            return [];
        }

        // 根据API URL确定请求格式
        let requestData = {};

        // 检测百炼API
        const isBailianAPI = apiUrl.includes('dashscope.aliyuncs.com/compatible-mode') ||
            apiUrl.includes('dashscope.aliyuncs.com/v1/chat/completions');

        // 如果不是百炼API，强制使用百炼API格式
        if (!isBailianAPI) {
            console.warn('不是百炼API，已自动切换为百炼API格式');
        }

        // task.priority 是英文，需要转换为中文
        const chinesePriority = {
            'Urgent': '紧急',
            'High': '高',
            'Medium': '中',
            'Low': '低'
        };
        const historicalTitles = historicalTasks.map(task => `[${chinesePriority[task.priority]}] ${task.title}`).join('\n\n');

        // 通用消息
        const systemMessage = {
            role: 'system',
            content: settings.systemPrompt || `根据示例输出，产出一个相似的标题，不要输出额外的内容，和奇怪的格式，只要补全用户的任务标题输入。`
        };

        const userMessage = {
            role: 'user',
            content: `${inputText}"`
        };

        // 设置百炼API请求格式
        requestData = {
            model: settings.llmModel || 'qwen-plus',
            messages: [systemMessage, userMessage],
            temperature: 0.2,
            max_tokens: 30,
            examples: [
                {
                    input: `# 历史任务\n\n${historicalTitles}\n\n#用户输入\n前\n\n`,
                    output: `[中] 前端开发需求`
                },
                {
                    input: `# 历史任务\n\n${historicalTitles}\n\n#用户输入\n前端\n\n`,
                    output: `[中] 前端开发需求`
                },
                {
                    input: `# 历史任务\n\n${historicalTitles}\n\n#用户输入\n外网缺\n\n`,
                    output: `[紧急] 外网缺陷修复`
                },
                {
                    input: `# 历史任务\n\n${historicalTitles}\n\n#用户输入\n外网\n\n`,
                    output: `[紧急] 外网缺陷修复`
                }
            ]
        };

        // 合并任何额外的API参数
        if (settings.apiExtraParams && typeof settings.apiExtraParams === 'object') {
            requestData = { ...requestData, ...settings.apiExtraParams };
        }

        // 设置百炼API认证
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        // 添加用户设置的额外请求头
        if (settings.extraHeaders && typeof settings.extraHeaders === 'object') {
            headers = { ...headers, ...settings.extraHeaders };
        }

        // 打印完整请求数据（不包含API密钥）以便调试
        console.log('LLM API请求数据:', {
            apiType: '阿里云百炼',
            url: apiUrl,
            ...requestData
        });

        // 发送请求
        const response = await axios.post(apiUrl, requestData, {
            headers: headers,
            timeout: 10000 // 10秒超时
        });

        // 调试日志
        console.log('LLM API响应状态:', response.status);

        // 增强错误处理
        if (!response || !response.data) {
            console.error('LLM API返回空响应');
            return [];
        }

        // 检查API状态码
        if (response.status !== 200) {
            console.error(`LLM API返回错误状态码: ${response.status}`);
            return [];
        }

        // 检查是否有错误响应
        if (response.data.error) {
            console.error('API返回错误:', response.data.error);

            // 检查是否是消息格式问题
            if (response.data.error.message &&
                (response.data.error.message.includes('messages') ||
                    response.data.error.message.includes('format'))) {

                console.log('检测到可能是消息格式问题，尝试兼容模式...');

                // 尝试使用兼容模式重新请求
                try {
                    // 构建简化请求
                    const compatRequestData = {
                        model: settings.llmModel || 'qwen-plus',
                        messages: [
                            {
                                role: 'system',
                                content: '根据示例输出，产出一个相似的标题，不要输出额外的内容。'
                            },
                            {
                                role: 'user',
                                content: `${inputText}`
                            }
                        ],
                        temperature: 0.2,
                        max_tokens: 30,
                        examples: [
                            {
                                input: `# 历史任务\n\n${historicalTitles}#用户输入\n\n${inputText}\n\n`,
                                output: `[中] ${inputText}`
                            }
                        ]
                    };

                    console.log('使用兼容模式重新请求:', compatRequestData);

                    // 发送兼容模式请求
                    const compatResponse = await axios.post(apiUrl, compatRequestData, {
                        headers: headers,
                        timeout: 10000
                    });

                    // 如果兼容模式请求成功，使用兼容模式响应
                    if (compatResponse && compatResponse.status === 200) {
                        console.log('兼容模式请求成功');
                        response.data = compatResponse.data;
                    }
                } catch (compatError) {
                    console.error('兼容模式请求失败:', compatError);
                    // 继续使用原始响应
                }
            }
        }

        // 根据API类型解析响应
        let responseText = '';

        try {
            // 处理百炼API响应格式
            if (response.data.choices &&
                Array.isArray(response.data.choices) &&
                response.data.choices.length > 0 &&
                response.data.choices[0].message &&
                response.data.choices[0].message.content) {
                responseText = response.data.choices[0].message.content;
            } else {
                // 尝试其他可能的响应格式
                if (typeof response.data === 'string') {
                    responseText = response.data;
                } else if (response.data.output && response.data.output.text) {
                    responseText = response.data.output.text;
                } else if (response.data.text) {
                    responseText = response.data.text;
                } else if (response.data.result) {
                    responseText = response.data.result;
                }
            }

            // 记录提取到的响应文本
            console.log('提取到的响应文本:', responseText);

            if (!responseText) {
                console.error('无法从响应中提取文本内容');
                console.log('完整响应数据:', JSON.stringify(response.data));
                return [];
            }

            // 直接使用文本响应，按行分割获取建议
            let suggestions = [];

            try {
                // 按行分割文本
                suggestions = responseText.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .slice(0, 5); // 最多取5个建议

                // 如果没有足够的行，尝试按其他方式分割
                if (suggestions.length === 0) {
                    // 尝试按句号分割
                    suggestions = responseText.split('。')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .slice(0, 5);
                }

                // 如果仍然没有建议，可能是整个文本作为一个建议
                if (suggestions.length === 0 && responseText.trim()) {
                    suggestions = [responseText.trim()];
                }

                // 清理建议文本（移除可能的序号前缀如1.、2.等）
                suggestions = suggestions.map(s => {
                    // 移除序号前缀
                    return s.replace(/^\d+[\.\)、]\s*/, '').trim();
                });

                // 过滤掉空建议
                suggestions = suggestions.filter(s => s && s.trim().length > 0);

                // 限制建议数量
                suggestions = suggestions.slice(0, 5);

                console.log('处理后的建议列表:', suggestions);
                return suggestions;
            } catch (error) {
                console.error('处理响应文本时出错:', error);
                // 如果处理出错但有原始文本，返回原始文本
                if (responseText.trim()) {
                    return [responseText.trim()];
                }
                return [];
            }
        } catch (error) {
            console.error('处理LLM响应时出错:', error);
            return [];
        }
    } catch (error) {
        console.error('LLM API请求失败:', error);
        return [];
    }
}

// 调试辅助函数
function debugLlmState() {
    ipcRenderer.invoke('get-settings').then(settings => {
        console.log('=== LLM 状态检查 ===');
        console.log('LLM 功能启用状态:', settings.enableLlm ? '已启用' : '未启用');
        console.log('API 密钥:', settings.llmApiKey ? '已设置' : '未设置');
        console.log('API 端点:', settings.llmApiUrl);
        console.log('选择的模型:', settings.llmModel);
        console.log('当前自动补全容器状态:', isAutocompleteVisible ? '可见' : '隐藏');
        console.log('自动补全项目数:', autocompleteItems.length);
        console.log('历史任务数:', historicalTasks.length);
        console.log('LLM建议数:', llmSuggestions.length);
        console.log('LLM加载状态:', isLlmLoading ? '加载中' : '空闲');
        console.log('============================');
    }).catch(err => {
        console.error('获取LLM状态失败:', err);
    });
}

// 在文档加载完成后添加一个键盘快捷键来触发调试信息
document.addEventListener('keydown', (e) => {
    // 按下Ctrl+Alt+D显示调试信息
    if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
        debugLlmState();
    }
}); 