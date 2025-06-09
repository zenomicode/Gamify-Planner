// API and WebSocket base URLs - using window object to avoid redeclaration
// Check if window.API_BASE_URL is already defined (from load-components-head.js)
if (typeof window.window.API_BASE_URL === 'undefined') {
  window.window.API_BASE_URL = "/api"; // Use window object to avoid redeclaration
}
const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";
const WS_BASE_URL = `${WS_PROTOCOL}://${window.location.host}${window.window.API_BASE_URL}`; // Using window.API_BASE_URL for WebSocket URL

// Store for tasks and catalogs
let tasks = [];
let catalogs = [];
let currentEditingTaskId = null;
let currentCatalogId = null;
// Хранилище для отслеживания задач, за которые уже был нанесен урон
let damagedTaskIds = new Set();
let dailyTaskInstances = new Map(); // Карта для хранения экземпляров ежедневных задач

// Функция для получения дня недели в формате базы данных
function getCurrentDayOfWeek() {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = new Date();
  return days[today.getDay()];
}

// Функция для проверки, должна ли ежедневная задача отображаться сегодня
function shouldShowDailyTaskToday(task) {
  if (!task.daily_tasks || task.daily_tasks.length === 0) {
    return false;
  }
  
  const today = getCurrentDayOfWeek();
  return task.daily_tasks.some(dailyTask => dailyTask.day_week === today);
}

// Функция для создания уникального экземпляра ежедневной задачи
function createDailyTaskInstance(task) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD формат
  const instanceId = `${task.task_id}_${today}`;
  
  // Проверяем, не создан ли уже экземпляр на сегодня
  if (dailyTaskInstances.has(instanceId)) {
    return dailyTaskInstances.get(instanceId);
  }
  
  // Проверяем сохраненное состояние в localStorage
  const savedState = localStorage.getItem(`daily_task_${instanceId}`);
  const completed = savedState === 'true' ? 'true' : 'false';
  
  // Создаем новый экземпляр задачи на сегодня
  const taskInstance = {
    ...task,
    instance_id: instanceId,
    original_task_id: task.task_id,
    completed: completed, // Используем сохраненное состояние
    date: today,
    is_daily_instance: true
  };
  
  dailyTaskInstances.set(instanceId, taskInstance);
  return taskInstance;
}


// Функция для получения ежедневных задач на сегодня
function getTodaysDailyTasks() {
  const todaysTasks = [];
  
  tasks.forEach(task => {
    // Проверяем только задачи с ежедневными повторениями
    if (task.daily_tasks && task.daily_tasks.length > 0) {
      if (shouldShowDailyTaskToday(task)) {
        const taskInstance = createDailyTaskInstance(task);
        todaysTasks.push(taskInstance);
      }
    }
  });
  
  return todaysTasks;
}

// Fetch user's catalogs from API
async function fetchCatalogs() {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) {
      console.error("No authentication token found");
      return;
    }

    const response = await fetch(`${window.API_BASE_URL}/catalogs/`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      catalogs = data;
      renderCatalogs();
    } else {
      console.error("Failed to fetch catalogs:", response.status);
      // Create default catalog if none exists
      createDefaultCatalog();
    }
  } catch (error) {
    console.error("Error fetching catalogs:", error);
    createDefaultCatalog();
  }
}

