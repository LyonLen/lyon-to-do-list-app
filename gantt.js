const { ipcRenderer } = require('electron');

// DOM元素引用
const ganttChart = document.getElementById('ganttChart');
const closeBtn = document.getElementById('close-btn');
const devToolsBtn = document.getElementById('dev-tools-btn'); // 开发者工具按钮
const viewTabs = document.querySelectorAll('.view-tab');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const taskTooltip = document.getElementById('taskTooltip');

// 全局变量
let allTasks = [];
let currentView = 'day'; // 默认视图：日视角
let startDate = new Date();
let endDate = new Date();
endDate.setDate(endDate.getDate() + 6); // 默认显示一周的数据
let startDateForTasks = null; // 用于存储动态计算的时间轴开始时间
let endDateForTasks = null; // 用于存储动态计算的时间轴结束时间

// 初始化函数
async function initialize() {
    try {
        // 获取所有任务数据
        console.log('正在获取任务数据...');
        allTasks = await ipcRenderer.invoke('get-all-tasks-for-gantt');
        console.log('原始任务数据:', allTasks);

        // 验证任务数据，将无效或格式错误的任务过滤掉
        allTasks = allTasks.filter(task => {
            // 检查任务是否为空或没有ID或标题
            if (!task || !task.id || !task.title) {
                console.log('过滤掉无效任务:', task);
                return false;
            }

            // 检查任务是否已被删除 - 检查多种可能的删除标记
            if (task.deleted === true ||
                task.isDeleted === true ||
                task.deletedAt ||
                task.removeTime ||
                task.state === 'deleted' ||
                task.status === 'deleted') {
                console.log(`过滤掉已删除的任务: ${task.title}`);
                return false;
            }

            // 检查并修正createdAt字段
            if (!task.createdAt) {
                if (task.created) {
                    // 有些任务可能使用created字段而不是createdAt
                    task.createdAt = task.created;
                    console.log(`修正任务的createdAt字段: ${task.title}`);
                } else {
                    console.log(`过滤掉没有创建时间的任务: ${task.title}`);
                    return false;
                }
            }

            // 尝试解析日期，确保是有效的日期格式
            try {
                const date = new Date(task.createdAt);
                if (isNaN(date.getTime())) {
                    console.log(`过滤掉日期无效的任务: ${task.title}, 日期: ${task.createdAt}`);
                    return false;
                }
                return true;
            } catch (e) {
                console.log(`过滤掉日期解析错误的任务: ${task.title}, 错误: ${e.message}`);
                return false;
            }
        });
        console.log('过滤有效任务后的数量:', allTasks.length);

        // 获取当前活跃任务列表的ID，用于确认任务是否真的被删除
        const currentTasks = await ipcRenderer.invoke('get-tasks');
        const currentTaskIds = new Set(currentTasks.map(task => task.id));
        console.log(`当前活跃任务数量: ${currentTasks.length}`);

        // 再次过滤，确保历史任务在当前活跃任务中存在，否则视为已删除
        allTasks = allTasks.filter(task => {
            // 如果是历史任务且不在当前活跃任务中，则视为已删除
            const isHistoricalTask = !task.isNew; // 假设历史任务没有isNew标记
            if (isHistoricalTask && !currentTaskIds.has(task.id)) {
                console.log(`过滤掉已不在当前活跃列表中的历史任务: ${task.title}`);
                return false;
            }
            return true;
        });
        console.log('第二次过滤后的任务数量:', allTasks.length);

        // 去重处理
        const uniqueTaskIds = new Set();
        allTasks = allTasks.filter(task => {
            if (uniqueTaskIds.has(task.id)) {
                return false;
            }
            uniqueTaskIds.add(task.id);
            return true;
        });
        console.log('去重后的任务数量:', allTasks.length);

        // 为每个任务计算实际持续时间
        calculateTaskDurations(allTasks);

        // 查看是否有任务数据可用于设置日期范围
        if (allTasks.length === 0) {
            console.log('没有有效的任务数据，使用默认日期范围');
            // 使用默认日期范围
            startDateInput.valueAsDate = startDate;
            endDateInput.valueAsDate = endDate;
        } else {
            // 找出最早的任务时间并设置为开始日期
            const earliestTask = allTasks.reduce((earliest, current) => {
                return new Date(current.createdAt) < new Date(earliest.createdAt) ? current : earliest;
            }, allTasks[0]);

            // 设置日期选择器的默认值为最早任务的日期
            const earliestDate = new Date(earliestTask.createdAt);

            // 设置默认开始日期为最早任务日期
            startDate = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), earliestDate.getDate());

            // 设置默认结束日期为开始日期后一周
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 6);

            // 更新日期选择器
            startDateInput.valueAsDate = startDate;
            endDateInput.valueAsDate = endDate;

            console.log(`设置默认日期范围: ${startDate.toLocaleString()} 到 ${endDate.toLocaleString()}`);
            console.log(`最早任务: ${earliestTask.title}, 创建时间: ${new Date(earliestTask.createdAt).toLocaleString()}`);
        }

        // 添加调试信息
        console.log(`已加载任务总数: ${allTasks.length}`);
        if (allTasks.length > 0) {
            console.log('第一个任务示例:', allTasks[0]);
        } else {
            console.log('没有可显示的任务');
        }

        // 初始渲染甘特图
        renderGanttChart();

        // 设置事件监听器
        setupEventListeners();
    } catch (error) {
        console.error('初始化甘特图时出错:', error);
    }
}

