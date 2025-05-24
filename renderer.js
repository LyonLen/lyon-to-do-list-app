const { ipcRenderer } = require('electron');
const { v4: uuidv4 } = require('uuid');

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

// 自动补全相关变量
let autocompleteItems = [];
let selectedAutocompleteIndex = -1;
let historicalTasks = [];
let isAutocompleteVisible = false;

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
    // 查找匹配的历史任务
    const matches = findMatches(inputValue);

    if (matches.length === 0) {
        hideAutocomplete();
        return;
    }

    // 显示匹配结果
    renderAutocompleteItems(matches);

    // 确保DOM更新后再添加显示类
    setTimeout(() => {
        // 恢复显示和点击事件
        autocompleteContainer.style.display = '';
        autocompleteContainer.style.pointerEvents = 'auto';

        // 添加显示类
        autocompleteContainer.classList.add('show');
        isAutocompleteVisible = true;

        // 将自动补全容器移到文档最前面以避免层叠上下文问题
        document.body.appendChild(autocompleteContainer);

        // 调整位置，确保在输入框上方
        positionAutocompleteContainer();

        // 添加调试信息
        console.log('显示自动补全容器:', matches.length + '个选项');

        // 默认选中第一项
        selectedAutocompleteIndex = 0;
        highlightSelectedItem();
    }, 0);
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

    autocompleteContainer.classList.remove('show');
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

    // 调整底部位置，确保有足够空间显示所有项目
    autocompleteContainer.style.bottom = (window.innerHeight - inputRect.top) + 'px';

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
    autocompleteContainer.innerHTML = '';

    // 添加提示信息
    const hint = document.createElement('div');
    hint.className = 'autocomplete-hint';
    hint.textContent = '按 Tab 键自动补全 ↹';
    autocompleteContainer.appendChild(hint);

    // 保存当前的自动补全项
    autocompleteItems = items;

    // 如果没有匹配项但有输入内容，显示空状态
    if (items.length === 0 && taskInput.value.trim()) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'autocomplete-empty';
        emptyDiv.textContent = '没有匹配的任务';
        autocompleteContainer.appendChild(emptyDiv);
        return;
    }

    // 确保selectedAutocompleteIndex在有效范围内
    if (selectedAutocompleteIndex < 0 || selectedAutocompleteIndex >= items.length) {
        selectedAutocompleteIndex = 0;
    }

    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';

        // 只有当前选中的项添加selected类
        if (index === selectedAutocompleteIndex) {
            div.classList.add('selected');
        }

        div.dataset.index = index;

        // AI建议项标记 - 只添加视觉标记，不添加选中状态
        if (item.isAISuggestion) {
            div.classList.add('ai-suggestion');
        }

        // 添加优先级标识
        const prioritySpan = document.createElement('span');
        prioritySpan.className = `autocomplete-priority ${item.priority.toLowerCase()}`;
        div.appendChild(prioritySpan);

        // 添加任务标题
        const titleSpan = document.createElement('span');
        titleSpan.className = 'autocomplete-title'; // 添加类名以便于样式设置
        titleSpan.textContent = item.title;
        div.appendChild(titleSpan);

        // 如果是AI建议，添加AI标签
        if (item.isAISuggestion) {
            const aiTag = document.createElement('span');
            aiTag.className = 'ai-tag';
            aiTag.textContent = 'AI';
            div.appendChild(aiTag);
        }

        // 添加标签信息（如果有）
        if (item.tags && item.tags.length > 0) {
            const tagsSpan = document.createElement('span');
            tagsSpan.className = 'autocomplete-tags';
            tagsSpan.textContent = item.tags.map(tag => `#${tag}`).join(' ');
            div.appendChild(tagsSpan);
        }

        // 为推荐项添加点击事件处理逻辑
        div.addEventListener('click', (event) => {
            // 阻止事件冒泡，避免触发document上的点击事件
            event.stopPropagation();
            // 点击推荐项后手动关闭推荐列表
            hideAutocomplete();
        });

        // 特别处理标题部分，阻止冒泡
        titleSpan.addEventListener('click', (event) => {
            event.stopPropagation();
            hideAutocomplete();
        });

        autocompleteContainer.appendChild(div);
    });
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