// Create a default catalog if user has none
async function createDefaultCatalog() {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const response = await fetch(`${window.API_BASE_URL}/catalogs/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Входящие",
        user_id: 0 // Will be replaced by server with current user's ID
      })
    });

    if (response.ok) {
      const newCatalog = await response.json();
      catalogs = [newCatalog];
      renderCatalogs();
    }
  } catch (error) {
    console.error("Error creating default catalog:", error);
  }
}

// Fetch tasks for a specific catalog
async function fetchCatalogTasks(catalogId) {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const response = await fetch(`${window.API_BASE_URL}/catalogs/${catalogId}/tasks`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.ok) {
      const catalogTasks = await response.json();
      // Merge with existing tasks, replacing any with same ID
      tasks = tasks.filter(t => t.catalog_id !== catalogId);
      tasks = [...tasks, ...catalogTasks];
      renderTasks();
      // Проверяем просроченные выполненные задачи после загрузки всех задач
      checkOverdueCompletedTasks();

    }
  } catch (error) {
    console.error(`Error fetching tasks for catalog ${catalogId}:`, error);
  }
}

// Fetch all tasks for all catalogs
async function fetchAllTasks() {
  tasks = [];
  for (const catalog of catalogs) {
    await fetchCatalogTasks(catalog.catalog_id);
  }
}

// Функция для проверки просроченных выполненных задач и нанесения урона
async function checkOverdueCompletedTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Собираем просроченные выполненные задачи
  const overdueTasks = tasks.filter(task => {
    // Проверяем, что задача выполнена
    if (task.completed !== 'false') return false;
    
    // Проверяем, что у задачи есть дедлайн
    if (!task.deadline) return false;
    
    // Проверяем, что дедлайн прошел
    const deadlineDate = new Date(task.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    
    // Проверяем, что за эту задачу еще не был нанесен урон
    return deadlineDate < today && !damagedTaskIds.has(task.task_id);
  });
  
  // Если есть просроченные выполненные задачи, наносим урон
  if (overdueTasks.length > 0) {
    for (const task of overdueTasks) {
      await applyDamageForTask(task);
    }
    
    // Обновляем список задач после нанесения урона и удаления
    renderTasks();
  }
}

// Функция для нанесения урона за задачу и её удаления
async function applyDamageForTask(task) {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    
    // Определяем урон в зависимости от сложности задачи
    let damage = 4; // По умолчанию для 'normal'
    if (task.complexity === 'easy') {
      damage = 3;
    } else if (task.complexity === 'hard') {
      damage = 5;
    }
    
    // Сначала получаем текущее количество жизней пользователя
    const userResponse = await fetch(`${window.API_BASE_URL}/users/me`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    
    if (!userResponse.ok) {
      console.error(`Failed to get user info: ${userResponse.status}`);
      return;
    }
    
    const userData = await userResponse.json();
    
    // Проверяем, что у пользователя есть поле lives
    if (userData.lives === undefined) {
      console.error("User data doesn't contain lives field");
      return;
    }
    
    if (userData.class_id === 4) {
      damage = damage - 1;
    }

    // Вычисляем новое значение жизней (целое число)
    const currentLives = parseInt(userData.lives);
    const newLives = Math.max(0, currentLives - damage); // Не даем уйти в отрицательные значения
    
    // Вызываем API для обновления жизней пользователя
    const updateResponse = await fetch(`${window.API_BASE_URL}/users/me`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        login: userData.login,
        nickname: userData.nickname,
        user_id: userData.user_id,
        lives: newLives // Отправляем новое целочисленное значение
      })
    });
    
    if (updateResponse.ok) {
      console.log(`Damage applied for task ${task.task_id}: ${damage} lives. Lives reduced from ${currentLives} to ${newLives}`);
      
      // Добавляем задачу в список тех, за которые уже нанесен урон
      damagedTaskIds.add(task.task_id);
      
      // Удаляем задачу
      await deleteTask(task.task_id);
    } else {
      console.error(`Failed to apply damage for task ${task.task_id}:`, updateResponse.status);
    }
  } catch (error) {
    console.error(`Error applying damage for task ${task.task_id}:`, error);
  }
}


// Render catalogs in the UI
function renderCatalogs() {
  const container = document.getElementById('catalogs-container');
  if (!container) return;
  
  // Clear container
  container.innerHTML = '';
  // Add "Мой день" catalog first
  const myDayCatalog = document.createElement('div');
  myDayCatalog.className = 'catalog';
  myDayCatalog.id = 'my-day-catalog';

  myDayCatalog.innerHTML = `
    <div class="catalog-header">
      <h2 class="catalog-title">Мой день</h2>
      <div class="catalog-actions">
        <!-- Кнопка добавления задачи не нужна для "Мой день", так как это виртуальный каталог -->
      </div>
    </div>
    <div class="catalog-content">
      <ul class="tasks-list" id="tasks-my-day"></ul>
    </div>
  `;

  container.appendChild(myDayCatalog);

  
  // Add each catalog
  catalogs.forEach(catalog => {
    const catalogElement = document.createElement('div');
    catalogElement.className = 'catalog';
    catalogElement.id = `catalog-${catalog.catalog_id}`;
    
    catalogElement.innerHTML = `
      <div class="catalog-header">
        <h2 class="catalog-title">${catalog.name}</h2>
        <div class="catalog-actions">
          <button class="btn-task add-task-btn" data-catalog="${catalog.catalog_id}">+</button>
          <button class="delete-catalog-btn" data-catalog="${catalog.catalog_id}">🗑️</button>
        </div>
      </div>
      <div class="catalog-content">
        <ul class="tasks-list" id="tasks-${catalog.catalog_id}"></ul>
      </div>
    `;
    
    container.appendChild(catalogElement);
  });
  
  // Add event listeners
  document.querySelectorAll('.add-task-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openNewTaskModal(parseInt(this.dataset.catalog));
    });
  });
  
  document.querySelectorAll('.delete-catalog-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteCatalog(parseInt(this.dataset.catalog));
    });
  });
  
  // Fetch tasks for each catalog
  fetchAllTasks();
}

// Render tasks in the UI
// Render tasks in the UI
function renderTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toLocaleDateString('ru-RU');
  
  // Clear all task lists
  document.querySelectorAll('.tasks-list').forEach(list => {
    list.innerHTML = '';
  });
  
  // Clear calendar
  const calendarContent = document.getElementById('calendar-content');
  if (calendarContent) {
    calendarContent.innerHTML = '';
  }
  
  // Group tasks for calendar
  const calendarTasks = {};
  
  // Group tasks by catalog and date
  const catalogTasks = {};
  const todayTasks = [];
  
  // Получаем ежедневные задачи на сегодня
  const dailyTasksToday = getTodaysDailyTasks();
  todayTasks.push(...dailyTasksToday);
  
  // Process regular tasks AND daily tasks for catalogs
  tasks.forEach(task => {
    // Initialize catalog tasks object if not exists
    if (!catalogTasks[task.catalog_id]) {
      catalogTasks[task.catalog_id] = {
        withDate: {},
        withoutDate: [],
        dailyTasks: [] // Добавляем группу для ежедневных задач
      };
    }
    
    // Обрабатываем ежедневные задачи для каталогов (НЕ для "Мой день")
    if (task.daily_tasks && task.daily_tasks.length > 0) {
      // Добавляем ежедневную задачу в её каталог
      catalogTasks[task.catalog_id].dailyTasks.push(task);
      return; // Переходим к следующей задаче
    }
    
    // Group by date for catalog display (обычные задачи)
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      const dateStr = deadlineDate.toLocaleDateString('ru-RU');
      
      // Check if task is for today
      if (dateStr === todayStr) {
        todayTasks.push(task);
      } else {
        // Group by date for catalog display (only if not today)
        if (!catalogTasks[task.catalog_id].withDate[dateStr]) {
          catalogTasks[task.catalog_id].withDate[dateStr] = [];
        }
        catalogTasks[task.catalog_id].withDate[dateStr].push(task);
      }
    } else {
      // Tasks without date go to their original catalogs
      catalogTasks[task.catalog_id].withoutDate.push(task);
    }
    
    // Add task to calendar if it has deadline
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      const dateStr = deadlineDate.toLocaleDateString('ru-RU');
      
      if (!calendarTasks[dateStr]) {
        calendarTasks[dateStr] = [];
      }
      
      if (!calendarTasks[dateStr].some(t => t.task_id === task.task_id)) {
        calendarTasks[dateStr].push(task);
      }
    }
  });

  // Render today's tasks in "Мой день"
  const myDayTasksList = document.getElementById('tasks-my-day');
  if (myDayTasksList) {
    if (todayTasks.length > 0) {
      // Create task group container
      const taskGroup = document.createElement('div');
      taskGroup.className = 'task-group';
      myDayTasksList.appendChild(taskGroup);
      
      // Add today's tasks
      todayTasks.forEach(task => {
        addTaskToGroup(task, taskGroup);
      });
    } else {
      // Show message if no tasks for today
      const noTasksMsg = document.createElement('div');
      noTasksMsg.className = 'no-tasks-message';
      noTasksMsg.textContent = 'Нет задач на сегодня';
      myDayTasksList.appendChild(noTasksMsg);
    }
  }
  
  // Render tasks in catalogs (включая ежедневные задачи)
  for (const catalogId in catalogTasks) {
    const catalogData = catalogTasks[catalogId];
    const tasksList = document.getElementById(`tasks-${catalogId}`);
    
    if (tasksList) {
      // Render tasks with dates first, sorted by date
      const sortedDates = Object.keys(catalogData.withDate).sort((a, b) => {
        const [dayA, monthA, yearA] = a.split('.');
        const [dayB, monthB, yearB] = b.split('.');
        
        const dateA = new Date(yearA, monthA - 1, dayA);
        const dateB = new Date(yearB, monthB - 1, dayB);
        
        return dateA - dateB;
      });
        
      sortedDates.forEach(dateStr => {
        // Create date header
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.textContent = dateStr;
        tasksList.appendChild(dateHeader);
        
        // Create task group container
        const taskGroup = document.createElement('div');
        taskGroup.className = 'task-group';
        tasksList.appendChild(taskGroup);
        
        // Add tasks for this date
        catalogData.withDate[dateStr].forEach(task => {
          addTaskToGroup(task, taskGroup, 'catalog');
        });
      });
      
      // Render tasks without date
      if (catalogData.withoutDate.length > 0) {
        // Create "No date" header
        const noDateHeader = document.createElement('div');
        noDateHeader.className = 'date-header no-date';
        noDateHeader.textContent = 'Без даты';
        tasksList.appendChild(noDateHeader);
        
        // Create task group container
        const taskGroup = document.createElement('div');
        taskGroup.className = 'task-group';
        tasksList.appendChild(taskGroup);
        
        // Add tasks without date
        catalogData.withoutDate.forEach(task => {
          addTaskToGroup(task, taskGroup, 'catalog');
        });
      }
      
      // НОВОЕ: Render daily tasks last (в самом низу)
      if (catalogData.dailyTasks && catalogData.dailyTasks.length > 0) {
        // Create daily tasks header
        const dailyHeader = document.createElement('div');
        dailyHeader.className = 'date-header daily-tasks';
        dailyHeader.textContent = 'Повторяющиеся задачи';
        tasksList.appendChild(dailyHeader);
        
        // Create task group container
        const taskGroup = document.createElement('div');
        taskGroup.className = 'task-group';
        tasksList.appendChild(taskGroup);
        
        // Add daily tasks
        catalogData.dailyTasks.forEach(task => {
          addTaskToGroup(task, taskGroup, 'catalog');
        });
      }
    }
  }
  
  // Render calendar tasks
  renderCalendarTasks(calendarTasks);
}

function addTaskToGroup(task, taskGroup, context = 'my-day') {
  const taskItem = document.createElement('div');
  taskItem.className = 'task-item';
  
  // Для ежедневных задач используем instance_id, для обычных - task_id
  const taskIdentifier = task.is_daily_instance ? task.instance_id : task.task_id;
  taskItem.dataset.taskId = taskIdentifier;
  
  // Определяем, нужен ли чекбокс
  const needCheckbox = context === 'my-day' || !task.daily_tasks || task.daily_tasks.length === 0;
  
  if (needCheckbox) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.completed === 'true';
    
    checkbox.addEventListener('change', function() {
      task.completed = this.checked ? 'true' : 'false';
      taskText.classList.toggle('completed', this.checked);
      
      if (task.is_daily_instance) {
        // Для ежедневных задач обновляем только локальный экземпляр
        updateDailyTaskInstance(task, this.checked);
      } else {
        // Для обычных задач отправляем запрос на сервер
        updateTaskCompletion(task.task_id, this.checked);
      }
    });
    
    taskItem.appendChild(checkbox);
  }
  
  const taskText = document.createElement('span');
  taskText.className = 'task-text' + (task.completed === 'true' ? ' completed' : '');
  taskText.textContent = task.name;
  
  // Добавляем индикатор для ежедневных задач в "Мой день"
  if (task.is_daily_instance && context === 'my-day') {
    taskText.textContent += ' 🔄'; // Иконка повторения
  }
  
  
  // Add complexity indicator
  const complexityIndicator = document.createElement('span');
  complexityIndicator.className = `complexity-indicator ${task.complexity}`;
  complexityIndicator.textContent = {
    'easy': '⚪',
    'normal': '🔵',
    'hard': '🔴'
  }[task.complexity] || '🔵';
  
  taskItem.appendChild(taskText);
  taskItem.appendChild(complexityIndicator);
  taskGroup.appendChild(taskItem);
  
  // Edit task on click
  taskItem.addEventListener('click', (e) => {
    if (e.target.type !== 'checkbox') {
      if (task.is_daily_instance) {
        // Для ежедневных задач редактируем оригинальную задачу
        editTask(task.original_task_id);
      } else {
        editTask(task.task_id);
      }
    }
  });
}

// Функция для обновления экземпляра ежедневной задачи
function updateDailyTaskInstance(taskInstance, completed) {
  taskInstance.completed = completed ? 'true' : 'false';
  dailyTaskInstances.set(taskInstance.instance_id, taskInstance);
  
  // Сохраняем состояние в localStorage
  localStorage.setItem(`daily_task_${taskInstance.instance_id}`, taskInstance.completed);
  
  // Если задача выполнена, можно добавить логику награды
  if (completed) {
    console.log(`Daily task instance ${taskInstance.instance_id} completed`);
    // Здесь можно добавить логику начисления опыта/золота
  }
}

// Add a task to its catalog in the UI
function addTaskToCatalog(task, listId) {
  const tasksList = document.getElementById(listId);
  if (!tasksList) return;
  
  const taskItem = document.createElement('li');
  taskItem.className = 'task-item';
  taskItem.dataset.taskId = task.task_id;
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed === 'true';
  
  const taskText = document.createElement('span');
  taskText.className = 'task-text' + (task.completed === 'true' ? ' completed' : '');
  taskText.textContent = task.name;
  
  // Add complexity indicator
  const complexityIndicator = document.createElement('span');
  complexityIndicator.className = `complexity-indicator ${task.complexity}`;
  complexityIndicator.textContent = {
    'easy': '⚪',
    'normal': '🔵',
    'hard': '🔴'
  }[task.complexity] || '🔵';
  
  checkbox.addEventListener('change', function() {
    task.completed = this.checked;
    taskText.classList.toggle('completed', this.checked);
    updateTaskCompletion(task.task_id, this.checked);
  });
  
  taskItem.appendChild(checkbox);
  taskItem.appendChild(taskText);
  taskItem.appendChild(complexityIndicator);
  tasksList.appendChild(taskItem);
  
  // Edit task on click
  taskItem.addEventListener('click', (e) => {
    if (e.target !== checkbox) {
      editTask(task.task_id);
    }
  });
}

// Add a task to the calendar
function addTaskToCalendar(task, calendarTasks, today) {
  // Tasks with deadline
  if (task.deadline) {
    const deadlineDate = new Date(task.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    const dateStr = deadlineDate.toLocaleDateString('ru-RU');
    
    if (!calendarTasks[dateStr]) {
      calendarTasks[dateStr] = [];
    }
    
    // Check if task is already in this date
    if (!calendarTasks[dateStr].some(t => t.task_id === task.task_id)) {
      calendarTasks[dateStr].push(task);
    }
  }
  
  // Tasks with daily repetitions
  if (task.daily_tasks && task.daily_tasks.length > 0) {
    const nextDate = getNextRepeatDate(task.daily_tasks, today);
    if (nextDate) {
      const dateStr = nextDate.toLocaleDateString('ru-RU');
      
      if (!calendarTasks[dateStr]) {
        calendarTasks[dateStr] = [];
      }
      
      // Check if task is already in this date
      if (!calendarTasks[dateStr].some(t => t.task_id === task.task_id)) {
        calendarTasks[dateStr].push(task);
      }
    }
  }
}

// Get the next repeat date for a task
function getNextRepeatDate(dailyTasks, fromDate) {
  const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
  const todayDay = fromDate.getDay();
  
  // Find the closest repeat day
  let minDiff = 7;
  dailyTasks.forEach(dailyTask => {
    const dayNumber = dayMap[dailyTask.day_week];
    let diff = dayNumber - todayDay;
    if (diff <= 0) diff += 7;
    if (diff < minDiff) minDiff = diff;
  });
  
  // Create next execution date
  const nextDate = new Date(fromDate);
  nextDate.setDate(nextDate.getDate() + minDiff);
  return nextDate;
}

// Render tasks in the calendar
function renderCalendarTasks(calendarTasks) {
  const calendarContent = document.getElementById('calendar-content');
  if (!calendarContent) return;
  
  // Sort dates
  const sortedDates = Object.keys(calendarTasks).sort((a, b) => {
    return new Date(a) - new Date(b);
  });
  
  // Display tasks by date
  sortedDates.forEach(date => {
    const dayElement = document.createElement('div');
    dayElement.className = 'calendar-day';
    
    const dateElement = document.createElement('div');
    dateElement.className = 'calendar-date';
    dateElement.textContent = date;
    dayElement.appendChild(dateElement);
    
    calendarTasks[date].forEach(task => {
      const taskElement = document.createElement('div');
      taskElement.className = 'task-item';
      taskElement.style.margin = '5px 0';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.checked = task.completed || false;
      checkbox.style.marginRight = '10px';
      
      const taskText = document.createElement('span');
      taskText.className = 'task-text' + (task.completed ? ' completed' : '');
      taskText.textContent = task.name;
      
      // Add complexity indicator
      const complexityIndicator = document.createElement('span');
      complexityIndicator.className = `complexity-indicator ${task.complexity}`;
      complexityIndicator.textContent = {
        'easy': '⚪',
        'normal': '🔵',
        'hard': '🔴'
      }[task.complexity] || '🔵';
      complexityIndicator.style.marginLeft = '10px';
      
      checkbox.addEventListener('change', function() {
        task.completed = this.checked;
        taskText.classList.toggle('completed', this.checked);
        updateTaskCompletion(task.task_id, this.checked);
      });
      
      taskElement.addEventListener('click', (e) => {
        if (e.target !== checkbox) {
          editTask(task.task_id);
        }
      });
      
      taskElement.appendChild(checkbox);
      taskElement.appendChild(taskText);
      taskElement.appendChild(complexityIndicator);
      dayElement.appendChild(taskElement);
    });
    
    calendarContent.appendChild(dayElement);
  });
}

// Update task completion status
async function updateTaskCompletion(taskId, completed) {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    // In this implementation, we're not actually updating completion status
    // as it's not part of the task schema. This would need to be implemented
    // in a real application.
    console.log(`Task ${taskId} completion status: ${completed}`);
    if (completed) {
      const task = tasks.find(t => t.task_id === taskId);
      if (task && task.deadline) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const deadlineDate = new Date(task.deadline);
        deadlineDate.setHours(0, 0, 0, 0);
        
        // Если дедлайн прошел и за эту задачу еще не был нанесен урон
        if (deadlineDate < today && !damagedTaskIds.has(taskId)) {
          await applyDamageForTask(task);
          // Обновляем список задач после нанесения урона и удаления
          tasks = tasks.filter(t => t.task_id !== taskId);
          renderTasks();
        }
      }
    }
  } catch (error) {
    console.error(`Error updating task ${taskId} completion:`, error);
  }
}

// Open modal for new task
function openNewTaskModal(catalogId) {
  currentEditingTaskId = null;
  currentCatalogId = catalogId;
  
  document.getElementById('task-modal-title').textContent = 'Новая задача';
  document.getElementById('task-input').value = '';
  document.getElementById('deadline-input').value = '';
  
  // Reset complexity selection
  document.querySelectorAll('.complexity-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.querySelector('.complexity-btn[data-complexity="normal"]').classList.add('selected');
  
  // Reset day selection
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  document.getElementById('delete-task-btn').style.display = 'none';
  document.getElementById('task-modal').style.display = 'flex';
  document.getElementById('task-input').focus();
}

// Open modal for editing task
async function editTask(taskId) {
  const task = tasks.find(t => t.task_id === taskId);
  if (!task) return;
  
  currentEditingTaskId = taskId;
  currentCatalogId = task.catalog_id;
  
  document.getElementById('task-modal-title').textContent = 'Редактировать задачу';
  document.getElementById('task-input').value = task.name;
  document.getElementById('deadline-input').value = task.deadline ? new Date(task.deadline).toISOString().substr(0, 10) : '';
  
  // Set complexity
  document.querySelectorAll('.complexity-btn').forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.complexity === (task.complexity || 'normal')) {
      btn.classList.add('selected');
    }
  });
  
  // Set repeat days
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.classList.remove('selected');
    if (task.daily_tasks && task.daily_tasks.some(dt => dt.day_week === btn.dataset.day)) {
      btn.classList.add('selected');
    }
  });
  
  document.getElementById('delete-task-btn').style.display = 'block';
  document.getElementById('task-modal').style.display = 'flex';
  document.getElementById('task-input').focus();
  attachSaveListener(taskId);
  attachDeleteListener(taskId);

}


function attachSaveListener(taskId) {
  const oldBtn = document.getElementById('save-task-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.replaceWith(newBtn);

  newBtn.addEventListener('click', () => saveTask());
}

function attachDeleteListener(taskId) {
  const oldBtn = document.getElementById('delete-task-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.replaceWith(newBtn);

  newBtn.addEventListener('click', () => deleteTask(taskId));
}


// Save task
async function saveTask() {
  const name = document.getElementById('task-input').value.trim();
  if (!name) return;
  
  const deadline = document.getElementById('deadline-input').value || null;
  
  // Get selected complexity
  const complexityBtn = document.querySelector('.complexity-btn.selected');
  const complexity = complexityBtn ? complexityBtn.dataset.complexity : 'normal';
  
  // Get selected repeat days
  const repeatDays = Array.from(document.querySelectorAll('.day-btn.selected'))
                      .map(btn => btn.dataset.day);
  
  // Check that deadline and repeat days are not both selected
  if (deadline && repeatDays.length > 0) {
    alert('Нельзя одновременно выбрать дедлайн и повторения!');
    return;
  }
  
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    
    if (currentEditingTaskId) {
      // Update existing task via API
      const response = await fetch(`${window.API_BASE_URL}/tasks/${currentEditingTaskId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: name,
          complexity: complexity,
          deadline: deadline ? new Date(deadline).toISOString().split('T')[0] : null,
          catalog_id: currentCatalogId
        })
      });
      
      if (response.ok) {
        // Handle daily tasks update
        if (repeatDays.length > 0) {
          // Delete existing daily tasks
          await fetch(`${window.API_BASE_URL}/tasks/${currentEditingTaskId}/daily-tasks`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
          });
          
          // Create new daily tasks
          for (const day of repeatDays) {
            await fetch(`${window.API_BASE_URL}/daily-tasks/`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                task_id: currentEditingTaskId,
                day_week: day
              })
            });
          }
        } else {
          // If no repeat days selected, delete all existing daily tasks
          await fetch(`${window.API_BASE_URL}/tasks/${currentEditingTaskId}/daily-tasks`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
          });
        }
        
        // Refresh tasks from server to get updated data
        await fetchCatalogTasks(currentCatalogId);
      } else {
        console.error("Failed to update task:", response.status);
        alert("Ошибка при обновлении задачи. Пожалуйста, попробуйте снова.");
        return;
      }
    } else {
      // Create new task
      const response = await fetch(`${window.API_BASE_URL}/tasks/`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          catalog_id: currentCatalogId,
          name: name,
          complexity: complexity,
          deadline: deadline ? new Date(deadline).toISOString().split('T')[0] : null
        })
      });
      
      if (response.ok) {
        const newTask = await response.json();
        
        // Add daily tasks if selected
        if (repeatDays.length > 0) {
          for (const day of repeatDays) {
            await fetch(`${window.API_BASE_URL}/daily-tasks/`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                task_id: newTask.task_id,
                day_week: day
              })
            });
          }
        }
        
        // Refresh tasks from server to get updated data
        await fetchCatalogTasks(currentCatalogId);
      } else {
        console.error("Failed to create task:", response.status);
        alert("Ошибка при создании задачи. Пожалуйста, попробуйте снова.");
        return;
      }
    }
    
    renderTasks();
    document.getElementById('task-modal').style.display = 'none';
  } catch (error) {
    console.error("Error saving task:", error);
    alert("Ошибка при сохранении задачи. Пожалуйста, попробуйте снова.");
  }
}