// 计算任务持续时间
function calculateTaskDurations(tasks) {
    tasks.forEach(task => {
        // 确保日期字段是Date对象
        task.createdDate = new Date(task.createdAt);

        if (task.completed && task.completedAt) {
            task.completedDate = new Date(task.completedAt);

            // 计算实际持续时间（毫秒）
            task.actualDuration = task.completedDate - task.createdDate;

            // 确保完成时间不早于创建时间
            if (task.actualDuration <= 0) {
                // 如果完成时间早于或等于创建时间，设置为至少15分钟
                task.completedDate = new Date(task.createdDate.getTime() + 15 * 60000);
                task.actualDuration = 15 * 60000;
            }
        } else {
            // 对于未完成的任务，使用预估时间
            task.estimatedDuration = parseEstimatedTime(task.title);
        }
    });
}

// 从任务标题中解析预估时间（例如@2h、@30m）
function parseEstimatedTime(title) {
    if (!title) return 3600000; // 默认为1小时（毫秒）

    const timeMatch = title.match(/@(\d+)([hm])/);
    if (!timeMatch) return 3600000;

    const amount = parseInt(timeMatch[1]);
    const unit = timeMatch[2];

    if (unit === 'h') {
        return amount * 3600000; // 小时转毫秒
    } else if (unit === 'm') {
        return amount * 60000; // 分钟转毫秒
    }

    return 3600000; // 默认为1小时
}

// 设置事件监听器
function setupEventListeners() {
    // 关闭按钮
    closeBtn.addEventListener('click', () => {
        window.close();
    });

    // 开发者工具按钮
    devToolsBtn.addEventListener('click', () => {
        ipcRenderer.send('open-gantt-devtools');
    });

    // 视图切换
    viewTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const newView = e.target.dataset.view;
            if (newView !== currentView) {
                currentView = newView;
                // 更新激活状态
                viewTabs.forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                // 重新渲染甘特图
                renderGanttChart();
            }
        });
    });

    // 日期选择器变化
    startDateInput.addEventListener('change', () => {
        startDate = startDateInput.valueAsDate;
        renderGanttChart();
    });

    endDateInput.addEventListener('change', () => {
        endDate = endDateInput.valueAsDate;
        renderGanttChart();
    });
}

