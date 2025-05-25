const { ipcRenderer } = require('electron');
const marked = require('marked');

// DOM Elements
const closeBtn = document.getElementById('close-btn');
const taskEditForm = document.getElementById('taskEditForm');
const editTaskId = document.getElementById('editTaskId');
const editTaskTitle = document.getElementById('editTaskTitle');
const editTaskStartTime = document.getElementById('editTaskStartTime');
const editTaskTags = document.getElementById('editTaskTags');
const editTaskEstimatedTime = document.getElementById('editTaskEstimatedTime');
const editTaskPriority = document.getElementById('editTaskPriority');
const editTaskNotes = document.getElementById('editTaskNotes');
const saveTaskBtn = document.getElementById('saveTaskBtn');
const cancelTaskEditBtn = document.getElementById('cancelTaskEditBtn');
const notesTabs = document.querySelectorAll('.notes-tab');
const markdownPreview = document.getElementById('markdownPreview');

let currentTask = null;

// 初始化窗口
document.addEventListener('DOMContentLoaded', () => {
    // 监听主进程传递的任务数据
    ipcRenderer.on('task-data', (event, task) => {
        fillTaskForm(task);
    });

    // 关闭按钮事件
    closeBtn.addEventListener('click', () => {
        ipcRenderer.send('close-task-edit-window');
    });

    // 取消按钮事件
    cancelTaskEditBtn.addEventListener('click', () => {
        ipcRenderer.send('close-task-edit-window');
    });

    // 保存按钮事件
    saveTaskBtn.addEventListener('click', () => {
        saveTaskEdit();
    });

    // 标签页切换事件
    notesTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有标签页的active类
            notesTabs.forEach(t => t.classList.remove('active'));
            // 移除所有面板的active类
            document.querySelectorAll('.notes-panel').forEach(p => p.classList.remove('active'));

            // 添加当前标签页的active类
            tab.classList.add('active');

            // 显示对应的面板
            const tabId = tab.getAttribute('data-tab');
            if (tabId === 'edit') {
                document.getElementById('editPanel').classList.add('active');
            } else if (tabId === 'preview') {
                document.getElementById('previewPanel').classList.add('active');
                // 更新预览内容
                renderMarkdownPreview();
            }
        });
    });

    // 实时预览 - 编辑内容时更新预览
    editTaskNotes.addEventListener('input', () => {
        // 如果预览面板可见，则更新预览
        if (document.getElementById('previewPanel').classList.contains('active')) {
            renderMarkdownPreview();
        }
    });

    // 监听Esc键关闭窗口
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            ipcRenderer.send('close-task-edit-window');
        }
    });
});

// 填充表单数据
function fillTaskForm(task) {
    currentTask = task;

    editTaskId.value = task.id;
    editTaskTitle.value = task.title || '';

    // 处理开始时间
    if (task.created) {
        // 将ISO时间字符串转换为本地datetime-local格式
        const createdDate = new Date(task.created);
        // 格式化为YYYY-MM-DDThh:mm格式
        const formattedDate = createdDate.toISOString().slice(0, 16);
        editTaskStartTime.value = formattedDate;
    } else {
        editTaskStartTime.value = '';
    }

    // 处理标签
    if (task.tags && task.tags.length > 0) {
        editTaskTags.value = task.tags.join(', ');
    } else {
        editTaskTags.value = '';
    }

    // 处理预估时长
    editTaskEstimatedTime.value = task.estimatedTime || '';

    // 处理优先级
    editTaskPriority.value = task.priority || 'Medium';

    // 处理备忘录
    editTaskNotes.value = task.notes || '';

    // 渲染初始Markdown预览
    renderMarkdownPreview();
}

// 保存任务编辑
function saveTaskEdit() {
    // 获取表单数据
    const updatedTask = {
        id: editTaskId.value,
        title: editTaskTitle.value.trim(),
        // 将本地datetime-local转换为ISO字符串
        created: editTaskStartTime.value ? new Date(editTaskStartTime.value).toISOString() : new Date().toISOString(),
        // 处理标签 - 分隔并清理空格
        tags: editTaskTags.value.split(',').map(tag => tag.trim()).filter(tag => tag),
        estimatedTime: editTaskEstimatedTime.value.trim(),
        priority: editTaskPriority.value,
        notes: editTaskNotes.value.trim()
    };

    // 发送更新任务消息给主进程
    ipcRenderer.send('update-task-from-edit-window', updatedTask);
}

// 渲染Markdown预览
function renderMarkdownPreview() {
    const markdown = editTaskNotes.value;
    try {
        markdownPreview.innerHTML = marked.parse(markdown);
    } catch (error) {
        console.error('Markdown渲染失败:', error);
        markdownPreview.innerHTML = '<p class="error">Markdown渲染失败</p>';
    }
} 