// Delete task
async function deleteTask(currentEditingTaskId) {
  if (!currentEditingTaskId) return;
  
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    
    const response = await fetch(`${window.API_BASE_URL}/tasks/${currentEditingTaskId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (response.ok) {
      tasks = tasks.filter(t => t.task_id !== currentEditingTaskId);
      renderTasks();
      document.getElementById('task-modal').style.display = 'none';
    }
  } catch (error) {
    console.error("Error deleting task:", error);
    alert("Ошибка при удалении задачи. Пожалуйста, попробуйте снова.");
  }
}

// Create new catalog
async function createCatalog() {
  const catalogName = document.getElementById('catalog-input').value.trim();
  if (!catalogName) return;
  
  if (catalogs.some(c => c.name === catalogName)) {
    alert('Каталог с таким именем уже существует!');
    return;
  }
  
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    
    const response = await fetch(`${window.API_BASE_URL}/catalogs/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: catalogName,
        user_id: 0 // Will be replaced by server with current user's ID
      })
    });
    
    if (response.ok) {
      const newCatalog = await response.json();
      catalogs.push(newCatalog);
      renderCatalogs();
      document.getElementById('catalog-modal').style.display = 'none';
      document.getElementById('catalog-input').value = '';
    }
  } catch (error) {
    console.error("Error creating catalog:", error);
    alert("Ошибка при создании каталога. Пожалуйста, попробуйте снова.");
  }
}