// 渲染甘特图
function renderGanttChart() {
    // 清空甘特图内容
    ganttChart.innerHTML = '';

    // 重置动态时间轴变量
    startDateForTasks = null;
    endDateForTasks = null;

    // 创建甘特图内容容器
    const chartContent = document.createElement('div');
    chartContent.className = 'gantt-chart-content';

    // 如果是日视角，添加导航箭头
    if (currentView === 'day') {
        // 基于startDate创建一个新的日期对象，避免共享引用
        const displayDate = new Date(startDate);

        // 添加导航控件容器
        const navContainer = document.createElement('div');
        navContainer.className = 'date-navigation';
        navContainer.style.display = 'flex';
        navContainer.style.justifyContent = 'space-between';
        navContainer.style.alignItems = 'center';
        navContainer.style.marginBottom = '10px';

        // 创建向左箭头
        const leftArrow = document.createElement('button');
        leftArrow.className = 'nav-arrow left-arrow';
        leftArrow.innerHTML = '&larr;';
        leftArrow.title = '查看前一天';
        leftArrow.style.backgroundColor = 'rgba(40, 43, 50, 0.8)';
        leftArrow.style.color = '#aaa';
        leftArrow.style.border = 'none';
        leftArrow.style.borderRadius = '4px';
        leftArrow.style.padding = '8px 15px';
        leftArrow.style.cursor = 'pointer';
        leftArrow.style.fontWeight = 'bold';
        leftArrow.style.fontSize = '16px';
        leftArrow.style.transition = 'all 0.2s ease';
        leftArrow.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.2)';

        // 创建向右箭头
        const rightArrow = document.createElement('button');
        rightArrow.className = 'nav-arrow right-arrow';
        rightArrow.innerHTML = '&rarr;';
        rightArrow.title = '查看后一天';
        rightArrow.style.backgroundColor = 'rgba(40, 43, 50, 0.8)';
        rightArrow.style.color = '#aaa';
        rightArrow.style.border = 'none';
        rightArrow.style.borderRadius = '4px';
        rightArrow.style.padding = '8px 15px';
        rightArrow.style.cursor = 'pointer';
        rightArrow.style.fontWeight = 'bold';
        rightArrow.style.fontSize = '16px';
        rightArrow.style.transition = 'all 0.2s ease';
        rightArrow.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.2)';

        // 创建日期显示容器
        const dateDisplay = document.createElement('div');
        dateDisplay.className = 'current-date-display';
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        const dayOfWeek = displayDate.getDay();
        dateDisplay.textContent = `${displayDate.getFullYear()}年${displayDate.getMonth() + 1}月${displayDate.getDate()}日 (${dayNames[dayOfWeek]})`;
        dateDisplay.style.fontSize = '16px';
        dateDisplay.style.fontWeight = 'bold';
        dateDisplay.style.padding = '0 10px';

        // 添加事件监听器
        leftArrow.addEventListener('mouseenter', () => {
            leftArrow.style.backgroundColor = 'rgba(50, 53, 60, 0.9)';
            leftArrow.style.transform = 'translateY(-2px)';
            leftArrow.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
            leftArrow.style.color = '#ddd';
        });

        leftArrow.addEventListener('mouseleave', () => {
            leftArrow.style.backgroundColor = 'rgba(40, 43, 50, 0.8)';
            leftArrow.style.transform = 'translateY(0)';
            leftArrow.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.2)';
            leftArrow.style.color = '#aaa';
        });

        rightArrow.addEventListener('mouseenter', () => {
            rightArrow.style.backgroundColor = 'rgba(50, 53, 60, 0.9)';
            rightArrow.style.transform = 'translateY(-2px)';
            rightArrow.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
            rightArrow.style.color = '#ddd';
        });

        rightArrow.addEventListener('mouseleave', () => {
            rightArrow.style.backgroundColor = 'rgba(40, 43, 50, 0.8)';
            rightArrow.style.transform = 'translateY(0)';
            rightArrow.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.2)';
            rightArrow.style.color = '#aaa';
        });

        leftArrow.addEventListener('mousedown', () => {
            leftArrow.style.transform = 'translateY(1px)';
            leftArrow.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        leftArrow.addEventListener('mouseup', () => {
            leftArrow.style.transform = 'translateY(-2px)';
            leftArrow.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
        });

        rightArrow.addEventListener('mousedown', () => {
            rightArrow.style.transform = 'translateY(1px)';
            rightArrow.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        rightArrow.addEventListener('mouseup', () => {
            rightArrow.style.transform = 'translateY(-2px)';
            rightArrow.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
        });

        // 添加导航功能
        leftArrow.addEventListener('click', () => {
            // 向前移动一天
            startDate.setDate(startDate.getDate() - 1);
            endDate.setDate(endDate.getDate() - 1);

            // 更新日期输入框
            startDateInput.valueAsDate = startDate;
            endDateInput.valueAsDate = endDate;

            // 重新渲染图表，而不是尝试更新DOM元素
            // 这样可以确保所有日期显示都是一致的
            renderGanttChart();
        });

        rightArrow.addEventListener('click', () => {
            // 向后移动一天
            startDate.setDate(startDate.getDate() + 1);
            endDate.setDate(endDate.getDate() + 1);

            // 更新日期输入框
            startDateInput.valueAsDate = startDate;
            endDateInput.valueAsDate = endDate;

            // 重新渲染图表，而不是尝试更新DOM元素
            // 这样可以确保所有日期显示都是一致的
            renderGanttChart();
        });

        // 将导航元素添加到容器
        navContainer.appendChild(leftArrow);
        navContainer.appendChild(dateDisplay);
        navContainer.appendChild(rightArrow);

        // 将导航容器添加到图表内容之前
        ganttChart.appendChild(navContainer);
    }

    // 根据当前视图渲染时间轴和任务条
    if (currentView === 'day') {
        renderDayView(chartContent);
    } else {
        renderWeekView(chartContent);
    }

    // 添加到甘特图容器
    ganttChart.appendChild(chartContent);

    // 设置任务条鼠标悬停效果
    setupTaskBarHoverEffects();

    // 添加当前时间线
    addCurrentTimeLine(chartContent);
}

// 添加当前时间线
function addCurrentTimeLine(container) {
    // 获取当前时间
    const now = new Date();

    // 如果当前时间不在显示范围内，则不显示时间线
    const timeStart = startDateForTasks || startDate;
    // 计算结束时间，确保包括完整的一天
    const timeEnd = endDateForTasks || new Date(endDate.getTime() + 24 * 3600000);

    if (now < timeStart || now > timeEnd) {
        console.log('当前时间不在显示范围内，不显示时间线');
        return;
    }

    // 计算当前时间在时间轴上的位置
    const totalDuration = timeEnd - timeStart;
    const offsetFromStart = now - timeStart;
    const positionPercent = (offsetFromStart * 100 / totalDuration);

    console.log(`当前时间: ${now.toLocaleString()}`);
    console.log(`时间轴开始: ${timeStart.toLocaleString()}`);
    console.log(`时间轴结束: ${timeEnd.toLocaleString()}`);
    console.log(`当前时间偏移量: ${offsetFromStart}ms`);
    console.log(`时间轴总长度: ${totalDuration}ms`);
    console.log(`当前时间位置百分比: ${positionPercent.toFixed(2)}%`);

    // 创建当前时间线
    const timeLine = document.createElement('div');
    timeLine.className = 'current-time-line';

    // 修正：给时间线添加固定的左边距，与任务区域对齐
    if (currentView === 'week') {
        // 周视角时，计算当前日期在周内的位置
        const weekStart = startDateForTasks;
        const weekDay = now.getDay(); // 0-6，代表周日到周六

        // 计算当天占一周的比例
        const dayPercent = (weekDay * 100 / 7);

        // 计算当前时间在当天内的位置百分比
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const dayOffset = now - startOfDay;
        const dayDuration = 24 * 60 * 60 * 1000; // 一天的总毫秒数
        const timePercent = (dayOffset * 100 / dayDuration);

        // 每天占一周的1/7，所以当天内的位置需要按比例缩放
        const dayWidth = 100 / 7; // 一天占整个周的百分比
        const finalPosition = dayPercent + (timePercent * dayWidth / 100);

        console.log(`周视角时间线: 周内日期=${weekDay}, 日内偏移=${timePercent.toFixed(2)}%, 最终位置=${finalPosition.toFixed(2)}%`);

        // 设置时间线位置
        timeLine.style.left = `${finalPosition}%`;
        timeLine.style.marginLeft = '180px'; // 补偿任务标签的宽度
    } else {
        // 日视角使用原来的计算方法
        timeLine.style.left = `${positionPercent}%`;
        timeLine.style.marginLeft = '180px'; // 补偿任务标签的宽度
    }

    // 创建当前时间标记
    const timeMarker = document.createElement('div');
    timeMarker.className = 'current-time-marker';
    timeMarker.style.left = timeLine.style.left;
    timeMarker.style.marginLeft = timeLine.style.marginLeft;
    timeMarker.style.transform = 'translateX(-50%)';

    // 添加当前时间文字标记
    const timeLabel = document.createElement('div');
    timeLabel.className = 'current-time-label';
    timeLabel.style.left = timeLine.style.left;
    timeLabel.style.marginLeft = timeLine.style.marginLeft;
    timeLabel.style.transform = 'translateX(-50%)';
    timeLabel.textContent = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

    // 添加到容器
    container.appendChild(timeLine);
    container.appendChild(timeMarker);
    container.appendChild(timeLabel);
}

// 渲染日视角
function renderDayView(container) {
    // 创建时间轴容器
    const timeAxisContainer = document.createElement('div');
    timeAxisContainer.className = 'time-axis-container';
    timeAxisContainer.style.display = 'flex';
    timeAxisContainer.style.flexDirection = 'column';
    timeAxisContainer.style.marginLeft = '180px';
    timeAxisContainer.style.position = 'sticky';
    timeAxisContainer.style.top = '0';
    timeAxisContainer.style.zIndex = '11';
    timeAxisContainer.style.backgroundColor = 'rgba(35, 38, 45, 0.95)';
    timeAxisContainer.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';

    // 创建时间轴 - 只显示时间，不需要日期轴
    const timeAxis = document.createElement('div');
    timeAxis.className = 'time-axis';
    timeAxis.style.display = 'flex';
    timeAxis.style.height = '30px';
    timeAxis.style.width = '100%';
    timeAxis.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';

    // 获取当前时间，用于当前时间线显示
    const now = new Date();

    // 固定显示工作时间区间：0:00-23:00
    const workStartHour = 0;  // 工作开始时间
    const workEndHour = 23;   // 工作结束时间

    // 设置固定的开始和结束时间
    const startHour = new Date(startDate);
    startHour.setHours(workStartHour, 0, 0, 0);

    const endHour = new Date(startDate);
    endHour.setHours(workEndHour, 0, 0, 0);

    // 过滤符合日期范围的任务，排除已删除的任务
    const filteredTasks = allTasks.filter(task => {
        // 检查任务是否已被删除 - 检查多种可能的删除标记
        if (task.deleted === true ||
            task.isDeleted === true ||
            task.deletedAt ||
            task.removeTime ||
            task.state === 'deleted' ||
            task.status === 'deleted') {
            return false;
        }

        // 使用任务的创建日期（只保留年月日部分）
        const taskDate = new Date(task.createdAt);
        const taskDateOnly = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());

        const extendedStartDate = new Date(startHour);
        extendedStartDate.setDate(extendedStartDate.getDate());
        extendedStartDate.setHours(0, 0, 0, 0); // 设置为当天的开始

        const extendedEndDate = new Date(endHour);
        extendedEndDate.setDate(extendedEndDate.getDate());
        extendedEndDate.setHours(23, 59, 59, 999); // 设置为当天的结束

        return taskDateOnly >= extendedStartDate && taskDateOnly <= extendedEndDate;
    });

    // 调试信息：显示日期范围和过滤结果
    console.log(`过滤后任务数: ${filteredTasks.length}`);

    // 创建时间轴单元格
    for (let hour = workStartHour; hour <= workEndHour; hour++) {
        const timeCell = document.createElement('div');
        timeCell.className = 'time-cell';
        timeCell.textContent = `${hour}:00`;
        timeCell.style.maxWidth = '29.7px';
        timeCell.style.minWidth = '0px';
        timeAxis.appendChild(timeCell);
    }

    // 将时间轴添加到时间轴容器
    timeAxisContainer.appendChild(timeAxis);
    container.appendChild(timeAxisContainer);

    // 更新任务过滤的起止时间，保持一致性
    startDateForTasks = startHour;
    endDateForTasks = endHour;

    // 按创建日期排序
    filteredTasks.sort((a, b) => a.createdDate - b.createdDate);

    // 使用动态计算的时间范围
    const timeStart = startDate;
    const totalDuration = new Date(hour = 24);

    // 调用调试函数
    debugTaskRendering(filteredTasks, timeStart, totalDuration);

    // 创建任务行和任务条区域容器
    const taskContainer = document.createElement('div');
    taskContainer.className = 'task-container';
    taskContainer.style.marginTop = '10px';

    // 创建任务行
    filteredTasks.forEach(task => {
        const taskRow = document.createElement('div');
        taskRow.className = 'gantt-row';

        // 创建任务标签
        const taskLabel = document.createElement('div');
        taskLabel.className = 'task-label';

        // 处理长文本，创建文本容器
        const textSpan = document.createElement('span');
        textSpan.className = 'task-label-text';

        // 处理长文本，截断显示
        const maxTitleLength = 25; // 设置最大显示字符数
        let displayTitle = task.title;

        if (task.title.length > maxTitleLength) {
            displayTitle = task.title.substring(0, maxTitleLength) + '...';
        }

        textSpan.textContent = displayTitle;
        textSpan.title = task.title; // 添加完整标题作为提示

        // 添加文本容器到标签
        taskLabel.appendChild(textSpan);

        // 添加标签
        if (task.tags && task.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'task-tags';

            task.tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'task-tag';
                tagEl.textContent = tag;
                tagsContainer.appendChild(tagEl);
            });

            taskLabel.appendChild(tagsContainer);
        }

        taskRow.appendChild(taskLabel);

        // 创建任务条容器
        const taskBarContainer = document.createElement('div');
        taskBarContainer.className = 'task-bar-container';

        // 创建任务条
        const taskBar = document.createElement('div');
        taskBar.className = 'task-bar';
        taskBar.dataset.id = task.id;

        // 检查是否是通期任务 - 跨越多天或特别长的任务
        let isOngoing = false;

        // 获取任务的预计结束时间
        const estimatedEndTime = new Date(task.createdDate.getTime() + (task.estimatedDuration || 3600000));

        // 获取当前时间，用于检查是否已逾期
        const currentTime = new Date();

        // 如果任务持续时间超过24小时，标记为通期任务
        if ((estimatedEndTime - task.createdDate) >= 24 * 3600000) {
            isOngoing = true;
        }

        // 判断是否已逾期 - 如果预计结束时间已过但任务未完成，则为逾期任务
        if (!task.completed && estimatedEndTime < currentTime) {
            console.log(`逾期任务: ${task.title}, 预计结束时间: ${estimatedEndTime.toLocaleString()}, 当前时间: ${currentTime.toLocaleString()}`);
            isOngoing = true;
        }

        // 通期任务标记方式增强 - 匹配更多通期任务的标记方式
        const lowerTitle = task.title.toLowerCase();
        if (lowerTitle.includes('[通期]') ||
            lowerTitle.includes('#通期') ||
            lowerTitle.includes('通期') ||
            lowerTitle.includes('持续') ||
            lowerTitle.includes('长期') ||
            (task.tags && task.tags.some(tag =>
                tag.toLowerCase().includes('通期') ||
                tag.toLowerCase().includes('持续') ||
                tag.toLowerCase().includes('长期')
            ))) {
            isOngoing = true;
        }

        // 如果任务是当前正在执行的任务，也视为通期任务
        if (task.status === 'ongoing' || task.status === 'in-progress' || task.inProgress) {
            isOngoing = true;
        }

        // 设置任务条样式
        if (task.completed) {
            taskBar.classList.add('task-completed');
        } else if (isOngoing) {
            taskBar.classList.add('task-ongoing');
        } else {
            taskBar.classList.add('task-not-completed');
        }

        // 计算任务条位置和宽度
        const startTime = task.createdDate;
        let endTime;

        if (task.completed && task.completedDate) {
            // 已完成任务使用实际结束时间
            endTime = task.completedDate;
        } else {
            // 未完成任务使用预估结束时间
            endTime = new Date(startTime.getTime() + (task.estimatedDuration || 3600000));
        }

        // 限制结束时间不超过当前日期范围
        const maxEndDate = new Date(endDateForTasks || endDate);
        if (endTime > maxEndDate) {
            endTime = maxEndDate;
        }

        // 计算在时间轴上的位置（毫秒精度）
        let startOffset, endOffset;

        // 日视角保持原来精确到小时的计算
        startOffset = Math.max(0, startTime - startDate);
        endOffset = Math.max(startOffset + 60000, endTime - startDate); // 确保至少有1分钟的宽度

        // 调试这个特定任务的位置
        console.log(`任务: ${task.title}`);
        console.log(`  任务开始时间: ${startTime.toLocaleString()}`);
        console.log(`  时间轴开始: ${timeStart.toLocaleString()}`);
        console.log(`  开始偏移: ${startOffset}ms (${startOffset / (1000 * 60 * 60)}小时)`);
        console.log(`  总持续时间: ${totalDuration}ms (${totalDuration / (1000 * 60 * 60)}小时)`);

        // 设置任务条位置和宽度，确保最小宽度为10px
        const leftPercent = (startOffset * 100 / totalDuration);
        const widthPercent = Math.max(1.0, ((endOffset - startOffset) * 100 / totalDuration));

        console.log(`  位置百分比: left=${leftPercent.toFixed(2)}%, width=${widthPercent.toFixed(2)}%`);

        // 对于日视图，再次校正任务位置，确保与时间轴对齐
        // 首先检查任务日期是否在当前显示的日期范围内
        const taskDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
        console.log(`taskDate: ${startTime}`);
        console.log(`taskDate: ${startTime.getHours()}`);
        const timeStartDate = new Date(timeStart.getFullYear(), timeStart.getMonth(), timeStart.getDate());

        // 计算任务日期与时间轴起始日期的差异（天数）
        const daysDiff = Math.floor((taskDate - timeStartDate) / (24 * 3600 * 1000));

        // 如果任务不在当前显示的时间范围内，则不显示任务
        if (daysDiff < 0 || daysDiff > Math.ceil(totalDuration / (24 * 3600 * 1000))) {
            console.log(`任务超出显示范围: ${task.title}, 日期差: ${daysDiff}天`);
            taskBar.style.display = 'none';
        } else {
            // 获取任务开始时间的小时和分钟部分
            const taskStartHour = startTime.getHours();
            const taskStartMinutes = startTime.getMinutes();

            // 计算时间轴开始时间的小时部分
            const timeStartHour = timeStart.getHours();

            // 计算当天内从时间轴开始到任务开始的小时数（包括小数部分表示分钟）
            const hourDiff = (taskStartHour - timeStartHour) + (taskStartMinutes / 60);
            console.log(`hourDiff: ${hourDiff}`);

            // 获取时间轴总小时数 - 使用实际工作时间区间（例如8:00-19:00）
            const totalHours = workEndHour - workStartHour;

            // 计算任务持续时间（小时）
            const taskDurationHours = (endTime - startTime) / (1000 * 60 * 60);

            // 计算当天时间轴的占比 - 使用实际显示的小时数
            const singleDayHours = totalHours; // 实际显示的小时数
            const singleDayPercent = 100; // 当前视图时间轴占100%

            // 计算任务在当天内的开始位置百分比
            const hourPercent = (hourDiff / singleDayHours) * 100;

            // 计算基于当天的位置百分比
            const correctedLeftPercent = hourPercent;

            // 计算任务宽度百分比（但不超过当天结束）
            const maxWidthPercent = 100 - hourPercent; // 当天剩余宽度
            const correctedWidthPercent = Math.min(maxWidthPercent, (taskDurationHours / singleDayHours) * 100);

            // 记录修正后的位置
            console.log(`  修正后位置: left=${correctedLeftPercent.toFixed(2)}%, width=${correctedWidthPercent.toFixed(2)}%`);
            console.log(`  天数差: ${daysDiff}, 当天小时差: ${hourDiff}, 当天占比: ${singleDayPercent.toFixed(2)}%`);

            // 使用修正后的值
            taskBar.style.left = `${correctedLeftPercent}%`;
            taskBar.style.width = `${correctedWidthPercent}%`;

            // 更新数据集属性
            taskBar.dataset.left = correctedLeftPercent.toFixed(2);
            taskBar.dataset.width = correctedWidthPercent.toFixed(2);
        }

        // 存储任务信息用于悬停提示
        taskBar.dataset.title = task.title;
        taskBar.dataset.start = startTime.toLocaleString();
        taskBar.dataset.end = endTime.toLocaleString();
        taskBar.dataset.status = task.completed ? '已完成' : '进行中';

        // 计算持续时间文本
        let durationText = '';
        const durationMs = endTime - startTime;
        const durationDaysValue = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const durationHoursValue = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        if (durationDaysValue > 0) {
            durationText += `${durationDaysValue}天`;
        }
        if (durationHoursValue > 0 || durationDaysValue === 0) {
            durationText += `${durationHoursValue}小时`;
        }

        taskBar.dataset.duration = durationText;

        // 将任务条添加到容器中
        taskBarContainer.appendChild(taskBar);
        taskRow.appendChild(taskBarContainer);

        // 将任务行添加到任务容器
        taskContainer.appendChild(taskRow);
    });

    // 将任务容器添加到主容器
    container.appendChild(taskContainer);
}

// 渲染周视角
function renderWeekView(container) {
    // 创建时间轴容器
    const timeAxisContainer = document.createElement('div');
    timeAxisContainer.className = 'time-axis-container';
    timeAxisContainer.style.display = 'flex';
    timeAxisContainer.style.flexDirection = 'column';
    timeAxisContainer.style.marginLeft = '180px';
    timeAxisContainer.style.position = 'sticky';
    timeAxisContainer.style.top = '0';
    timeAxisContainer.style.zIndex = '11';
    timeAxisContainer.style.backgroundColor = 'rgba(35, 38, 45, 0.95)';
    timeAxisContainer.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';

    // 创建时间轴
    const timeAxis = document.createElement('div');
    timeAxis.className = 'time-axis';

    // 过滤符合日期范围的任务，排除已删除的任务
    const filteredTasks = allTasks.filter(task => {
        // 检查任务是否已被删除 - 检查多种可能的删除标记
        if (task.deleted === true ||
            task.isDeleted === true ||
            task.deletedAt ||
            task.removeTime ||
            task.state === 'deleted' ||
            task.status === 'deleted') {
            return false;
        }

        // 使用任务的创建日期（只保留年月日部分）
        const taskDate = new Date(task.createdAt);
        const taskDateOnly = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());

        // 扩大过滤范围，包括开始日期前一天和结束日期后一天的任务
        const nowDate = new Date();
        const extendedStartDate = new Date(year = nowDate.getFullYear(), month = nowDate.getMonth(), date = nowDate.getDate(), day = 0);
        extendedStartDate.setDate(extendedStartDate.getDate());
        extendedStartDate.setHours(0, 0, 0, 0); // 设置为当天的开始

        const extendedEndDate = new Date(year = nowDate.getFullYear(), month = nowDate.getMonth(), date = nowDate.getDate(), day = 6);
        extendedEndDate.setDate(extendedEndDate.getDate());
        extendedEndDate.setHours(23, 59, 59, 999); // 设置为当天的结束

        return taskDateOnly >= extendedStartDate && taskDateOnly <= extendedEndDate;
    });

    // 调试信息：显示日期范围和过滤结果
    console.log(`周视角 - 日期范围: ${startDate.toLocaleString()} 到 ${endDate.toLocaleString()}`);
    console.log(`周视角 - 过滤后任务数: ${filteredTasks.length}`);

    // 获取当前时间，用于确保当前时间在时间轴范围内
    const now = new Date();
    let earliestStart, latestEnd;

    // 计算以当前时间为中心的周视图
    earliestStart = new Date(now);
    earliestStart.setDate(earliestStart.getDate() - now.getDay()); // 从本周日开始
    earliestStart.setHours(0, 0, 0, 0);

    latestEnd = new Date(earliestStart);
    latestEnd.setDate(latestEnd.getDate() + 7); // 显示一周

    // 更新全局时间轴变量，用于正确显示当前时间线
    startDateForTasks = earliestStart;
    endDateForTasks = latestEnd;

    // 创建日期标签
    for (let day = 0; day < 7; day++) {
        const cellDate = new Date(earliestStart);
        cellDate.setDate(cellDate.getDate() + day);

        const timeCell = document.createElement('div');
        timeCell.className = 'time-cell';
        timeCell.classList.add('date-cell'); // 所有日期单元格添加样式

        // 显示完整日期（带年份）和星期
        const year = cellDate.getFullYear();
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        timeCell.textContent = `${year}/${cellDate.getMonth() + 1}/${cellDate.getDate()} (${dayNames[cellDate.getDay()]})`;

        timeAxis.appendChild(timeCell);
    }

    // 将时间轴添加到时间轴容器
    timeAxisContainer.appendChild(timeAxis);

    // 将时间轴容器添加到主容器
    container.appendChild(timeAxisContainer);

    // 按创建日期排序
    filteredTasks.sort((a, b) => a.createdDate - b.createdDate);

    const nowDate = new Date();
    const weekStartDate = new Date(year = nowDate.getFullYear(), month = nowDate.getMonth(), date = nowDate.getDate(), day = 0);
    const weekEndDate = new Date(year = nowDate.getFullYear(), month = nowDate.getMonth(), date = nowDate.getDate(), day = 6);

    // 使用动态计算的时间范围
    const timeStart = weekStartDate;

    // 创建任务行和任务条区域容器
    const taskContainer = document.createElement('div');
    taskContainer.className = 'task-container';
    taskContainer.style.marginTop = '10px';

    // 创建任务行
    filteredTasks.forEach(task => {
        const taskRow = document.createElement('div');
        taskRow.className = 'gantt-row';

        // 创建任务标签
        const taskLabel = document.createElement('div');
        taskLabel.className = 'task-label';

        // 处理长文本，创建文本容器
        const textSpan = document.createElement('span');
        textSpan.className = 'task-label-text';

        // 处理长文本，截断显示
        const maxTitleLength = 25; // 设置最大显示字符数
        let displayTitle = task.title;

        if (task.title.length > maxTitleLength) {
            displayTitle = task.title.substring(0, maxTitleLength) + '...';
        }

        textSpan.textContent = displayTitle;
        textSpan.title = task.title; // 添加完整标题作为提示

        // 添加文本容器到标签
        taskLabel.appendChild(textSpan);

        // 添加标签
        if (task.tags && task.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'task-tags';

            task.tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'task-tag';
                tagEl.textContent = tag;
                tagsContainer.appendChild(tagEl);
            });

            taskLabel.appendChild(tagsContainer);
        }

        taskRow.appendChild(taskLabel);

        // 创建任务条容器
        const taskBarContainer = document.createElement('div');
        taskBarContainer.className = 'task-bar-container';

        // 创建任务条
        const taskBar = document.createElement('div');
        taskBar.className = 'task-bar';
        taskBar.dataset.id = task.id;

        // 检查是否是通期任务 - 跨越多天或特别长的任务
        let isOngoing = false;

        // 获取任务的预计结束时间
        const estimatedEndTime = new Date(task.createdDate.getTime() + (task.estimatedDuration || 3600000));

        // 获取当前时间，用于检查是否已逾期
        const currentTime = new Date();

        // 如果任务持续时间超过24小时，标记为通期任务
        if ((estimatedEndTime - task.createdDate) >= 24 * 3600000) {
            isOngoing = true;
        }

        // 判断是否已逾期 - 如果预计结束时间已过但任务未完成，则为逾期任务
        if (!task.completed && estimatedEndTime < currentTime) {
            console.log(`逾期任务: ${task.title}, 预计结束时间: ${estimatedEndTime.toLocaleString()}, 当前时间: ${currentTime.toLocaleString()}`);
            isOngoing = true;
        }

        // 通期任务标记方式增强 - 匹配更多通期任务的标记方式
        const lowerTitle = task.title.toLowerCase();
        if (lowerTitle.includes('[通期]') ||
            lowerTitle.includes('#通期') ||
            lowerTitle.includes('通期') ||
            lowerTitle.includes('持续') ||
            lowerTitle.includes('长期') ||
            (task.tags && task.tags.some(tag =>
                tag.toLowerCase().includes('通期') ||
                tag.toLowerCase().includes('持续') ||
                tag.toLowerCase().includes('长期')
            ))) {
            isOngoing = true;
        }

        // 如果任务是当前正在执行的任务，也视为通期任务
        if (task.status === 'ongoing' || task.status === 'in-progress' || task.inProgress) {
            isOngoing = true;
        }

        // 设置任务条样式
        if (task.completed) {
            taskBar.classList.add('task-completed');
        } else if (isOngoing) {
            taskBar.classList.add('task-ongoing');
        } else {
            taskBar.classList.add('task-not-completed');
        }

        // 计算任务条位置和宽度
        const startTime = task.createdDate;
        let endTime;

        if (task.completed && task.completedDate) {
            // 已完成任务使用实际结束时间
            endTime = task.completedDate;
        } else {
            // 未完成任务使用预估结束时间
            endTime = new Date(startTime.getTime() + (task.estimatedDuration || 3600000));
        }

        // 限制结束时间不超过当前日期范围
        const maxEndDate = new Date(endDateForTasks || endDate);
        if (endTime > maxEndDate) {
            endTime = maxEndDate;
        }

        // 用于周视角的任务位置计算
        // 对于周视角，计算任务在周内的准确位置
        const startDay = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
        const timeStartDay = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());

        // 计算当前任务所在周的第几天（0-6）
        const dayIndex = Math.floor((startDay - timeStartDay) / (24 * 60 * 60 * 1000));

        // 一天在整周中的宽度百分比
        const dayWidth = 100 / 7; // 7天

        // 计算任务在当天内的起始位置（小时百分比）
        const dayStartTime = new Date(startDay);
        dayStartTime.setHours(0, 0, 0, 0);
        const hourOffset = (startTime - dayStartTime) / (24 * 60 * 60 * 1000); // 占一天的比例

        // 计算任务持续时间（小时）
        const taskDurationHours = (endTime - startTime) / (60 * 60 * 1000);

        // 计算任务持续时间占一天的比例
        const durationDayRatio = taskDurationHours / 24;

        // 计算左侧位置：dayIndex*dayWidth 是任务所在日期的起始位置
        // hourOffset*dayWidth 是任务在当天内的偏移量
        const leftPercent = (dayIndex * dayWidth) + (hourOffset * dayWidth);

        // 计算宽度：任务持续时间占一天的比例，再乘以每天的宽度
        // 但不超过当天结束位置
        const remainingDayWidth = dayWidth - (hourOffset * dayWidth); // 当天剩余宽度
        const widthPercent = Math.min(remainingDayWidth, durationDayRatio * dayWidth);

        // 确保最小宽度
        const minWidthPercent = 0.5; // 最小宽度百分比
        const finalWidthPercent = Math.max(minWidthPercent, widthPercent);

        console.log(`周视角任务位置计算 - ${task.title}:`);
        console.log(`  所在日期: 周内第${dayIndex}天`);
        console.log(`  日内开始时间比例: ${hourOffset.toFixed(4)}`);
        console.log(`  持续时间: ${taskDurationHours.toFixed(2)}小时`);
        console.log(`  左侧位置: ${leftPercent.toFixed(2)}%`);
        console.log(`  宽度: ${finalWidthPercent.toFixed(2)}%`);

        // 设置任务条位置和宽度
        taskBar.style.left = `${leftPercent}%`;
        taskBar.style.width = `${finalWidthPercent}%`;

        // 记录关键位置和宽度到自定义属性（便于调试）
        taskBar.dataset.left = leftPercent.toFixed(2);
        taskBar.dataset.width = finalWidthPercent.toFixed(2);

        // 存储任务信息用于悬停提示
        taskBar.dataset.title = task.title;
        taskBar.dataset.start = startTime.toLocaleString();
        taskBar.dataset.end = endTime.toLocaleString();
        taskBar.dataset.status = task.completed ? '已完成' : '进行中';

        // 计算持续时间文本
        let durationText = '';
        const durationMs = endTime - startTime;
        const durationDaysValue = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const durationHoursValue = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        if (durationDaysValue > 0) {
            durationText += `${durationDaysValue}天`;
        }
        if (durationHoursValue > 0 || durationDaysValue === 0) {
            durationText += `${durationHoursValue}小时`;
        }

        taskBar.dataset.duration = durationText;

        // 将任务条添加到容器中
        taskBarContainer.appendChild(taskBar);
        taskRow.appendChild(taskBarContainer);

        // 将任务行添加到任务容器
        taskContainer.appendChild(taskRow);
    });

    // 将任务容器添加到主容器
    container.appendChild(taskContainer);
}