// Delete catalog
async function deleteCatalog(catalogId) {
  // Confirm deletion
  if (!confirm("Вы уверены, что хотите удалить этот каталог и все его задачи?")) {
    return;
  }
  
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    
    // Вызываем API для удаления каталога и всех его задач
    const response = await fetch(`${window.API_BASE_URL}/catalogs/${catalogId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (response.ok) {
      // Удаляем каталог и его задачи из локального хранилища
      catalogs = catalogs.filter(c => c.catalog_id !== catalogId);
      tasks = tasks.filter(t => t.catalog_id !== catalogId);
      
      // Обновляем UI
      renderCatalogs();
    } else {
      console.error("Failed to delete catalog:", response.status);
      alert("Ошибка при удалении каталога. Пожалуйста, попробуйте снова.");
    }
  } catch (error) {
    console.error("Error deleting catalog:", error);
    alert("Ошибка при удалении каталога. Пожалуйста, попробуйте снова.");
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  // Очищаем старые экземпляры ежедневных задач
  cleanupOldDailyTaskInstances();
  
  // Остальная инициализация...
  fetchCatalogs();
  
  // Set up complexity button handlers
  document.querySelectorAll('.complexity-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.complexity-btn').forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
    });
  });
  
  // Set up day button handlers
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      this.classList.toggle('selected');
      
      // If days are selected, reset deadline
      if (document.querySelectorAll('.day-btn.selected').length > 0) {
        document.getElementById('deadline-input').value = '';
      }
    });
  });
  
  // Set up deadline input handler
  document.getElementById('deadline-input').addEventListener('change', function() {
    if (this.value) {
      // If deadline is set, reset day selection
      document.querySelectorAll('.day-btn.selected').forEach(btn => {
        btn.classList.remove('selected');
      });
    }
  });
  
  // Set up button handlers
  document.getElementById('add-task-calendar-btn')?.addEventListener('click', () => {
    console.log('Кнопка "Добавить задачу" нажата');
    const taskModal = document.getElementById('task-modal');
    console.log('Модальное окно задачи:', taskModal);
    
    // Find first catalog or create one
    if (catalogs.length > 0) {
      console.log('Каталоги найдены:', catalogs);
      openNewTaskModal(catalogs[0].catalog_id);
    } else {
      console.log('Каталоги не найдены, создаю дефолтный каталог');
      createDefaultCatalog().then(() => {
        if (catalogs.length > 0) {
          openNewTaskModal(catalogs[0].catalog_id);
        }
      });
    }
  });
  
  document.getElementById('cancel-task-btn')?.addEventListener('click', function() {
    document.getElementById('task-modal').style.display = 'none';
  });
  
  document.getElementById('save-task-btn')?.addEventListener('click', saveTask);
  document.getElementById('delete-task-btn')?.addEventListener('click', deleteTask);
  
  document.getElementById('create-catalog-btn')?.addEventListener('click', function() {
    document.getElementById('catalog-modal').style.display = 'flex';
    document.getElementById('catalog-input').focus();
  });
  
  // Добавляем обработчик для кнопки создания каталога с правильным ID
  document.getElementById('add-catalog-btn')?.addEventListener('click', function() {
    console.log('Кнопка "Создать каталог" нажата');
    const catalogModal = document.getElementById('catalog-modal');
    console.log('Модальное окно каталога:', catalogModal);
    catalogModal.style.display = 'flex';
    document.getElementById('catalog-input').focus();
  });
  
  document.getElementById('cancel-catalog-btn')?.addEventListener('click', function() {
    document.getElementById('catalog-modal').style.display = 'none';
  });
  
  document.getElementById('save-catalog-btn')?.addEventListener('click', createCatalog);
  
  // Close modals when clicking outside
  window.addEventListener('click', function(event) {
    const taskModal = document.getElementById('task-modal');
    const catalogModal = document.getElementById('catalog-modal');
    
    if (event.target === taskModal) {
      taskModal.style.display = 'none';
    }
    
    if (event.target === catalogModal) {
      catalogModal.style.display = 'none';
    }
  });
});


// Update task completion status
async function updateTaskCompletion(taskId, completed) {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    // Отправляем PATCH-запрос для обновления статуса выполнения задачи
    const response = await fetch(`${window.API_BASE_URL}/tasks/${taskId}/completion`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        completed: completed ? 'true' : 'false'
      })
    });
    
    if (response.ok) {
      const updatedTask = await response.json();
      // Обновляем задачу в локальном массиве
      const taskIndex = tasks.findIndex(t => t.task_id === taskId);
      if (taskIndex !== -1) {
        tasks[taskIndex].completed = updatedTask.completed;
      }
      console.log(`Task ${taskId} completion status updated to: ${completed ? 'true' : 'false'}`);
      if (typeof window.refreshUserData === 'function') {
        await window.refreshUserData();
        console.log('User data refreshed after task completion');
      }

    } else {
      console.error(`Failed to update task ${taskId} completion status:`, response.status);
      // Откатываем изменения в UI, если запрос не удался
      const taskElements = document.querySelectorAll(`[data-task-id="${taskId}"]`);
      taskElements.forEach(element => {
        const checkbox = element.querySelector('.task-checkbox');
        const taskText = element.querySelector('.task-text');
        if (checkbox) {
          checkbox.checked = !completed; // Возвращаем предыдущее состояние
        }
        if (taskText) {
          taskText.classList.toggle('completed', !completed);
        }
      });
    }
  } catch (error) {
    console.error(`Error updating task ${taskId} completion:`, error);
    // Откатываем изменения в UI в случае ошибки
    const taskElements = document.querySelectorAll(`[data-task-id="${taskId}"]`);
    taskElements.forEach(element => {
      const checkbox = element.querySelector('.task-checkbox');
      const taskText = element.querySelector('.task-text');
      if (checkbox) {
        checkbox.checked = !completed; // Возвращаем предыдущее состояние
      }
      if (taskText) {
        taskText.classList.toggle('completed', !completed);
      }
    });
  }
}

async function updateDailyTaskInstance(taskInstance, completed) {
  try {
    // Обновляем локальное состояние
    taskInstance.completed = completed ? 'true' : 'false';
    dailyTaskInstances.set(taskInstance.instance_id, taskInstance);
    
    if (completed) {
      // Если задача выполнена, даем награду
      const token = localStorage.getItem("access_token");
      if (token) {
        // Используем тот же API что и для обычных задач, но передаем original_task_id
        const response = await fetch(`${window.API_BASE_URL}/tasks/${taskInstance.original_task_id}/completion`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            completed: 'true'
          })
        });
        
        if (response.ok) {
          console.log(`Daily task instance ${taskInstance.instance_id} completed successfully`);
          if (typeof window.refreshUserData === 'function') {
            await window.refreshUserData();
            console.log('User data refreshed after daily task completion');
          }
        } else {
          console.error(`Failed to complete daily task instance ${taskInstance.instance_id}`);
        }
      }
    }
  } catch (error) {
    console.error('Error updating daily task instance:', error);
  }
}

function cleanupOldDailyTaskInstances() {
  const today = new Date().toISOString().split('T')[0];
  
  // Очищаем старые экземпляры из памяти
  for (const [instanceId, taskInstance] of dailyTaskInstances.entries()) {
    if (taskInstance.date !== today) {
      dailyTaskInstances.delete(instanceId);
    }
  }
  
  // Очищаем старые записи из localStorage
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('daily_task_')) {
      const instanceId = key.replace('daily_task_', '');
      const [taskId, date] = instanceId.split('_');
      if (date !== today) {
        keysToRemove.push(key);
      }
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
}