// 设置任务条鼠标悬停效果
function setupTaskBarHoverEffects() {
    const taskBars = document.querySelectorAll('.task-bar');

    taskBars.forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            // 更新提示框内容
            const tooltipTitle = document.querySelector('.tooltip-title');
            const tooltipStartTime = document.querySelector('.tooltip-start-time');
            const tooltipEndTime = document.querySelector('.tooltip-end-time');
            const tooltipDuration = document.querySelector('.tooltip-duration');
            const tooltipStatus = document.querySelector('.tooltip-status');

            tooltipTitle.textContent = e.target.dataset.title;
            tooltipStartTime.textContent = e.target.dataset.start;
            tooltipEndTime.textContent = e.target.dataset.end;
            tooltipDuration.textContent = e.target.dataset.duration;
            tooltipStatus.textContent = e.target.dataset.status;

            // 显示提示框
            taskTooltip.classList.add('visible');

            // 计算提示框位置
            const barRect = e.target.getBoundingClientRect();
            const tooltipRect = taskTooltip.getBoundingClientRect();

            let left = barRect.left + barRect.width / 2 - tooltipRect.width / 2;
            let top = barRect.top - tooltipRect.height - 10;

            // 确保提示框不超出视口
            if (left < 10) left = 10;
            if (left + tooltipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tooltipRect.width - 10;
            }

            if (top < 10) {
                top = barRect.bottom + 10;
            }

            taskTooltip.style.left = `${left}px`;
            taskTooltip.style.top = `${top}px`;
        });

        bar.addEventListener('mouseleave', () => {
            // 隐藏提示框
            taskTooltip.classList.remove('visible');
        });
    });
}

// 调试函数：检查任务渲染情况
function debugTaskRendering(filteredTasks, timeStart, totalDuration) {
    console.log(`时间轴开始: ${timeStart.toLocaleString()}`);
    console.log(`时间轴总长度: ${totalDuration}ms (${totalDuration / 3600000}小时)`);
    console.log(`符合日期范围的任务数: ${filteredTasks.length}`);

    if (filteredTasks.length > 0) {
        filteredTasks.forEach((task, index) => {
            const startTime = task.createdDate;
            let endTime;

            if (task.completed && task.completedDate) {
                endTime = task.completedDate;
            } else {
                endTime = new Date(startTime.getTime() + (task.estimatedDuration || 3600000));
            }

            const startOffset = startTime - timeStart;
            const endOffset = endTime - timeStart;
            const leftPercent = (startOffset * 100 / totalDuration);
            const widthPercent = ((endOffset - startOffset) * 100 / totalDuration);

            console.log(`任务 ${index + 1}: ${task.title}`);
            console.log(`  开始时间: ${startTime.toLocaleString()}, 结束时间: ${endTime.toLocaleString()}`);
            console.log(`  位置: left=${leftPercent.toFixed(2)}%, width=${widthPercent.toFixed(2)}%`);
        });
    }
}

// 初始化应用
initialize(); 